import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseValuation,multipleFromPrice,priceFromMultiple,prerequisites,safeSource} from '../src/lib/valuation.ts';
const [raw,peer]=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8'));
test('PER・PBR・EV/EBITDAの往復計算とEVから株主価値への控除',()=>{
 const f=parseValuation(raw).facts;
 assert.equal(multipleFromPrice(f,'per',1500),15);assert.equal(multipleFromPrice(f,'pbr',1500),1.5);
 assert.equal(multipleFromPrice(f,'evEbitda',1400),10);assert.equal(priceFromMultiple(f,'evEbitda',10),1400);
 for(const key of ['per','pbr','evEbitda'])for(const price of [1,1.25,1400,1750.33,100000])assert.ok(Math.abs(priceFromMultiple(f,key,multipleFromPrice(f,key,price))-price)<1e-8);
 const adjusted=structuredClone(f);adjusted.adjustments.value=500000000;assert.equal(priceFromMultiple(adjusted,'evEbitda',10),1350);
});
test('未取得・赤字・無効な数値・連結範囲・残高日付の不一致では試算しない',()=>{
 for(const key of ['eps','bps','ebitda','shares','debt','cash','adjustments']){const f=structuredClone(raw.facts);delete f[key];const metric=key==='eps'?'per':key==='bps'?'pbr':'evEbitda';assert.equal(multipleFromPrice(f,metric,1000),null);assert.equal(priceFromMultiple(f,metric,10),null);}
 for(const value of [0,-1])for(const [key,metric] of [['eps','per'],['bps','pbr'],['ebitda','evEbitda'],['shares','evEbitda']]){const f=structuredClone(raw.facts);f[key].value=value;assert.ok(prerequisites(f,metric));}
 for(const value of [NaN,Infinity,-1,0])assert.equal(multipleFromPrice(raw.facts,'per',value),null);
 const f=structuredClone(raw.facts);f.debt.period='2025-03-31';assert.ok(prerequisites(f,'evEbitda'));f.debt.period=f.cash.period;f.debt.scope='standalone';assert.ok(prerequisites(f,'evEbitda'));
 assert.equal(priceFromMultiple(raw.facts,'evEbitda',0.01),null);
});
test('公開データの型・出典・ゼロと未取得の区別',()=>{
 assert.equal(parseValuation(raw).facts.adjustments.value,0);assert.equal(parseValuation(peer).multiples.per.value,15);
 for(const value of ['',null,Infinity]){const f=structuredClone(raw);f.facts.eps.value=value;assert.throws(()=>parseValuation(f));}
 for(const url of ['javascript:alert(1)','https://a:b@example.com','https://api.edinet-fsa.go.jp/?Subscription-Key=secret'])assert.equal(safeSource(url),false);
 assert.throws(()=>parseValuation({...raw,checkedOn:'2026-02-30'}));
});
