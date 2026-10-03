import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler';
import {experimental_AstroContainer as AstroContainer} from 'astro/container';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const file=path.resolve('src/components/DcfCalculator.astro'),source=fs.readFileSync(file,'utf8');
let code=(await transform(source,{filename:pathToFileURL(file).href,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:async s=>s})).code;
code=code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime')).replace(/^import ".*\?astro&type=style.*";$/gm,'');
const Component=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
const html=await (await AstroContainer.create()).renderToString(Component);
const script=source.match(/<script>([\s\S]*?)<\/script>/)[1];
const client=(await build({stdin:{contents:script,loader:'ts',resolveDir:path.dirname(file)},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
function page(){const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(client);return dom;}
function set(dom,key,value){const el=dom.window.document.querySelector(`[data-dcf-${key}]`);el.value=value;el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input'));}
function fill(dom){set(dom,'date','2026-06-30');set(dom,'scope','standalone');set(dom,'notes','検証用の仮定。実在銘柄の予測ではない。');dom.window.document.querySelectorAll('[data-dcf-fcff]').forEach(el=>{el.value='100';el.dispatchEvent(new dom.window.Event('input'));});for(const [key,value] of Object.entries({wacc:'10',bridge:'20',shares:'1000000',normalized:'100',growth:'0'}))set(dom,key,value);}

test('DCF画面：財務や同業平均を自動入力せず、欠損を0として計算しない',()=>{
 const dom=page(),d=dom.window.document;assert.ok([...d.querySelectorAll('input,textarea')].every(el=>el.value===''));assert.equal(d.querySelector('[data-dcf-results]').hidden,true);
 fill(dom);set(dom,'bridge','');assert.equal(d.querySelector('[data-dcf-results]').hidden,true);assert.equal(d.querySelectorAll('[data-dcf-body] td').length,0);set(dom,'bridge','0');assert.match(d.querySelector('[data-dcf-price]').textContent,/1,000円/);dom.window.close();
});
test('DCF画面：株価・価値の内訳・9セルの感応度を表示し、方式切替で独立した継続価値を使う',()=>{
 const dom=page(),d=dom.window.document;fill(dom);assert.match(d.querySelector('[data-dcf-price]').textContent,/1,020円/);assert.equal(d.querySelector('[data-dcf-results]').hidden,false);assert.equal(d.querySelector('.dcf-center').textContent,'1,020');assert.equal(d.querySelector('[data-dcf-value="enterpriseValue"]').textContent,'1,000百万円');
 set(dom,'method','multiple');assert.equal(d.querySelector('[data-dcf-results]').hidden,true);assert.equal(d.querySelector('[data-dcf-growth-fields]').hidden,true);assert.equal(d.querySelector('[data-dcf-multiple-fields]').hidden,false);set(dom,'ebitda','200');set(dom,'exit','5');assert.match(d.querySelector('[data-dcf-price]').textContent,/1,020円/);assert.match(d.querySelector('[data-dcf-sensitivity-note]').textContent,/±0.5倍/);dom.window.close();
});
test('DCF画面：WACCと成長率の逆転や非整数株数を止め、クリアで前提と結果を消す',()=>{
 const dom=page(),d=dom.window.document;fill(dom);set(dom,'growth','10');assert.equal(d.querySelector('[data-dcf-results]').hidden,true);set(dom,'growth','0');set(dom,'shares','1.5');assert.equal(d.querySelector('[data-dcf-results]').hidden,true);set(dom,'shares','1000000');assert.equal(d.querySelector('[data-dcf-results]').hidden,false);d.querySelector('[data-dcf-reset]').click();assert.ok([...d.querySelectorAll('input,textarea')].every(el=>el.value===''));assert.equal(d.querySelector('[data-dcf-results]').hidden,true);assert.equal(d.querySelector('[data-dcf-scope]').value,'');dom.window.close();
});
