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
import { applyPublishedProfile, parseTrackingProfile, validateProfileReferences, TRACKING_STATUS, publicTrackingStatus } from './trackingProfile.ts';
import type { TrackingEdition, MediaOutlet } from './trackingProfile.ts';
import { publicEventDate, timelineDateKey } from './trackingDates.ts';
import { compareCases, latestDatedEvent, companySearchAliases } from './trackingSearch.ts';
import type { SearchCase } from './trackingSearch.ts';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { assembleArticles } from './articles.ts';
import type { RawArticle, ArticleLink } from './articles.ts';
import { classifyCommentStance, latestCommentStanceFromEvent } from './commentTags.ts';
import { resolvePublicDataEnvironment } from './buildEnv.ts';
import { hasFormalAnnouncement } from './caseFilters.ts';
import { deriveCaseFields } from './derive.ts';
import { safeHttpUrl } from './tracking.ts';
import { sanitizeLargeShareholdingMetadata } from './noteMetadataHelpers.ts';
import { buildPublicCompanies, isPublishableCompany } from './publicCompanyHelpers.ts';
import { normalizeDailyCloses } from './priceHelpers.ts';
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
} from './types.ts';

interface RawData {
  trackingEditions?: TrackingEdition[];
  mediaOutlets?: MediaOutlet[];
  articles?: RawArticle[];
  articleLinks?: ArticleLink[];
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

  const [companies, cases, events, prices, publications, trackingPublications] = await Promise.all([
    supabase.from('companies').select('*'),
    supabase.from('cases').select('*').eq('is_visible', true),
    supabase.from('case_events').select('*').eq('is_visible', true),
    supabase.from('price_snapshots').select('*'),
    supabase.rpc('read_published_articles'),
    supabase.rpc('read_published_tracking'),
  ]);

  for (const [name, res] of Object.entries({ companies, cases, case_events: events, price_snapshots: prices, publications, trackingPublications })) {
    if (res.error) {
      throw new Error(`[publicData] ${name} の取得に失敗: ${res.error.message}。DBの自動更新・マイグレーション履歴を確認してください（公開情報を黙って省略しません）。`);
    }
  }

  const classified = new Set((trackingPublications.data.editions ?? []).map((e: TrackingEdition) => e.case_id));
  const active = new Set((companies.data ?? []).filter(c=>c.is_active).map(c=>c.id));
  const missing = (cases.data ?? []).filter(c=>active.has(c.company_id)&&!classified.has(c.id));
  if(missing.length)throw new Error('[publicData] 公開銘柄の分類が未承認です: '+missing.map(c=>c.slug).join(', '));
  return {
    trackingEditions: trackingPublications.data.editions,
    mediaOutlets: trackingPublications.data.outlets,
    articles: publications.data.articles,
    articleLinks: publications.data.links,
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
    trackingEditions: read<TrackingEdition[]>('tracking_editions.json'),
    mediaOutlets: read<MediaOutlet[]>('media_outlets.json'),
    articles: read<RawArticle[]>('articles.json'),
    articleLinks: read<ArticleLink[]>('article_companies.json'),
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
export function assemble(raw: RawData): PublicData {
  const companyById = new Map(raw.companies.map((c) => [c.id, c]));
  const eventsByCase = groupBy(raw.events, (e) => e.case_id);
  const pricesByCase = groupBy(raw.prices, (p) => p.case_id);

  // 派生値の計算基準時刻(=このビルドの generatedAt と同一)
  const now = new Date();

  const details: CaseDetail[] = [];

  const editions = new Map((raw.trackingEditions ?? []).map(e => [e.case_id, e]));
  const mediaOutlets = raw.mediaOutlets ?? [];
  for (const original of raw.cases.filter(c => c.is_visible)) {
    const edition = editions.get(original.id);
    const profile = edition?.published ? parseTrackingProfile(edition.published, true) : null;
    if (profile) validateProfileReferences(profile, original, raw.events, mediaOutlets);
    const c = profile ? applyPublishedProfile(original, profile) : original;
    const overrides = new Map((profile?.event_dates ?? []).map(d => [d.event_id,d]));
    const dateOf = (e: RawEvent) => publicEventDate(e, overrides.get(e.id));
    const company = companyById.get(c.company_id);
    if (!company) {
      console.warn(`[publicData] 案件 ${c.slug} の会社(${c.company_id})が見つからないためスキップ`);
      continue;
    }
    if (!isPublishableCompany(company)) {
      console.warn(`[publicData] 案件 ${c.slug} の会社(${c.company_id})が非アクティブのため公開データからスキップ`);
      continue;
    }

    const events = (eventsByCase.get(c.id) ?? []).filter(e => e.is_visible)
      .slice()
      .sort(
        (a, b) =>
          timelineDateKey(dateOf(a)).localeCompare(timelineDateKey(dateOf(b))) ||
          a.sort_order - b.sort_order,
      );

    const prices = pricesByCase.get(c.id) ?? [];
    const preReportClose = latestPrice(prices, 'pre_report_close');
    // 現在株価は、その案件に daily_close が1件以上あれば最新の daily_close を使い、
    // 無ければ従来どおり手動登録の current_close を使う。
    const dailyCloses = normalizeDailyCloses(prices);
    const currentClose = dailyCloses.at(-1) ?? latestPrice(prices, 'current_close');
    const formalOfferPrice = latestPrice(prices, 'formal_offer_price');

    const firstReport = events.find(e => ['observation_report','follow_up_report'].includes(e.event_type) && ['date','datetime'].includes(dateOf(e).precision)) ?? null;
    const firstDate = firstReport ? dateOf(firstReport) : null;
    const firstReportedAt = firstDate ? firstDate.instant ?? `${firstDate.start}T00:00:00+09:00` : null;

    const lastUpdatedAt = maxIso([
      c.updated_at,
      edition?.published_at ?? null,
      ...events.map((e) => e.updated_at),
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

    const sparklineSvg = null; // チャートは当面表示しない。保存済み価格は保持する。

    const eventViews: CaseEventView[] = events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      date: dateOf(e),
      dateLabel: dateOf(e).label,
      title: e.title,
      summary: e.summary,
      sourceName: e.source_name,
      sourceUrl: safeHttpUrl(e.source_url) ?? '',
      sitePublishedAt: e.site_published_at,
      updatedAt: e.updated_at,
      corrected: e.metadata?.corrected === true,
      correctionNote: e.metadata?.correction_note ?? null,
      commentStance: e.comment_stance ?? null,
      commentTags: e.comment_tags ?? [],
      largeShareholding: buildLargeShareholdingView(e),
    }));

    const mediaIds = profile ? profile.report_state === 'none' ? ['none'] : [...new Set(profile.reports.map(r => r.outlet_id))] : ['unreviewed'];
    const media = mediaIds.map(id => ({id, name:id==='none' ? '報道なし' : id==='unreviewed' ? '媒体を確認中' : mediaOutlets.find(m=>m.id===id)!.name}));
    const search: SearchCase = {id:c.id,code:company.security_code,name:company.name_ja,
      aliases:companySearchAliases(company.name_ja,c.title),
      reason:profile?.short_reason || c.tracking_reason || c.summary,
      media:mediaIds,stage:profile ? TRACKING_STATUS[profile.public_status].stage : 'unreviewed',status:profile ? publicTrackingStatus(profile) : 'unreviewed',
      statementTags:[...new Set(profile?.statements.flatMap(s=>s.tags) ?? [])],registeredOn:c.site_published_at ?? '',updatedAt:lastUpdatedAt,
      events:eventViews.map(e=>({id:e.id,title:e.title,date:e.date}))};
    const latest = latestDatedEvent(search);
    details.push({
      tracking:profile, publicationVersion:edition?.publication_version ?? null, media, search,
      id: c.id,
      slug: c.slug,
      title: c.title,
      status: c.status,
      summary: c.summary,
      companyId: c.company_id,
      trackingReason: c.tracking_reason || c.summary,
      trackingStartedOn: c.tracking_started_on ?? null,
      lastCheckedOn: c.last_checked_on ?? null,
      verificationNote: c.verification_note ?? '',
      latestEvent: latest ? {id:latest.id,title:latest.title,dateLabel:latest.date.label} : null,
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
      effectiveStatus: c.status, // 経過日数だけで管理者の確認状況を書き換えない。
      events: eventViews,
    });
  }

  // 標準の並び順: 最終更新日の新しい順(要件 §5.2)
  details.sort(
    (a, b) => compareCases(a.search,b.search,'event'),
  );

  const cases: CaseListItem[] = details.map(({ events: _e, industry: _i, sitePublishedAt: _s, ...item }) => item);

  const companies: PublicCompany[] = buildPublicCompanies(raw.companies, cases);
  const publishedIds = new Set((raw.articles ?? []).filter(a => a.published !== null).map(a => a.id));
  const linkedCompanyIds = new Set((raw.articleLinks ?? []).filter(l => l.edition === 'published' && publishedIds.has(l.article_id)).map(l => l.company_id));
  for (const company of raw.companies.filter(c => c.is_active && linkedCompanyIds.has(c.id))) {
    if (!companies.some(c => c.id === company.id)) companies.push({ id:company.id, securityCode:company.security_code, nameJa:company.name_ja, market:company.market, industry:company.industry, cases:[], lastUpdatedAt:company.updated_at });
  }
  const articles = assembleArticles(raw.articles ?? [], raw.articleLinks ?? [], companies);

  const allSourceNames = [...new Set(details.flatMap((d) => d.sourceNames))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );

  return {
    articles,
    companies,
    cases,
    details,
    allSourceNames,
    mediaOutlets,
    isSampleData: raw.isSampleData,
    generatedAt: now.toISOString(),
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
