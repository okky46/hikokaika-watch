// ============================================================
// 型定義
// Raw* は DB / サンプルJSON の行(snake_case)。
// CaseListItem / CaseDetail はページ生成用に組み立てたビューモデル。
// ============================================================

export type CaseStatus = 'tracking' | 'announced' | 'closed';

/** PR4 まで旧画面・旧管理フォームのために保持する。 */
export type LegacyCaseStatus =
  | 'rumored'
  | 'commented'
  | 'denied'
  | 'announced'
  | 'completed'
  | 'withdrawn'
  | 'ended'
  | 'dormant';

export type EventType =
  | 'observation_report'
  | 'company_comment'
  | 'follow_up_report'
  | 'timely_disclosure'
  | 'formal_announcement'
  | 'price_revision'
  | 'tender_offer_result'
  | 'consideration_ended'
  | 'withdrawal'
  | 'correction'
  | 'large_shareholding_report'
  | 'other';

export type EventCategory = 'media_report' | 'company_disclosure' | 'formal_announcement' | 'post_announcement_update' | 'related_information' | 'correction';
export type ReportRole = 'initial' | 'follow_up' | 'related' | 'market_reaction';
export type CompanyStance = 'private_consideration' | 'capital_policy' | 'denied';
export type EventTagKind = 'source' | 'content';
export type DatePrecision = 'datetime' | 'date' | 'issue' | 'unknown';

export type CommentStance = 'acknowledged' | 'neutral' | 'denied' | 'declined' | 'unclear' | 'needs_review';
export type CommentTag =
  | 'consideration_acknowledged'
  | 'strategic_options_under_review'
  | 'proposal_received'
  | 'discussions_ongoing'
  | 'no_decision'
  | 'not_company_announcement'
  | 'not_under_consideration'
  | 'report_denied'
  | 'comment_declined'
  | 'other';

export type PriceType = 'pre_report_close' | 'current_close' | 'formal_offer_price' | 'daily_close';

export type InboxSourceKind = 'tdnet' | 'edinet' | 'news';
export type InboxStatus = 'pending' | 'approved' | 'rejected';

export interface RawInboxItem {
  id: string;
  source_kind: InboxSourceKind;
  title: string;
  url: string;
  published_at: string | null;
  security_code: string | null;
  matched_case_id: string | null;
  suggested_event_type: EventType | string | null;
  suggested_comment_tags: CommentTag[] | null;
  raw: Record<string, unknown> | null;
  dedup_key: string;
  status: InboxStatus;
  created_at: string;
  reviewed_at: string | null;
}

export interface RawCompany {
  id: string;
  security_code: string;
  name_ja: string;
  market: string | null;
  industry: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RawCase {
  id: string;
  company_id: string;
  title: string;
  slug: string;
  status: LegacyCaseStatus;
  canonical_status?: CaseStatus | null;
  summary: string;
  first_reported_at: string | null;
  site_published_at: string | null;
  updated_at: string;
  is_visible: boolean;
  metadata: Record<string, unknown> | null;
}

export interface RawEvent {
  id: string;
  case_id: string;
  event_type: EventType;
  occurred_at: string | null;
  event_category?: EventCategory | null;
  report_role?: ReportRole | null;
  company_stance?: CompanyStance | null;
  date_precision?: DatePrecision;
  issue_label?: string | null;
  issue_year_month?: string | null;
  market_trigger_date?: string | null;
  sort_at?: string | null;
  title: string;
  summary: string;
  source_name: string;
  source_url: string;
  site_published_at: string | null;
  updated_at: string;
  sort_order: number;
  is_visible: boolean;
  comment_stance: CommentStance | null;
  comment_tags: CommentTag[];
  metadata: { corrected?: boolean; correction_note?: string; holder_name?: string; ratio?: number; previous_ratio?: number | null; filing_date?: string; change_type?: 'new' | 'increase' | 'decrease' | 'exit' } | null;
}

export interface RawPrice {
  id: string;
  case_id: string;
  price_type: PriceType;
  price: string | number; // Supabase の numeric は文字列で返る
  price_date: string;
  source_name: string | null;
  basis_note?: string | null;
  created_at: string;
  updated_at: string;
}

/** 表示用の価格情報 */
export interface PricePoint {
  price: number;
  priceDate: string;
  sourceName: string | null;
  basisNote?: string | null;
}

export interface EventTagView {
  id: string;
  kind: EventTagKind;
  slug: string;
  label: string;
  isActive: boolean;
  sortOrder: number;
}

/** 一覧・検索用のビューモデル(トップページに JSON 埋め込みされる) */
export interface CaseListItem {
  id: string;
  slug: string;
  title: string;
  status: LegacyCaseStatus;
  summary: string;
  securityCode: string;
  companyName: string;
  market: string | null;
  firstReportedAt: string | null;
  firstSourceName: string | null;
  lastUpdatedAt: string;
  hasFormalAnnouncement: boolean;
  hasAcknowledgedCompanyComment: boolean;
  /** この案件の可視イベントに登場する媒体名(絞り込み用) */
  sourceNames: string[];
  preReportClose: PricePoint | null;
  currentClose: PricePoint | null;
  formalOfferPrice: PricePoint | null;
  dailyCloses: PricePoint[];
  sparklineSvg: string | null;
  /** 最新の会社コメント系イベント(company_comment / timely_disclosure)の comment_stance。無ければ null */
  latestCommentStance: CommentStance | null;
  /** 第N報カウント(observation_report + follow_up_report) */
  reportCount: number;
  /** コメントカウント(company_comment + timely_disclosure) */
  commentCount: number;
  heatLevel: 1 | 2 | 3 | 4;
  /** 思惑プレミアム((現在値 - 報道前終値) / 報道前終値) */
  speculationPremium: number | null;
  /** TOBプレミアム((TOB価格 - 報道前終値) / 報道前終値) */
  tobPremium: number | null;
  /** 裁定スプレッド((TOB価格 - 現在値) / 現在値) */
  arbSpread: number | null;
  /** 最初の観測報道からの経過日数(今日基準) */
  daysSinceFirstReport: number | null;
  /** 表示用ステータス(dormant 判定を含む。DBのstatusは変更しない) */
  effectiveStatus: LegacyCaseStatus;
  /** effectiveStatus が発表前系(rumored/commented/denied/ended/dormant)かどうか */
  isPreAnnouncement: boolean;
}

/** タイムライン表示用の出来事 */
export interface CaseEventView {
  id: string;
  eventType: EventType;
  occurredAt: string | null;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  sitePublishedAt: string | null;
  updatedAt: string;
  corrected: boolean;
  correctionNote: string | null;
  commentStance: CommentStance | null;
  commentTags: CommentTag[];
  largeShareholding: { holderName: string; ratio: number; previousRatio: number | null; filingDate: string | null; changeType: 'new' | 'increase' | 'decrease' | 'exit' | null } | null;
}

/** 案件詳細ページ用のビューモデル */
export interface CaseDetail extends CaseListItem {
  industry: string | null;
  sitePublishedAt: string | null;
  events: CaseEventView[];
}

export interface PublicCompany {
  id: string;
  securityCode: string;
  nameJa: string;
  market: string | null;
  industry: string | null;
  cases: CaseListItem[];
  lastUpdatedAt: string | null;
}

export interface PublicData {
  companies: PublicCompany[];
  cases: CaseListItem[];
  details: CaseDetail[];
  /** 絞り込み用の媒体名一覧(登場順ではなく五十音等でソート済み) */
  allSourceNames: string[];
  /** サンプルデータでビルドされたかどうか(画面に注意書きを出す) */
  isSampleData: boolean;
  generatedAt: string;
}
