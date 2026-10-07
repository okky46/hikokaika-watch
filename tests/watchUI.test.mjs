import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler-rs';
import {experimental_AstroContainer as AstroContainer} from 'astro/container';
import {build,transform as stripTypes} from 'esbuild';
import {JSDOM} from 'jsdom';
async function render(name,props={}){
 const file=path.resolve(`src/components/${name}.astro`);
 let code=(await transform(fs.readFileSync(file,'utf8'),{filename:pathToFileURL(file).href,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:s=>s})).code;
 code=code.replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime')).replace(/^import ".*\?astro&type=style.*";$/gm,'');
 for(const m of [...code.matchAll(/from ['"]([^'"]+)['"]/g)])if(m[1].startsWith('.')){
  let filePath=path.resolve(path.dirname(file),m[1]);if(!fs.existsSync(filePath))filePath+='.ts';code=code.replaceAll(m[1],pathToFileURL(filePath).href);
 }
 code=(await stripTypes(code,{loader:'ts',format:'esm'})).code;
 const component=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
 return (await AstroContainer.create()).renderToString(component,{props});
}
async function bundle(contents){return (await build({stdin:{contents,loader:'ts',resolveDir:path.resolve('src/lib')},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;}
const quickClient=await bundle("import {setupQuickValuation} from './quickValuationUI.ts';setupQuickValuation(document.querySelector('[data-quick-valuation]'));");
test('価格画面：登録値を読み込み、手入力・方式切替を保持し、時点不一致を反映しない',async()=>{
 const financials=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8'))[0];
 const dom=new JSDOM(await render('QuickValuation',{financials}),{runScripts:'outside-only'});dom.window.eval(quickClient);
 const d=dom.window.document,q=k=>d.querySelector(`[data-q="${k}"]`),edit=(k,v)=>{q(k).value=v;q(k).dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 edit('base','1000');assert.match(d.querySelector('[data-output=premium]').textContent,/1,300/);
 d.querySelector('[data-method=ev]').click();d.querySelector('[data-load-ev]').click();
 assert.equal(Number(q('shares').value),financials.facts.shares.value/1e6);
 edit('ebitda','100');edit('multiple','8');edit('debt','300');edit('cash','100');edit('adjustments','20');edit('shares','10');
 assert.match(d.querySelector('[data-output=ev]').textContent,/58 円/);
 d.querySelector('[data-method=nav]').click();edit('equity','1000');edit('nav-shares','10');edit('nav-adjustment','200');
 assert.match(d.querySelector('[data-output=nav]').textContent,/選んで/);
 const scope=d.querySelector('[data-nav-scope]');scope.value='assumption';scope.dispatchEvent(new dom.window.Event('change'));
 assert.match(d.querySelector('[data-output=nav]').textContent,/120 円/);
 d.querySelector('[data-method=ev]').click();assert.equal(q('ebitda').value,'100');assert.equal(q('base').value,'1000');
 dom.window.close();
 const mismatch=structuredClone(financials);mismatch.facts.shares.period='2099-01-01';
 const bad=new JSDOM(await render('QuickValuation',{financials:mismatch}),{runScripts:'outside-only'});bad.window.eval(quickClient);
 bad.window.document.querySelector('[data-q=ebitda]').value='321';bad.window.document.querySelector('[data-load-ev]').click();
 assert.equal(bad.window.document.querySelector('[data-q=ebitda]').value,'321');assert.match(bad.window.document.querySelector('[data-ev-origin]').textContent,/一致していません/);bad.window.close();
});
test('観察入力：AIの省略JSONを取り込み、既存観察へつなぎ、訂正して再読込する',async()=>{
 const dom=new JSDOM(await render('WatchHistoryEditor'),{url:'https://local.invalid',runScripts:'outside-only'});
 dom.window.structuredClone=structuredClone;
 dom.window.eval(await bundle("import {setupWatchHistoryEditor} from './watchHistoryEditor.ts';window.editor=setupWatchHistoryEditor(()=>{},()=>[{id:'90000000-0000-4000-8000-000000000001',label:'後日の開示'}]);window.editor.fill([]);"));
 const d=dom.window.document,editor=dom.window.editor;
 d.querySelector('[data-observation-json]').value=JSON.stringify([{title:'気になった起点',facts:'材料が見当たらない日に出来高が増加',date_note:'9月上旬',kind:'origin'}]);d.querySelector('[data-import-observations]').click();
 const first=editor.read()[0];assert.equal(first.occurred_on,'');
 d.querySelector('[data-observation-json]').value=JSON.stringify([{title:'後日の確認',facts:'別の材料を確認',date_note:'10月上旬',kind:'check',related_id:first.id,outcome:'explained'}]);d.querySelector('[data-import-observations]').click();
 const saved=editor.read();assert.equal(saved.length,2);assert.equal(saved[1].related_id,first.id);
 editor.fill(saved);d.querySelector('[data-o=interpretation]').value='見立てを訂正';const edited=editor.read();editor.fill(edited);
 assert.equal(editor.read()[0].interpretation,'見立てを訂正');assert.equal(editor.read()[0].recorded_at,first.recorded_at);dom.window.close();
});
test('再訪画面：既読保存・差分リンク・マイページ絞り込み・保存失敗を扱う',async()=>{
 const manifest={summary:'1111111111111111','observation-test':'2222222222222222'};
 const html=`<input type="checkbox" data-watch-updates-only><div data-revisit-empty></div><section data-watch-case="case-1" data-watch-manifest='${JSON.stringify(manifest)}'><p data-watch-message></p><div data-watch-change-links></div><button data-watch-mark></button><article id="observation-test" data-watch-item="observation-test"><h3>過去の起点</h3></article></section><li data-revisit-row data-watch-case="case-1" data-watch-manifest='${JSON.stringify(manifest)}'><span data-watch-badge></span></li>`;
 const dom=new JSDOM(html,{url:'https://local.invalid',runScripts:'outside-only'});
 dom.window.eval(await bundle("import {setupWatchReadState} from './watchReadState.ts';setupWatchReadState();"));const d=dom.window.document;
 d.querySelector('[data-watch-mark]').click();assert.match(d.querySelector('[data-watch-message]').textContent,/変更はありません/);assert.equal(d.querySelector('[data-revisit-row]').hidden,false);
 for(const root of d.querySelectorAll('[data-watch-case]'))root.dataset.watchManifest=JSON.stringify({...manifest,'observation-test':'3333333333333333'});
 dom.window.dispatchEvent(new dom.window.Event('pageshow'));assert.match(d.querySelector('[data-watch-message]').textContent,/1項目/);
 assert.equal(d.querySelector('[data-watch-change-links] a').getAttribute('href'),'#observation-test');
 const filter=d.querySelector('[data-watch-updates-only]');filter.checked=true;filter.dispatchEvent(new dom.window.Event('change'));assert.equal(d.querySelector('[data-revisit-row]').hidden,false);
 d.querySelector('[data-watch-mark]').click();assert.equal(d.querySelector('[data-revisit-row]').hidden,true);
 Object.defineProperty(dom.window,'localStorage',{get(){throw Error('blocked');}});d.querySelector('[data-watch-mark]').click();assert.match(d.querySelector('[data-watch-message]').textContent,/保存できません/);dom.window.close();
});
