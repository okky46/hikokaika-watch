export function setupTobList(doc:Document=document){
 const form=doc.querySelector<HTMLFormElement>('#tob-filters');
 if(!form)return;
 const industry=doc.querySelector<HTMLSelectElement>('#tob-industry')!,metric=doc.querySelector<HTMLSelectElement>('#tob-metric')!;
 const query=doc.querySelector<HTMLInputElement>('#tob-query')!,outcome=doc.querySelector<HTMLSelectElement>('#tob-outcome')!;
 const from=doc.querySelector<HTMLInputElement>('#tob-from')!,to=doc.querySelector<HTMLInputElement>('#tob-to')!;
 const available=doc.querySelector<HTMLInputElement>('#tob-available')!;
 const table=doc.querySelector<HTMLElement>('#tob-comparison')!,hint=doc.querySelector<HTMLElement>('#tob-scroll-hint')!;
 const win=doc.defaultView!;
 const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/g,'');
 const rows=[...doc.querySelectorAll<HTMLElement>('[data-tob-row]')];
 const url=new URL(win.location.href),initialIndustry=url.searchParams.get('industry');
 if(initialIndustry&&[...industry.options].some(o=>o.value===initialIndustry))industry.value=initialIndustry;
 metric.value=win.matchMedia('(max-width: 760px)').matches?'per':'all';
 const apply=()=>{
  const invalid=!!from.value&&!!to.value&&from.value>to.value;
  to.setCustomValidity(invalid?'終了日は開始日以降にしてください。':'');
  doc.querySelector<HTMLElement>('#tob-date-error')!.hidden=!invalid;
  if(invalid)doc.querySelector<HTMLDetailsElement>('.tob-more')!.open=true;
  const advanced=Number(!!outcome.value)+Number(!!(from.value||to.value))+Number(available.checked);
  doc.querySelector('#tob-advanced-count')!.textContent=advanced?`（${advanced}条件を適用中）`:'';
  let count=0;
  for(const row of rows){
   const data=row.dataset;
   row.hidden=invalid||!!(industry.value&&data.tobIndustry!==industry.value)||!normalize(data.tobSearch??'').includes(normalize(query.value))
    ||!!(outcome.value&&data.tobOutcome!==outcome.value)
    ||!!(!invalid&&from.value&&(data.tobDate??'')<from.value)||!!(!invalid&&to.value&&(data.tobDate??'')>to.value)
    ||!!(available.checked&&!(data.tobMetrics??'').split(',').some(k=>k&&(metric.value==='all'||k===metric.value)));
   const article=doc.getElementById(data.tobTarget!);if(article)article.hidden=row.hidden;
   if(!row.hidden)count++;
  }
  doc.querySelectorAll<HTMLElement>('section[data-tob-industry]').forEach(s=>s.hidden=!!industry.value&&s.dataset.tobIndustry!==industry.value);
  doc.querySelector('#tob-count')!.textContent=`${count}件 / 全${rows.length}件（価格の段階別）`;
  doc.querySelector<HTMLElement>('#tob-empty')!.hidden=count!==0;
  table.dataset.metricMode=metric.value;hint.hidden=metric.value!=='all';table.scrollLeft=0;
  const current=new URL(win.location.href);
  if(industry.value)current.searchParams.set('industry',industry.value);else current.searchParams.delete('industry');
  win.history.replaceState(null,'',current);
 };
 const showHash=()=>{
  let id=win.location.hash.slice(1);try{id=decodeURIComponent(id);}catch{}
  const target=doc.getElementById(id);
  const article=target?.closest<HTMLElement>('article[data-tob-target]');
  if(!article)return;
  if(article.hidden){form.reset();metric.value=win.matchMedia('(max-width: 760px)').matches?'per':'all';apply();}
  target?.closest('details')?.setAttribute('open','');
 };
 form.addEventListener('submit',e=>e.preventDefault());
 form.addEventListener('input',apply);form.addEventListener('change',apply);
 doc.querySelector('[data-tob-reset]')!.addEventListener('click',()=>{form.reset();metric.value=win.matchMedia('(max-width: 760px)').matches?'per':'all';apply();query.focus();});
 win.addEventListener('hashchange',showHash);
 doc.querySelector<HTMLElement>('#tob-metric-control')!.hidden=false;
 apply();showHash();
}
