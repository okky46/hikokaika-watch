import records from '../../data/tob-terms.json' with {type:'json'};
import type {CaseListItem,PricePoint} from './types.ts';
type CaseIdentity=Partial<Pick<CaseListItem,'slug'|'securityCode'|'tracking'>>;
/** Reviewed public disclosures. Match the case, not just a recycled security code.
 * A changed status note invalidates the summary until its conditions are reviewed again.
 * Dates never advance a case to a new stage automatically. */
export function tobTermsFor(c:CaseIdentity){
 return records.find(r=>r.slug===c.slug&&r.code===c.securityCode&&r.sourceStatusNote===c.tracking?.status_note)??null;
}
export function reviewedOfferPrice(c:CaseIdentity):PricePoint|null{
 const r=tobTermsFor(c);
 return r?{price:r.price,priceDate:r.priceDate,shareBasisOn:r.shareBasisOn??undefined,sourceName:r.sourceName,note:`公表日 ${r.priceDate}。${r.sourceUrl}`} : null;
}
export function offerPriceFor(c:CaseIdentity & Partial<Pick<CaseListItem,'formalOfferPrice'>>):PricePoint|null{
 const reviewed=reviewedOfferPrice(c),registered=c.formalOfferPrice;
 if(!registered)return reviewed;
 if(reviewed&&registered.priceDate<reviewed.priceDate)return reviewed;
 // Supplement an identical registered price only; never infer a basis for a revised price.
 return reviewed&&registered.price===reviewed.price&&registered.priceDate===reviewed.priceDate?{...reviewed,...registered,shareBasisOn:registered.shareBasisOn||reviewed.shareBasisOn}:registered;
}
