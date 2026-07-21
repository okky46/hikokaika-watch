export type CompanyLike = { id: string; security_code?: string | null };
export type CaseLike = { id: string };

export function normalizeSecurityCode(code: unknown): string {
  return String(code ?? '').trim().toUpperCase();
}

export function resolveInboxCompanyId(companies: CompanyLike[], securityCode: unknown): string | null {
  const normalized = normalizeSecurityCode(securityCode);
  if (!normalized) return null;
  return companies.find((company) => normalizeSecurityCode(company.security_code) === normalized)?.id ?? null;
}

export function resolveInboxCaseId(cases: CaseLike[], matchedCaseId: unknown): string {
  const id = String(matchedCaseId ?? '').trim();
  if (!id) return '';
  return cases.some((caseRow) => caseRow.id === id) ? id : '';
}

export function normalizeHttpUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function isAllowedHttpUrl(value: unknown): boolean {
  return normalizeHttpUrl(value) !== null;
}

export function preserveSelectValueIfValid<T extends string>(currentValue: unknown, validValues: readonly T[]): T | null {
  const value = String(currentValue ?? '');
  return validValues.includes(value as T) ? (value as T) : null;
}

export type InboxAdminItemLike = {
  id: string;
  title?: string | null;
  security_code?: string | null;
  source_kind?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  raw?: { query?: unknown; description?: unknown } | null;
};

export type InboxFilterOptions = { keyword?: string; dateFrom?: string; dateTo?: string };

function localDateKey(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function inboxItemFilterDate(item: InboxAdminItemLike): string | null {
  return localDateKey(item.published_at) ?? localDateKey(item.created_at);
}

export function inboxSearchText(item: InboxAdminItemLike): string {
  return [item.title, item.security_code, item.source_kind, item.raw?.query, item.raw?.description]
    .map((value) => String(value ?? '').toLowerCase())
    .join('\n');
}

export function filterInboxItems<T extends InboxAdminItemLike>(items: T[], options: InboxFilterOptions): T[] {
  const keyword = String(options.keyword ?? '').trim().toLowerCase();
  const from = String(options.dateFrom ?? '').trim();
  const to = String(options.dateTo ?? '').trim();
  return items.filter((item) => {
    if (keyword && !inboxSearchText(item).includes(keyword)) return false;
    const key = inboxItemFilterDate(item);
    if (from && (!key || key < from)) return false;
    if (to && (!key || key > to)) return false;
    return true;
  });
}

export function visibleSelectionIds(items: InboxAdminItemLike[], selectedIds: Iterable<string>): string[] {
  const visible = new Set(items.map((item) => item.id));
  return [...selectedIds].filter((id) => visible.has(id));
}

export function pendingBulkRejectIds(items: InboxAdminItemLike[], selectedIds: Iterable<string>): string[] {
  const selected = new Set(selectedIds);
  return items.filter((item) => item.status === 'pending' && selected.has(item.id)).map((item) => item.id);
}
