import type {SupabaseClient} from '@supabase/supabase-js';
import {parseDailyPriceBatch} from './dailyPriceBatch.ts';
import type {PriceCase} from './dailyPriceBatch.ts';
import {parseDailyPriceTable,previewDailyPrices} from './dailyPriceTable.ts';
import type {DailyPriceHistory} from './dailyPriceTable.ts';
import {parseValuation} from './valuation.ts';
import type {Financials} from './valuation.ts';
import {marketFinancialIssue,signedPercent} from './marketMetrics.ts';
import {previousTradingDay} from './tradingCalendar.ts';
import {publicTrackingStatus} from './trackingProfile.ts';
export {parseDailyPriceBatch} from './dailyPriceBatch.ts';
export type {PriceCase} from './dailyPriceBatch.ts';

export function setupDailyPriceImport(client:SupabaseClient,cases:()=>PriceCase[],saved:()=>Promise<void>){
 const field=document.getElementById('daily-price-json') as HTMLTextAreaElement,preview=document.getElementById('daily-price-preview') as HTMLButtonElement,save=document.getElementById('daily-price-save') as HTMLButtonElement,summary=document.getElementById('daily-price-summary')!,status=document.getElementById('daily-price-status')!;
 const format=document.getElementById('daily-price-format') as HTMLSelectElement|null,date=document.getElementById('daily-price-date') as HTMLInputElement|null,checked=document.getElementById('daily-price-basis-checked') as HTMLInputElement|null,refresh=document.getElementById('daily-price-refresh') as HTMLButtonElement|null,targets=document.getElementById('daily-price-targets');
 let pending:ReturnType<typeof parseDailyPriceBatch>=[],busy=false,version=0,pendingSignature='',pendingMode='',checkedFinancials='';
 const mode=()=>format?.value??'json';
 const signature=()=>JSON.stringify([field.value,mode(),date?.value,checked?.checked]);
 const invalidate=()=>{version++;pending=[];save.disabled=true;summary.textContent='';status.textContent='';if(targets)targets.textContent='「更新対象を確認」で最新の一覧を読み込みます。';};
 const freeze=(value:boolean)=>{busy=value;for(const control of [field,preview,format,date,checked,refresh])if(control)control.disabled=value;save.disabled=true;};
 const table=(container:HTMLElement,headings:string[],rows:string[][])=>{
  container.replaceChildren();const wrap=document.createElement('div');wrap.className='table-wrap';const t=document.createElement('table');t.className='daily-price-table';
  const head=t.createTHead().insertRow();for(const label of headings){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
  const body=t.createTBody();for(const values of rows){const tr=body.insertRow();for(const value of values)tr.insertCell().textContent=value;}
  wrap.append(t);container.append(wrap);
 };
 const load=async()=>{
  const known=cases();if(!known.length)throw Error('公開銘柄を読み込めませんでした。管理画面を再読み込みしてください。');
  const ids=known.map(c=>c.id);
  const [editions,priceResults,visibility,tracking]=await Promise.all([
   client.from('valuation_editions').select('published').like('id','financials:%'),
   Promise.all(known.map(c=>client.from('price_snapshots').select('case_id,price,price_date,share_basis_on,source_name').eq('price_type','daily_close').eq('case_id',c.id).order('price_date',{ascending:false}).limit(2))),
   client.from('cases').select('id,is_visible').in('id',ids),
   client.from('tracking_editions').select('case_id,published').in('case_id',ids),
  ]);
  if(editions.error||priceResults.some(r=>r.error)||visibility.error||tracking.error)throw Error('財務・終値を読み込めませんでした。ログイン状態を確認し、もう一度試してください。');
  const list=known.filter(c=>visibility.data?.some(v=>v.id===c.id&&v.is_visible)).map(c=>{
   const profile=tracking.data?.find(t=>t.case_id===c.id)?.published;
   return {...c,archived:profile?['delisted','privatized'].includes(publicTrackingStatus(profile)):c.archived};
  });
  const financials:Financials[]=[];
  for(const row of editions.data??[]){if(!row.published)continue;const f=parseValuation(row.published);if(f.kind==='financials')financials.push(f);}
  // Two rows per case keep the previous close available when JSON has registered today's close.
  // A global row limit would lose recent quotes after daily history grows past Supabase's page size.
  const history:DailyPriceHistory[]=priceResults.flatMap(r=>r.data??[]).map(row=>({caseId:row.case_id,point:{price:Number(row.price),priceDate:row.price_date,shareBasisOn:row.share_basis_on??undefined,sourceName:row.source_name}}));
  return {list,financials,history};
 };
 const financialSignature=(financials:Financials[],batch:typeof pending)=>JSON.stringify(batch.map(p=>financials.find(f=>f.code===cases().find(c=>c.id===p.row.case_id)?.code)));
 const inventory=(data:Awaited<ReturnType<typeof load>>,batch:typeof pending=[])=>{
  if(!targets)return;
  const expected=date?.value??'';
  table(targets,['銘柄','最後の終値','財務の確認','今回の入力'],data.list.map(c=>{
   const last=data.history.filter(h=>h.caseId===c.id).sort((a,b)=>a.point.priceDate.localeCompare(b.point.priceDate)).at(-1)?.point;
   return [c.code+' '+c.name,last?last.priceDate+' ／ '+last.price.toLocaleString('ja-JP')+'円':'未登録',marketFinancialIssue(data.financials.find(f=>f.code===c.code))??'算定条件を確認済み',c.archived?'上場廃止・非公開化完了':batch.some(p=>p.row.case_id===c.id)?'入力あり':last?.priceDate===expected?'基準日の終値を登録済み':'未入力'];
  }));
 };
 const updateFormat=()=>{
  invalidate();const isTable=mode()==='table';
  const options=document.getElementById('daily-price-table-options'),help=document.getElementById('daily-price-json-help');if(options)options.hidden=!isTable;if(help)help.hidden=isTable;
  field.placeholder=isTable?'銘柄コード\t終値\n0001\t2,100':'[{"code":"0001","date":"2026-10-07","price":2100,"shareBasisOn":"2026-03-31"}]';
 };
 if(date)date.value=previousTradingDay()??'';
 field.addEventListener('input',invalidate);date?.addEventListener('input',invalidate);checked?.addEventListener('change',invalidate);format?.addEventListener('change',updateFormat);updateFormat();
 refresh?.addEventListener('click',async()=>{if(busy)return;invalidate();freeze(true);try{inventory(await load());status.textContent='公開銘柄の更新状況を読み込みました。';}catch(e){status.textContent=(e as Error).message;}finally{freeze(false);}});
 preview.addEventListener('click',async()=>{
  if(busy)return;invalidate();const current=version,input=signature();
  try{
   if(mode()==='json'){pending=parseDailyPriceBatch(JSON.parse(field.value),cases());summary.textContent=pending.map(p=>p.label).join('\n');}
   else{
    if(!checked?.checked)throw Error('株価と株式数の分割基準を確認し、チェックを入れてください。');
    freeze(true);const data=await load();if(current!==version||input!==signature())return;
    pending=parseDailyPriceTable(field.value,date?.value??'',data.list,data.financials);
    const rows=previewDailyPrices(pending,data.list,data.financials,data.history);
    table(summary,['銘柄','終値の基準日','前回 → 今回（円）','変動率','EV/EBITDA','確認事項'],rows.map(p=>[
     p.target.code+' '+p.target.name,p.row.price_date,(p.before.close?.price.toLocaleString('ja-JP')??'未登録')+' → '+p.row.price.toLocaleString('ja-JP'),p.change===null?'比較できません':signedPercent(p.change),p.after.multiple===null?'算定できません':p.after.multiple.toFixed(1)+'倍',[p.after.issue,p.largeChange?'20%以上の変動です。桁・分割・基準日を確認してください。':null,'分割基準 '+p.row.share_basis_on].filter(Boolean).join(' '),
    ]));inventory(data,pending);checkedFinancials=financialSignature(data.financials,pending);
   }
   pendingSignature=input;pendingMode=mode();status.textContent=pending.length+'件を確認してください。まだ保存していません。';
  }catch(e){pending=[];summary.textContent='';status.textContent=e instanceof SyntaxError?'JSONを読み取れません。括弧・項目名・数値の形式を確認してください。':(e as Error).message;}
  finally{freeze(false);save.disabled=!pending.length;}
 });
 save.addEventListener('click',async()=>{
  if(busy||!pending.length)return;if(signature()!==pendingSignature){invalidate();status.textContent='入力が変わりました。もう一度「入力内容を確認」を押してください。';return;}
  freeze(true);let sent=false;
  try{
   if(pendingMode==='table'){
    const data=await load();previewDailyPrices(pending,data.list,data.financials,data.history);
    if(financialSignature(data.financials,pending)!==checkedFinancials)throw Error('財務データが更新されました。もう一度「入力内容を確認」を押してください。');
   }
   sent=true;const {error}=await client.rpc('add_daily_closes',{rows:pending.map(p=>p.row)});
   if(error){status.textContent='保存できませんでした。既存行との重複・ログイン状態を確認し、一覧を再読み込みしてください。保存結果が不明な場合は再送前に一覧を確認してください。';}
   else{
    const count=pending.length;field.value='';summary.textContent='';pending=[];if(targets)targets.textContent='「更新対象を確認」で保存後の一覧を読み込みます。';
    status.textContent=count+'件を保存しました。「公開処理」でサイトを再ビルドすると反映されます。';
    try{await saved();}catch{status.textContent=count+'件を保存しましたが、一覧を再読み込みできませんでした。再送せず、画面を再読み込みしてください。';}
   }
  }catch(e){status.textContent=sent?'保存結果を確認できません。通信回復後に一覧を再読み込みし、保存済みか確認してください。':(e as Error).message;}
  finally{pending=[];freeze(false);}
 });
}
