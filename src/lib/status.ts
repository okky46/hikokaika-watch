// ============================================================
// ステータス・出来事種別の表示定義(ラベル/記号/色トーン)を集約する。
// 色だけに依存せず、ラベルと記号でも状態を区別する(要件 §12)。
// ============================================================
import type { CaseStatus, EventType } from './types';

export interface StatusDef {
  label: string;
  /** 色覚に依存しないための記号 */
  mark: string;
  /** CSS クラス接尾辞 (badge--{tone}) */
  tone: 'watch' | 'comment' | 'announce' | 'done' | 'stop' | 'pause';
  /** 「正式発表前」集計に含めるか */
  preAnnouncement: boolean;
  description: string;
}

export const CASE_STATUS: Record<CaseStatus, StatusDef> = {
  rumored: {
    label: '観測報道段階',
    mark: '◇',
    tone: 'watch',
    preAnnouncement: true,
    description: '観測報道が存在するが、会社の正式発表はない状態',
  },
  commented: {
    label: '会社コメントあり',
    mark: '◆',
    tone: 'comment',
    preAnnouncement: true,
    description: '観測報道に対して会社がコメント(適時開示等)を出した状態',
  },
  announced: {
    label: '正式発表済み',
    mark: '●',
    tone: 'announce',
    preAnnouncement: false,
    description: 'TOB・MBO等が正式発表され、手続きが進行中の状態',
  },
  completed: {
    label: '成立・完了',
    mark: '■',
    tone: 'done',
    preAnnouncement: false,
    description: '公開買付等が成立し、案件が完了した状態',
  },
  withdrawn: {
    label: '撤回・不成立',
    mark: '✕',
    tone: 'stop',
    preAnnouncement: false,
    description: '公開買付等が撤回された、または不成立となった状態',
  },
  dormant: {
    label: '検討終了・未進展',
    mark: '□',
    tone: 'pause',
    preAnnouncement: true,
    description: '検討終了が公表された、または報道後に長期間進展がない状態',
  },
};

export const STATUS_ORDER: CaseStatus[] = [
  'rumored',
  'commented',
  'announced',
  'completed',
  'withdrawn',
  'dormant',
];

export interface EventTypeDef {
  label: string;
  mark: string;
  tone: StatusDef['tone'];
}

export const EVENT_TYPE: Record<EventType, EventTypeDef> = {
  observation_report: { label: '観測報道', mark: '◇', tone: 'watch' },
  company_comment: { label: '会社コメント', mark: '◆', tone: 'comment' },
  follow_up_report: { label: '続報', mark: '◇', tone: 'watch' },
  timely_disclosure: { label: '適時開示', mark: '◆', tone: 'comment' },
  formal_announcement: { label: '正式発表', mark: '●', tone: 'announce' },
  price_revision: { label: '公開買付価格の変更', mark: '●', tone: 'announce' },
  tender_offer_result: { label: '公開買付結果', mark: '■', tone: 'done' },
  consideration_ended: { label: '検討終了', mark: '□', tone: 'pause' },
  withdrawal: { label: '撤回・不成立', mark: '✕', tone: 'stop' },
  correction: { label: '訂正', mark: '!', tone: 'stop' },
  other: { label: 'その他', mark: '・', tone: 'pause' },
};

export function statusDef(status: CaseStatus): StatusDef {
  return CASE_STATUS[status] ?? CASE_STATUS.rumored;
}

export function eventTypeDef(type: EventType): EventTypeDef {
  return EVENT_TYPE[type] ?? EVENT_TYPE.other;
}
