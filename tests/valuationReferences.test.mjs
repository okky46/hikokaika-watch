import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler';
import {experimental_AstroContainer as AstroContainer} from 'astro/container';
import {build,transform as stripTypes} from 'esbuild';
import {JSDOM} from 'jsdom';
import {comparableStats} from '../src/lib/comparableStats.ts';
import {matchingReferences,referenceScenarios,referencePeriod} from '../src/lib/valuationReference.ts';
import {priceFromMultiple,parseValuation} from '../src/lib/valuation.ts';
const records=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8')).map(parseValuation);
const financials=records[0],comparables=records.slice(1);

test('平均倍率の±10%を各指標の株価へ換算し、EVの負債等を控除する',()=>{
 assert.deepEqual(referenceScenarios(financials.facts,'per',20),[{multiple:18,price:1800},{multiple:20,price:2000},{multiple:22,price:2200}]);
 assert.deepEqual(referenceScenarios(financials.facts,'pbr',2).map(s=>s.price),[1800,2000,2200]);
 assert.deepEqual(referenceScenarios(financials.facts,'evEbitda',10).map(s=>s.price),[1250,1400,1550]);
 const missing=structuredClone(financials.facts);delete missing.cash;
 assert.ok(referenceScenarios(missing,'evEbitda',10).every(s=>s.price===null));
 assert.equal(referenceScenarios(financials.facts,'evEbitda',0.01)[1].price,null);
});
test('参考株価は対象銘柄と実績予想・連結範囲が一致する集計から求める',()=>{
 const [group]=comparableStats(comparables,financials.industry);
 const wrongScope={...group,scope:'standalone'},wrongBasis={...group,basis:'company_forecast'};
 assert.deepEqual(matchingReferences([group,wrongScope,wrongBasis],group.metric,financials.facts),[group]);
 assert.deepEqual(matchingReferences([group],'pbr',financials.facts),[]);
});
test('対象年月は集計に採用したTOB公表月の範囲を示す',()=>{
 const group={samples:[{announcedOn:'2024-04-05'},{announcedOn:'2023-11-08'}]};
 assert.equal(referencePeriod(group),'2023年11月〜2024年4月');
 assert.equal(referencePeriod({samples:[{announcedOn:'2023-11-08'}]}),'2023年11月');
});

const compiled=new Map();
async function component(name){
 if(compiled.has(name))return compiled.get(name);
 const file=path.resolve('src/components',name+'.astro');
 let code=(await transform(fs.readFileSync(file,'utf8'),{filename:pathToFileURL(file).href,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:async s=>s})).code;
 code=code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime')).replace(/^import ".*\?astro&type=style.*";$/gm,'');
 for(const match of [...code.matchAll(/from ['"]([^'"]+)['"]/g)]){
  const spec=match[1];if(!spec.startsWith('.'))continue;
  const replace=(value)=>{code=code.replaceAll("'"+spec+"'","'"+value+"'").replaceAll('"'+spec+'"','"'+value+'"');};
  if(spec.endsWith('.astro'))replace(await component(path.basename(spec,'.astro')));
  else {let target=path.resolve(path.dirname(file),spec);if(!fs.existsSync(target))target+='.ts';replace(pathToFileURL(target).href);}
 }
 code=(await stripTypes(code,{loader:'ts',format:'esm'})).code;
 const url=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;compiled.set(name,url);return url;
}
const Calculator=(await import(await component('ValuationCalculator'))).default;
const script=fs.readFileSync('src/components/ValuationCalculator.astro','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const client=(await build({stdin:{contents:script,loader:'ts',resolveDir:path.resolve('src/components')},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
test('画面：会社予想を初期表示し、実績切替で倍率・出典・同業参考を一緒に更新する',async()=>{
 const record=structuredClone(financials);record.forecastFacts=structuredClone(record.facts);
 record.forecastFacts.eps={...record.facts.eps,value:200,basis:'company_forecast',period:'2027年3月期'};
 record.forecastFacts.ebitda={...record.facts.ebitda,value:3000000000,basis:'company_forecast',period:'2027年3月期'};
 record.forecastFacts.cash={...record.facts.cash,value:2000000000};
 const html=await (await AstroContainer.create()).renderToString(Calculator,{props:{financials:record,comparables}});
 const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(client);const d=dom.window.document;
 const price=d.querySelector('[data-price]'),multiple=d.querySelector('[data-multiple]'),selector=d.querySelector('[data-financial-basis]');
 assert.equal(selector.value,'forecast');assert.equal(price.value,'');assert.equal(multiple.value,'');
 price.value='1400';price.dispatchEvent(new dom.window.Event('input'));
 assert.equal(d.querySelector('[data-result="per"]').textContent,'7倍');assert.match(d.querySelector('[data-result="evEbitda"]').textContent,/4.67倍/);
 assert.match(d.querySelector('[data-result-basis="per"]').textContent,/会社予想・2027年3月期/);
 assert.equal(d.querySelector('.reference-section').closest('[data-financial-view]').hidden,false);
 assert.match(d.querySelector('.reference-section [data-reference-metric="per"]').textContent,/参考値なし/);
 multiple.value='12.3';multiple.dispatchEvent(new dom.window.Event('input'));selector.value='registered';selector.dispatchEvent(new dom.window.Event('change'));
 assert.equal(price.value,'1400');assert.equal(multiple.value,'12.3');assert.equal(d.querySelector('[data-result="per"]').textContent,'14倍');
 for(const view of d.querySelectorAll('[data-financial-view]'))assert.equal(view.hidden,view.dataset.financialView==='forecast');
 d.querySelector('[data-reset]').click();assert.equal(price.value,'');assert.equal(multiple.value,'');
 assert.deepEqual(record.facts,financials.facts);dom.window.close();
});

test('画面：参考3指標の平均・中央値・期間・レンジを表示し、自由入力は変更しない',async()=>{
 const html=await (await AstroContainer.create()).renderToString(Calculator,{props:{financials,comparables}});
 const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(client);const document=dom.window.document;
 assert.equal(document.querySelector('[data-multiple]').value,'');
 assert.equal(document.querySelector('[data-dcf]'),null);
 assert.doesNotMatch(html,/DCFで株価を試算する/);
 assert.equal(document.querySelectorAll('[data-peer-metric]').length,0);
 const references=document.querySelectorAll('[data-reference-metric]');assert.equal(references.length,3);
 for(const card of references){
  assert.match(card.textContent,/平均\s*\d+\.\d倍/);assert.match(card.textContent,/中央値\s*\d+\.\d倍/);
  assert.match(card.textContent,/対象2件/);assert.match(card.textContent,/TOB公表年月：/);assert.match(card.textContent,/−10%/);assert.match(card.textContent,/＋10%/);
  const [group]=comparableStats(comparables,financials.industry).filter(g=>g.metric===card.dataset.referenceMetric);
  assert.equal(card.querySelector('[data-reference-center]').textContent,priceFromMultiple(financials.facts,group.metric,group.mean).toLocaleString('ja-JP',{maximumFractionDigits:0})+'円');
 }
 const input=document.querySelector('[data-multiple]');input.value='12.3';input.dispatchEvent(new dom.window.Event('input'));
 assert.match(document.querySelector('[data-scenario]').textContent,/1,230円/);
 document.querySelector('.reference-sources summary').click();assert.equal(input.value,'12.3');
 document.querySelector('[data-metric]').value='pbr';document.querySelector('[data-metric]').dispatchEvent(new dom.window.Event('change'));
 assert.equal(input.value,'12.3');assert.match(document.querySelector('[data-scenario]').textContent,/12,300円/);
 document.querySelector('[data-reset]').click();assert.equal(input.value,'');dom.window.close();
});
test('画面：不足するBPS・EVの株価は捏造せず、参考倍率と欠損理由を表示する',async()=>{
 const f=structuredClone(financials);delete f.facts.bps;delete f.facts.cash;
 const html=await (await AstroContainer.create()).renderToString(Calculator,{props:{financials:f,comparables}});
 const dom=new JSDOM(html);for(const metric of ['pbr','evEbitda']){
  const card=dom.window.document.querySelector(`[data-reference-metric="${metric}"]`);
  assert.equal(card.querySelector('[data-reference-center]').textContent,'試算できません');assert.match(card.textContent,/未登録/);
  assert.equal(card.querySelector('[data-use-reference]').disabled,true);
 }
 dom.window.close();
});

test('画面：1件の参考倍率を明示操作で全精度のまま取り込み、株価を保持する',async()=>{
 const peers=structuredClone(comparables.slice(0,1));peers[0].multiples.per.value=15.123456789;
 const html=await (await AstroContainer.create()).renderToString(Calculator,{props:{financials,comparables:peers}});
 const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(client);const d=dom.window.document;
 const card=d.querySelector('[data-reference-metric="per"]'),input=d.querySelector('[data-multiple]'),price=d.querySelector('[data-price]');
 assert.match(card.textContent,/参考事例1件の倍率：15.1倍/);assert.doesNotMatch(card.textContent,/中央値/);
 assert.equal(card.querySelector('.reference-sensitivity').open,false);assert.equal(input.value,'');
 price.value='1400';price.dispatchEvent(new dom.window.Event('input'));
 card.querySelector('[data-use-reference]').click();
 assert.equal(input.value,'15.123456789');assert.equal(d.querySelector('[data-metric]').value,'per');assert.equal(price.value,'1400');
 assert.match(d.querySelector('[data-scenario]').textContent,/1,512.35円/);assert.equal(d.activeElement,input);
 assert.equal(d.querySelector('[data-applied-reference]').hidden,false);
 input.value='12';input.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelector('[data-applied-reference]').hidden,true);
 card.querySelector('[data-use-reference]').click();d.querySelector('[data-reset]').click();assert.equal(input.value,'');assert.equal(price.value,'');assert.equal(d.querySelector('[data-applied-reference]').hidden,true);
 dom.window.close();
});

test('画面：会社予想の参考を取り込んでも実績の数値に混ぜず、切替後も入力を保持する',async()=>{
 const f=structuredClone(financials);f.forecastFacts=structuredClone(f.facts);f.forecastFacts.eps={...f.facts.eps,value:200,basis:'company_forecast',period:'2027年3月期'};
 const peers=structuredClone(comparables);for(const p of peers)p.multiples.per.basis='company_forecast';
 const html=await (await AstroContainer.create()).renderToString(Calculator,{props:{financials:f,comparables:peers}});
 const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(client);const d=dom.window.document;
 d.querySelector('[data-financial-view="forecast"] [data-use-metric="per"]').click();
 assert.equal(d.querySelector('[data-financial-basis]').value,'forecast');assert.match(d.querySelector('[data-scenario-basis]').textContent,/会社予想・2027年3月期/);
 const value=d.querySelector('[data-multiple]').valueAsNumber;assert.match(d.querySelector('[data-scenario]').textContent,new RegExp((value*200).toLocaleString('ja-JP',{maximumFractionDigits:2})+'円'));
 const selector=d.querySelector('[data-financial-basis]');selector.value='registered';selector.dispatchEvent(new dom.window.Event('change'));
 assert.equal(d.querySelector('[data-multiple]').valueAsNumber,value);assert.match(d.querySelector('[data-scenario-basis]').textContent,/実績/);assert.equal(d.querySelector('[data-applied-reference]').hidden,true);
 dom.window.close();
});
