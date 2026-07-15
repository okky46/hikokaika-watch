// ============================================================
// 型定義
// Raw* は DB / サンプルJSON の行(snake_case)。
// CaseListItem / CaseDetail はページ生成用に組み立てたビューモデル。
// ============================================================

export type CaseStatus =
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
  | 'other';

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

export type PriceType = 'pre_report_close' | 'current_close' | 'formal_offer_price';

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
  status: CaseStatus;
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
  occurred_at: string;
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
  metadata: { corrected?: boolean; correction_note?: string } | null;
}

export interface RawPrice {
  id: string;
  case_id: string;
  price_type: PriceType;
  price: string | number; // Supabase の numeric は文字列で返る
  price_date: string;
  source_name: string | null;
  created_at: string;
  updated_at: string;
}

/** 表示用の価格情報 */
export interface PricePoint {
  price: number;
  priceDate: string;
  sourceName: string | null;
}

/** 一覧・検索用のビューモデル(トップページに JSON 埋め込みされる) */
export interface CaseListItem {
  id: string;
  slug: string;
  title: string;
  status: CaseStatus;
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
}

/** タイムライン表示用の出来事 */
export interface CaseEventView {
  id: string;
  eventType: EventType;
  occurredAt: string;
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
}

/** 案件詳細ページ用のビューモデル */
export interface CaseDetail extends CaseListItem {
  industry: string | null;
  sitePublishedAt: string | null;
  events: CaseEventView[];
}

export interface PublicData {
  cases: CaseListItem[];
  details: CaseDetail[];
  /** 絞り込み用の媒体名一覧(登場順ではなく五十音等でソート済み) */
  allSourceNames: string[];
  /** サンプルデータでビルドされたかどうか(画面に注意書きを出す) */
  isSampleData: boolean;
  generatedAt: string;
}
