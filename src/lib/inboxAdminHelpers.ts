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
