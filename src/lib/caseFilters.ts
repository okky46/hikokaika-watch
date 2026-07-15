import type { CaseListItem } from './types';

export function isAcknowledgedCase(c: Pick<CaseListItem, 'status' | 'hasAcknowledgedCompanyComment'>): boolean {
  return c.status === 'commented' && c.hasAcknowledgedCompanyComment;
}

export function isAnnouncedCase(c: Pick<CaseListItem, 'hasFormalAnnouncement'>): boolean {
  return c.hasFormalAnnouncement;
}
