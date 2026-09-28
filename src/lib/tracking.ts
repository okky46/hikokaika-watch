import { formatDate, formatDateTime } from './format.ts';
import type { RawEvent } from './types';

/** PR #8適用済みDBの補助列も読める。並び順の日付を実際の公表日として表示しない。 */
export function eventSortKey(event: RawEvent): string {
  return event.sort_at ?? event.occurred_at ?? event.site_published_at ?? event.updated_at;
}

export function eventDateLabel(event: RawEvent): string {
  if (event.date_precision === 'issue') return event.issue_label || '号数のみ確認';
  if (event.date_precision === 'unknown' || !event.occurred_at) return '日付未確認';
  return (event.date_precision ?? event.metadata?.date_precision) === 'date' ? formatDate(event.occurred_at) : formatDateTime(event.occurred_at);
}

/** 日付だけの資料はJSTの同日を保存上の基準にし、時刻として公開しない。 */
export function dateOnlyToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) return null;
  return formatDate(date.toISOString()).replaceAll('/', '-') === value ? date.toISOString() : null;
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
