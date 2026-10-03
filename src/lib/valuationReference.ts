import {priceFromMultiple} from './valuation.ts';
import type {Financials,Metric} from './valuation';
import type {PeerStats} from './comparableStats';

export const REFERENCE_SPREAD = 0.1;
export function referenceScenarios(facts:Financials['facts'],metric:Metric,mean:number){
  return [1-REFERENCE_SPREAD,1,1+REFERENCE_SPREAD].map(factor=>{
    const multiple=mean*factor;
    return {multiple,price:priceFromMultiple(facts,metric,multiple)};
  });
}
export function matchingReferences(groups:PeerStats[],metric:Metric,facts:Financials['facts']){
  const fact=facts[metric==='per'?'eps':metric==='pbr'?'bps':'ebitda'];
  return groups.filter(g=>g.metric===metric&&(!fact||(g.basis===fact.basis&&g.scope===fact.scope)));
}
export function referencePeriod(group:PeerStats){
  const months=group.samples.map(s=>s.announcedOn.slice(0,7)).sort();
  const label=(s:string)=>`${s.slice(0,4)}年${Number(s.slice(5))}月`;
  if(!months.length)return '未登録';
  return months[0]===months.at(-1)?label(months[0]):`${label(months[0])}〜${label(months.at(-1)!)}`;
}
