import {multipleFromPrice,prerequisites} from './valuation.ts';
import type {Financials} from './valuation.ts';
import type {CaseListItem} from './types.ts';
import {japanToday,previousTradingDay,tradingDay,validDay} from './tradingCalendar.ts';
export function marketMetrics(c:Pick<CaseListItem,'dailyCloses'|'preRumorClose'>,financials?:Financials,today=japanToday()) {
 const cutoff=previousTradingDay(today)??today;
 const close=c.dailyCloses.filter(p=>validDay(p.priceDate)&&p.priceDate<=cutoff&&p.priceDate<today&&tradingDay(p.priceDate)!==false&&Number.isFinite(p.price)&&p.price>0).at(-1)??null;
 const f=financials?.facts;
 let issue=!close?'終値が未登録です。':!f?'財務数値が未登録です。':prerequisites(f,'evEbitda');
 if(!issue&&f&&['ebitda','debt','cash','adjustments','shares'].some(k=>f[k as keyof typeof f]?.basis!=='actual'))issue='実績の財務数値を確認中です。';
 if(!issue&&financials?.ebitdaPeriodMonths!==12)issue='12か月分の実績EBITDAを確認中です。';
 if(!issue&&/銀行|保険|証券|金融/.test(financials?.industry??''))issue='この業種はEV/EBITDAの表示対象外です。';
 if(!issue&&(!close?.shareBasisOn||!financials?.shareBasisOn||close.shareBasisOn!==financials.shareBasisOn))issue='株価と株式数の分割基準を確認中です。';
 const multiple=!issue&&f&&close?multipleFromPrice(f,'evEbitda',close.price):null;
 if(!issue&&multiple===null)issue='EVが0以下のため倍率を表示できません。';
 const base=c.preRumorClose??null;
 let premiumIssue=!close?'終値が未登録です。':!base?'噂直前の基準株価を確認中です。':!base.rumorOn||base.priceDate>=base.rumorOn?'噂の起点と基準株価の日付を確認中です。':close.priceDate<base.rumorOn?'噂の起点より後の終値を確認中です。':!base.shareBasisOn||base.shareBasisOn!==close.shareBasisOn?'株価の分割基準を確認中です。':null;
 if(!premiumIssue&&base&&(!Number.isFinite(base.price)||base.price<=0))premiumIssue='基準株価を確認中です。';
 const premium=!premiumIssue&&close&&base?(close.price/base.price-1)*100:null;
 return {close,multiple,issue,base,premium,premiumIssue};
}
export const signedPercent=(n:number)=>{const rounded=Math.round(n*10)/10;return (rounded>0?'+':'')+rounded.toFixed(1)+'%';};
export function parseManualPrice(raw:Record<string,unknown>,today=japanToday()) {
 const text=(key:string,max=500)=>{const v=raw[key]??'';if(typeof v!=='string'||v.length>max)throw Error('入力項目の形式・長さを確認してください。');return v.trim();};
 const case_id=text('case_id'),price_type=text('price_type'),price_date=text('price_date'),source_name=text('source_name',200),share_basis_on=text('share_basis_on'),rumor_on=text('rumor_on'),note=text('note');
 const price=raw.price;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(case_id)||!['daily_close','pre_rumor_close','pre_report_close','current_close','formal_offer_price'].includes(price_type)||typeof price!=='number'||!Number.isFinite(price)||price<=0||price>9999999999.99||Math.abs(price*100-Math.round(price*100))>0.001)throw Error('案件・種類・0円を超える価格（小数2桁まで）を確認してください。');
 if(!validDay(price_date)||price_date>today||share_basis_on&&(!validDay(share_basis_on)||share_basis_on>today))throw Error('基準日・分割基準日は今日以前の有効な日付にしてください。');
 if(['daily_close','pre_rumor_close'].includes(price_type)&&tradingDay(price_date)===false)throw Error('終値の基準日は現物市場の営業日にしてください。');
 if(price_type==='pre_rumor_close'&&(!validDay(rumor_on)||rumor_on>today||price_date>=rumor_on||previousTradingDay(rumor_on)&&price_date!==previousTradingDay(rumor_on)))throw Error('最初の噂の日と、その直前営業日の終値を指定してください。');
 return {case_id,price_type,price,price_date,source_name:source_name||null,share_basis_on:share_basis_on||null,rumor_on:price_type==='pre_rumor_close'?rumor_on:null,note:note||null};
}

export const marketDateLabel=(day:string)=>{const [y,m,d]=day.split('-').map(Number);return `${y}年${m}月${d}日`;};
