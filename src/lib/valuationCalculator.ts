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
  const output=root.querySelector<HTMLElement>('[data-scenario-output]');
  if(output)output.dataset.metricKind=key;
  const metricLabel=root.querySelector<HTMLElement>('[data-scenario-metric]');
  if(metricLabel)metricLabel.textContent=METRICS[key];
  basis.textContent=fact?`${basisLabel(fact.basis)}・${fact.period}の数値で計算。`:'';
  const value=priceFromMultiple(f,key,multiple.valueAsNumber);
  result.textContent=prerequisites(f,key)??(!multiple.value?'倍率を入力してください':!multiple.validity.valid||value===null?'試算できません。倍率の入力範囲と財務数値を確認してください。':`入力した条件での試算株価：${number(value)}円`);
  root.querySelector<HTMLElement>('[data-ev-inputs]')!.textContent=f.ebitda?`EBITDA：${number(f.ebitda.value/1000000)}百万円（${basisLabel(f.ebitda.basis)}・${f.ebitda.period}） ／ EV残高基準日：${f.cash?.period??'未登録'}`:'';
  const evRatio=multipleFromPrice(f,'evEbitda',price.valueAsNumber);
  root.querySelector<HTMLElement>('[data-ev-result]')!.textContent=price.validity.valid&&evRatio!==null?`入力株価でのEV：${number((price.valueAsNumber*f.shares!.value+f.debt!.value-f.cash!.value+f.adjustments!.value)/1000000)}百万円`:'';
 };
 const applied=root.querySelector<HTMLElement>('[data-applied-reference]');
 const clearReference=()=>{if(applied){applied.hidden=true;applied.textContent='';}};
 const edit=()=>{clearReference();update();};
 price.addEventListener('input',update);multiple.addEventListener('input',edit);metric.addEventListener('change',edit);selector?.addEventListener('change',edit);
 root.querySelectorAll<HTMLButtonElement>('[data-use-reference]').forEach(button=>button.addEventListener('click',()=>{
  if(button.disabled)return;
  const key=button.dataset.useMetric as Metric,value=Number(button.dataset.referenceMultiple);
  const view=button.closest<HTMLElement>('[data-financial-view]');
  const selected=sets.find(s=>s.key===(view?.dataset.financialView??sets[0].key));
  if(!selected||!(key in METRICS)||!Number.isFinite(value)||value<=0||value>10000||prerequisites(selected.facts,key)||priceFromMultiple(selected.facts,key,value)===null)return;
  if(selector)selector.value=selected.key;
  metric.value=key;multiple.value=String(value);update();
  if(applied){applied.hidden=false;applied.textContent=`反映した参考倍率：${button.dataset.referenceLabel}。試算欄で倍率を変更できます。`;}
  multiple.focus({preventScroll:true});
  root.querySelector<HTMLElement>('[data-scenario-panel]')?.scrollIntoView?.({block:'start',behavior:'auto'});
 }));
 root.querySelector('[data-reset]')!.addEventListener('click',()=>{price.value='';multiple.value='';clearReference();update();});
 update();
}
