/** Shared by the calculator, editorial import and public build. Amounts are yen. */
export const METRICS = {per:'PER', pbr:'PBR', evEbitda:'EV/EBITDA'} as const;
export type Metric = keyof typeof METRICS;
export const FIELDS = {eps:'EPS（円）',bps:'BPS（円）',ebitda:'EBITDA（円）',debt:'有利子負債（円）',cash:'EV控除用の現金等（円）',adjustments:'EVその他調整額（円）',shares:'自己株式控除後株式数（株）'} as const;
export type Field = keyof typeof FIELDS;
export type Fact = {value:number; period:string; basis:'actual'|'company_forecast'; scope:'consolidated'|'standalone'; sourceName:string; sourceUrl:string; note:string};
export type Financials = {kind:'financials'; code:string; name:string; industry:string; checkedOn:string; notes:string; facts:Partial<Record<Field,Fact>>; forecastFacts?:Partial<Record<Field,Fact>>};
export type ComparableMultiple = {value:number; basis:'actual'|'company_forecast'; period:string; method:'calculated'|'disclosed'; calculation:string; sourceUrl:string};
export type ValuationInput = {name:string; unit:string; period:string; low:number; high:number; basis:'actual'|'company_forecast'|'valuation_assumption'|'unknown'; definition:string};
export type AdvisorValuation = {advisor:string; role:string; date:string; method:'market'|'trading_comparables'|'dcf'|'other'; low:number; high:number; sourceUrl:string; page:string; inputs:ValuationInput[]; peers:string[]; notes:string; unit?:'円/株'|'円/口'; methodName?:string};
export type ComparableResearch = {dealId:string; buyer:string; transactionType:'mbo'|'parent_subsidiary'|'third_party'|'other'; status:'announced'|'completed'|'failed'|'withdrawn'|'unverified'; priceBasis:'initial'|'revised'|'final'; scope:'consolidated'|'standalone'|'unknown'; statisticsEligible:boolean; definitions:Partial<Record<Metric,string>>; denominators:Financials['facts']; valuations:AdvisorValuation[]; sourceReview?:{packageId:string;sha256:string;caseData:Record<string,unknown>}};
export type Comparable = {priceUnit?:'円/株'|'円/口';kind:'comparable'; code:string; name:string; industry:string; checkedOn:string; notes:string; announcedOn:string; priceStage:string; offerPrice:number; sourceUrl:string; articleUrl:string; multiples:Partial<Record<Metric,ComparableMultiple>>; history:{date:string; price:number; note:string; sourceUrl:string}[]; research?:ComparableResearch};
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
    if(Object.keys(raw).some(k=>!(k in FIELDS)))throw Error('未知の財務項目です。');
    for(const key of Object.keys(FIELDS) as Field[])if(raw[key]!=null){
      const f=object(raw[key]);const scope=f.scope;if(scope!=='consolidated'&&scope!=='standalone')throw Error('連結・単体を指定してください。');
      const value=num(f.value);if(['debt','cash','shares'].includes(key)&&value<0)throw Error('負債・現金・株式数は負数にできません。');
      const period=text(f.period,100),sourceName=text(f.sourceName,200);if(!period||!sourceName)throw Error('対象期と出典名が必要です。');
      facts[key]={value,period,basis:basis(f.basis),scope,sourceName,sourceUrl:source(f.sourceUrl),note:text(f.note)};
    }
    if(!Object.keys(facts).length)throw Error('財務数値を1つ以上登録してください。');
    let forecastFacts:Financials['forecastFacts'];
    if(x.forecastFacts!==undefined){
      forecastFacts=(parseValuation({...common,kind:'financials',facts:x.forecastFacts}) as Financials).facts;
      if(!forecastFacts.eps&&!forecastFacts.ebitda)throw Error('会社予想EPSまたは予想EBITDAが必要です。');
      for(const [key,f] of Object.entries(forecastFacts))if(f.basis!==(['eps','ebitda'].includes(key)?'company_forecast':'actual'))throw Error('予想の利益と実績の残高を区別してください。');
    }
    return {...common,kind:'financials',facts,...(forecastFacts?{forecastFacts}:{})};
  }
  if(x.kind!=='comparable')throw Error('データ種別が不正です。');
  if(x.forecastFacts!==undefined)throw Error('予想計算の財務数値は銘柄の財務情報へ登録してください。');
  const research=x.research==null?undefined:parseResearch(x.research,common);
  const priceUnit=x.priceUnit;if(priceUnit!==undefined&&!['円/株','円/口'].includes(priceUnit))throw Error('価格単位を確認してください。');
  const multiples:Comparable['multiples']={};const raw=object(x.multiples);
  if(Object.keys(raw).some(k=>!(k in METRICS)))throw Error('未知の倍率項目です。');
  for(const key of Object.keys(METRICS) as Metric[])if(raw[key]!=null){const f=object(raw[key]);const value=num(f.value),period=text(f.period,100),calculation=text(f.calculation);if(value<=0||value>10000||!period||!calculation||!['calculated','disclosed'].includes(f.method))throw Error('事例倍率は正数とし、対象期・計算根拠を記録してください。');multiples[key]={value,period,calculation,basis:basis(f.basis),method:f.method,sourceUrl:source(f.sourceUrl)};}
  if(!Object.keys(multiples).length&&!research?.valuations.length)throw Error('取引倍率または第三者機関の算定を1つ以上登録してください。');
  const announcedOn=text(x.announcedOn,10),offerPrice=num(x.offerPrice),priceStage=text(x.priceStage,100),articleUrl=text(x.articleUrl);
  if(!date(announcedOn)||offerPrice<=0||!priceStage||articleUrl&&!(safeSource(articleUrl)||/^\/articles\/[a-z0-9-]+\/$/.test(articleUrl)))throw Error('公表日・価格・段階・記事URLを確認してください。');
  if(!Array.isArray(x.history)||x.history.length>50)throw Error('価格履歴は50件以内です。');
  const history=x.history.map((raw:unknown)=>{const h=object(raw),d=text(h.date,10),price=num(h.price);if(!date(d)||price<=0)throw Error('価格履歴を確認してください。');return {date:d,price,note:text(h.note),sourceUrl:source(h.sourceUrl)};});
  if(research?.statisticsEligible){
    if(!Object.keys(multiples).length)throw Error('集計対象には取引倍率が必要です。');
    for(const [key,m] of Object.entries(multiples) as [Metric,ComparableMultiple][]){
      if(!research.definitions[key])throw Error('集計する倍率の定義を記録してください。');
      if(m.method==='calculated'){
        const denominator=research.denominators[key==='per'?'eps':key==='pbr'?'bps':'ebitda'];
        const calculated=multipleFromPrice(research.denominators,key,offerPrice);
        if(!denominator||denominator.basis!==m.basis||denominator.period!==m.period||denominator.scope!==research.scope||calculated===null||Math.abs(calculated-m.value)>Math.max(0.0001,m.value*0.0001))throw Error('倍率と採用財務数値・対象期・範囲が一致しません。');
      }
    }
  }
  return {...common,kind:'comparable',...(priceUnit?{priceUnit}:{}),announcedOn,offerPrice,priceStage,articleUrl,sourceUrl:source(x.sourceUrl),multiples,history,...(research?{research}:{})};
}
function parseResearch(input:unknown,common:{code:string;name:string;industry:string;checkedOn:string;notes:string}):ComparableResearch{
  const r=object(input);
  if(typeof r.dealId!=='string'||!new RegExp(`^${common.code}-[a-z0-9-]{1,60}$`,'i').test(r.dealId))throw Error('案件IDは銘柄コードで始まる英数字・ハイフンにしてください。');
  const buyer=text(r.buyer,200);if(!buyer||!['mbo','parent_subsidiary','third_party','other'].includes(r.transactionType)||!['announced','completed','failed','withdrawn','unverified'].includes(r.status)||!['initial','revised','final'].includes(r.priceBasis)||!['consolidated','standalone','unknown'].includes(r.scope)||typeof r.statisticsEligible!=='boolean')throw Error('取引区分・結果・価格段階・範囲・集計対象を確認してください。');
  if(r.scope==='unknown'&&r.statisticsEligible)throw Error('範囲が未確認の案件は集計対象にできません。');
  let sourceReview:ComparableResearch['sourceReview'];
  if(r.sourceReview!==undefined){const raw=object(r.sourceReview),caseData=object(raw.caseData);if(typeof raw.packageId!=='string'||!/^[-a-z0-9.]{1,100}$/.test(raw.packageId)||typeof raw.sha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.sha256)||caseData.security_code!==common.code||caseData.statisticsEligible!==false||new TextEncoder().encode(JSON.stringify(caseData)).length>200000)throw Error('原調査記録の形式・銘柄・サイズを確認してください。');sourceReview={packageId:raw.packageId,sha256:raw.sha256,caseData:structuredClone(caseData)};}
  const definitions:ComparableResearch['definitions']={};
  for(const [k,v] of Object.entries(object(r.definitions))){if(!(k in METRICS))throw Error('未知の倍率定義です。');definitions[k as Metric]=text(v,300);}
  const d=object(r.denominators);
  const denominators=Object.keys(d).length?(parseValuation({...common,kind:'financials',facts:d}) as Financials).facts:{};
  if(!Array.isArray(r.valuations)||r.valuations.length>60)throw Error('算定は60件以内です。');
  const valuations=r.valuations.map((raw:unknown)=>{
    const v=object(raw);const advisor=text(v.advisor,200),role=text(v.role,100),day=text(v.date,10),low=num(v.low),high=num(v.high),page=text(v.page,100);
    if(!advisor||!role||(day!==''&&!date(day))||!['market','trading_comparables','dcf','other'].includes(v.method)||low<0||high<low||!page)throw Error('算定主体・日付・手法・価格レンジ・掲載ページを確認してください。');
    if(!Array.isArray(v.inputs)||v.inputs.length>120)throw Error('算定の入力数値は120件以内です。');
    if(!Array.isArray(v.peers)||v.peers.length>60)throw Error('比較会社は60件以内です。');
    const inputs=v.inputs.map((raw:unknown)=>{const i=object(raw),name=text(i.name,200),unit=text(i.unit,50),period=text(i.period,100),definition=text(i.definition),low=num(i.low),high=num(i.high);if(!name||!unit||!period||!definition||high<low||!['actual','company_forecast','valuation_assumption','unknown'].includes(i.basis))throw Error('算定の入力値・単位・対象期・定義を確認してください。');return {name,unit,period,definition,low,high,basis:i.basis} as ValuationInput;});
    const peers=v.peers.map((p:unknown)=>text(p,200));
    const unit=v.unit;if(unit!==undefined&&!['円/株','円/口'].includes(unit))throw Error('算定の単位を確認してください。');const methodName=v.methodName===undefined?undefined:text(v.methodName,100);
    return {advisor,role,date:day,...(unit?{unit}:{}),...(methodName?{methodName}:{}),method:v.method,low,high,page,inputs,peers,sourceUrl:source(v.sourceUrl),notes:text(v.notes)} as AdvisorValuation;
  });
  return {...(sourceReview?{sourceReview}:{}),dealId:r.dealId.toLowerCase(),buyer,transactionType:r.transactionType,status:r.status,priceBasis:r.priceBasis,scope:r.scope,statisticsEligible:r.statisticsEligible,definitions,denominators,valuations};
}
export const valuationMethodLabel={market:'市場株価法',trading_comparables:'類似会社比較法',dcf:'DCF法',other:'その他'};
export const transactionLabel={mbo:'MBO',parent_subsidiary:'親子上場解消',third_party:'第三者による買収',other:'その他'};
export const outcomeLabel={announced:'発表・実施段階',completed:'成立・完了',failed:'不成立',withdrawn:'撤回',unverified:'結果未照合'};
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
/** Each set is complete in itself: never borrow missing forecast inputs from old actual balances. */
export function valuationFactSets(financials?:Financials){
  if(!financials)return [];
  const registered={key:'registered',label:Object.values(financials.facts).some(f=>f.basis==='company_forecast')?'登録済みの財務':'実績',facts:financials.facts};
  return financials.forecastFacts?[{key:'forecast',label:'会社予想',facts:financials.forecastFacts},registered]:[registered];
}
