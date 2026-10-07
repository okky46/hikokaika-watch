import {newObservation,parseObservations,mergeObservationImport,OBSERVATION_KIND,OBSERVATION_OUTCOME,type WatchObservation} from './watchHistory.ts';
import {escapeTrackingText as esc} from './trackingPresentation';
export function setupWatchHistoryEditor(markDirty:()=>void,eventOptions:()=>{id:string;label:string}[]){
 const root=document.getElementById('observation-editor')!;
 const rows=root.querySelector<HTMLElement>('[data-observation-rows]')!;
 const message=root.querySelector<HTMLElement>('[data-observation-message]')!;
 let originals:WatchObservation[]=[];
 const fields:Record<string,string>={title:'見出し',occurred_on:'動きがあった日（不明は空欄）',date_note:'時期の補足・不確かさ',observer:'記録者・発見方法（人・AIなど）',facts:'観測した事実・確認した範囲',interpretation:'見立て・仮説（任意）',source_name:'出典名・情報の入手方法',source_url:'出典URL（任意）',price:'当時の株価（円、任意）',price_on:'株価の基準日',volume:'当時の出来高（株、任意）'};
 function refreshReferences(){
  for(const box of rows.querySelectorAll<HTMLElement>('[data-observation-id]')){
   for(const key of ['related_id','event_id']){
    const sel=box.querySelector<HTMLSelectElement>(`[data-o="${key}"]`)!;const selected=sel.value||sel.dataset.initial||'';delete sel.dataset.initial;
    const options=key==='event_id'?eventOptions():[...rows.querySelectorAll<HTMLElement>('[data-observation-id]')].filter(x=>x!==box).map(x=>({id:x.dataset.observationId!,label:x.querySelector<HTMLInputElement>('[data-o="title"]')!.value||'新しい観察'}));
    sel.innerHTML='<option value="">指定なし</option>'+options.map(x=>`<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('');
    if(selected&&!options.some(x=>x.id===selected))sel.innerHTML+=`<option value="${esc(selected)}">参照先が見つかりません</option>`;
    sel.value=selected;
   }
  }
 }
 function add(o:WatchObservation){
  const box=document.createElement('details');box.className='card section';box.dataset.observationId=o.id;box.open=!o.title;
  box.innerHTML=`<summary>${esc(o.title||'新しい観察')}</summary><p class="small muted">観察ID：${esc(o.id)} ／ 記録：${esc(o.recorded_at)}</p><div class="editor-grid"><label>記録の種類<select data-o="kind">${Object.entries(OBSERVATION_KIND).map(([k,v])=>`<option value="${k}" ${o.kind===k?'selected':''}>${v}</option>`).join('')}</select></label><label>確認結果<select data-o="outcome">${Object.entries(OBSERVATION_OUTCOME).map(([k,v])=>`<option value="${k}" ${o.outcome===k?'selected':''}>${v}</option>`).join('')}</select></label>${Object.entries(fields).map(([k,label])=>`<label>${label}${['facts','interpretation'].includes(k)?`<textarea data-o="${k}" maxlength="3000">${esc(String(o[k as keyof WatchObservation]??''))}</textarea>`:`<input data-o="${k}" type="${k.endsWith('_on')?'date':['price','volume'].includes(k)?'number':k==='source_url'?'url':'text'}" ${['price','volume'].includes(k)?'step="any" min="0"':''} value="${esc(String(o[k as keyof WatchObservation]??''))}"/>`}</label>`).join('')}</div><button class="btn" type="button" data-remove-observation>この観察を下書きから外す</button>`;
  const grid=box.querySelector('.editor-grid')!;
  for(const [key,label] of [['related_id','関連する観察・起点'],['event_id','関連する報道・開示']]){const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.dataset.o=key;select.dataset.initial=String(o[key as keyof WatchObservation]??'');wrap.append(select);grid.append(wrap);}
  box.querySelector('[data-o="title"]')!.addEventListener('input',()=>{box.querySelector('summary')!.textContent=box.querySelector<HTMLInputElement>('[data-o="title"]')!.value||'新しい観察';refreshReferences();});
  box.querySelector('[data-remove-observation]')!.addEventListener('click',()=>{box.remove();refreshReferences();markDirty();});rows.append(box);refreshReferences();
 }
 function fill(input:WatchObservation[]){originals=structuredClone(input);rows.replaceChildren();input.forEach(add);message.textContent='';}
 function read(){
  const result=[...rows.querySelectorAll<HTMLElement>('[data-observation-id]')].map(box=>{
   const old=originals.find(x=>x.id===box.dataset.observationId),o={...(old??newObservation()),id:box.dataset.observationId!} as WatchObservation;
   for(const input of box.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('[data-o]')){
    const k=input.dataset.o!; (o as unknown as Record<string,unknown>)[k]=['price','volume'].includes(k)?(input.value.trim()===''?null:Number(input.value)):input.value.trim();
   }
   if(!old||JSON.stringify({...o,updated_at:''})!==JSON.stringify({...old,updated_at:''}))o.updated_at=new Date().toISOString();
   return o;
  });return parseObservations(result);
 }
 root.querySelector('[data-add-observation]')!.addEventListener('click',()=>{const o=newObservation();originals.push(o);add(o);markDirty();});
 root.querySelector('[data-import-observations]')!.addEventListener('click',()=>{
  try{const imported=JSON.parse(root.querySelector<HTMLTextAreaElement>('[data-observation-json]')!.value);fill(mergeObservationImport(read(),imported));markDirty();message.textContent=`${imported.length}件を入力欄へ反映しました。内容を確認して下書き保存してください。`;}
  catch(e){message.textContent=`取り込めませんでした。${e instanceof Error?e.message:'JSONの形式を確認してください。'}`;}
 });
 return {fill,read,refreshReferences};
}
