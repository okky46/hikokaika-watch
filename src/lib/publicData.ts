// ============================================================
// ビルド時の公開データ取得
//
// - DATA_SOURCE=sample なら data/sample/ を使用
// - DATA_SOURCE=supabase なら Supabase から取得
// - Cloudflare Pages では未指定や production + sample をフェイルクローズ
// - Cloudflare Pages 以外で DEPLOY_ENV / DATA_SOURCE が両方未設定なら development + sample
//
// このモジュールはビルド時(Node)専用。ブラウザからは import しない。
// ============================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { classifyCommentStance, latestCommentStanceFromEvent } from './commentTags';
import { resolvePublicDataEnvironment } from './buildEnv';
import { hasFormalAnnouncement } from './caseFilters';
import { deriveCaseFields, firstVisibleReportOccurredAt } from './derive';
import { renderSparkline } from './sparkline';
import { sanitizeLargeShareholdingMetadata } from './noteMetadataHelpers';
import { buildPublicCompanies } from './publicCompanyHelpers';
import type { SparklineMarker } from './sparkline';
import type {
  CaseDetail,
  CaseEventView,
  CaseListItem,
  PricePoint,
  PublicCompany,
  PublicData,
  RawCase,
  RawCompany,
  RawEvent,
  RawPrice,
} from './types';

interface RawData {
  companies: RawCompany[];
  cases: RawCase[];
  events: RawEvent[];
  prices: RawPrice[];
  isSampleData: boolean;
}

let cache: PublicData | null = null;

export async function loadPublicData(): Promise<PublicData> {
  if (cache) return cache;
  const raw = await loadRaw();
  cache = assemble(raw);
  return cache;
}

async function loadRaw(): Promise<RawData> {
  const env = {
    ...process.env,
    DEPLOY_ENV: process.env.DEPLOY_ENV ?? import.meta.env.DEPLOY_ENV,
    DATA_SOURCE: process.env.DATA_SOURCE ?? import.meta.env.DATA_SOURCE,
    CF_PAGES: process.env.CF_PAGES ?? import.meta.env.CF_PAGES,
  };
  const { deployEnv, dataSource } = resolvePublicDataEnvironment(env);
  const url = import.meta.env.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (dataSource === 'sample') {
    console.log(`[publicData] DEPLOY_ENV=${deployEnv} / DATA_SOURCE=sample のためサンプルデータを使用します`);
    return loadFromSample();
  }

  if (!url || !key) throw new Error('[publicData] DATA_SOURCE=supabase には SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です');
  console.log(`[publicData] DEPLOY_ENV=${deployEnv} / DATA_SOURCE=supabase のため Supabase から公開データを取得します`);
  return loadFromSupabase(url, key);
}

async function loadFromSupabase(url: string, key: string): Promise<RawData> {
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [companies, cases, events, prices] = await Promise.all([
    supabase.from('companies').select('*'),
    supabase.from('cases').select('*').eq('is_visible', true),
    supabase.from('case_events').select('*').eq('is_visible', true),
    supabase.from('price_snapshots').select('*'),
  ]);

  for (const [name, res] of Object.entries({ companies, cases, case_events: events, price_snapshots: prices })) {
    if (res.error) {
      throw new Error(`[publicData] ${name} の取得に失敗: ${res.error.message}`);
    }
  }

  return {
    companies: (companies.data ?? []) as RawCompany[],
    cases: (cases.data ?? []) as RawCase[],
    events: (events.data ?? []) as RawEvent[],
    prices: (prices.data ?? []) as RawPrice[],
    isSampleData: false,
  };
}

function loadFromSample(): RawData {
  const dir = path.resolve(process.cwd(), 'data/sample');
  const read = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as T;

  return {
    companies: read<RawCompany[]>('companies.json'),
    cases: read<RawCase[]>('cases.json').filter((c) => c.is_visible),
    events: read<RawEvent[]>('case_events.json').filter((e) => e.is_visible),
    prices: read<RawPrice[]>('price_snapshots.json'),
    isSampleData: true,
  };
}

// ------------------------------------------------------------
// 組み立て
// ------------------------------------------------------------
function assemble(raw: RawData): PublicData {
  const companyById = new Map(raw.companies.map((c) => [c.id, c]));
  const eventsByCase = groupBy(raw.events, (e) => e.case_id);
  const pricesByCase = groupBy(raw.prices, (p) => p.case_id);

  // 派生値の計算基準時刻(=このビルドの generatedAt と同一)
  const now = new Date();

  const details: CaseDetail[] = [];

  for (const c of raw.cases) {
    const company = companyById.get(c.company_id);
    if (!company) {
      console.warn(`[publicData] 案件 ${c.slug} の会社(${c.company_id})が見つからないためスキップ`);
      continue;
    }

    const events = (eventsByCase.get(c.id) ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() ||
          a.sort_order - b.sort_order,
      );

    const prices = pricesByCase.get(c.id) ?? [];
    const preReportClose = latestPrice(prices, 'pre_report_close');
    // 現在株価は、その案件に daily_close が1件以上あれば最新の daily_close を使い、
    // 無ければ従来どおり手動登録の current_close を使う。
    const dailyCloses = pricesOfType(prices, 'daily_close');
    const currentClose = dailyCloses.at(-1) ?? latestPrice(prices, 'current_close');
    const formalOfferPrice = latestPrice(prices, 'formal_offer_price');

    const firstReportedAt = firstVisibleReportOccurredAt(events);
    const firstReport = firstReportedAt ? events.find((e) => e.occurred_at === firstReportedAt) ?? null : null;

    const lastUpdatedAt = maxIso([
      c.updated_at,
      ...events.map((e) => e.updated_at),
      ...prices.map((p) => p.updated_at),
    ]);

    const caseHasFormalAnnouncement = hasFormalAnnouncement(c.status, events);
    const hasAcknowledgedCompanyComment = events.some(
      (e) => e.event_type === 'company_comment' && (e.comment_stance ?? classifyCommentStance(e.comment_tags ?? [])) === 'acknowledged',
    );

    const sourceNames = [
      ...new Set(events.map((e) => e.source_name).filter((s) => s.length > 0)),
    ];

    const commentLikeEvents = events.filter(
      (e) => e.event_type === 'company_comment' || e.event_type === 'timely_disclosure',
    );
    const latestCommentEvent = commentLikeEvents[commentLikeEvents.length - 1] ?? null;
    const latestCommentStance = latestCommentStanceFromEvent(latestCommentEvent);

    const lastVisibleEventOccurredAt = events[events.length - 1]?.occurred_at ?? null;
    const derived = deriveCaseFields({
      status: c.status,
      eventTypes: events.map((e) => e.event_type),
      lastVisibleEventOccurredAt,
      firstReportedAt,
      preReportClose,
      currentClose,
      formalOfferPrice,
      now,
    });

    const sparklineMarkers: SparklineMarker[] = events.flatMap((e): SparklineMarker[] => {
      if (e.event_type === 'observation_report' || e.event_type === 'follow_up_report') return [{ date: e.occurred_at, kind: 'report' as const }];
      if (e.event_type === 'company_comment' || e.event_type === 'timely_disclosure') return [{ date: e.occurred_at, kind: 'comment' as const }];
      if (e.event_type === 'formal_announcement') return [{ date: e.occurred_at, kind: 'announce' as const }];
      return [];
    });
    const sparklineSvg = dailyCloses.length >= 2
      ? renderSparkline({ points: dailyCloses.map((p) => ({ date: p.priceDate, price: p.price })), markers: sparklineMarkers, offerPrice: formalOfferPrice?.price, width: 640, height: 120 })
      : null;

    const eventViews: CaseEventView[] = events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      title: e.title,
      summary: e.summary,
      sourceName: e.source_name,
      sourceUrl: e.source_url,
      sitePublishedAt: e.site_published_at,
      updatedAt: e.updated_at,
      corrected: e.metadata?.corrected === true,
      correctionNote: e.metadata?.correction_note ?? null,
      commentStance: e.comment_stance ?? null,
      commentTags: e.comment_tags ?? [],
      largeShareholding: buildLargeShareholdingView(e),
    }));

    details.push({
      id: c.id,
      slug: c.slug,
      title: c.title,
      status: c.status,
      summary: c.summary,
      securityCode: company.security_code,
      companyName: company.name_ja,
      market: company.market,
      industry: company.industry,
      firstReportedAt,
      firstSourceName: firstReport?.source_name || null,
      lastUpdatedAt,
      sitePublishedAt: c.site_published_at,
      hasFormalAnnouncement: caseHasFormalAnnouncement,
      hasAcknowledgedCompanyComment,
      sourceNames,
      preReportClose,
      currentClose,
      formalOfferPrice,
      dailyCloses,
      sparklineSvg,
      latestCommentStance,
      ...derived,
      events: eventViews,
    });
  }

  // 標準の並び順: 最終更新日の新しい順(要件 §5.2)
  details.sort(
    (a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
  );

  const cases: CaseListItem[] = details.map(({ events: _e, industry: _i, sitePublishedAt: _s, ...item }) => item);

  const companies: PublicCompany[] = buildPublicCompanies(raw.companies, cases);

  const allSourceNames = [...new Set(details.flatMap((d) => d.sourceNames))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );

  return {
    companies,
    cases,
    details,
    allSourceNames,
    isSampleData: raw.isSampleData,
    generatedAt: now.toISOString(),
  };
}

function pricesOfType(prices: RawPrice[], type: RawPrice['price_type']): PricePoint[] {
  return prices
    .filter((p) => p.price_type === type)
    .sort((a, b) => (a.price_date > b.price_date ? 1 : -1))
    .map((p) => ({ price: Number(p.price), priceDate: p.price_date, sourceName: p.source_name }));
}

function latestPrice(prices: RawPrice[], type: RawPrice['price_type']): PricePoint | null {
  const filtered = prices
    .filter((p) => p.price_type === type)
    .sort((a, b) => (a.price_date < b.price_date ? 1 : -1));
  const latest = filtered[0];
  if (!latest) return null;
  return {
    price: Number(latest.price),
    priceDate: latest.price_date,
    sourceName: latest.source_name,
  };
}

function maxIso(isos: (string | null)[]): string {
  let max = '';
  for (const iso of isos) {
    if (iso && iso > max) max = iso;
  }
  return max || new Date(0).toISOString();
}



function buildLargeShareholdingView(e: RawEvent): CaseEventView['largeShareholding'] {
  return sanitizeLargeShareholdingMetadata(e.event_type, e.metadata);
}


function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}
