import {parseDailyPriceBatch} from './dailyPriceBatch.ts';
import type {PriceCase} from './dailyPriceBatch.ts';
import type {Financials} from './valuation.ts';
import {marketMetrics} from './marketMetrics.ts';
import {japanToday,validDay} from './tradingCalendar.ts';
import type {PricePoint} from './types.ts';

const headers:Record<string,string>={
 code:'code',銘柄コード:'code',証券コード:'code',コード:'code',
 price:'price',終値:'price',株価:'price','終値(円)':'price','株価(円)':'price',
 date:'date',基準日:'date',日付:'date',終値日:'date',
 sharebasison:'shareBasisOn',分割基準日:'shareBasisOn',
 caseid:'caseId',案件id:'caseId',
};
function cells(text:string):string[][] {
 if(text.length>500000)throw Error('表は50万文字以内にしてください。');
 const delimiter=text.split(/\r?\n/,1)[0].includes('\t')?'\t':',';
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const addRow=()=>{row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false;};
 const source=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===delimiter){row.push(cell);cell='';closed=false;}
  else if(c==='\n')addRow();
  else if(c==='"'){if(cell.trim()||closed)throw Error('表の引用符を確認してください。CSVの値全体を引用符で囲んでください。');cell='';quoted=true;}
  else if(closed&&c.trim())throw Error('CSVの引用符の後は区切り文字か改行にしてください。');
  else if(!closed)cell+=c;
 }
 if(quoted)throw Error('CSVの引用符が閉じていません。貼り付けた表を確認してください。');
 addRow();return rows;
}
function day(value:string):string {
 const s=value.trim().normalize('NFKC'),m=/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
 return m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:s;
}
function price(value:string):number {
 const s=value.trim().normalize('NFKC').replace(/^[¥￥]\s*/,'').replace(/\s*円$/,'');
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))throw Error('終値は円単位の正数、小数2桁までで入力してください。');
 return Number(s.replaceAll(',',''));
}
export function parseDailyPriceTable(text:string,commonDate:string,cases:PriceCase[],financials:Financials[],today=japanToday()){
 const rows=cells(text);
 if(!rows.length)throw Error('銘柄コードと終値の2列を貼り付けてください。');
 const first=rows[0].map(c=>c.trim().normalize('NFKC').toLowerCase());
 const hasHeader=first.some(c=>headers[c]);
 let keys=['code','price'];
 if(hasHeader){keys=first.map(c=>headers[c]);if(keys.some(k=>!k)||new Set(keys).size!==keys.length||!keys.includes('code')||!keys.includes('price'))throw Error('見出しは「銘柄コード」「終値」と、必要に応じて「基準日」「分割基準日」「案件ID」にしてください。');rows.shift();}
 if(!rows.length||rows.length>300)throw Error('終値の表は1〜300件にしてください。');
 const input=rows.map((values,index)=>{
  const line=index+(hasHeader?2:1);
  try{
   if(values.length!==keys.length)throw Error('列数が一致しません。2列の表、または見出し付きの表にしてください。');
   const r=Object.fromEntries(keys.map((k,i)=>[k,values[i].trim()]));
   const code=r.code.normalize('NFKC').toUpperCase();
   if(!/^[0-9][0-9A-Z]{3}$/.test(code))throw Error('銘柄コードは4桁で入力してください。英字のあるコードも使えます。');
   const matches=cases.filter(c=>c.code===code&&(!r.caseId||c.id===r.caseId));
   if(matches.length!==1)throw Error('銘柄が見つからないか、複数案件があります。コードと案件IDを確認してください。');
   if(matches[0].archived)throw Error('上場廃止・非公開化完了の銘柄です。過去の終値は個別編集で登録してください。');
   const date=day(r.date||commonDate);
   if(!validDay(date)||date>=today)throw Error('基準日は前営業日以前の終値の日付にしてください。');
   const basis=day(r.shareBasisOn||financials.find(f=>f.code===code)?.shareBasisOn||'');
   if(!basis)throw Error('財務の株式分割基準が未確認です。「財務情報・保管データ」で確認してください。');
   if(basis>date)throw Error('分割基準日より前の株価です。分割後の単位へ換算した値は個別編集で登録してください。');
   const expected=financials.find(f=>f.code===code)?.shareBasisOn;
   if(expected&&basis!==expected)throw Error('財務の株式数と分割基準が異なります。株価・株式数の換算を確認してください。');
   return {code,caseId:matches[0].id,date,price:price(r.price),shareBasisOn:basis};
  }catch(e){throw Error(`${line}行目：${(e as Error).message}`);}
 });
 return parseDailyPriceBatch(input,cases,today);
}
export type DailyPriceHistory={caseId:string;point:PricePoint};
export function previewDailyPrices(batch:ReturnType<typeof parseDailyPriceBatch>,cases:PriceCase[],financials:Financials[],history:DailyPriceHistory[],today=japanToday()){
 return batch.map(({row})=>{
  const target=cases.find(c=>c.id===row.case_id);
  if(!target||target.archived)throw Error('更新対象の公開状態が変わりました。管理画面を再読み込みして確認してください。');
  const f=financials.find(f=>f.code===target.code);
  const closes=history.filter(h=>h.caseId===row.case_id).map(h=>h.point).sort((a,b)=>a.priceDate.localeCompare(b.priceDate));
  if(closes.some(p=>p.priceDate===row.price_date))throw Error(`${target.code} ${target.name}の${row.price_date}は登録済みです。個別編集で訂正してください。`);
  if(closes.some(p=>p.priceDate>row.price_date))throw Error(`${target.code}には新しい終値が登録済みです。過去の終値は個別編集で登録してください。`);
  const before=marketMetrics({dailyCloses:closes,preRumorClose:null},f,today);
  const quote={price:row.price,priceDate:row.price_date,sourceName:row.source_name,shareBasisOn:row.share_basis_on??undefined};
  const after=marketMetrics({dailyCloses:[quote],preRumorClose:null},f,today);
  const change=before.close&&before.close.shareBasisOn===quote.shareBasisOn?(quote.price/before.close.price-1)*100:null;
  return {target,row,before,after,change,largeChange:change!==null&&Math.abs(change)>=20};
 });
}
