import type {SupabaseClient} from '@supabase/supabase-js';
import {parseValuation} from './valuation.ts';
import type {ValuationRecord,Comparable} from './valuation';
type Row={id:string;draft:ValuationRecord;published:ValuationRecord|null;revision:number};
export function setupValuationAdmin(client:SupabaseClient){
  const root=document.getElementById('va-editor')!;
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const form=el<HTMLFormElement>('va-form'),list=el<HTMLSelectElement>('va-list'),status=el<HTMLElement>('va-status');
  const control=(name:string)=>form.elements.namedItem(name) as HTMLInputElement;
  let rows:Row[]=[],current:Row|null=null,kind:ValuationRecord['kind']='financials',dirty=false,busy=false;
  const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
  function buttons(){el<HTMLButtonElement>('va-publish').disabled=busy||dirty||!current;el<HTMLButtonElement>('va-unpublish').disabled=busy||dirty||!current?.published;}
  const discard=()=>!dirty||window.confirm('未保存の編集を破棄しますか？');
  function historyRow(h?:Comparable['history'][number]){
    const div=document.createElement('div');div.className='card section';
    for(const [key,label,type] of [['date','日付','date'],['price','価格（円）','number'],['note','経緯・算定根拠','text'],['sourceUrl','出典URL','url']]){const l=document.createElement('label'),i=document.createElement('input');l.textContent=label;i.dataset.h=key;i.type=type;i.value=String(h?.[key as keyof typeof h]??'');if(type==='number'){i.min='0.0001';i.step='any';}l.append(i);div.append(l);}
    const b=document.createElement('button');b.type='button';b.className='btn';b.textContent='この履歴を除く';b.onclick=()=>{div.remove();dirty=true;buttons();};div.append(b);el<HTMLElement>('va-history').append(div);
  }
  function render(record?:ValuationRecord){
    form.reset();kind=record?.kind??kind;
    for(const name of ['code','name','industry','checkedOn','notes','announcedOn','priceStage','offerPrice','sourceUrl','articleUrl'])control(name).value=String(record?.[name as keyof ValuationRecord]??(name==='checkedOn'?today():''));
    root.querySelector<HTMLElement>('[data-va-financials]')!.hidden=kind!=='financials';root.querySelector<HTMLElement>('[data-va-comparable]')!.hidden=kind!=='comparable';
    el<HTMLElement>('va-kind-label').textContent=kind==='financials'?'財務数値':'TOB比較事例';
    for(const fieldset of root.querySelectorAll<HTMLFieldSetElement>('[data-fact],[data-comparable]')){
      const key=fieldset.dataset.fact??fieldset.dataset.comparable!;
      const group=record?.kind==='financials'?record.facts:record?.multiples;
      const v=(group as Record<string,Record<string,unknown>>|undefined)?.[key];
      fieldset.querySelector<HTMLInputElement>('[data-enabled]')!.checked=!!v;
      for(const input of fieldset.querySelectorAll<HTMLInputElement>('[data-v]')){if(v)input.value=String(v[input.dataset.v!]??'');input.disabled=!v;}
    }
    for(const group of root.querySelectorAll<HTMLElement>('[data-va-financials],[data-va-comparable]'))for(const input of group.querySelectorAll<HTMLInputElement>('[name]'))input.disabled=group.hidden;
    el<HTMLElement>('va-history').replaceChildren();if(record?.kind==='comparable')record.history.forEach(historyRow);
    control('code').readOnly=!!current;dirty=false;buttons();
  }
  function read(){
    const p:Record<string,unknown>={kind};for(const name of ['code','name','industry','checkedOn','notes'])p[name]=control(name).value;
    const group:Record<string,unknown>={};for(const f of root.querySelectorAll<HTMLElement>(kind==='financials'?'[data-fact]':'[data-comparable]'))if(f.querySelector<HTMLInputElement>('[data-enabled]')!.checked){const data:Record<string,unknown>={};for(const i of f.querySelectorAll<HTMLInputElement>('[data-v]')){if(i.dataset.v==='value'&&!i.value.trim())throw Error('登録する項目の数値を入力してください。');data[i.dataset.v!]=i.dataset.v==='value'?Number(i.value):i.value;}group[f.dataset.fact??f.dataset.comparable!]=data;}
    p[kind==='financials'?'facts':'multiples']=group;
    if(kind==='comparable'){for(const name of ['announcedOn','priceStage','sourceUrl','articleUrl'])p[name]=control(name).value;p.offerPrice=Number(control('offerPrice').value);p.history=Array.from(el<HTMLElement>('va-history').children).map(div=>Object.fromEntries(Array.from(div.querySelectorAll<HTMLInputElement>('[data-h]')).map(i=>[i.dataset.h!,i.dataset.h==='price'?Number(i.value):i.value])));}
    return parseValuation(p);
  }
  function options(){list.replaceChildren(new Option('新規作成',''));rows.forEach(r=>list.add(new Option(`${r.draft.name}（${r.draft.code}）・${r.draft.kind==='financials'?'財務':'TOB'}・${r.published?'公開対象あり':'下書き'}`,r.id)));list.value=current?.id??'';}
  async function run(fn:()=>Promise<void>){if(busy)return;busy=true;root.inert=true;buttons();try{await fn();}catch{status.textContent='保存・読込に失敗しました。入力内容、管理者ログイン、DB更新状況を確認してください。競合時は内容を控えて再読込してください。';}finally{root.inert=false;busy=false;buttons();}}
  async function reload(){if(!discard())return;await run(async()=>{const {data,error}=await client.from('valuation_editions').select('*').order('updated_at',{ascending:false});if(error)throw error;rows=data??[];current=current?rows.find(r=>r.id===current!.id)??null:null;options();render(current?.draft);status.textContent='一覧を読み込みました。';});}
  form.addEventListener('input',()=>{dirty=true;buttons();});
  form.addEventListener('change',e=>{const target=e.target as HTMLInputElement;if(target.matches('[data-enabled]'))target.closest('fieldset')!.querySelectorAll<HTMLInputElement>('[data-v]').forEach(i=>i.disabled=!target.checked);dirty=true;buttons();});
  for(const type of ['financials','comparable'] as const)el<HTMLButtonElement>(`va-new-${type}`).onclick=()=>{if(busy||!discard())return;current=null;kind=type;render();list.value='';status.textContent='新規データを編集中です。';};
  list.onchange=()=>{if(busy||!discard()){list.value=current?.id??'';return;}current=rows.find(r=>r.id===list.value)??null;render(current?.draft);status.textContent=current?.published?'公開対象の保存版があります。編集は下書きに保存されます。':'下書きです。';};
  el<HTMLButtonElement>('va-reload').onclick=()=>{void reload();};
  el<HTMLButtonElement>('va-add-history').onclick=()=>{if(el<HTMLElement>('va-history').children.length>=50)return;historyRow();dirty=true;buttons();};
  el<HTMLInputElement>('va-import').onchange=async e=>{const input=e.target as HTMLInputElement,file=input.files?.[0];try{if(!file||busy||!discard())return;if(file.size>100000)throw Error();const p=parseValuation(JSON.parse(await file.text()));current=p.kind==='financials'?rows.find(r=>r.id===`financials:${p.code}`)??null:null;kind=p.kind;render(p);list.value=current?.id??'';dirty=true;buttons();status.textContent='取り込みました。出典・対象期・数値を確認し、下書きを保存してください。';}catch{status.textContent='JSONの形式を確認してください。APIキーは取り込めません。';}finally{input.value='';}};
  form.onsubmit=e=>{e.preventDefault();let payload:ValuationRecord;try{payload=read();}catch(error){status.textContent=error instanceof Error?error.message:'入力を確認してください。';return;}void run(async()=>{const id=current?.id??(kind==='financials'?`financials:${payload.code}`:`tob:${crypto.randomUUID()}`);const {data,error}=await client.rpc('save_valuation_draft',{record_id:id,payload,expected_revision:current?.revision??null});if(error)throw error;current=data as Row;rows=[current,...rows.filter(r=>r.id!==id)];options();dirty=false;control('code').readOnly=true;status.textContent='下書きを保存しました。公開対象へ設定する前に出典と数値を確認してください。';});};
  for(const publish of [true,false])el<HTMLButtonElement>(publish?'va-publish':'va-unpublish').onclick=()=>{if(!current||dirty)return;void run(async()=>{const {data,error}=await client.rpc('publish_valuation',{record_id:current!.id,expected_revision:current!.revision,make_public:publish});if(error)throw error;current=data as Row;rows=rows.map(r=>r.id===current!.id?current!:r);options();status.textContent='公開対象の設定を保存しました。「公開処理」で再ビルドすると反映されます。';});};
  window.addEventListener('beforeunload',e=>{if(dirty)e.preventDefault();});
  render();return {reload};
}
