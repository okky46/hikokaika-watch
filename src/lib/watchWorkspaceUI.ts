import { getSupabase } from './supabaseBrowser';
import { createPersonalWatch,emptyRecord,LOCAL_WATCH_KEY } from './personalWatch';
import { parseStructuredNote,type StructuredNotePayload } from './noteMetadataHelpers';
import { changedEntries,readChecked,saveChecked } from './watchReadState';
import type {WorkspaceCase} from './watchWorkspace';

export async function setupWatchWorkspace(){
  const desk=document.querySelector<HTMLElement>('[data-watch-desk]');
  const notebook=document.querySelector<HTMLElement>('[data-notebook]');
  if(!desk&&!notebook)return;
  const db=getSupabase();
  // Access storage lazily: browsers may block even reading the localStorage property.
  const storage={getItem:(k:string)=>localStorage.getItem(k),setItem:(k:string,v:string)=>localStorage.setItem(k,v)};
  const repo=createPersonalWatch(db,storage);
  const cases=JSON.parse(desk?.dataset.workspaceCases??'[]') as WorkspaceCase[];
  const form=notebook?.querySelector<HTMLFormElement>('form');
  const entry=notebook?.querySelector<HTMLDetailsElement>('.note-entry');
  if(entry&&matchMedia('(max-width:950px)').matches&&location.hash!=='#note-section')entry.open=false;
  document.querySelectorAll('a[href="#note-section"]').forEach(link=>link.addEventListener('click',()=>{if(entry)entry.open=true;}));
  window.addEventListener('hashchange',()=>{if(location.hash==='#note-section'&&entry)entry.open=true;});
  const fields=['scenario','freeText','nextCheckDate','targetPrice','exitCondition'] as const;
  const field=(key:typeof fields[number])=>form!.elements.namedItem(key) as HTMLInputElement;
  const noteStatus=notebook?.querySelector<HTMLElement>('[data-notebook-status]');
  const deskStatus=desk?.querySelector<HTMLElement>('[data-desk-status]');
  let filter='all',busy=false,dirty=false;
  function status(message:string){if(noteStatus)noteStatus.textContent=message;if(deskStatus)deskStatus.textContent=message;}
  function controls(){notebook?.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,textarea,button').forEach(el=>el.disabled=busy||!repo.ready);}
  function baseline(id:string){
    const root=notebook?.closest<HTMLElement>('[data-watch-case]');
    if(root&&!readChecked(storage)[id])saveChecked(storage,id,JSON.parse(root.dataset.watchManifest??'{}'));
    document.dispatchEvent(new Event('watch-baseline-saved'));
  }
  const element=(tag:string,text:string,className='')=>{const el=document.createElement(tag);el.textContent=text;el.className=className;return el;};
  function render(){
    document.querySelectorAll<HTMLElement>('[data-personal-scope]').forEach(el=>el.textContent=repo.account?'ログイン中のアカウントに保存します。メモは本人だけが閲覧できます。':'このブラウザーに保存します。公開されません。アカウントの記録はログイン後に表示します。');
    if(notebook){const r=repo.rows[notebook.dataset.notebook!]??emptyRecord();const follow=notebook.querySelector<HTMLButtonElement>('[data-follow]')!;follow.textContent=r.watching?'監視中 · 外す':'監視する';follow.setAttribute('aria-pressed',String(r.watching));}
    if(!desk)return;
    let checked:ReturnType<typeof readChecked>={};try{checked=readChecked(storage);}catch{}
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
    const rows=cases.filter(c=>repo.rows[c.id]?.watching).map(c=>{
      const note=parseStructuredNote(repo.rows[c.id].body).note,previous=checked[c.id];
      return {c,note,previous,changes:previous?changedEntries(c.manifest,previous.entries):[],due:!!note.nextCheckDate&&note.nextCheckDate<=today};
    }).sort((a,b)=>Number(b.changes.length>0)-Number(a.changes.length>0)||Number(b.due)-Number(a.due)||(a.note.nextCheckDate||'9999').localeCompare(b.note.nextCheckDate||'9999'));
    for(const key of ['all','changed','due'])desk.querySelector(`[data-count="${key}"]`)!.textContent=String(rows.filter(r=>key==='all'||(key==='changed'?r.changes.length:r.due)).length);
    const list=desk.querySelector('[data-desk-list]')!;list.replaceChildren();
    for(const {c,note,previous,changes,due} of rows.filter(r=>filter==='all'||(filter==='changed'?r.changes.length:r.due))){
      const card=element('article','','desk-case card');card.dataset.deskCase=c.id;
      const head=element('div','','workspace-heading'),name=element('h3',''),link=document.createElement('a');
      link.href=`/cases/${c.slug}/#watch-review`;link.textContent=`${c.name}（${c.code}）`;name.append(link);head.append(name,element('span',changes.length?`${changes.length}項目に更新`:previous?'確認後の更新なし':'経過を確認する',changes.length?'watch-badge watch-badge--changed':'watch-badge'));card.append(head);
      card.append(element('p',note.scenario||c.reason,'desk-reason'));
      const changeRecords=changes.map(key=>c.records.find(r=>r.key===key)).filter(r=>!!r);
      if(changes.length){
        const ul=element('ul','','desk-changes');
        for(const r of changeRecords.slice(0,3)){const li=element('li',''),a=document.createElement('a');a.href=`/cases/${c.slug}/#${r!.key}`;a.textContent=`${r!.kind}：${r!.title}`;li.append(a);ul.append(li);}
        const removed=changes.filter(k=>!(k in c.manifest)).length;if(removed)ul.append(element('li',`${removed}件の記録が取り下げられました。`));
        if(changes.includes('summary'))ul.append(element('li','追跡理由・現在の状況が更新されています。'));
        card.append(ul);
      }else card.append(element('p',c.status,'small'));
      if(note.freeText)card.append(element('p',`次に見ること：${note.freeText}`,'desk-next'));
      const foot=element('div','','desk-foot');foot.append(element('span',note.nextCheckDate?`自分の確認日：${note.nextCheckDate}${due?' · 確認日になりました':''}`:'自分の確認日：未設定',due?'due-label':'small muted'));
      const action=document.createElement('a');action.href=`/cases/${c.slug}/#${changes.length?'watch-review':'note-section'}`;action.textContent=changes.length?'変化を確認する →':'確認・記録する →';foot.append(action);card.append(foot);
      card.append(element('p',`運営の確認：${c.checkedOn||'日付未登録'} ／ 自分の前回確認：${previous?new Date(previous.at).toLocaleDateString('ja-JP'):'未確認'}`,'small muted'));list.append(card);
    }
    desk.querySelector<HTMLElement>('[data-desk-empty]')!.hidden=rows.length>0;
    if(rows.length&&!list.childElementCount)list.append(element('p',filter==='changed'?'確認後に更新があった銘柄はありません。監視中の銘柄は「監視中」で確認できます。':'確認日になった銘柄はありません。確認日は各銘柄の記録欄で変更できます。','empty-state'));
  }
  async function task(fn:()=>Promise<void>){if(busy||!repo.ready)return;busy=true;controls();status('保存中…');try{await fn();render();}catch(e){status(e instanceof Error?e.message:'保存できません。入力を控えて再読み込みしてください。');}finally{busy=false;controls();}}
  notebook?.querySelector('[data-follow]')?.addEventListener('click',()=>void task(async()=>{
    const id=notebook.dataset.notebook!,watching=!repo.rows[id]?.watching;await repo.follow(id,watching);
    let baselineFailed=false;try{if(watching)baseline(id);}catch{baselineFailed=true;}
    status(baselineFailed?'監視に追加しました。確認状態を保存できないため、ブラウザーの保存設定を確認してください。':watching?'監視に追加しました。次回はホームから続けられます。':'監視から外しました。保存済みのメモは残しています。');
  }));
  form?.addEventListener('input',()=>{dirty=true;});
  form?.addEventListener('submit',event=>{event.preventDefault();void task(async()=>{
    const id=notebook!.dataset.notebook!,note={v:1,...Object.fromEntries(fields.map(k=>[k,field(k).value]))} as StructuredNotePayload;
    await repo.save(id,note);dirty=false;let baselineFailed=false;try{baseline(id);}catch{baselineFailed=true;}
    status(baselineFailed?'記録は保存しました。確認状態は保存できませんでした。ブラウザーの保存設定を確認してください。':'記録を保存しました。監視ホームに次の確認日と気づきが表示されます。');
  });});
  desk?.querySelectorAll<HTMLButtonElement>('[data-desk-filter]').forEach(button=>button.addEventListener('click',()=>{filter=button.dataset.deskFilter!;desk.querySelectorAll('[data-desk-filter]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));render();}));
  document.addEventListener('watch-state-updated',()=>{if(repo.ready)render();});
  window.addEventListener('beforeunload',event=>{if(dirty)event.preventDefault();});
  window.addEventListener('storage',event=>{if(event.key===LOCAL_WATCH_KEY&&!repo.account){if(dirty){status('別のタブで記録が変わりました。入力を控え、再読み込みしてから保存してください。');return;}void init();}else if(repo.ready)render();});
  async function init(){
    controls();try{await repo.load();if(form){const note=parseStructuredNote(repo.rows[notebook!.dataset.notebook!]?.body??'').note;for(const k of fields)field(k).value=note[k];}render();}catch(e){status(e instanceof Error?e.message:'記録を読み込めません。再読み込みしてください。');}finally{controls();}
  }
  await init();
  db?.auth.onAuthStateChange((event,session)=>{if((event==='SIGNED_OUT'||event==='SIGNED_IN')&&(session?.user.id??null)!==repo.identity){
    // Do not leave a previous account's private record visible after an identity change.
    for(const k of fields)if(form)field(k).value='';desk?.querySelector('[data-desk-list]')?.replaceChildren();dirty=false;busy=true;controls();status('ログイン状態が変わりました。再読み込みすると、そのアカウントの記録が表示されます。');
  }});
  if(db&&repo.account){const admin=await db.rpc('is_admin');if(!admin.error&&admin.data)document.querySelectorAll<HTMLElement>('[data-public-record]').forEach(el=>el.hidden=false);}
}
