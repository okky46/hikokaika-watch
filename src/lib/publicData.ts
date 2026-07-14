// ============================================================
// ビルド時の公開データ取得
//
// - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY があれば Supabase から取得
//   (is_visible = true のもののみ。Service Role Key はビルド環境のみで使用)
// - なければ data/sample/ の架空サンプルデータでビルド
//
// このモジュールはビルド時(Node)専用。ブラウザからは import しない。
// ============================================================
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import type {
  CaseDetail,
  CaseEventView,
  CaseListItem,
  PricePoint,
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
  const url = import.meta.env.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    import.meta.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    console.log('[publicData] Supabase から公開データを取得します');
    return loadFromSupabase(url, key);
  }
  console.warn('[publicData] SUPABASE_URL 未設定のため data/sample/ のサンプルデータでビルドします');
  return loadFromSample();
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
    const currentClose = latestPrice(prices, 'current_close');
    const formalOfferPrice = latestPrice(prices, 'formal_offer_price');

    const firstEvent = events[0] ?? null;
    const firstReport =
      events.find((e) => e.event_type === 'observation_report') ?? firstEvent;
    const firstReportedAt = c.first_reported_at ?? firstReport?.occurred_at ?? null;

    const lastUpdatedAt = maxIso([
      c.updated_at,
      ...events.map((e) => e.updated_at),
      ...prices.map((p) => p.updated_at),
    ]);

    const hasFormalAnnouncement =
      c.status === 'announced' ||
      c.status === 'completed' ||
      events.some((e) => e.event_type === 'formal_announcement');

    const sourceNames = [
      ...new Set(events.map((e) => e.source_name).filter((s) => s.length > 0)),
    ];

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
      hasFormalAnnouncement,
      sourceNames,
      preReportClose,
      currentClose,
      formalOfferPrice,
      events: eventViews,
    });
  }

  // 標準の並び順: 最終更新日の新しい順(要件 §5.2)
  details.sort(
    (a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
  );

  const cases: CaseListItem[] = details.map(({ events: _e, industry: _i, sitePublishedAt: _s, ...item }) => item);

  const allSourceNames = [...new Set(details.flatMap((d) => d.sourceNames))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );

  return {
    cases,
    details,
    allSourceNames,
    isSampleData: raw.isSampleData,
    generatedAt: new Date().toISOString(),
  };
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
