/** Shared by the calculator, editorial import and public build. Amounts are yen. */
export const METRICS = {per:'PER', pbr:'PBR', evEbitda:'EV/EBITDA'} as const;
export type Metric = keyof typeof METRICS;
export const FIELDS = {eps:'EPS（円）',bps:'BPS（円）',ebitda:'EBITDA（円）',debt:'有利子負債（円）',cash:'現金・現金同等物（円）',adjustments:'EVその他調整額（円）',shares:'自己株式控除後株式数（株）'} as const;
export type Field = keyof typeof FIELDS;
export type Fact = {value:number; period:string; basis:'actual'|'company_forecast'; scope:'consolidated'|'standalone'; sourceName:string; sourceUrl:string; note:string};
export type Financials = {kind:'financials'; code:string; name:string; industry:string; checkedOn:string; notes:string; facts:Partial<Record<Field,Fact>>};
export type ComparableMultiple = {value:number; basis:'actual'|'company_forecast'; period:string; method:'calculated'|'disclosed'; calculation:string; sourceUrl:string};
export type Comparable = {kind:'comparable'; code:string; name:string; industry:string; checkedOn:string; notes:string; announcedOn:string; priceStage:string; offerPrice:number; sourceUrl:string; articleUrl:string; multiples:Partial<Record<Metric,ComparableMultiple>>; history:{date:string; price:number; note:string; sourceUrl:string}[]};
export type ValuationRecord = Financials | Comparable;
export function safeSource(url:string):boolean {try {const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!Array.from(u.searchParams.keys()).some(k=>/subscription-key|api[_-]?key|access_token/i.test(k));}catch{return false;}}
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
function object(v:unknown):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('データ形式を確認してください。');return v as Record<string,any>;}
function text(v:unknown,max=2000):string {if(typeof v!=='string'||v.length>max)throw Error('文字列の形式・長さを確認してください。');return v.trim();}
function num(v:unknown):number {if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e16)throw Error('数値は有限の数で入力してください。');return v;}
function source(v:unknown):string{const s=text(v);if(!safeSource(s))throw Error('出典は認証情報を含まないHTTPS URLにしてください。');return s;}
function basis(v:unknown):Fact['basis']{if(v!=='actual'&&v!=='company_forecast')throw Error('実績・会社予想を指定してください。');return v;}
export function parseValuation(input:unknown):ValuationRecord {
  const x=object(input);
  const common={code:text(x.code,4),name:text(x.name,200),industry:text(x.industry,100),checkedOn:text(x.checkedOn,10),notes:text(x.notes)};
  if(!/^[0-9][0-9A-Z]{3}$/.test(common.code)||!common.name||!common.industry||!date(common.checkedOn))throw Error('銘柄コード・名称・比較業種・確認日を確認してください。');
  if(x.kind==='financials') {
    const facts:Financials['facts']={};const raw=object(x.facts);
    for(const key of Object.keys(FIELDS) as Field[])if(raw[key]!=null){
      const f=object(raw[key]);const scope=f.scope;if(scope!=='consolidated'&&scope!=='standalone')throw Error('連結・単体を指定してください。');
      const value=num(f.value);if(['debt','cash','shares'].includes(key)&&value<0)throw Error('負債・現金・株式数は負数にできません。');
      const period=text(f.period,100),sourceName=text(f.sourceName,200);if(!period||!sourceName)throw Error('対象期と出典名が必要です。');
      facts[key]={value,period,basis:basis(f.basis),scope,sourceName,sourceUrl:source(f.sourceUrl),note:text(f.note)};
    }
    if(!Object.keys(facts).length)throw Error('財務数値を1つ以上登録してください。');
    return {...common,kind:'financials',facts};
  }
  if(x.kind!=='comparable')throw Error('データ種別が不正です。');
  const multiples:Comparable['multiples']={};const raw=object(x.multiples);
  for(const key of Object.keys(METRICS) as Metric[])if(raw[key]!=null){const f=object(raw[key]);const value=num(f.value),period=text(f.period,100),calculation=text(f.calculation);if(value<=0||value>10000||!period||!calculation||!['calculated','disclosed'].includes(f.method))throw Error('事例倍率は正数とし、対象期・計算根拠を記録してください。');multiples[key]={value,period,calculation,basis:basis(f.basis),method:f.method,sourceUrl:source(f.sourceUrl)};}
  if(!Object.keys(multiples).length)throw Error('事例倍率を1つ以上登録してください。');
  const announcedOn=text(x.announcedOn,10),offerPrice=num(x.offerPrice),priceStage=text(x.priceStage,100),articleUrl=text(x.articleUrl);
  if(!date(announcedOn)||offerPrice<=0||!priceStage||articleUrl&&!(safeSource(articleUrl)||/^\/articles\/[a-z0-9-]+\/$/.test(articleUrl)))throw Error('公表日・価格・段階・記事URLを確認してください。');
  if(!Array.isArray(x.history)||x.history.length>50)throw Error('価格履歴は50件以内です。');
  const history=x.history.map((raw:unknown)=>{const h=object(raw),d=text(h.date,10),price=num(h.price);if(!date(d)||price<=0)throw Error('価格履歴を確認してください。');return {date:d,price,note:text(h.note),sourceUrl:source(h.sourceUrl)};});
  return {...common,kind:'comparable',announcedOn,offerPrice,priceStage,articleUrl,sourceUrl:source(x.sourceUrl),multiples,history};
}
export function prerequisites(f:Financials['facts'],metric:Metric):string|null {
  const needed:Field[]=metric==='per'?['eps']:metric==='pbr'?['bps']:['ebitda','debt','cash','adjustments','shares'];
  if(needed.some(k=>!f[k]))return '計算に必要な財務数値が未登録です。';
  if(f[metric==='per'?'eps':metric==='pbr'?'bps':'ebitda']!.value<=0)return '分母が0以下のため倍率を計算できません。';
  if(metric==='evEbitda'){
    if(f.shares!.value<=0)return '株式数が0以下です。';
    if(new Set(needed.map(k=>f[k]!.scope)).size!==1)return '連結・単体の範囲が一致していません。';
    if(new Set(['debt','cash','adjustments','shares'].map(k=>f[k as Field]!.period)).size!==1)return 'EV計算の残高・株式数の基準日が一致していません。';
  }
  return null;
}
export function multipleFromPrice(f:Financials['facts'],metric:Metric,price:number):number|null {
  if(!Number.isFinite(price)||price<=0||prerequisites(f,metric))return null;
  const n=metric==='per'?price/f.eps!.value:metric==='pbr'?price/f.bps!.value:(price*f.shares!.value+f.debt!.value-f.cash!.value+f.adjustments!.value)/f.ebitda!.value;
  return Number.isFinite(n)&&n>0?n:null;
}
export function priceFromMultiple(f:Financials['facts'],metric:Metric,multiple:number):number|null {
  if(!Number.isFinite(multiple)||multiple<=0||multiple>10000||prerequisites(f,metric))return null;
  const n=metric==='per'?multiple*f.eps!.value:metric==='pbr'?multiple*f.bps!.value:(multiple*f.ebitda!.value-f.debt!.value+f.cash!.value-f.adjustments!.value)/f.shares!.value;
  return Number.isFinite(n)&&n>0?n:null;
}
export const basisLabel=(b:Fact['basis'])=>b==='actual'?'実績':'会社予想';
