import type { CaseListItem, PublicCompany, RawCompany } from './types';

export function buildPublicCompanies(rawCompanies: RawCompany[], cases: CaseListItem[]): PublicCompany[] {
  const casesByCompany = groupBy(cases, (c) => c.securityCode);
  return rawCompanies
    .filter((co) => co.is_active === true)
    .flatMap((co): PublicCompany[] => {
      const companyCases = (casesByCompany.get(co.security_code) ?? [])
        .slice()
        .sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime());
      if (companyCases.length === 0) return [];
      return [{
        id: co.id,
        securityCode: co.security_code,
        nameJa: co.name_ja,
        market: co.market,
        industry: co.industry,
        cases: companyCases,
        lastUpdatedAt: companyCases[0]?.lastUpdatedAt ?? co.updated_at ?? null,
      }];
    });
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const arr = map.get(key);
    if (arr) arr.push(item);
    else map.set(key, [item]);
  }
  return map;
}
