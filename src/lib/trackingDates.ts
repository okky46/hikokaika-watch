import { formatDate, formatDateTime } from './format.ts';
import { validDate, validMonth } from './trackingProfile.ts';
import type { EventDateOverride } from './trackingProfile.ts';
import type { RawEvent } from './types.ts';

export interface PublicEventDate {
  precision: EventDateOverride['precision'];
  label: string;
  start: string | null;
  end: string | null;
  referenceMonth: string | null;
  instant?: string;
}
export function jstToday(now = new Date()): string { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0,10); }
export function monthBounds(month: string): { start: string; end: string } {
  if (!validMonth(month)) throw new Error('年月が不正です');
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth()+1); d.setUTCDate(0);
  return { start:`${month}-01`, end:d.toISOString().slice(0,10) };
}
/** Inclusive interval: day after the clamped same date twelve months ago through today. */
export function lastTwelveMonths(today = jstToday()): { from: string; to: string } {
  if (!validDate(today)) throw new Error('基準日が不正です');
  const year = Number(today.slice(0,4)) - 1;
  const month = `${String(year).padStart(4,'0')}${today.slice(4,7)}`;
  const day = Math.min(Number(today.slice(8)), Number(monthBounds(month).end.slice(8)));
  const d = new Date(`${month}-${String(day).padStart(2,'0')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate()+1);
  return { from:d.toISOString().slice(0,10), to:today };
}
export function publicEventDate(e: RawEvent, override?: EventDateOverride): PublicEventDate {
  const precision = override?.precision ?? e.date_precision ?? e.metadata?.date_precision ?? (e.occurred_at ? 'datetime' : 'unknown');
  const value = override?.value ?? (precision === 'date' && e.occurred_at ? jstToday(new Date(e.occurred_at)) : e.occurred_at ?? '');
  if (precision === 'issue') return { precision, label:override?.issue_label || e.issue_label || '号数のみ確認', start:null, end:null, referenceMonth:validMonth(value) ? value : null };
  if (precision === 'month' && validMonth(value)) return { precision, label:`${value.replace('-','年')}月（公表月のみ）`, ...monthBounds(value), referenceMonth:null };
  if (precision === 'date' && validDate(value)) return { precision, label:value.replaceAll('-','/'), start:value, end:value, referenceMonth:null };
  if (precision === 'datetime' && value && Number.isFinite(Date.parse(value))) {
    const day = formatDate(value).replaceAll('/','-');
    return { precision, label:formatDateTime(value), start:day, end:day, referenceMonth:null, instant:new Date(value).toISOString() };
  }
  return { precision:'unknown', label:'公表日未確認', start:null, end:null, referenceMonth:null };
}
export function matchesDate(d: PublicEventDate, from: string, to: string, includeIssues = false): boolean {
  if (!from && !to) return true;
  const bounds = d.start && d.end ? { start:d.start, end:d.end } : includeIssues && d.referenceMonth ? monthBounds(d.referenceMonth) : null;
  return !!bounds && (!from || bounds.end >= from) && (!to || bounds.start <= to);
}
/** Unknown dates never acquire chronology from site registration or later editing. */
export function timelineDateKey(d: PublicEventDate): string {
  return d.start ? `${d.start}|${d.instant ?? ''}` : d.referenceMonth ? `${d.referenceMonth}-99|issue` : '9999-12-31|unknown';
}

export function timelineGroup(d:PublicEventDate):string {
  if(d.precision==='issue')return d.referenceMonth ? d.referenceMonth.replace('-','年')+'月・号数による参考配置' : '号数のみ確認（年月未確認）';
  if(d.start)return d.start.slice(0,7).replace('-','年')+'月';
  return '公表日未確認の記録';
}
