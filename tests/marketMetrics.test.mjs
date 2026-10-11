import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {marketMetrics,parseManualPrice,signedPercent,marketDateLabel} from '../src/lib/marketMetrics.ts';
import {parseDailyPriceBatch} from '../src/lib/dailyPriceImport.ts';
import {previousTradingDay,japanToday} from '../src/lib/tradingCalendar.ts';
import {parseValuation} from '../src/lib/valuation.ts';
const id='b0000001-0000-4000-8000-000000000001';
const financials=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8')).find(v=>v.kind==='financials'&&v.code==='0001');
const quote={price:2100,priceDate:'2026-10-07',sourceName:null,shareBasisOn:'2026-03-31'};
const c={dailyCloses:[quote],preRumorClose:{...quote,price:1500,priceDate:'2026-04-09',rumorOn:'2026-04-10'}};
test('終値の営業日：祝日・年始・JST境界・範囲外を扱う',()=>{
 assert.equal(previousTradingDay('2026-10-13'),'2026-10-09');assert.equal(previousTradingDay('2026-09-24'),'2026-09-18');assert.equal(previousTradingDay('2027-01-04'),'2026-12-30');
 assert.equal(japanToday(new Date('2026-10-07T15:01:00Z')),'2026-10-08');assert.equal(previousTradingDay('2028-02-01'),null);
 assert.equal(marketDateLabel('2026-10-07'),'2026年10月7日');
});
test('公開倍率：同じ財務を試算と共有し、実績・12か月・分割基準を検証',()=>{
 const m=marketMetrics(c,parseValuation(financials),'2026-10-08');
 const f=financials.facts;const expected=(2100*f.shares.value+f.debt.value-f.cash.value+f.adjustments.value)/f.ebitda.value;
 assert.equal(m.multiple,expected);assert.ok(Math.abs(m.premium-40)<1e-10);assert.equal(signedPercent(m.premium),'+40.0%');
 for(const changed of [{...financials,shareBasisOn:'2025-03-31'},{...financials,ebitdaPeriodMonths:3},{...financials,facts:{...f,ebitda:{...f.ebitda,value:0}}},{...financials,facts:{...f,cash:undefined}},{...financials,industry:'銀行業'}])assert.equal(marketMetrics(c,changed,'2026-10-08').multiple,null);
 assert.equal(marketMetrics({...c,dailyCloses:[{...quote,priceDate:'2026-10-08'}]},financials,'2026-10-08').close,null);
});
test('噂直前比：未確認・分割不一致・下落・報道前価格の代用を防ぐ',()=>{
 assert.equal(marketMetrics({...c,preRumorClose:null,preReportClose:c.preRumorClose},financials,'2026-10-08').premium,null);
 assert.equal(marketMetrics({...c,preRumorClose:{...c.preRumorClose,shareBasisOn:'2025-03-31'}},financials,'2026-10-08').premium,null);
 assert.equal(signedPercent(marketMetrics({...c,dailyCloses:[{...quote,price:1200}]},financials,'2026-10-08').premium),'-20.0%');
});
function withForecast(){
 const record=structuredClone(financials);
 record.forecastFacts=structuredClone(record.facts);
 record.forecastFacts.eps.basis='company_forecast';
 record.forecastFacts.ebitda={...record.facts.ebitda,value:3000000000,basis:'company_forecast',period:'2027年3月期',note:'会社予想営業利益20億円＋前期通期償却費10億円の参考値。'};
 // The forecast set may use different, but internally aligned, actual balances.
 record.forecastFacts.cash.value=2000000000;
 return record;
}
test('会社予想倍率：独立した計算一式を使い、実績と予想を同じ終値で算出する',()=>{
 const record=parseValuation(withForecast()),before=structuredClone(record);
 const m=marketMetrics(c,record,'2026-10-08');
 assert.equal(m.multiple,22e9/1.5e9);
 assert.equal(m.forecastMultiple,21e9/3e9);
 assert.equal(m.forecastIssue,null);
 assert.deepEqual(record,before);
 const actualMissing=structuredClone(record);delete actualMissing.facts.cash;
 const independent=marketMetrics(c,actualMissing,'2026-10-08');
 assert.equal(independent.multiple,null);assert.equal(independent.forecastMultiple,7);
});
test('会社予想倍率：欠損・不整合を実績で代用せず、分母とEVの非正数を除外する',()=>{
 const record=withForecast();
 assert.equal(marketMetrics(c,financials,'2026-10-08').forecastMultiple,null);
 assert.match(marketMetrics(c,financials,'2026-10-08').forecastIssue,/会社予想/);
 for(const mutate of [
  r=>delete r.forecastFacts.cash,
  r=>r.forecastFacts.ebitda.value=0,
  r=>r.forecastFacts.ebitda.value=-1,
  r=>r.forecastFacts.ebitda.basis='actual',
  r=>r.forecastFacts.debt.basis='company_forecast',
  r=>r.forecastFacts.shares.period='2025-03-31',
  r=>r.forecastFacts.ebitda.scope='standalone',
  r=>r.forecastFacts.cash.value=23e9,
  r=>r.shareBasisOn='2025-03-31',
  r=>r.ebitdaPeriodMonths=3,
  r=>r.industry='銀行業',
 ]){
  const changed=structuredClone(record);mutate(changed);
  const m=marketMetrics(c,changed,'2026-10-08');assert.equal(m.forecastMultiple,null);assert.ok(m.forecastIssue);
 }
 const mismatch=marketMetrics({...c,dailyCloses:[{...quote,shareBasisOn:null}]},record,'2026-10-08');
 assert.equal(mismatch.multiple,null);assert.equal(mismatch.forecastMultiple,null);
 const noClose=marketMetrics({...c,dailyCloses:[]},record,'2026-10-08');
 assert.equal(noClose.forecastMultiple,null);assert.equal(noClose.forecastIssue,'終値が未登録です。');
});
test('詳細の実描画：実績と会社予想の倍率・対象期・根拠を同時表示する',async()=>{
 const path=await import('node:path'),{pathToFileURL}=await import('node:url');
 const {transform}=await import('@astrojs/compiler-rs');
 const {transform:stripTypes}=await import('esbuild');
 const {experimental_AstroContainer:AstroContainer}=await import('astro/container');
 const {JSDOM}=await import('jsdom');
 const file=path.resolve('src/components/MarketQuote.astro');
 let code=(await transform(fs.readFileSync(file,'utf8'),{filename:pathToFileURL(file).href,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:s=>s})).code;
 code=code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime'));
 for(const match of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]){
  const spec=match[1];if(spec.startsWith('.'))code=code.replaceAll(spec,pathToFileURL(path.resolve(path.dirname(file),spec+'.ts')).href);
 }
 code=(await stripTypes(code,{loader:'ts',format:'esm'})).code;
 const Component=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
 const container=await AstroContainer.create();
 const html=await container.renderToString(Component,{props:{caseData:c,financials:withForecast(),detail:true}});
 const dom=new JSDOM(html),items=[...dom.window.document.querySelectorAll('.market-quote__item')];
 assert.equal(items.length,4);
 assert.match(items[0].textContent,/株価（終値）/);
 assert.match(items[1].textContent,/最初の噂の直前比/);
 assert.equal(items[1].querySelector('strong').classList.contains('market-quote__text'),false);
 assert.match(items[2].textContent,/EV\/EBITDA（実績）14.7倍2026年3月期/);
 assert.match(items[3].textContent,/EV\/EBITDA（会社予想）7.0倍2027年3月期/);
 assert.match(dom.window.document.querySelector('details').textContent,/会社予想営業利益20億円＋前期通期償却費10億円/);
 dom.window.close();
 const missing=await container.renderToString(Component,{props:{caseData:c,financials,detail:true}});
 assert.match(missing,/会社予想の財務数値が未登録です。/);
 const noBase=await container.renderToString(Component,{props:{caseData:{...c,preRumorClose:null},financials,detail:true}});
 const noBaseDoc=new JSDOM(noBase).window.document;
 assert.equal(noBaseDoc.querySelector('.market-quote__text').textContent,'算出待ち');
 noBaseDoc.defaultView.close();
});
test('半手動JSON：銘柄・重複・日付・金額を保存前に検証する',()=>{
 const cases=[{id,code:'0001',name:'架空会社'}];const input={code:'0001',date:'2026-10-07',price:2100,shareBasisOn:'2026-03-31'};
 assert.equal(parseDailyPriceBatch([input],cases,'2026-10-08')[0].row.source_name,null);
 for(const data of [[input,input],[{...input,code:'9999'}],[{...input,price:'2100'}],[{...input,price:0}],[{...input,price:2100.123}],[{...input,date:'2026-10-12'}],[{...input,date:'2026-02-30'}]])assert.throws(()=>parseDailyPriceBatch(data,cases,'2026-10-13'));
 assert.throws(()=>parseDailyPriceBatch([input],[...cases,{...cases[0],id:'20000000-0000-4000-8000-000000000001'}],'2026-10-08'));
 assert.throws(()=>parseManualPrice({case_id:id,price_type:'pre_rumor_close',price:1500,price_date:'2026-04-08',rumor_on:'2026-04-10'},'2026-10-08'));
});
test('DB：管理者限定の一括登録・重複時の全件取消・既存行の保全',async()=>{
 const db=new PGlite();const admin='10000000-0000-4000-8000-000000000001',company='20000000-0000-4000-8000-000000000001';
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.exec(`insert into auth.users values('${admin}');insert into admin_users(user_id) values('${admin}');insert into companies(id,security_code,name_ja) values('${company}','0001','架空会社');insert into cases(id,company_id,title,slug) values('${id}','${company}','架空案件','market-test');`);
 await db.exec('grant select,insert,update,delete on price_snapshots to authenticated');
 const row=parseManualPrice({case_id:id,price_type:'daily_close',price:2100,price_date:'2026-04-09',share_basis_on:'2026-03-31'},'2026-10-08');
 const save=rows=>db.query('select add_daily_closes($1) as n',[JSON.stringify(rows)]);
 await db.exec('set role anon');await assert.rejects(save([row]));await db.exec('reset role;set role authenticated');await assert.rejects(save([row]));await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 assert.equal((await save([row])).rows[0].n,1);await assert.rejects(save([{...row,price_date:'2026-04-10'},row]),/登録済み/);
 const stored=(await db.query('select price,price_date from price_snapshots')).rows;assert.equal(stored.length,1);assert.equal(Number(stored[0].price),2100);
 await assert.rejects(save([{...row,price_date:'2026-04-10',price:0}]));
 await db.query('insert into price_snapshots(case_id,price_type,price,price_date,rumor_on)values($1,$2,$3,$4,$5)',[id,'pre_rumor_close',1500,'2026-04-09','2026-04-10']);
 await assert.rejects(db.query('insert into price_snapshots(case_id,price_type,price,price_date,rumor_on)values($1,$2,$3,$4,$5)',[id,'pre_rumor_close',1800,'2026-04-10','2026-04-13']),/登録済み/);
 const draft=(await db.query('select save_valuation_draft($1,$2,null) as r',['financials:0001',JSON.stringify(financials)])).rows[0].r;
 const published=(await db.query('select publish_valuation($1,$2,true) as r',['financials:0001',draft.revision])).rows[0].r;
 assert.equal(published.published.ebitdaPeriodMonths,12);assert.equal(published.published.shareBasisOn,'2026-03-31');
 for(const changed of [{...financials,ebitdaPeriodMonths:0},{...financials,shareBasisOn:'2026-02-30'}])await assert.rejects(db.query('select save_valuation_draft($1,$2,$3)',['financials:0001',JSON.stringify(changed),published.revision]));
 }finally{await db.close();}
});

test('一括入力画面：確認後の書換えは保存不可、失敗時は入力を保持',async()=>{
 const {JSDOM}=await import('jsdom');const {setupDailyPriceImport}=await import('../src/lib/dailyPriceImport.ts');
 const dom=new JSDOM('<textarea id="daily-price-json"></textarea><button id="daily-price-preview"></button><button id="daily-price-save" disabled></button><pre id="daily-price-summary"></pre><p id="daily-price-status"></p>');
 const old=globalThis.document;globalThis.document=dom.window.document;const doc=dom.window.document;let calls=0;
 try{setupDailyPriceImport({rpc:async()=>{calls++;return {error:{message:'conflict'}};}},()=>[{id,code:'0001',name:'架空会社'}],async()=>{});
 const field=doc.getElementById('daily-price-json'),save=doc.getElementById('daily-price-save'),preview=doc.getElementById('daily-price-preview');
 field.value=JSON.stringify([{code:'0001',date:'2026-04-09',price:2100}]);preview.click();assert.equal(save.disabled,false);field.dispatchEvent(new dom.window.Event('input'));assert.equal(save.disabled,true);save.click();assert.equal(calls,0);
 preview.click();save.click();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.match(field.value,/2100/);assert.equal(save.disabled,true);assert.match(doc.getElementById('daily-price-status').textContent,/保存できません/);
 }finally{globalThis.document=old;dom.window.close();}
});
