import type {SupabaseClient} from '@supabase/supabase-js';
import {parseManualPrice} from './marketMetrics.ts';
export type PriceCase={id:string;code:string;name:string};
export function parseDailyPriceBatch(input:unknown,cases:PriceCase[],today?:string){
 if(!Array.isArray(input)||input.length<1||input.length>300)throw Error('JSONは1〜300件の配列にしてください。');
 const seen=new Set<string>();
 return input.map(r=>{
  if(!r||typeof r!=='object'||Object.keys(r).some(k=>!['code','caseId','date','price','shareBasisOn','sourceName','note'].includes(k)))throw Error('JSONの項目名を確認してください。');
  const matches=cases.filter(c=>c.code===r.code&&(!r.caseId||c.id===r.caseId));
  if(matches.length!==1)throw Error('銘柄が見つからないか、複数案件があります。証券コードとcaseIdを確認してください。');
  const c=matches[0],row=parseManualPrice({case_id:c.id,price_type:'daily_close',price:r.price,price_date:r.date,share_basis_on:r.shareBasisOn,source_name:r.sourceName,note:r.note},today);
  const key=c.id+row.price_date;if(seen.has(key))throw Error('同じ銘柄・日付が入力内で重複しています。');seen.add(key);
  return {row,label:c.code+' '+c.name+' ／ '+row.price_date+' ／ '+row.price.toLocaleString('ja-JP')+'円 ／ 分割基準 '+(row.share_basis_on??'未確認')};
 });
}
export function setupDailyPriceImport(client:SupabaseClient,cases:()=>PriceCase[],saved:()=>Promise<void>){
 const field=document.getElementById('daily-price-json') as HTMLTextAreaElement,preview=document.getElementById('daily-price-preview') as HTMLButtonElement,save=document.getElementById('daily-price-save') as HTMLButtonElement,summary=document.getElementById('daily-price-summary')!,status=document.getElementById('daily-price-status')!;
 let pending:ReturnType<typeof parseDailyPriceBatch>=[],busy=false;
 field.addEventListener('input',()=>{pending=[];save.disabled=true;summary.textContent='';status.textContent='';});
 preview.addEventListener('click',()=>{if(busy)return;pending=[];save.disabled=true;try{pending=parseDailyPriceBatch(JSON.parse(field.value),cases());summary.textContent=pending.map(p=>p.label).join('\n');save.disabled=false;status.textContent=pending.length+'件を確認してください。まだ保存していません。';}catch(e){summary.textContent='';status.textContent=e instanceof SyntaxError?'JSONを読み取れません。括弧・項目名・数値の形式を確認してください。':(e as Error).message;}});
 save.addEventListener('click',async()=>{if(busy||!pending.length)return;busy=true;save.disabled=true;preview.disabled=true;field.disabled=true;try{const {error}=await client.rpc('add_daily_closes',{rows:pending.map(p=>p.row)});if(error){status.textContent='保存できませんでした。既存行との重複・ログイン状態を確認し、一覧を再読み込みしてください。保存結果が不明な場合は再送前に一覧を確認してください。';}else{status.textContent=pending.length+'件を保存しました。「公開処理」でサイトを再ビルドすると反映されます。';field.value='';summary.textContent='';await saved();}}catch{status.textContent='保存結果を確認できません。通信回復後に一覧を再読み込みし、保存済みか確認してください。';}finally{pending=[];busy=false;preview.disabled=false;field.disabled=false;}});
}
