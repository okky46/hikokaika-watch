import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyArticle, parseArticleContent, parseResearchDraft } from './articles';
import type { ArticleContent, RawArticle } from './articles';

type EditorArticle = RawArticle & {draft: ArticleContent; revision: number};
type Company = {id:string; security_code:string; name_ja:string; is_active:boolean};
const fields = ['title','summary','body','confirmed_facts','interpretation','unknowns','checked_on','correction_note'] as const;

export function setupArticleAdmin(supabase: SupabaseClient) {
  const element = <T extends HTMLElement=HTMLElement>(id:string) => document.getElementById(id) as T;
  const value = (key:string) => element<HTMLInputElement | HTMLTextAreaElement>(`ar-${key}`);
  let rows:EditorArticle[]=[];
  let companies:Company[]=[];
  let links:{article_id:string;company_id:string;edition:string}[]=[];
  let selected:EditorArticle|null=null;
  let dirty=false;
  let busy=false;
  let pendingPublication:boolean|null=null;
  const message=(text:string) => { element('ar-status').textContent=text; };
  function buttons() {
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('#article-form input, #article-form textarea')) field.disabled=busy;
    value('import').disabled=busy;
    for (const id of ['ar-new','ar-reload','ar-save','ar-import-run']) element<HTMLButtonElement>(id).disabled=busy;
    element<HTMLButtonElement>('ar-publish').disabled=busy || !selected || dirty;
    element<HTMLButtonElement>('ar-unpublish').disabled=busy || !selected?.published || dirty;
  }
  function renderCompanies(ids:string[]) {
    const container=element('ar-companies'); container.replaceChildren();
    for (const c of companies) {
      const label=document.createElement('label'); const input=document.createElement('input');
      input.type='checkbox'; input.value=c.id; input.name='article-company'; input.checked=ids.includes(c.id);
      label.append(input, ` ${c.security_code} ${c.name_ja}${c.is_active ? '' : '（非アクティブ・公開では非表示）'}`); container.append(label);
    }
  }
  function fill(row:EditorArticle|null, content=emptyArticle(), ids:string[]=[]) {
    pendingPublication=null; element('ar-confirm').hidden=true;
    selected=row; for (const key of fields) value(key).value=content[key];
    value('slug').value=row?.slug ?? ''; value('slug').readOnly=Boolean(row?.first_published_at);
    value('sources').value=content.sources.map(s=>[s.name,s.url,s.published_on,s.checked_on].join(' | ')).join('\n');
    renderCompanies(ids); dirty=false; element('ar-preview-body').hidden=true; buttons();
  }
  function read() {
    const content:Record<string,unknown>={}; for (const key of fields) content[key]=value(key).value;
    content.sources=value('sources').value.split('\n').filter(s=>s.trim()).map(line=> {
      const parts=line.split('|').map(v=>v.trim()); if(parts.length!==4) throw new Error('出典は1行4項目を | で区切ってください');
      return {name:parts[0],url:parts[1],published_on:parts[2],checked_on:parts[3]};
    });
    return parseArticleContent(content);
  }
  const companyIds=()=>[...document.querySelectorAll<HTMLInputElement>('input[name="article-company"]:checked')].map(c=>c.value);
  const discard=()=>!dirty || confirm('保存していない入力があります。入力内容を破棄しますか？');
  async function task(action:()=>Promise<void>) {
    if(busy) return; busy=true; buttons();
    try { await action(); } catch(e) { message(e instanceof Error ? e.message : String(e)); }
    finally { busy=false; buttons(); }
  }
  function renderList() {
    const container=element('ar-list');container.replaceChildren();
    if(!rows.length) {container.textContent='保存した記事はまだありません。';return;}
    for(const row of rows) {
      const div=document.createElement('div');div.className='card';
      const button=document.createElement('button');button.type='button';button.className='btn';button.textContent=row.draft.title || row.slug;
      button.addEventListener('click',()=>{if(busy || !discard())return;fill(row,row.draft,links.filter(l=>l.article_id===row.id&&l.edition==='draft').map(l=>l.company_id));message('保存済みの下書きを読み込みました。公開版への反映には承認が必要です。');});
      const state=document.createElement('span');state.className='small muted';state.dataset.articleState=row.id;
      state.textContent=row.published ? ' 公開承認済み（反映は未確認）' : ' 下書き・非公開';
      div.append(button,state);container.append(div);
    }
  }
  async function reload() {
    const [a,c,l]=await Promise.all([supabase.from('articles').select('*').order('updated_at',{ascending:false}),supabase.from('companies').select('id,security_code,name_ja,is_active').order('security_code'),supabase.from('article_companies').select('*')]);
    if(a.error||c.error||l.error) {element('ar-list-status').textContent=`記事の読込に失敗しました。0007適用状況と管理者権限を確認してください: ${(a.error||c.error||l.error)?.message}`;return false;}
    rows=a.data as EditorArticle[];companies=c.data as Company[];links=l.data ?? [];renderList();
    element('ar-list-status').textContent=`保存済み ${rows.length}件（下書きを含む）`;
    renderCompanies(companyIds());return true;
  }
  element('article-form').addEventListener('input',()=>{pendingPublication=null;element('ar-confirm').hidden=true;dirty=true;buttons();message('未保存の変更があります。公開承認の前に下書きを保存してください。');});
  element('ar-new').addEventListener('click',()=>{if(discard()){fill(null);message('新規記事です。');}});
  element('ar-reload').addEventListener('click',()=>{if(discard())void task(async()=>{if(await reload()){fill(null);message('一覧を再読込しました。編集する記事を選択してください。');}});});
  element('ar-save').addEventListener('click',()=>void task(async()=>{
    if(!(element('article-form') as HTMLFormElement).reportValidity())return;
    const payload=read();
    const {data,error}=await supabase.rpc('save_article_draft',{article_id:selected?.id??null,article_slug:value('slug').value.trim(),payload,company_ids:companyIds(),expected_revision:selected?.revision??null});
    if(error)throw new Error(error.message);
    // 更新成功後の再読込が失敗しても、新規INSERTを二重送信しない。
    selected={...(selected??{}),id:data.id,revision:data.revision,slug:value('slug').value.trim(),draft:payload} as EditorArticle;
    dirty=false;
    if(await reload()) {const row=rows.find(r=>r.id===data.id)!;fill(row,row.draft,links.filter(l=>l.article_id===row.id&&l.edition==='draft').map(l=>l.company_id));}
    message('下書きを保存しました。公開済みの本文・関連銘柄は変更していません。');
  }));
  async function publish(makePublic:boolean) {
    if(!selected) return;
    if(makePublic && dirty)throw new Error('先に下書きを保存してください');
    if(makePublic)parseArticleContent(selected.draft,true);
    const {data,error}=await supabase.rpc('set_article_publication',{article_id:selected.id,expected_revision:selected.revision,make_public:makePublic});
    if(error)throw new Error(error.message);
    selected.revision=data.revision;
    if(await reload()){const row=rows.find(r=>r.id===data.id)!;fill(row,row.draft,links.filter(l=>l.article_id===row.id&&l.edition==='draft').map(l=>l.company_id));}
    message(makePublic?'公開待ちです。「公開処理」で再ビルド後、反映を確認してください。':'非公開への反映待ちです。「公開処理」で再ビルドしてください。');
  }
  function requestPublication(makePublic:boolean) {
    if(!selected || busy || dirty)return;
    try { if(makePublic)parseArticleContent(selected.draft,true); }
    catch(e){message(e instanceof Error?e.message:String(e));return;}
    pendingPublication=makePublic;
    element('ar-confirm-text').textContent=makePublic ? `「${selected.draft.title}」の保存済み本文・出典・関連銘柄を公開版にします。内容を確認して実行してください。反映には再ビルドが必要です。` : `「${selected.draft.title}」を非公開に戻します。再ビルド完了までは既存ページが残ります。`;
    element('ar-confirm').hidden=false;
  }
  element('ar-publish').addEventListener('click',()=>requestPublication(true));
  element('ar-unpublish').addEventListener('click',()=>requestPublication(false));
  element('ar-confirm-cancel').addEventListener('click',()=>{pendingPublication=null;element('ar-confirm').hidden=true;});
  element('ar-confirm-apply').addEventListener('click',()=>{
    if(pendingPublication===null || dirty)return;
    const next=pendingPublication;pendingPublication=null;element('ar-confirm').hidden=true;
    void task(()=>publish(next));
  });
  element('ar-preview').addEventListener('click',()=>{
    try {const c=read();const panel=element('ar-preview-body');panel.textContent=[c.title,c.summary,'確認できた事実',c.confirmed_facts,c.body,'編集上の解釈',c.interpretation,'未確認事項',c.unknowns,'出典',...c.sources.map(s=>`${s.name} ${s.url}`),'訂正履歴',c.correction_note].join('\n\n');panel.hidden=false;}catch(e){message(String(e));}
  });
  element('ar-import-run').addEventListener('click',()=>{
    try {
      if(!discard())return;const draft=parseResearchDraft(JSON.parse(value('import').value));
      const missing=draft.company_codes.filter(code=>!companies.some(c=>c.security_code===code));if(missing.length)throw new Error(`先に会社を登録してください: ${missing.join(', ')}`);
      if(rows.some(r=>r.slug===draft.slug))throw new Error('同じslugの記事があります。一覧から既存記事を開いてください');
      fill(null,draft.content,companies.filter(c=>draft.company_codes.includes(c.security_code)).map(c=>c.id));value('slug').value=draft.slug;dirty=true;buttons();message('入力欄に取り込みました。内容を確認して下書きを保存してください。');
    }catch(e){message(e instanceof Error?e.message:String(e));}
  });
  element('ar-check').addEventListener('click',()=>void task(async()=>{
    const res=await fetch(`/data/publication.json?check=${Date.now()}`,{cache:'no-store'});if(!res.ok)throw new Error('反映状況を取得できません（新コードの初回デプロイ前は未提供です）');
    const manifest=await res.json();if(!Array.isArray(manifest.articles))throw new Error('公開情報の形式を確認できません');
    for(const row of rows){const live=manifest.articles.find((a:{id:string;version:string})=>a.id===row.id);const state=document.querySelector<HTMLElement>(`[data-article-state="${row.id}"]`);if(state)state.textContent=row.published?(live?.version===row.publication_version?' 公開反映済み（この環境）':' 公開待ち／別の公開版が表示中'):(live?' 非公開への反映待ち':' 下書き・非公開（この環境で確認済み）');}
    element('ar-list-status').textContent=`この環境 ${location.origin} のビルド日時: ${manifest.generatedAt}。本番URLでも確認してください。`;
  }));
  return {reload};
}
