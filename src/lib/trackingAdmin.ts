import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyTrackingProfile, parseTrackingProfile, REPORT_METHOD, REPORT_ACCESS, DATE_PRECISION, validateProfileReferences, COLOR_STRENGTH_FIELDS } from './trackingProfile';
import type { TrackingProfile, TrackingEdition, MediaOutlet } from './trackingProfile';
import type { RawCase, RawEvent, RawCompany } from './types';
import { STATEMENT_FILTERS } from './trackingSearch';
import { publicEventDate, timelineDateKey, jstToday } from './trackingDates';
import { trackingSummaryHtml, escapeTrackingText as esc } from './trackingPresentation';

const fields={title:'ca-title',summary:'ca-summary',tracking_reason:'ca-tracking-reason',tracking_started_on:'ca-tracking-start',last_checked_on:'ca-last-checked',verification_note:'ca-verification',short_reason:'tp-short',status_note:'tp-status-note',public_status:'tp-status',report_state:'tp-report-state',report_note:'tp-report-note'} as const;
type Options={companies:()=>RawCompany[];cases:()=>RawCase[];afterSave:(id:string,approved:boolean)=>Promise<void>;onReset:()=>void};
export function setupTrackingAdmin(db:SupabaseClient,options:Options) {
  const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const input=(id:string)=>el<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>(id);
  let current:RawCase|null=null,edition:TrackingEdition|null=null,events:RawEvent[]=[],media:MediaOutlet[]=[];
  let busy=false,dirty=false,pending:boolean|null=null;
  const message=(s:string)=>el('ca-status-msg').textContent=s;
  function buttons() {
    for(const field of el('case-form').querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement|HTMLTextAreaElement>('input,select,textarea,button'))field.disabled=busy;
    input('ca-company').disabled=busy||!!current;
    el<HTMLButtonElement>('tp-publish').disabled=busy||dirty||!edition;
    el<HTMLButtonElement>('tp-unpublish').disabled=busy||dirty||!edition||!(edition.published||current?.is_visible);
    el<HTMLButtonElement>('tp-check').disabled=busy||!current;
  }
  function markDirty(){dirty=true;pending=null;el('tp-confirm').hidden=true;buttons();}
  const discard=()=>!dirty||confirm('保存していない銘柄の入力を破棄しますか？');
  async function task(action:()=>Promise<void>){if(busy)return;busy=true;buttons();try{await action();}catch(e){message(e instanceof Error?e.message:String(e));}finally{busy=false;buttons();}}
  async function loadMedia(){const r=await db.from('media_outlets').select('*').order('name');if(r.error)throw new Error(`媒体の読込に失敗: ${r.error.message}`);media=r.data;}
  async function readEvents(id:string){const r=await db.from('case_events').select('*').eq('case_id',id);if(r.error)throw new Error(r.error.message);return r.data as RawEvent[];}
  const eventOptions=()=>events.map(e=>({id:e.id,label:`${publicEventDate(e).label} ${e.title}${e.is_visible?'':'（非公開）'}`}));
  function select(key:string,label:string,values:{id:string;label:string}[],value:string,optional=false) {
    return `<label>${esc(label)}<select data-key="${key}">${optional?'<option value="">指定なし</option>':''}${values.map(v=>`<option value="${esc(v.id)}" ${v.id===value?'selected':''}>${esc(v.label)}</option>`).join('')}</select></label>`;
  }
  const choices=(o:Record<string,string>)=>Object.entries(o).map(([id,label])=>({id,label}));
  const field=(key:string,label:string,value:string,type='text')=>`<label>${esc(label)}<input data-key="${key}" type="${type}" value="${esc(value)}"/></label>`;
  function row(kind:'reports'|'statements'|'dates',html:string) {
    const box=document.createElement('fieldset');box.className='section';box.dataset.editorRow=kind;
    box.innerHTML=`<div class="editor-grid">${html}</div><button type="button" class="btn" data-remove-row>この項目を削除</button>`;
    box.querySelector('[data-remove-row]')!.addEventListener('click',()=>{if(busy)return;box.remove();markDirty();});el(`tp-${kind}`).append(box);
    if(kind==='reports')box.querySelector('[data-key="method"]')!.addEventListener('change',()=>{const method=box.querySelector<HTMLSelectElement>('[data-key="method"]')!.value;if(method!=='direct')box.querySelector<HTMLSelectElement>('[data-key="access"]')!.value='unread';markDirty();});
  }
  function report(r:TrackingProfile['reports'][number]) {row('reports',
    select('outlet_id','元の報道媒体',media.map(m=>({id:m.id,label:m.name})),r.outlet_id,true)+select('event_id','関連する出来事',eventOptions(),r.event_id,true)+
    select('method','報道の存在を確認した方法',choices(REPORT_METHOD),r.method)+select('access','原文の閲覧範囲',choices(REPORT_ACCESS),r.access)+
    field('source_name','確認に使った出典名',r.source_name)+field('source_url','出典URL',r.source_url,'url')+field('checked_on','確認日',r.checked_on,'date')+field('reported_on','報道日（不明は空欄）',r.reported_on,'date')+field('scope_note','確認できた範囲・未確認事項',r.scope_note));}
  function statement(r:TrackingProfile['statements'][number]) {row('statements',select('event_id','説明を記録した出来事',eventOptions(),r.event_id,true)+field('subject','説明した主体',r.subject)+field('text','説明内容（その日付時点）',r.text)+`<fieldset><legend>説明の分類</legend>${Object.entries(STATEMENT_FILTERS).map(([key,label])=>`<label class="filter-check"><input type="checkbox" data-tag value="${key}" ${r.tags.includes(key)?'checked':''}/>${label}</label>`).join('')}</fieldset>`);}
  function date(r:TrackingProfile['event_dates'][number]) {row('dates',select('event_id','出来事',eventOptions(),r.event_id,true)+select('precision','日付の精度',choices(DATE_PRECISION),r.precision)+field('value','日時／日付／年月（不明は空欄）',r.value)+field('issue_label','号数の表示（例: 2026年1月号）',r.issue_label));}
  function renderStatusEvents(ids:string[]) {el('tp-status-events').innerHTML=events.length?eventOptions().map(e=>`<label class="filter-check"><input type="checkbox" data-status-event value="${e.id}" ${ids.includes(e.id)?'checked':''}/>${esc(e.label)}</label>`).join(''):'<p class="small muted">出来事はまだありません。噂段階なら、このまま登録できます。</p>';}
  function fill(p:TrackingProfile) {
    for(const [key,id] of Object.entries(fields))input(id).value=p[key as keyof typeof fields];
    input('ca-id').value=current?.id??'';input('ca-company').value=current?.company_id??'';input('ca-slug').value=current?.slug??'';
    el<HTMLInputElement>('ca-slug').readOnly=!!current?.site_published_at;
    for(const kind of ['reports','statements','dates'])el(`tp-${kind}`).replaceChildren();
    renderStatusEvents(p.status_event_ids);p.reports.forEach(report);p.statements.forEach(statement);p.event_dates.forEach(date);
    renderBiddingEvents(p.bidding?.event_id ?? '');input('tp-bidding-stage').value=p.bidding?.stage ?? '';
    for(const key of Object.keys(COLOR_STRENGTH_FIELDS) as (keyof typeof COLOR_STRENGTH_FIELDS)[]) input(`tp-${key}`).value=p[key] ?? '';
    el('tp-edition-state').textContent=edition?.published?'公開承認済みの版があります。編集内容の反映には再承認が必要です。':current?.is_visible?'従来の公開情報があります。新しい分類は承認後に反映されます。':'新規・非公開の下書きです。';
    dirty=false;pending=null;el('tp-confirm').hidden=true;el('preview-panel').hidden=true;el('tp-diff').hidden=true;buttons();
  }
  function readRows(kind:string) {return [...el(`tp-${kind}`).querySelectorAll<HTMLElement>('[data-editor-row]')].map(box=>{
    const r:Record<string,unknown>={};for(const field of box.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-key]'))r[field.dataset.key!]=field.value.trim();
    if(kind==='statements')r.tags=[...box.querySelectorAll<HTMLInputElement>('[data-tag]:checked')].map(c=>c.value);return r;
  });}
  function read(publish=false) {const p:Record<string,unknown>={};for(const [key,id] of Object.entries(fields))p[key]=input(id).value.trim();p.status_event_ids=[...el('tp-status-events').querySelectorAll<HTMLInputElement>(':checked')].map(e=>e.value);p.reports=readRows('reports');p.statements=readRows('statements');p.event_dates=readRows('dates');if(input('tp-bidding-stage').value)p.bidding={stage:input('tp-bidding-stage').value,event_id:input('tp-bidding-event').value};for(const key of Object.keys(COLOR_STRENGTH_FIELDS))if(input(`tp-${key}`).value)p[key]=input(`tp-${key}`).value;return parseTrackingProfile(p,publish);}
  function renderBiddingEvents(selected:string) {input('tp-bidding-event').innerHTML='<option value="">指定なし</option>'+eventOptions().map(e=>`<option value="${e.id}">${esc(e.label)}</option>`).join('');input('tp-bidding-event').value=selected;}
  async function open(c:RawCase) {
    if(busy||!discard())return false;
    let loaded=false;
    await task(async()=>{const [r,es]=await Promise.all([db.from('tracking_editions').select('*').eq('case_id',c.id).maybeSingle(),readEvents(c.id),loadMedia()]);if(r.error)throw new Error(r.error.message);
      current=c;edition=r.data;events=es;fill(edition?.draft??emptyTrackingProfile(c));message('銘柄の下書きを読み込みました。');loaded=true;});return loaded;
  }
  function reset(){if(busy||!discard())return false;current=null;edition=null;events=[];const p=emptyTrackingProfile();p.report_state='none';p.last_checked_on=jstToday();fill(p);options.onReset();message('記事なしで登録できます。会社を選び、噂の概要を入力してください。');return true;}
  function proposeSlug(){if(current||input('ca-slug').value)return;const co=options.companies().find(c=>c.id===input('ca-company').value);if(!co)return;
    const base=`${co.security_code.toLowerCase()}-tracking-${jstToday().replaceAll('-','')}`;let slug=base,i=2;while(options.cases().some(c=>c.slug===slug))slug=`${base}-${i++}`;input('ca-slug').value=slug;if(!input('ca-title').value)input('ca-title').value=`${co.name_ja}の非公開化をめぐる動き`;}
  function selectCompany(id:string){if(current)return;input('ca-company').value=id;proposeSlug();markDirty();}
  async function refreshEvents(){if(!current)return;const ids=[...el('tp-status-events').querySelectorAll<HTMLInputElement>(':checked')].map(e=>e.value);const es=await readEvents(current.id);events=es;renderStatusEvents(ids);for(const kind of ['reports','statements','dates'])for(const sel of el(`tp-${kind}`).querySelectorAll<HTMLSelectElement>('[data-key="event_id"]')){const selected=sel.value;sel.innerHTML='<option value="">指定なし</option>'+eventOptions().map(e=>`<option value="${e.id}">${esc(e.label)}</option>`).join('');sel.value=selected;}message('入力を保って出来事を更新しました。');}
  el('tp-media-add').addEventListener('click',()=>void task(async()=>{
    const name=input('tp-media-name').value.trim(),aliases=input('tp-media-aliases').value.split('\n').map(x=>x.trim()).filter(Boolean);
    if(!name)throw new Error('媒体名を入力してください');
    const id='media-'+crypto.randomUUID();const r=await db.from('media_outlets').insert({id,name,aliases,is_active:true});if(r.error)throw new Error(r.error.message);
    await loadMedia();for(const sel of el('tp-reports').querySelectorAll<HTMLSelectElement>('[data-key="outlet_id"]')){const value=sel.value;sel.innerHTML='<option value="">指定なし</option>'+media.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');sel.value=value;}
    input('tp-media-name').value='';input('tp-media-aliases').value='';message('媒体辞書へ追加しました。根拠の媒体欄で選択できます。');
  }));
  function diff(p:TrackingProfile){
    const before=edition?.published;
    el('tp-diff-before').innerHTML=before?trackingSummaryHtml(before,media):'<p>新しい分類の公開版はありません。</p>';
    el('tp-diff-after').innerHTML=trackingSummaryHtml(p,media);
    const labels:Record<string,string>={title:'タイトル',summary:'概要',tracking_reason:'追跡理由',tracking_started_on:'追跡開始日',last_checked_on:'確認日',verification_note:'確認状況',short_reason:'一覧の噂',status_note:'状況の補足',public_status:'状況タグ',status_event_ids:'状況の根拠',statements:'会社説明',report_state:'媒体分類',report_note:'媒体の確認範囲',reports:'媒体の根拠',event_dates:'日付精度',bidding:'入札段階と根拠',rumor_strength:'噂の色の強弱',reported_strength:'観測報道の色の強弱',process_strength:'検討・協議の色の強弱'};
    el('tp-diff-fields').textContent='変更項目: '+[...new Set([...Object.keys(p),...Object.keys(before ?? {})])].filter(k=>JSON.stringify(p[k as keyof TrackingProfile])!==JSON.stringify(before?.[k as keyof TrackingProfile])).map(k=>labels[k]).join('、');
    el('tp-diff').hidden=false;
  }
  el('case-form').addEventListener('input',markDirty);
  input('ca-company').addEventListener('change',proposeSlug);
  el('ca-clear').addEventListener('click',reset);
  el('tp-refresh-events').addEventListener('click',()=>void task(async()=>{const selected=input('tp-bidding-event').value;await refreshEvents();renderBiddingEvents(selected);}));
  el('tp-add-report').addEventListener('click',()=>void task(async()=>{await loadMedia();report({outlet_id:'',event_id:'',source_name:'',source_url:'',method:'direct',access:'partial',checked_on:jstToday(),reported_on:'',scope_note:''});input('tp-report-state').value='reported';markDirty();}));
  el('tp-add-statement').addEventListener('click',()=>{statement({event_id:'',subject:'',text:'',tags:[]});markDirty();});
  el('tp-add-date').addEventListener('click',()=>{date({event_id:'',precision:'unknown',value:'',issue_label:''});markDirty();});
  el('ca-save').addEventListener('click',()=>void task(async()=>{
    // busy fields are disabled, so validate the model and identity explicitly.
    const p=read();const company=input('ca-company').value,slug=input('ca-slug').value.trim();
    if(!company||!p.title||!slug)throw new Error('会社・タイトル・URLが必要です');
    const r=await db.rpc('save_tracking_draft',{tracking_id:current?.id??null,target_company_id:company,case_slug:slug,payload:p,expected_revision:edition?.revision??null});if(r.error)throw new Error(r.error.message);
    current={...(current??{}),id:r.data.id,company_id:company,slug,title:current?.title??p.title} as RawCase;
    edition={...(edition??{published:null,publication_version:null,published_at:null}),case_id:r.data.id,draft:p,revision:r.data.revision};dirty=false;input('ca-id').value=current.id;
    await options.afterSave(current.id,false);message('下書きを保存しました。内容をプレビューし、公開を承認してください。');
  }));
  function request(on:boolean){if(busy||dirty||!current)return;try{if(on){const p=read(true);validateProfileReferences(p,current,events,media);diff(p);}pending=on;el('tp-confirm-text').textContent=on?`「${input('ca-title').value}」の保存済み分類・説明・日付を公開版にします。反映には再ビルドが必要です。`:'銘柄を非公開に戻します。メモや記事は削除しません。反映には再ビルドが必要です。';el('tp-confirm').hidden=false;}catch(e){message(String(e));}}
  el('tp-publish').addEventListener('click',()=>request(true));el('tp-unpublish').addEventListener('click',()=>request(false));
  el('tp-confirm-cancel').addEventListener('click',()=>{pending=null;el('tp-confirm').hidden=true;});
  el('tp-confirm-apply').addEventListener('click',()=>{if(pending===null||dirty||!current||!edition)return;const on=pending;pending=null;el('tp-confirm').hidden=true;void task(async()=>{
    const r=await db.rpc('set_tracking_publication',{tracking_id:current!.id,expected_revision:edition!.revision,make_public:on});if(r.error)throw new Error(r.error.message);
    edition!.revision=r.data.revision;edition!.published=on?edition!.draft!:null;edition!.publication_version=r.data.publication_version;current!.is_visible=on;
    if(on){current!.site_published_at ||= new Date().toISOString();el<HTMLInputElement>('ca-slug').readOnly=true;}
    await options.afterSave(current!.id,on);el('tp-edition-state').textContent=on?'公開承認済み・反映待ち':'非公開への反映待ち';message('「公開処理」で再ビルドし、このサイトへの反映を確認してください。');
  });});
  el('ca-preview').addEventListener('click',()=>{try{const p=read();diff(p);const co=options.companies().find(c=>c.id===input('ca-company').value);const dates=new Map(p.event_dates.map(d=>[d.event_id,d]));
    el('preview-body').innerHTML=`<h3>${esc(co?.name_ja??'会社未選択')} — ${esc(p.title)}</h3>${trackingSummaryHtml(p,media)}<p>${esc(p.tracking_reason)}</p><p>${esc(p.verification_note)}</p><h4>確認した根拠</h4><ul>${p.reports.map(r=>`<li>${esc(r.source_name)} ／ ${REPORT_METHOD[r.method]}・${REPORT_ACCESS[r.access]}<p>${esc(r.scope_note)}</p></li>`).join('')}</ul><ol class="timeline">${events.map(e=>({e,date:publicEventDate(e,dates.get(e.id))})).sort((a,b)=>timelineDateKey(a.date).localeCompare(timelineDateKey(b.date))).map(({e,date})=>`<li class="timeline__item"><article class="event-card"><span>${esc(date.label)} ${e.is_visible?'':'（非公開）'}</span><h4>${esc(e.title)}</h4><p>${esc(e.summary)}</p></article></li>`).join('')}</ol>`;
    el('preview-panel').hidden=false;el('preview-panel').scrollIntoView({behavior:'smooth'});
  }catch(e){message(String(e));}});
  el('tp-check').addEventListener('click',()=>void task(async()=>{const r=await fetch(`/data/publication.json?check=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error('公開情報を取得できません');const m=await r.json();if(!Array.isArray(m.cases))throw new Error('公開情報の形式が不正です');const live=m.cases.find((c:{id:string})=>c.id===current?.id);message(edition?.published?(live?.version===edition.publication_version?'公開反映済み（この環境）':'公開待ち／別の公開版が表示中'):(live?'公開ページが残っています':'この環境では非公開です'));}));
  reset();
  return {open,reset,selectCompany,markDirty,discard,proposeSlug};
}
