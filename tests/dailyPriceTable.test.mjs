import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler-rs';
import {experimental_AstroContainer as AstroContainer} from 'astro/container';
import {JSDOM} from 'jsdom';
import {parseDailyPriceTable,previewDailyPrices} from '../src/lib/dailyPriceTable.ts';
import {setupDailyPriceImport} from '../src/lib/dailyPriceImport.ts';
import {marketFinancialIssue} from '../src/lib/marketMetrics.ts';

const id='b0000001-0000-4000-8000-000000000001',id2='b0000001-0000-4000-8000-000000000002',id3='b0000001-0000-4000-8000-000000000003';
const f=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8')).find(r=>r.kind==='financials'&&r.code==='0001');
const financials=[f,{...structuredClone(f),code:'202A',name:'架空会社B'},{...structuredClone(f),code:'3480',name:'架空会社C'}];
const cases=[{id,code:'0001',name:'架空会社A'},{id:id2,code:'202A',name:'架空会社B'},{id:id3,code:'3480',name:'架空会社C',archived:true}];
const today='2026-10-08',date='2026-10-07';
const parse=(text,day=date,targets=cases,records=financials)=>parseDailyPriceTable(text,day,targets,records,today);

test('表：Excelの2列・英字コード・桁区切り・全角・円表示から確認済み基準を引き継ぐ',()=>{
 const rows=parse('０００１\t￥２,１００\r\n202a\t1,234.50円\r\n');
 assert.deepEqual(rows.map(p=>[p.row.case_id,p.row.price,p.row.price_date,p.row.share_basis_on]),[[id,2100,date,'2026-03-31'],[id2,1234.5,date,'2026-03-31']]);
 assert.equal(parse('0001,2100')[0].row.price,2100);
});
test('表：見出しで列順・行ごとの日付・CSVの引用符を処理する',()=>{
 const row=parse('\uFEFF終値,基準日,銘柄コード,分割基準日\n"2,100",2026/10/7,0001,2026/3/31','')[0].row;
 assert.equal(row.price,2100);assert.equal(row.price_date,date);
 assert.equal(parse('終値\t銘柄コード\n2100\t0001')[0].row.case_id,id);
});
test('表：曖昧なコードは案件IDで識別し、重複・不明・廃止銘柄を拒否する',()=>{
 const targets=[cases[0],{...cases[0],id:id2}];
 assert.throws(()=>parse('0001\t2100',date,targets),/複数案件/);
 assert.equal(parse('銘柄コード\t終値\t案件ID\n0001\t2100\t'+id,date,targets)[0].row.case_id,id);
 for(const [text,pattern] of [['0001\t2100\n0001\t2200',/重複/],['9999\t2100',/見つからない/],['3480\t2100',/上場廃止/],['00001\t2100',/4桁/]])assert.throws(()=>parse(text),pattern);
});
test('表：不正な金額・CSV・列数・今日・休場日を保存前に拒否する',()=>{
 for(const text of ['0001\t0','0001\t-1','0001\tNaN','0001\t21,00','0001\t2.123','0001\t1e3','0001\t10000000000','0001\t2100\t余分','code,price\n0001,"2100','code,price\n0001,"2100"x','code,price,price\n0001,2100,2100'])assert.throws(()=>parse(text));
 for(const day of [today,'2026-10-09','2026-10-04','2026-02-30',''])assert.throws(()=>parse('0001\t2100',day));
 assert.throws(()=>parse('0001\t2100\n'.repeat(301)),/1〜300/);
});
test('表：未確認・異なる分割基準・分割前の日付を誤って補わない',()=>{
 assert.throws(()=>parse('0001\t2100',date,cases,[{...f,shareBasisOn:undefined}]),/未確認/);
 assert.throws(()=>parse('コード\t終値\t分割基準日\n0001\t2100\t2026-01-01'),/異なります/);
 assert.throws(()=>parse('0001\t2100','2026-03-30'),/分割基準日より前/);
});
const history=[{caseId:id,point:{price:1500,priceDate:'2026-10-06',shareBasisOn:'2026-03-31',sourceName:null}}];
test('確認表：公開と同じ実績倍率・前回比を計算し、大幅変動と欠損を示す',()=>{
 const rows=previewDailyPrices(parse('0001\t2100\n202A\t2100'),cases,financials,history,today);
 assert.equal(rows[0].after.multiple,14.666666666666666);assert.ok(Math.abs(rows[0].change-40)<1e-10);assert.equal(rows[0].largeChange,true);assert.equal(rows[1].change,null);
 const changed=previewDailyPrices(parse('0001\t2100'),cases,[{...f,ebitdaPeriodMonths:3}],history,today)[0];
 assert.equal(changed.after.multiple,null);assert.match(changed.after.issue,/12か月/);
 const split=previewDailyPrices(parse('0001\t2100'),cases,financials,[{caseId:id,point:{...history[0].point,shareBasisOn:'2025-03-31'}}],today)[0];assert.equal(split.change,null);
 assert.equal(marketFinancialIssue(f),null);assert.match(marketFinancialIssue({...f,shareBasisOn:undefined}),/分割基準/);
});
test('確認表：既存終値・新しい終値・公開状態の変更を上書きしない',()=>{
 for(const priceDate of [date,'2026-10-09'])assert.throws(()=>previewDailyPrices(parse('0001\t2100'),cases,financials,[{caseId:id,point:{...history[0].point,priceDate}}],today),/登録済み/);
 assert.throws(()=>previewDailyPrices(parse('0001\t2100'),[],financials,[],today),/公開状態/);
 assert.throws(()=>previewDailyPrices(parse('0001\t2100'),[{...cases[0],archived:true}],financials,[],today),/公開状態/);
});

const filename=pathToFileURL(path.resolve('src/components/DailyPriceImport.astro')).href;
const compiled=await transform(fs.readFileSync('src/components/DailyPriceImport.astro','utf8'),{filename,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:s=>s});
const code=compiled.code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime')).replace(/^import ".*\?astro&type=style.*";$/gm,'');
const component=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
const html=await(await AstroContainer.create()).renderToString(component);
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
function setup(t){
 const dom=new JSDOM(html,{url:'https://local.invalid/admin/'}),old=Object.getOwnPropertyDescriptor(globalThis,'document');Object.defineProperty(globalThis,'document',{value:dom.window.document,configurable:true});
 t.after(()=>{old?Object.defineProperty(globalThis,'document',old):delete globalThis.document;dom.window.close();});
 const data={valuation_editions:financials.map(p=>({published:structuredClone(p)})),price_snapshots:history.map(h=>({case_id:h.caseId,price:h.point.price,price_date:h.point.priceDate,share_basis_on:h.point.shareBasisOn,source_name:null})),cases:cases.map(c=>({id:c.id,is_visible:true})),tracking_editions:[{case_id:id3,published:{public_status:'delisted',report_state:'none',reports:[]}}]};
 let error=null,reject=false,savedError=false,pause=null;const calls=[];
 const client={from:name=>{let caseId=null,limit=null;const chain={select:()=>chain,eq:(key,value)=>{if(key==='case_id')caseId=value;return chain;},like:()=>chain,in:()=>chain,order:()=>chain,limit:value=>{limit=value;return chain;},then:async(resolve,reject)=>{try{if(pause)await pause;let rows=structuredClone(data[name]);if(caseId)rows=rows.filter(r=>r.case_id===caseId).sort((a,b)=>b.price_date.localeCompare(a.price_date));if(limit)rows=rows.slice(0,limit);return resolve({data:rows,error});}catch(e){return reject(e);}}};return chain;},rpc:async(name,args)=>{calls.push({name,args});return {error:reject?{message:'conflict'}:null};}};
 const el=id=>dom.window.document.getElementById('daily-price-'+id);
 const input=(id,value,event='input')=>{el(id).value=value;el(id).dispatchEvent(new dom.window.Event(event));};
 setupDailyPriceImport(client,()=>cases,async()=>{if(savedError)throw Error('reload');});
 input('date',date);el('basis-checked').checked=true;el('basis-checked').dispatchEvent(new dom.window.Event('change'));
 input('json','0001\t2100');
 return {el,input,calls,data,dom,failRead:()=>{error={message:'network'};},rejectSave:()=>{reject=true;},failReload:()=>{savedError=true;},pause:promise=>{pause=promise;}};
}
test('画面：確認表と未入力一覧を表示し、実績基準を引き継いで一括保存する',async t=>{
 const h=setup(t);h.el('preview').click();await flush();assert.equal(h.el('save').disabled,false);assert.match(h.el('summary').textContent,/14.7倍/);assert.match(h.el('summary').textContent,/20%以上/);assert.match(h.el('targets').textContent,/未入力/);assert.match(h.el('targets').textContent,/上場廃止/);
 assert.deepEqual([...h.el('summary').querySelectorAll('th')].map(c=>c.textContent),['銘柄','終値の基準日','前回 → 今回（円）','変動率','EV/EBITDA','確認事項']);
 h.el('save').click();await flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'add_daily_closes');assert.equal(h.calls[0].args.rows[0].share_basis_on,'2026-03-31');assert.equal(h.el('json').value,'');assert.match(h.el('status').textContent,/1件を保存/);assert.equal(h.el('save').disabled,true);
});
test('画面：チェックなし・財務取得失敗は保存不可で、入力を保持する',async t=>{
 const h=setup(t);h.el('basis-checked').checked=false;h.el('preview').click();await flush();assert.match(h.el('status').textContent,/チェック/);assert.equal(h.el('save').disabled,true);
 h.el('basis-checked').checked=true;h.failRead();h.el('preview').click();await flush();assert.match(h.el('status').textContent,/読み込めません/);assert.equal(h.el('save').disabled,true);assert.match(h.el('json').value,/2100/);
});
test('画面：日付・形式・チェック変更で確認を取り消し、保存直前の無通知変更も拒否する',async t=>{
 const h=setup(t);
 for(const control of ['date','format','basis-checked']){h.el('preview').click();await flush();assert.equal(h.el('save').disabled,false);h.el(control).dispatchEvent(new h.dom.window.Event(control==='date'?'input':'change'));assert.equal(h.el('save').disabled,true);}
 h.el('preview').click();await flush();h.el('json').value='0001\t2200';h.el('save').click();await flush();assert.equal(h.calls.length,0);assert.match(h.el('status').textContent,/入力が変わりました/);
});
test('画面：確認中の入力変更が後から完了した確認結果を有効にしない',async t=>{
 const h=setup(t);let release;h.pause(new Promise(r=>release=r));h.el('preview').click();h.input('json','0001\t2200');release();await flush();assert.equal(h.el('save').disabled,true);assert.equal(h.el('summary').textContent,'');
});
test('画面：保存前に財務変更・既存終値・公開停止・上場廃止を再照合する',async t=>{
 const h=setup(t);
 const changes=[()=>{h.data.valuation_editions[0].published.facts.ebitda.value++;},()=>{h.data.price_snapshots.push({case_id:id,price:2100,price_date:date,share_basis_on:'2026-03-31'});},()=>{h.data.cases[0].is_visible=false;},()=>{h.data.tracking_editions.push({case_id:id,published:{public_status:'privatized',report_state:'none',reports:[]}});}];
 for(const change of changes){const baseline=structuredClone(h.data);h.el('preview').click();await flush();assert.equal(h.el('save').disabled,false);change();h.el('save').click();await flush();assert.equal(h.calls.length,0);assert.equal(h.el('save').disabled,true);assert.match(h.el('json').value,/2100/);Object.assign(h.data,baseline);}
});
test('画面：保存失敗は入力を保持し、再確認前の再送を止める',async t=>{
 const h=setup(t);h.rejectSave();h.el('preview').click();await flush();h.el('save').click();await flush();assert.match(h.el('json').value,/2100/);assert.match(h.el('status').textContent,/保存できません/);assert.equal(h.el('save').disabled,true);
});
test('画面：履歴1000件超でも各銘柄の最新終値を取り、今日の登録があっても前回値を表示する',async t=>{
 const h=setup(t);for(let i=0;i<1100;i++)h.data.price_snapshots.unshift({case_id:id2,price:1000,price_date:'2026-01-05',share_basis_on:'2026-03-31'});
 h.el('preview').click();await flush();assert.match(h.el('summary').textContent,/1,500 → 2,100/);
 h.data.price_snapshots.push({case_id:id,price:2200,price_date:'2026-10-11',share_basis_on:'2026-03-31'});h.el('preview').click();await flush();assert.equal(h.el('save').disabled,true);assert.match(h.el('status').textContent,/新しい終値/);
});
test('画面：保存済みなのに再読込が失敗しても、入力を消して保存完了を伝える',async t=>{
 const h=setup(t);h.failReload();h.el('preview').click();await flush();h.el('save').click();await flush();assert.equal(h.el('json').value,'');assert.match(h.el('status').textContent,/1件を保存しましたが/);assert.match(h.el('status').textContent,/再送せず/);assert.equal(h.calls.length,1);
});
test('画面：従来のJSON形式へ切り替えると任意項目も維持して保存できる',async t=>{
 const h=setup(t);h.input('format','json','change');h.input('json',JSON.stringify([{code:'0001',date,price:2100,note:'控え',sourceName:'一次資料'}]));h.el('preview').click();await flush();assert.equal(h.el('save').disabled,false);h.el('save').click();await flush();assert.equal(h.calls[0].args.rows[0].note,'控え');assert.equal(h.calls[0].args.rows[0].source_name,'一次資料');
});
test('画面：銘柄名はHTMLとして実行しない',async t=>{
 const h=setup(t),old=cases[0].name;cases[0].name='<img src=x onerror=alert(1)>';try{h.el('preview').click();await flush();assert.match(h.el('summary').textContent,/<img/);assert.equal(h.el('summary').querySelector('img'),null);}finally{cases[0].name=old;}
});
