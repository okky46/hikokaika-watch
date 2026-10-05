import { jstToday, timelineDateKey } from './trackingDates.ts';
import type { CaseEventView } from './types.ts';

export type TimelineOrder = 'newest' | 'oldest';
type DatedEvent = Pick<CaseEventView, 'id' | 'date'>;

/** Keep undated records last in either direction; issue months remain explicitly approximate. */
export function orderTimeline<T extends DatedEvent>(events: T[], order: TimelineOrder): T[] {
  return [...events].sort((a, b) => {
    const aKnown = !!(a.date.start || a.date.referenceMonth);
    const bKnown = !!(b.date.start || b.date.referenceMonth);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    const difference = timelineDateKey(a.date).localeCompare(timelineDateKey(b.date));
    return (order === 'newest' ? -difference : difference) || a.id.localeCompare(b.id);
  });
}

/** Never promote a later registration, issue month, or future date to the latest publication. */
export function latestDatedEvent(events: CaseEventView[], now = new Date()): CaseEventView | undefined {
  const today = jstToday(now);
  return orderTimeline(events, 'newest').find(e =>
    ['date', 'datetime'].includes(e.date.precision) && e.date.start && e.date.start === e.date.end &&
    e.date.start <= today && (e.date.precision !== 'datetime' || !!e.date.instant && Date.parse(e.date.instant) <= now.getTime()) &&
    e.sourceName.trim() && /^https?:\/\//i.test(e.sourceUrl));
}
