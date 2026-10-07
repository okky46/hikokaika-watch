// JPX現物市場の休業日（2026-10-08確認）。範囲外は営業日を推測しない。
// https://www.jpx.co.jp/corporate/about-jpx/calendar/index.html
const holidays = new Set([
'2026-01-01','2026-01-02','2026-01-03','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29','2026-05-03','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11','2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23','2026-12-31',
'2027-01-01','2027-01-02','2027-01-03','2027-01-11','2027-02-11','2027-02-23','2027-03-21','2027-03-22','2027-04-29','2027-05-03','2027-05-04','2027-05-05','2027-07-19','2027-08-11','2027-09-20','2027-09-23','2027-10-11','2027-11-03','2027-11-23','2027-12-31']);
export const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export const japanToday=(now=new Date())=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
export function tradingDay(day:string):boolean|null {
 if(!validDay(day)||day<'2026-01-01'||day>'2027-12-31')return null;
 return ![0,6].includes(new Date(day).getUTCDay())&&!holidays.has(day);
}
export function previousTradingDay(day=japanToday()):string|null {
 if(!validDay(day))return null;
 const d=new Date(day);
 for(let i=0;i<15;i++){d.setUTCDate(d.getUTCDate()-1);const s=d.toISOString().slice(0,10),open=tradingDay(s);if(open===null)return null;if(open)return s;}
 return null;
}
