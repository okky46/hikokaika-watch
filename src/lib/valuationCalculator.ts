import {METRICS,basisLabel,prerequisites,multipleFromPrice,priceFromMultiple} from './valuation.ts';
import type {Financials,Metric} from './valuation';
export function setupValuationCalculator(root:HTMLElement){
 const sets=JSON.parse(root.dataset.factSets??'[]') as {key:string;facts:Financials['facts']}[];
 const price=root.querySelector<HTMLInputElement>('[data-price]'),multiple=root.querySelector<HTMLInputElement>('[data-multiple]'),metric=root.querySelector<HTMLSelectElement>('[data-metric]');
 if(!price||!multiple||!metric||!sets.length)return;
 const selector=root.querySelector<HTMLSelectElement>('[data-financial-basis]');
 const result=root.querySelector<HTMLElement>('[data-scenario]')!,basis=root.querySelector<HTMLElement>('[data-scenario-basis]')!;
 const number=(v:number)=>v.toLocaleString('ja-JP',{maximumFractionDigits:2});
 const update=()=>{
  const selected=sets.find(s=>s.key===selector?.value)??sets[0],f=selected.facts;
  root.querySelectorAll<HTMLElement>('[data-financial-view]').forEach(view=>view.hidden=view.dataset.financialView!==selected.key);
  for(const key of Object.keys(METRICS) as Metric[]){
   const out=root.querySelector<HTMLElement>(`[data-result="${key}"]`)!,fact=f[key==='per'?'eps':key==='pbr'?'bps':'ebitda'];
   root.querySelector<HTMLElement>(`[data-result-basis="${key}"]`)!.textContent=fact?`${basisLabel(fact.basis)}・${fact.period}`:'財務数値未登録';
   const value=multipleFromPrice(f,key,price.valueAsNumber);
   out.textContent=prerequisites(f,key)??(!price.value?'株価を入力してください':!price.validity.valid||value===null?'株価の入力範囲と財務数値を確認してください。計算には0より大きい株価・EVが必要です。':`${number(value)}倍`);
  }
  const key=metric.value as Metric,fact=f[key==='per'?'eps':key==='pbr'?'bps':'ebitda'];
  basis.textContent=fact?`${basisLabel(fact.basis)}・${fact.period}の数値で計算。`:'';
  const value=priceFromMultiple(f,key,multiple.valueAsNumber);
  result.textContent=prerequisites(f,key)??(!multiple.value?'倍率を入力してください':!multiple.validity.valid||value===null?'試算できません。倍率の入力範囲と財務数値を確認してください。':`入力した条件での試算株価：${number(value)}円`);
  root.querySelector<HTMLElement>('[data-ev-inputs]')!.textContent=f.ebitda?`EBITDA：${number(f.ebitda.value/1000000)}百万円（${basisLabel(f.ebitda.basis)}・${f.ebitda.period}） ／ EV残高基準日：${f.cash?.period??'未登録'}`:'';
  const evRatio=multipleFromPrice(f,'evEbitda',price.valueAsNumber);
  root.querySelector<HTMLElement>('[data-ev-result]')!.textContent=price.validity.valid&&evRatio!==null?`入力株価でのEV：${number((price.valueAsNumber*f.shares!.value+f.debt!.value-f.cash!.value+f.adjustments!.value)/1000000)}百万円`:'';
 };
 price.addEventListener('input',update);multiple.addEventListener('input',update);metric.addEventListener('change',update);selector?.addEventListener('change',update);
 root.querySelector('[data-reset]')!.addEventListener('click',()=>{price.value='';multiple.value='';update();});
 update();
}
