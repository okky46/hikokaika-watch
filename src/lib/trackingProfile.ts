import { articleSourceUrl } from './articleSourceUrl.ts';
import { COMMENT_TAG_ORDER } from './commentTags.ts';
import type { CaseStatus, RawCase, RawEvent } from './types.ts';

export const TRACKING_STATUS = {
  rumor: { label: '噂段階', stage: 'pre', legacy: 'rumored', tone: 'watch' },
  proposal: { label: '提案受領', stage: 'pre', legacy: 'commented', tone: 'comment' },
  consideration: { label: '検討に言及', stage: 'pre', legacy: 'commented', tone: 'comment' },
  discussions: { label: '協議に言及', stage: 'pre', legacy: 'commented', tone: 'comment' },
  comment: { label: '会社コメントあり', stage: 'pre', legacy: 'commented', tone: 'comment' },
  consideration_denied: { label: '検討を否定', stage: 'pre', legacy: 'denied', tone: 'pause' },
  report_denied: { label: '報道内容を否定', stage: 'pre', legacy: 'denied', tone: 'pause' },
  announced: { label: 'TOB等の実施発表', stage: 'post', legacy: 'announced', tone: 'announce' },
  offer_open: { label: 'TOB開始', stage: 'post', legacy: 'announced', tone: 'announce' },
  offer_succeeded: { label: 'TOB成立', stage: 'post', legacy: 'announced', tone: 'announce' },
  delisted: { label: '上場廃止', stage: 'closed', legacy: 'completed', tone: 'done' },
  privatized: { label: '非公開化完了', stage: 'closed', legacy: 'completed', tone: 'done' },
  consideration_ended: { label: '検討・協議終了', stage: 'closed', legacy: 'ended', tone: 'pause' },
  withdrawn: { label: '撤回', stage: 'closed', legacy: 'withdrawn', tone: 'stop' },
  failed: { label: '不成立', stage: 'closed', legacy: 'withdrawn', tone: 'stop' },
} as const satisfies Record<string, { label: string; stage: string; legacy: CaseStatus; tone: string }>;
export type TrackingStatus = keyof typeof TRACKING_STATUS;
const { rumor: rumorStatus, ...laterStatuses } = TRACKING_STATUS;
/** Public labels share the approved evidence classification; no second manual report flag. */
export const PUBLIC_TRACKING_STATUS = {
  rumor: rumorStatus,
  reported: { label: '観測報道あり', stage: 'pre', legacy: 'rumored', tone: 'watch' },
  ...laterStatuses,
} as const;
export type PublicTrackingStatus = keyof typeof PUBLIC_TRACKING_STATUS;
export function publicTrackingStatus(p: Pick<TrackingProfile,'public_status'|'report_state'|'reports'>): PublicTrackingStatus {
  return p.public_status === 'rumor' && p.report_state === 'reported' && p.reports.length > 0
    ? 'reported' : p.public_status;
}
export type TrackingStage = 'pre' | 'post' | 'closed';
/** Explicit editorial classification, never inferred from keywords or report counts. */
export const BIDDING_STAGE = { first_round:'一次入札の報道', second_round:'二次入札の報道', final_round:'最終入札の報道' } as const;
/** Editorial strength only; never a probability or an inferred fact. Omission means unassessed. */
export const RUMOR_STRENGTH = { weak:'弱', medium:'中', strong:'強' } as const;
export const COLOR_STRENGTH_FIELDS = { rumor_strength:'噂（紫）', reported_strength:'観測報道（黄色）', process_strength:'検討・協議（オレンジ）' } as const;
export const BIDDING_ELIGIBLE_STATUSES = ['rumor','proposal','consideration','discussions','comment'] as const;
export const REPORT_METHOD = { direct: '原報道を直接確認', company: '会社開示で言及を確認', secondary: '二次報道で言及を確認' } as const;
export const REPORT_ACCESS = { full: '本文確認', partial: '公開部分のみ確認', unread: '原文未閲覧' } as const;
export const DATE_PRECISION = { datetime: '日時', date: '日付のみ', month: '公表年月のみ', issue: '号数のみ', unknown: '日付不明' } as const;
export interface MediaOutlet { id: string; name: string; aliases: string[]; is_active: boolean }
export interface ReportEvidence {
  outlet_id: string; // unknown = 媒体未特定。配信先で原報道元を推測しない。
  event_id: string;
  source_name: string;
  source_url: string;
  method: keyof typeof REPORT_METHOD;
  access: keyof typeof REPORT_ACCESS;
  checked_on: string;
  reported_on: string;
  scope_note: string;
}
export interface CompanyStatement { event_id: string; subject: string; text: string; tags: string[] }
export interface EventDateOverride {
  event_id: string;
  precision: keyof typeof DATE_PRECISION;
  value: string; // ISO timestamp / YYYY-MM-DD / YYYY-MM / empty
  issue_label: string;
}
export interface TrackingProfile {
  title: string;
  summary: string;
  tracking_reason: string;
  tracking_started_on: string;
  last_checked_on: string;
  verification_note: string;
  short_reason: string;
  status_note: string;
  public_status: TrackingStatus;
  status_event_ids: string[];
  statements: CompanyStatement[];
  report_state: 'none' | 'reported' | 'unreviewed';
  report_note: string;
  reports: ReportEvidence[];
  event_dates: EventDateOverride[];
  bidding?: { stage: keyof typeof BIDDING_STAGE; event_id: string };
  rumor_strength?: keyof typeof RUMOR_STRENGTH;
  reported_strength?: keyof typeof RUMOR_STRENGTH;
  process_strength?: keyof typeof RUMOR_STRENGTH;
}
export interface TrackingEdition {
  case_id: string;
  draft?: TrackingProfile;
  published: TrackingProfile | null;
  revision?: number;
  publication_version: string | null;
  published_at: string | null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function validMonth(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && validDate(`${value}-01`); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('入力形式が不正です');
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('未対応の項目があります');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`文字列は${max}文字以内で入力してください`);
  return value.trim();
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`項目は${max}件以内で入力してください`);
  return value;
}
function id(value: unknown, optional = false): string {
  const s = string(value, 36);
  if (!(optional && s === '') && !uuid.test(s)) throw new Error('出来事IDが不正です');
  return s.toLowerCase();
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('分類を選択してください');
  return value as T;
}
const textKeys = ['title','summary','tracking_reason','tracking_started_on','last_checked_on','verification_note','short_reason','status_note','report_note'] as const;
const profileKeys = [...textKeys,'public_status','status_event_ids','statements','report_state','reports','event_dates','bidding',...Object.keys(COLOR_STRENGTH_FIELDS)];
export function parseTrackingProfile(value: unknown, publish = false): TrackingProfile {
  const s = object(value, profileKeys);
  const out = {} as TrackingProfile;
  for (const key of Object.keys(COLOR_STRENGTH_FIELDS) as (keyof typeof COLOR_STRENGTH_FIELDS)[]) {
    if (s[key] !== undefined) out[key] = choice(s[key], Object.keys(RUMOR_STRENGTH) as (keyof typeof RUMOR_STRENGTH)[]);
  }
  for (const k of textKeys) out[k] = string(s[k], k === 'title' ? 240 : k === 'short_reason' || k === 'status_note' ? 300 : 6000);
  for (const k of ['tracking_started_on','last_checked_on'] as const) if (out[k] && !validDate(out[k])) throw new Error('日付が不正です');
  out.public_status = choice(s.public_status, Object.keys(TRACKING_STATUS) as TrackingStatus[]);
  out.report_state = choice(s.report_state, ['none','reported','unreviewed'] as const);
  out.status_event_ids = array(s.status_event_ids, 10).map(v => id(v));
  if (new Set(out.status_event_ids).size !== out.status_event_ids.length) throw new Error('状態の根拠が重複しています');
  out.statements = array(s.statements, 5).map(v => {
    const r = object(v, ['event_id','subject','text','tags']);
    return { event_id: id(r.event_id), subject: string(r.subject, 100), text: string(r.text, 300), tags: array(r.tags, 10).map(t => choice(t, COMMENT_TAG_ORDER)) };
  });
  out.reports = array(s.reports, 50).map(v => {
    const r = object(v, ['outlet_id','event_id','source_name','source_url','method','access','checked_on','reported_on','scope_note']);
    const result: ReportEvidence = {
      outlet_id: string(r.outlet_id, 60), event_id: id(r.event_id, true),
      source_name: string(r.source_name, 240), source_url: string(r.source_url, 2000),
      method: choice(r.method, Object.keys(REPORT_METHOD) as (keyof typeof REPORT_METHOD)[]),
      access: choice(r.access, Object.keys(REPORT_ACCESS) as (keyof typeof REPORT_ACCESS)[]),
      checked_on: string(r.checked_on, 10), reported_on: string(r.reported_on, 10), scope_note: string(r.scope_note, 1000),
    };
    if (!/^[a-z][a-z0-9-]*$/.test(result.outlet_id) || !result.source_name || !articleSourceUrl(result.source_url) || !validDate(result.checked_on) || (result.reported_on && !validDate(result.reported_on)) || !result.scope_note) throw new Error('媒体の根拠・出典・確認日を入力してください');
    if (result.method !== 'direct' && result.access !== 'unread') throw new Error('間接確認では原文未閲覧を選択してください');
    return result;
  });
  out.event_dates = array(s.event_dates, 300).map(v => {
    const r = object(v, ['event_id','precision','value','issue_label']);
    const result: EventDateOverride = { event_id: id(r.event_id), precision: choice(r.precision, Object.keys(DATE_PRECISION) as (keyof typeof DATE_PRECISION)[]), value: string(r.value, 40), issue_label: string(r.issue_label, 100) };
    if (result.precision === 'datetime' && (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/.test(result.value) || !validDate(result.value.slice(0,10)) || !Number.isFinite(Date.parse(result.value)))) throw new Error('日時を確認してください');
    if (result.precision === 'date' && !validDate(result.value)) throw new Error('公表日を確認してください');
    if (result.precision === 'month' && !validMonth(result.value)) throw new Error('公表年月を確認してください');
    if (result.precision === 'issue' && (!result.issue_label || (result.value && !validMonth(result.value)))) throw new Error('号数と参考配置の年月を確認してください');
    if (result.precision === 'unknown' && result.value) throw new Error('日付不明に日時を指定できません');
    return result;
  });
  if (new Set(out.event_dates.map(x => x.event_id)).size !== out.event_dates.length) throw new Error('日付設定が重複しています');
  if (s.bidding !== undefined) {
    const b = object(s.bidding, ['stage','event_id']);
    out.bidding = { stage:choice(b.stage, Object.keys(BIDDING_STAGE) as (keyof typeof BIDDING_STAGE)[]), event_id:id(b.event_id) };
    if (!(BIDDING_ELIGIBLE_STATUSES as readonly string[]).includes(out.public_status)) throw new Error('入札段階は正式発表前の進行中の状況だけに設定できます');
    if (out.report_state !== 'reported' || !out.reports.some(r => r.event_id === out.bidding!.event_id)) throw new Error('入札段階には確認済み媒体の根拠と結び付いた出来事が必要です');
  }
  if ((out.report_state === 'reported') !== (out.reports.length > 0)) throw new Error('媒体の分類と根拠が一致しません');
  if (publish && (!out.title || !out.short_reason || !out.last_checked_on || out.report_state === 'unreviewed')) throw new Error('公開にはタイトル・噂の概要・確認日・媒体分類が必要です');
  if (publish && out.report_state === 'none' && !out.report_note) throw new Error('報道なしとして登録する内容・確認範囲を入力してください');
  if (publish && out.public_status !== 'rumor' && !out.status_event_ids.length) throw new Error('状況タグの根拠となる出来事を選択してください');
  if (publish && out.statements.some(r => !r.subject || !r.text)) throw new Error('会社説明の主体と内容を入力してください');
  return out;
}

export function emptyTrackingProfile(c?: Partial<RawCase>): TrackingProfile {
  const legacy: Partial<Record<CaseStatus, TrackingStatus>> = { rumored:'rumor', commented:'comment', denied:'consideration_denied', announced:'announced', ended:'consideration_ended', withdrawn:'withdrawn' };
  return { title:c?.title ?? '', summary:c?.summary ?? '', tracking_reason:c?.tracking_reason ?? '',
    tracking_started_on:c?.tracking_started_on ?? '', last_checked_on:c?.last_checked_on ?? '', verification_note:c?.verification_note ?? '',
    short_reason:'', status_note:'', public_status:legacy[c?.status ?? 'rumored'] ?? 'rumor', status_event_ids:[], statements:[], report_state:'unreviewed', report_note:'', reports:[], event_dates:[] };
}

/** Only published profile fields are applied; never consume draft as a fallback. */
export function applyPublishedProfile(c: RawCase, p: TrackingProfile): RawCase {
  return { ...c, title:p.title, summary:p.summary, tracking_reason:p.tracking_reason,
    tracking_started_on:p.tracking_started_on || null, last_checked_on:p.last_checked_on || null,
    verification_note:p.verification_note, status:TRACKING_STATUS[p.public_status].legacy };
}
export function validateProfileReferences(p: TrackingProfile, c: RawCase, events: RawEvent[], outlets: MediaOutlet[]): void {
  const ids = new Set(events.filter(e => e.case_id === c.id && e.is_visible).map(e => e.id));
  for (const ref of [...p.status_event_ids, ...p.statements.map(x => x.event_id), ...p.reports.map(x => x.event_id).filter(Boolean), ...p.event_dates.map(x => x.event_id), ...(p.bidding ? [p.bidding.event_id] : [])]) {
    if (!ids.has(ref)) throw new Error(`公開分類が非公開・別案件・削除済みの出来事を参照しています: ${c.slug}`);
  }
  const mediaIds = new Set(outlets.map(o => o.id));
  for (const r of p.reports) if (!mediaIds.has(r.outlet_id)) throw new Error(`媒体が見つかりません: ${r.outlet_id}`);
}
