import { jstToday, type PublicEventDate } from './trackingDates.ts';
import { validDate } from './trackingProfile.ts';
import type { CaseDetail, CaseEventView } from './types.ts';

type MovementCase = Pick<CaseDetail, 'id' | 'slug' | 'companyName' | 'securityCode' | 'events'>;
export interface RecentMovement {
  caseId: string;
  slug: string;
  companyName: string;
  securityCode: string;
  event: CaseEventView;
}

/** Date precision is reviewed public data; never fall back to raw timestamps or editing dates. */
function eligibleDate(date: PublicEventDate, from: string, to: string, now: Date): boolean {
  if (!['date', 'datetime'].includes(date.precision) || !date.start || !validDate(date.start)) return false;
  if (date.start !== date.end || date.start < from || date.start > to) return false;
  return date.precision !== 'datetime' || !!date.instant && Number.isFinite(Date.parse(date.instant)) && Date.parse(date.instant) <= now.getTime();
}

/** Input must come from loadPublicData().details, after visibility / published-profile filtering. */
export function recentMovements(cases: MovementCase[], now = new Date()): { asOf: string; from: string; items: RecentMovement[] } {
  const asOf = jstToday(now);
  const start = new Date(`${asOf}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  const from = start.toISOString().slice(0, 10);
  const items = cases.flatMap(c => c.events
    .filter(e => eligibleDate(e.date, from, asOf, now) && e.sourceName.trim() && /^https?:\/\//i.test(e.sourceUrl))
    .map(event => ({ caseId: c.id, slug: c.slug, companyName: c.companyName, securityCode: c.securityCode, event })));
  // Within a day, timed entries precede date-only entries; this is not an inferred publication time.
  items.sort((a, b) => b.event.date.start!.localeCompare(a.event.date.start!) ||
    (b.event.date.instant ?? '').localeCompare(a.event.date.instant ?? '') ||
    a.caseId.localeCompare(b.caseId) || a.event.id.localeCompare(b.event.id));
  const seen = new Set<string>();
  return { asOf, from, items: items.filter(item => {
    if (seen.has(item.caseId)) return false;
    seen.add(item.caseId);
    return true;
  }).slice(0, 5) };
}
