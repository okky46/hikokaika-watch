import { articleSourceUrl } from './articleSourceUrl.ts';

export const OBSERVATION_KIND = { origin: '気になった起点', observation: '観察', check: '確認結果', retrospective: '後から分かったこと' } as const;
export const OBSERVATION_OUTCOME = { open: '追跡中', no_change: '新しい情報なし', explained: '別の材料で説明', closed: '追跡を終了', confirmed: 'その後の事実を確認' } as const;
export interface WatchObservation {
  id: string;
  kind: keyof typeof OBSERVATION_KIND;
  title: string;
  occurred_on: string; // Empty means unknown, never substitute recording date.
  date_note: string;
  recorded_at: string;
  updated_at: string;
  observer: string;
  facts: string;
  interpretation: string;
  outcome: keyof typeof OBSERVATION_OUTCOME;
  related_id: string; // Earlier observation/phase in the same case.
  event_id: string; // Optional later disclosure in existing timeline.
  source_name: string;
  source_url: string;
  price: number | null;
  price_on: string;
  volume: number | null;
}
const keys = ['id','kind','title','occurred_on','date_note','recorded_at','updated_at','observer','facts','interpretation','outcome','related_id','event_id','source_name','source_url','price','price_on','volume'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (s:string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !s.startsWith('0000') && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
const instant = (s:string) => /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{3})?Z$/.test(s) && day(s.slice(0,10)) && Number.isFinite(Date.parse(s));
export function parseObservations(input:unknown):WatchObservation[] {
  if(!Array.isArray(input)||input.length>200)throw Error('観察は200件以内で入力してください。');
  const rows=input.map((value):WatchObservation=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('観察の形式を確認してください。');
    const r=value as Record<string,unknown>;
    if(Object.keys(r).some(k=>!keys.includes(k)))throw Error('観察に未対応の項目があります。');
    const out={} as Record<string,unknown>;
    for(const k of keys.filter(k=>!['price','volume'].includes(k))){
      const max=['facts','interpretation'].includes(k)?3000:k==='source_url'?2000:300;
      if(typeof r[k]!=='string'||(r[k] as string).length>max)throw Error('観察の文字数・入力形式を確認してください。');
      out[k]=(r[k] as string).trim();
    }
    const o=out as unknown as WatchObservation;
    if(!uuid.test(o.id)||!Object.hasOwn(OBSERVATION_KIND,o.kind)||!Object.hasOwn(OBSERVATION_OUTCOME,o.outcome)||!o.title||!o.facts||!o.observer)throw Error('観察の見出し・観測した事実・記録者を入力してください。');
    if((o.occurred_on&&!day(o.occurred_on))||(!o.occurred_on&&!o.date_note)||!instant(o.recorded_at)||!instant(o.updated_at)||Date.parse(o.updated_at)<Date.parse(o.recorded_at))throw Error('出来事の日付と記録日時を確認してください。日付が不明なら時期の説明を添えてください。');
    if(o.related_id&&!uuid.test(o.related_id)||o.event_id&&!uuid.test(o.event_id))throw Error('関連する記録を選び直してください。');
    for(const k of ['id','related_id','event_id'] as const)o[k]=o[k].toLowerCase();
    if(o.source_url&&(!articleSourceUrl(o.source_url)||!o.source_name))throw Error('出典の名前とHTTP(S) URLを確認してください。');
    for(const k of ['price','volume'] as const){const n=r[k];if(n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e15||k==='price'&&n===0))throw Error('株価・出来高は有効な数値で入力してください。');o[k]=n as number|null;}
    if(o.price!==null&&(!day(o.price_on)||!o.source_name))throw Error('株価の基準日と出典名を入力してください。');
    if(o.price===null&&o.price_on)throw Error('株価の基準日を入力した場合は株価も必要です。');
    return o;
  });
  const ids=new Set(rows.map(r=>r.id));
  if(ids.size!==rows.length)throw Error('観察IDが重複しています。');
  for(const r of rows){
    if(r.related_id&&(!ids.has(r.related_id)||r.related_id===r.id))throw Error('関連する観察が同じ銘柄にありません。');
    const seen=new Set([r.id]);let ref=r.related_id;
    while(ref){if(seen.has(ref))throw Error('観察の関連付けが循環しています。');seen.add(ref);ref=rows.find(x=>x.id===ref)?.related_id??'';}
  }
  return rows;
}
export function newObservation(now=new Date().toISOString()):WatchObservation {
  return {id:crypto.randomUUID(),kind:'observation',title:'',occurred_on:'',date_note:'',recorded_at:now,updated_at:now,observer:'運営者',facts:'',interpretation:'',outcome:'open',related_id:'',event_id:'',source_name:'',source_url:'',price:null,price_on:'',volume:null};
}
export function mergeObservationImport(current:WatchObservation[],input:unknown):WatchObservation[]{
  if(!Array.isArray(input)||input.length>200)throw Error('観察の配列を200件以内で入力してください。');
  const merged=new Map(current.map(o=>[o.id,o]));const importedIds=new Set<string>();
  for(const value of input){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('観察の形式を確認してください。');
    const row=value as Partial<WatchObservation>;
    const id=typeof row.id==='string'?row.id.toLowerCase():crypto.randomUUID();
    if(importedIds.has(id))throw Error('取り込む観察IDが重複しています。');
    importedIds.add(id);
    merged.set(id,{...(merged.get(id)??newObservation()),...row,id} as WatchObservation);
  }
  return parseObservations([...merged.values()]);
}
export function latestCheck(rows:WatchObservation[]){return rows.filter(r=>r.kind==='check').sort((a,b)=>b.occurred_on.localeCompare(a.occurred_on)||Date.parse(b.recorded_at)-Date.parse(a.recorded_at))[0]??null;}
