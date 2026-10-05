import { readSearch, searchParams, matchesCase, matchingEvents, compareCases, defaultSearch } from './trackingSearch';
import type { SearchCase } from './trackingSearch';
import { lastTwelveMonths } from './trackingDates';

export function setupTrackingList(personalMatch:(id:string)=>boolean, clearPersonal:()=>void) {
  const form=document.getElementById('filter-form') as HTMLFormElement;
  const data=JSON.parse(document.getElementById('tracking-search-data')!.textContent!) as (SearchCase & {slug:string})[];
  const cases=new Map(data.map(c=>[c.id,c]));
  const rows=[...document.querySelectorAll<HTMLTableRowElement>('#tracking-table tbody tr')];
  const body=document.querySelector<HTMLTableSectionElement>('#tracking-table tbody')!;
  // Keep native links/buttons and text selection usable; keyboard users retain the company link.
  body.classList.add('clickable-rows');
  body.addEventListener('click',e=>{
    if(e.defaultPrevented || e.button!==0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const target=e.target;
    if(!(target instanceof Element) || target.closest('a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[contenteditable]')) return;
    if(window.getSelection()?.toString()) return;
    target.closest('tr')?.querySelector<HTMLAnchorElement>('a.case-link')?.click();
  });
  const media=[...form.querySelectorAll<HTMLInputElement>('[name=media]')];
  const allowedMedia=media.map(m=>m.value);
  const input=(key:string)=>form.elements.namedItem(key) as HTMLInputElement;
  let filters=defaultSearch();
  function restore() {
    const parsed=readSearch(location.search,allowedMedia); filters=parsed.filters;
    document.getElementById('search-warning')!.hidden=!parsed.ignored;
    for(const key of ['q','stage','status','statement','from','to','sort'] as const) input(key).value=filters[key];
    input('issues').checked=filters.includeIssues;
    for(const m of media)m.checked=filters.media.includes(m.value);
    apply();
  }
  function readForm() {
    for(const key of ['q','stage','status','statement','from','to','sort'] as const) (filters as unknown as Record<string,unknown>)[key]=input(key).value;
    filters.media=media.filter(m=>m.checked).map(m=>m.value);filters.includeIssues=input('issues').checked;
  }
  function apply() {
    const invalid=!!(filters.from && filters.to && filters.from>filters.to);
    input('to').setCustomValidity(invalid ? '終了日は開始日以降にしてください' : '');
    document.getElementById('date-error')!.hidden=!invalid;
    if(invalid)form.querySelector<HTMLDetailsElement>('.search-more')!.open=true;
    const advancedCount=filters.media.length+Number(!!filters.statement)+Number(!!(filters.from||filters.to))+Number(filters.includeIssues)+Number(!!(document.getElementById('f-intensity') as HTMLSelectElement).value);
    document.getElementById('advanced-filter-count')!.textContent=advancedCount ? `（${advancedCount}条件を適用中）` : '';
    let visible=0;
    for(const row of rows.sort((a,b)=>compareCases(cases.get(a.dataset.caseId!)!,cases.get(b.dataset.caseId!)!,filters.sort))) {
      const c=cases.get(row.dataset.caseId!)!;
      const ok=!invalid && matchesCase(c,filters) && personalMatch(c.id);
      row.hidden=!ok;body.append(row);if(ok)visible++;
      const match=row.querySelector<HTMLElement>('.period-match')!;match.replaceChildren();match.hidden=!(filters.from||filters.to);
      if(!match.hidden) {
        const events=matchingEvents(c,filters);
        if(events.length) {const link=document.createElement('a');link.href=`/cases/${c.slug}/#event-${events[0].id}`;link.textContent=`期間内: ${events[0].date.label} ${events[0].title}`;match.append(link);if(events.length>1)match.append(` ほか${events.length-1}件`);}
      }
    }
    document.getElementById('filter-count')!.textContent=`${visible} / ${rows.length} 件`;
    document.getElementById('empty-state')!.hidden=visible>0;
    for(const m of media) {
      const n=data.filter(c=>matchesCase(c,filters,true)&&personalMatch(c.id)&&c.media.includes(m.value)).length;
      form.querySelector(`[data-media-count="${m.value}"]`)!.textContent=String(n);
      m.disabled=n===0&&!m.checked;
    }
    const chips=document.getElementById('active-filters')!;chips.replaceChildren();
    const add=(label:string,clear:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='btn small';b.textContent=`${label} ×`;b.setAttribute('aria-label',`${label}の条件を解除`);b.onclick=()=>{clear();commit();};chips.append(b);};
    if(filters.q)add(`検索: ${filters.q}`,()=>input('q').value='');
    if(filters.stage) add(form.querySelector<HTMLInputElement>('[name="stage"]:checked')!.dataset.label!,()=>input('stage').value='');
    for(const key of ['status','statement'] as const) if(filters[key])add((input(key) as unknown as HTMLSelectElement).selectedOptions[0].text,()=>input(key).value='');
    for(const m of media.filter(m=>m.checked))add(m.dataset.label!,()=>m.checked=false);
    if(filters.from||filters.to)add(`期間: ${filters.from||'指定なし'}〜${filters.to||'指定なし'}`,()=>{input('from').value='';input('to').value='';});
    if(filters.includeIssues)add('号数の参考年月を含む',()=>input('issues').checked=false);
    if(filters.sort!=='event')add(`並び順: ${(input('sort') as unknown as HTMLSelectElement).selectedOptions[0].text}`,()=>input('sort').value='event');
    const fav=document.getElementById('f-fav') as HTMLInputElement;
    const intensity=document.getElementById('f-intensity') as HTMLSelectElement;
    if(fav.checked)add('お気に入り',()=>fav.checked=false);
    if(intensity.value)add(`関心度: ${intensity.selectedOptions[0].text}`,()=>intensity.value='');
    document.querySelector<HTMLElement>('[data-clear-main]')!.hidden=!chips.childElementCount;
    try {sessionStorage.setItem('tracking-public-search',searchParams(filters));}catch{}
  }
  function commit(replace=false) {
    readForm();const query=searchParams(filters);const url=query?`/?${query}`:'/';
    if(url!==location.pathname+location.search)history[replace?'replaceState':'pushState'](null,'',url);
    document.getElementById('search-warning')!.hidden=true;apply();
  }
  let timer:ReturnType<typeof setTimeout>;
  form.addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);commit();});
  form.addEventListener('input',e=>{
    const target=e.target as HTMLInputElement;
    if(target.name==='media'&&target.checked)for(const m of media)if(m!==target&&(target.value==='none'||m.value==='none'))m.checked=false;
    clearTimeout(timer);
    if(target.name==='q')timer=setTimeout(()=>commit(true),300);else commit();
  });
  // form-associated controls outside <form> do not bubble input events through it.
  input('sort').addEventListener('change',()=>{clearTimeout(timer);commit();});
  document.querySelectorAll('[data-clear-search]').forEach(b=>b.addEventListener('click',()=>{form.reset();clearPersonal();commit();input('q').focus();}));
  document.getElementById('last-twelve-months')!.addEventListener('click',()=>{const range=lastTwelveMonths();input('from').value=range.from;input('to').value=range.to;commit();});
  document.getElementById('f-year')!.addEventListener('change',e=>{const year=(e.target as HTMLSelectElement).value;if(year){input('from').value=year+'-01-01';input('to').value=year+'-12-31';commit();}(e.target as HTMLSelectElement).value='';});
  window.addEventListener('popstate',()=>{clearTimeout(timer);restore();});
  window.addEventListener('pageshow',restore);
  restore();return apply;
}
