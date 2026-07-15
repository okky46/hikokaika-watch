import type { CommentStance, CommentTag } from './types';

export type CommentTagGroup = 'acknowledged' | 'neutral' | 'denied' | 'declined' | 'other';

export interface CommentTagDef {
  label: string;
  description: string;
  group: CommentTagGroup;
}

export const COMMENT_TAGS: Record<CommentTag, CommentTagDef> = {
  consideration_acknowledged: { label: '検討を認めた', description: '非公開化やMBO等の検討事実を認めた。', group: 'acknowledged' },
  strategic_options_under_review: { label: '選択肢を検討中', description: '戦略的選択肢・企業価値向上策等を検討中。', group: 'acknowledged' },
  proposal_received: { label: '提案を受領', description: '買収・非公開化等の提案を受領した。', group: 'acknowledged' },
  discussions_ongoing: { label: '協議中', description: '関係者との協議・交渉が進行中。', group: 'acknowledged' },
  no_decision: { label: '決定事実なし', description: '現時点で決定した事実はない。', group: 'neutral' },
  not_company_announcement: { label: '会社発表ではない', description: '報道は会社が発表したものではない。', group: 'neutral' },
  not_under_consideration: { label: '検討していない', description: '検討事実を明確に否定。', group: 'denied' },
  report_denied: { label: '報道内容を否定', description: '報道内容を明確に否定。', group: 'denied' },
  comment_declined: { label: 'コメント差し控え', description: 'コメントを差し控えた。', group: 'declined' },
  other: { label: 'その他', description: '上記に当てはまらない会社コメント。', group: 'other' },
};

export const COMMENT_TAG_ORDER = Object.keys(COMMENT_TAGS) as CommentTag[];

export function classifyCommentStance(tags: readonly string[]): CommentStance {
  const groups = new Set(
    tags.map((tag) => COMMENT_TAGS[tag as CommentTag]?.group).filter(Boolean) as CommentTagGroup[],
  );
  if (groups.has('acknowledged') && groups.has('denied')) return 'needs_review';
  if (groups.has('acknowledged')) return 'acknowledged';
  if (groups.size === 1 && groups.has('denied')) return 'denied';
  if (groups.size === 1 && groups.has('declined')) return 'declined';
  if (groups.size === 1 && groups.has('neutral')) return 'neutral';
  return 'unclear';
}

export const COMMENT_STANCE_LABELS: Record<CommentStance, string> = {
  acknowledged: '検討・協議等の存在を認めた',
  neutral: '否定も肯定もしていない',
  denied: '明確に否定',
  declined: 'コメントを差し控えた',
  unclear: '分類困難',
  needs_review: '要確認（矛盾あり）',
};
