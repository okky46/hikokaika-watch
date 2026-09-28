import { formatDate, formatDateTime } from './format.ts';
import type { RawEvent } from './types';

/** PR #8適用済みDBの補助列も読める。並び順の日付を実際の公表日として表示しない。 */
export function eventSortKey(event: RawEvent): string {
  return event.sort_at ?? event.occurred_at ?? event.site_published_at ?? event.updated_at;
}

export function eventDateLabel(event: RawEvent): string {
  if (event.date_precision === 'issue') return event.issue_label || '号数のみ確認';
  if (event.date_precision === 'unknown' || !event.occurred_at) return '日付未確認';
  return event.date_precision === 'date' ? formatDate(event.occurred_at) : formatDateTime(event.occurred_at);
}

export function externalStockLinks(code: string) {
  const value = encodeURIComponent(code);
  return [
    { label: '株探 チャート', url: `https://kabutan.jp/stock/chart?code=${value}` },
    { label: '株探 業績', url: `https://kabutan.jp/stock/finance?code=${value}` },
    { label: 'Yahoo!ファイナンス', url: `https://finance.yahoo.co.jp/quote/${value}.T` },
  ];
}

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
