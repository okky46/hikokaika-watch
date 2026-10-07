import type {PublicCompany} from './types';
import type {Financials} from './valuation';
/** The financials here are already filtered by the publication RPC. */
export function valuationCompanies(companies:PublicCompany[],financials:Financials[]):PublicCompany[]{
 const codes=new Set(companies.map(c=>c.securityCode));
 return [...companies,...financials.filter(f=>!codes.has(f.code)).map(f=>({id:`valuation:${f.code}`,securityCode:f.code,nameJa:f.name,industry:f.industry,market:null,cases:[],lastUpdatedAt:f.checkedOn}))];
}
