import type { CaseListItem, LegacyCaseStatus, RawEvent } from './types';

export function isAcknowledgedCase(c: Pick<CaseListItem, 'hasAcknowledgedCompanyComment'>): boolean {
  return c.hasAcknowledgedCompanyComment === true;
}

export function isAnnouncedCase(c: Pick<CaseListItem, 'hasFormalAnnouncement'>): boolean {
  return c.hasFormalAnnouncement;
}


export const FORMAL_ANNOUNCEMENT_STATUS_FALLBACKS = ['announced', 'completed', 'withdrawn'] as const satisfies readonly LegacyCaseStatus[];

export function hasFormalAnnouncement(status: LegacyCaseStatus, events: Pick<RawEvent, 'event_type'>[]): boolean {
  return (FORMAL_ANNOUNCEMENT_STATUS_FALLBACKS as readonly LegacyCaseStatus[]).includes(status) || events.some((e) => e.event_type === 'formal_announcement');
}
