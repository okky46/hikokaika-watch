import type { CaseListItem } from './types';

export function isAcknowledgedCase(c: Pick<CaseListItem, 'hasAcknowledgedCompanyComment'>): boolean {
  return c.hasAcknowledgedCompanyComment === true;
}

export function isAnnouncedCase(c: Pick<CaseListItem, 'hasFormalAnnouncement'>): boolean {
  return c.hasFormalAnnouncement;
}
