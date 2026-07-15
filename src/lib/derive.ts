// ============================================================
// フェーズ1: 派生値の導出(純関数)
//
// ここに実装する計算式は指示書 §1-1 の擬似コードをそのまま実装したものであり、
// 独自の改良・変更は行わない。派生値はDBやJSONに永続化せず、常にこの関数で
// ビルド時に計算する(指示書 §C-3, §1-5)。
// ============================================================
import { daysBetween } from './format.ts';
import type { CaseStatus, EventType, PricePoint } from './types';

export type HeatLevel = 1 | 2 | 3 | 4;

const REPORT_EVENT_TYPES: readonly EventType[] = ['observation_report', 'follow_up_report'];
const COMMENT_EVENT_TYPES: readonly EventType[] = ['company_comment', 'timely_disclosure'];
const TOB_PREMIUM_STATUSES: readonly CaseStatus[] = ['announced', 'completed', 'withdrawn'];
const DORMANT_SOURCE_STATUSES: readonly CaseStatus[] = ['rumored', 'commented', 'denied'];
const PRE_ANNOUNCEMENT_EFFECTIVE_STATUSES: readonly CaseStatus[] = [
  'rumored',
  'commented',
  'denied',
  'ended',
  'dormant',
];

const HEAT_COOLDOWN_DAYS = 90;
const DORMANT_THRESHOLD_DAYS = 240;

export interface DeriveCaseInput {
  status: CaseStatus;
  /** 可視イベントの種別一覧(順不同でよい) */
  eventTypes: EventType[];
  /** 最終可視イベントの occurred_at(可視イベントが無ければ null) */
  lastVisibleEventOccurredAt: string | null;
  firstReportedAt: string | null;
  preReportClose: PricePoint | null;
  currentClose: PricePoint | null;
  formalOfferPrice: PricePoint | null;
  /** ビルド時点の日時(既存の generatedAt と同一時刻を渡す) */
  now: Date;
}

export interface DerivedCaseFields {
  reportCount: number;
  commentCount: number;
  heatLevel: HeatLevel;
  speculationPremium: number | null;
  tobPremium: number | null;
  arbSpread: number | null;
  daysSinceFirstReport: number | null;
  effectiveStatus: CaseStatus;
  isPreAnnouncement: boolean;
}

export function deriveCaseFields(input: DeriveCaseInput): DerivedCaseFields {
  const nowIso = input.now.toISOString();

  const reportCount = input.eventTypes.filter((t) => REPORT_EVENT_TYPES.includes(t)).length;
  const commentCount = input.eventTypes.filter((t) => COMMENT_EVENT_TYPES.includes(t)).length;

  const daysSinceLastVisibleEvent = daysBetween(input.lastVisibleEventOccurredAt, nowIso);

  let heatBase = Math.min(Math.max(reportCount, 1), 4);
  if (daysSinceLastVisibleEvent !== null && daysSinceLastVisibleEvent >= HEAT_COOLDOWN_DAYS) {
    heatBase = Math.max(heatBase - 1, 1);
  }
  const heatLevel = heatBase as HeatLevel;

  const speculationPremium =
    input.preReportClose && input.currentClose
      ? (input.currentClose.price - input.preReportClose.price) / input.preReportClose.price
      : null;

  const tobPremium =
    TOB_PREMIUM_STATUSES.includes(input.status) && input.formalOfferPrice && input.preReportClose
      ? (input.formalOfferPrice.price - input.preReportClose.price) / input.preReportClose.price
      : null;

  const arbSpread =
    input.status === 'announced' && input.formalOfferPrice && input.currentClose
      ? (input.formalOfferPrice.price - input.currentClose.price) / input.currentClose.price
      : null;

  const daysSinceFirstReport = daysBetween(input.firstReportedAt, nowIso);

  const effectiveStatus: CaseStatus =
    DORMANT_SOURCE_STATUSES.includes(input.status) &&
    daysSinceLastVisibleEvent !== null &&
    daysSinceLastVisibleEvent >= DORMANT_THRESHOLD_DAYS
      ? 'dormant'
      : input.status;

  const isPreAnnouncement = PRE_ANNOUNCEMENT_EFFECTIVE_STATUSES.includes(effectiveStatus);

  return {
    reportCount,
    commentCount,
    heatLevel,
    speculationPremium,
    tobPremium,
    arbSpread,
    daysSinceFirstReport,
    effectiveStatus,
    isPreAnnouncement,
  };
}
