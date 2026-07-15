import type { CaseListItem, CaseStatus, RawEvent } from './types';

export function isAcknowledgedCase(c: Pick<CaseListItem, 'hasAcknowledgedCompanyComment'>): boolean {
  return c.hasAcknowledgedCompanyComment === true;
}

export function isAnnouncedCase(c: Pick<CaseListItem, 'hasFormalAnnouncement'>): boolean {
  return c.hasFormalAnnouncement;
}


export const FORMAL_ANNOUNCEMENT_STATUS_FALLBACKS = ['announced', 'completed', 'withdrawn'] as const satisfies readonly CaseStatus[];

export function hasFormalAnnouncement(status: CaseStatus, events: Pick<RawEvent, 'event_type'>[]): boolean {
  return (FORMAL_ANNOUNCEMENT_STATUS_FALLBACKS as readonly CaseStatus[]).includes(status) || events.some((e) => e.event_type === 'formal_announcement');
}
