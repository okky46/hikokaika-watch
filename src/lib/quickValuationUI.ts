import {premiumPrice,evPrice,navPrice} from './quickValuation.ts';
import {prerequisites,basisLabel,type Financials} from './valuation.ts';
export function setupQuickValuation(root:HTMLElement){
  const sets=JSON.parse(root.dataset.sets??'[]') as {key:string;label:string;facts:Financials['facts']}[];
  const bases=JSON.parse(root.dataset.bases??'[]') as {id:string;price:number;label:string;note:string;url:string}[];
  const q=(k:string)=>root.querySelector<HTMLInputElement>(`[data-q="${k}"]`)!;
  const n=(k:string)=>q(k).validity.valid?q(k).valueAsNumber:NaN;
  const fmt=(v:number)=>v.toLocaleString('ja-JP',{maximumFractionDigits:2});
  const text=(selector:string,value:string)=>root.querySelector<HTMLElement>(selector)!.textContent=value;
  const output=(key:string,value:number|null,empty:string,formula:string)=>{
    text(`[data-output="${key}"]`,value===null?empty:`この前提なら ${fmt(value)} 円 / 株`);
    text(`[data-formula="${key}"]`,value===null?'':formula);
  };
  const scope=root.querySelector<HTMLSelectElement>('[data-nav-scope]')!;
  function update(){
    output('premium',premiumPrice(n('base'),n('premium')),'基準株価と想定プレミアムを確認してください。',`${fmt(n('base'))}円 ×（1 ＋ ${fmt(n('premium'))}%）`);
    output('ev',evPrice(n('ebitda'),n('multiple'),n('debt'),n('cash'),n('adjustments'),n('shares')),'財務数値と倍率を入力してください。株式数・EBITDAは正数、試算結果は0円超が必要です。',`（${fmt(n('ebitda'))} × ${fmt(n('multiple'))} − ${fmt(n('debt'))} ＋ ${fmt(n('cash'))} − ${fmt(n('adjustments'))}）÷ ${fmt(n('shares'))}（百万円・百万株）`);
    const contradiction=scope.value==='unreviewed'&&n('nav-adjustment')!==0;
    output('nav',contradiction?null:navPrice(n('equity'),n('nav-adjustment'),n('nav-shares')),contradiction?'評価調整を加える場合は、確認範囲で調査済みか自分の仮定かを選んでください。':'純資産・調整額・株式数を確認してください。株式数と試算結果は0超が必要です。',`（${fmt(n('equity'))} ＋ ${fmt(n('nav-adjustment'))}）÷ ${fmt(n('nav-shares'))}（百万円・百万株）／ ${scope.selectedOptions[0].text}`);
  }
  const base=root.querySelector<HTMLSelectElement>('[data-base]')!;
  base.addEventListener('change',()=>{const b=bases.find(x=>x.id===base.value);q('base').value=b?String(b.price):'';const note=root.querySelector<HTMLElement>('[data-base-note]')!;note.replaceChildren();note.append(b?`${b.label} ／ ${b.note}`:'自分で選んだ基準株価');if(b?.url){const a=document.createElement('a');a.href=b.url;a.textContent=' 出典';a.target='_blank';a.rel='noopener noreferrer';note.append(a);}update();});
  root.querySelectorAll<HTMLButtonElement>('[data-method]').forEach(button=>button.addEventListener('click',()=>{
    root.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==button.dataset.method);
    root.querySelectorAll<HTMLButtonElement>('[data-method]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  }));
  root.querySelector('[data-load-ev]')?.addEventListener('click',()=>{
    const selector=root.querySelector<HTMLSelectElement>('[data-load-set]')!;
    const s=sets.find(s=>s.key===selector.value)!;
    // Do not fill a mismatched set piecemeal; leave the user's prior inputs intact.
    const error=prerequisites(s.facts,'evEbitda');
    if(error){text('[data-ev-origin]',`${error} 入力欄は変更していません。手入力でも試算できます。`);return;}
    for(const k of ['ebitda','debt','cash','adjustments','shares'] as const)q(k).value=String(s.facts[k]!.value/1e6);
    text('[data-ev-origin]',`登録値を反映：${s.label}・EBITDA ${s.facts.ebitda!.period} ／ 残高 ${s.facts.cash!.period}。出典・参考予想の算式は「試算に使う登録値と出典」に記載。倍率は自分の仮定を入力してください。`);update();
  });
  root.querySelector('[data-load-nav]')?.addEventListener('click',()=>{
    const f=sets.find(s=>s.key==='registered')?.facts;
    if(!f?.bps||!f.shares||f.shares.value<=0||f.bps.period!==f.shares.period||f.bps.scope!==f.shares.scope||f.bps.basis!=='actual'){
      text('[data-nav-origin]','同じ基準日・範囲の実績BPSと株式数がそろっていません。純資産と株式数を手入力してください。');return;
    }
    q('equity').value=String(f.bps.value*f.shares.value/1e6);q('nav-shares').value=String(f.shares.value/1e6);
    text('[data-nav-origin]',`登録BPS × 株式数による概算：${f.bps.period}・${basisLabel(f.bps.basis)}。資産の時価はこの操作では評価していません。BPSと株数は「試算に使う登録値と出典」で確認できます。`);update();
  });
  root.addEventListener('input',event=>{
    const target=event.target as HTMLInputElement;
    if(target===q('base')){base.value='';text('[data-base-note]','自分で入力した基準株価。日付・株式分割の基準をそろえてください。');}
    if(['ebitda','debt','cash','adjustments','shares'].includes(target.dataset.q??''))text('[data-ev-origin]','自由入力の前提で試算中。残高の基準日・連結範囲・株式分割の基準をそろえてください。');
    if(['equity','nav-shares'].includes(target.dataset.q??''))text('[data-nav-origin]','自由入力の純資産と株式数で試算中。時価未調査の資産は調整に含めていません。');
    update();
  });scope.addEventListener('change',update);update();
}
