import fs from 'node:fs';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import {resolvePublicDataEnvironment} from './buildEnv.ts';
import {parseValuation} from './valuation.ts';
import type {ValuationRecord,Financials,Comparable} from './valuation.ts';
let cache:Promise<{financials:Financials[];comparables:Comparable[]}>|undefined;
export function loadValuations(){return cache??=load();}
async function load(){
  const env={...process.env,DEPLOY_ENV:process.env.DEPLOY_ENV??import.meta.env.DEPLOY_ENV,DATA_SOURCE:process.env.DATA_SOURCE??import.meta.env.DATA_SOURCE,CF_PAGES:process.env.CF_PAGES??import.meta.env.CF_PAGES};
  const {dataSource}=resolvePublicDataEnvironment(env);
  let records:unknown[];
  if(dataSource==='sample')records=JSON.parse(fs.readFileSync(path.resolve('data/sample/valuations.json'),'utf8'));
  else {
    const url=process.env.SUPABASE_URL??import.meta.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY??import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!key)throw Error('財務データの接続設定がありません。');
    const {data,error}=await createClient(url,key,{auth:{persistSession:false}}).rpc('read_published_valuations');
    if(error)throw Error('財務データの取得に失敗しました。DB更新状態を確認してください。');
    if(!Array.isArray(data))throw Error('財務データの応答形式が不正です。');
    records=data.map(row=>row.content);
  }
  const parsed:ValuationRecord[]=records.map(parseValuation);
  return {financials:parsed.filter((r):r is Financials=>r.kind==='financials'),comparables:parsed.filter((r):r is Comparable=>r.kind==='comparable').sort((a,b)=>b.announcedOn.localeCompare(a.announcedOn))};
}
