import type {Comparable,Metric,ComparableMultiple} from './valuation';
export type PeerStats={metric:Metric; basis:ComparableMultiple['basis']; scope:string; priceBasis:string; definition:string; count:number; mean:number; median:number; min:number; max:number; samples:Comparable[]};
export function comparableStats(records:Comparable[],industry:string,options:{excludeCode?:string; fromYear?:number; toYear?:number; transactionType?:string; priceBasis?:string}={}):PeerStats[]{
  const candidates=records.filter(c=>c.industry===industry&&c.code!==options.excludeCode&&c.research?.statisticsEligible&&c.research.status==='completed'&&c.research.priceBasis===(options.priceBasis??'final')&&(!options.transactionType||c.research.transactionType===options.transactionType)&&(!options.fromYear||Number(c.announcedOn.slice(0,4))>=options.fromYear)&&(!options.toYear||Number(c.announcedOn.slice(0,4))<=options.toYear));
  // Conflicting duplicate editions of a deal are omitted instead of being counted twice.
  const counts=new Map<string,number>();for(const c of candidates)counts.set(c.research!.dealId,(counts.get(c.research!.dealId)??0)+1);
  const groups=new Map<string,{metric:Metric;basis:ComparableMultiple['basis'];scope:string;priceBasis:string;definition:string;rows:{c:Comparable;value:number}[]}>();
  for(const c of candidates){const r=c.research!;if(counts.get(r.dealId)!==1)continue;
    for(const [metric,m] of Object.entries(c.multiples) as [Metric,ComparableMultiple][]){const definition=r.definitions[metric];if(!definition)continue;
      const key=JSON.stringify([metric,m.basis,r.scope,r.priceBasis,definition]);
      const g=groups.get(key)??{metric,basis:m.basis,scope:r.scope,priceBasis:r.priceBasis,definition,rows:[]};g.rows.push({c,value:m.value});groups.set(key,g);
    }
  }
  return [...groups.values()].map(g=>{const values=g.rows.map(r=>r.value).sort((a,b)=>a-b),n=values.length;return {metric:g.metric,basis:g.basis,scope:g.scope,priceBasis:g.priceBasis,definition:g.definition,count:n,mean:values.reduce((a,b)=>a+b,0)/n,median:n%2?values[(n-1)/2]:(values[n/2-1]+values[n/2])/2,min:values[0],max:values[n-1],samples:g.rows.map(r=>r.c)};});
}
