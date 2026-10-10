import {parseManualPrice} from './marketMetrics.ts';
export type PriceCase={id:string;code:string;name:string;archived?:boolean};
export function parseDailyPriceBatch(input:unknown,cases:PriceCase[],today?:string){
 if(!Array.isArray(input)||input.length<1||input.length>300)throw Error('JSONは1〜300件の配列にしてください。');
 const seen=new Set<string>();
 return input.map(r=>{
  if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['code','caseId','date','price','shareBasisOn','sourceName','note'].includes(k)))throw Error('JSONの項目名を確認してください。');
  const matches=cases.filter(c=>c.code===r.code&&(!r.caseId||c.id===r.caseId));
  if(matches.length!==1)throw Error('銘柄が見つからないか、複数案件があります。証券コードとcaseIdを確認してください。');
  const c=matches[0],row=parseManualPrice({case_id:c.id,price_type:'daily_close',price:r.price,price_date:r.date,share_basis_on:r.shareBasisOn,source_name:r.sourceName,note:r.note},today);
  const key=c.id+row.price_date;if(seen.has(key))throw Error('同じ銘柄・日付が入力内で重複しています。');seen.add(key);
  return {row,label:c.code+' '+c.name+' ／ '+row.price_date+' ／ '+row.price.toLocaleString('ja-JP')+'円 ／ 分割基準 '+(row.share_basis_on??'未確認')};
 });
}
