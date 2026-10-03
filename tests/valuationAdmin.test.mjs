import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {transform} from '@astrojs/compiler';
import {experimental_AstroContainer as AstroContainer} from 'astro/container';
import {JSDOM} from 'jsdom';
import {setupValuationAdmin} from '../src/lib/valuationAdmin.ts';

// Render the real component in memory. No server, public route, auth bypass or real API.
const filename=pathToFileURL(path.resolve('src/components/ValuationAdmin.astro')).href;
const compiled=await transform(fs.readFileSync('src/components/ValuationAdmin.astro','utf8'),{filename,internalURL:'astro/compiler-runtime',resultScopedSlot:true,renderScript:true,resolvePath:specifier=>specifier});
const code=compiled.code
 .replaceAll('astro/compiler-runtime',import.meta.resolve('astro/compiler-runtime'))
 .replaceAll('../lib/valuation',pathToFileURL(path.resolve('src/lib/valuation.ts')).href)
 .replace(/^import ".*\?astro&type=style.*";$/gm,'');
const component=(await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
const html=await (await AstroContainer.create()).renderToString(component);
const [financials,comparable]=JSON.parse(fs.readFileSync('data/sample/valuations.json','utf8'));
const flush=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};

function setup(t){
 const dom=new JSDOM(html,{url:'https://local.invalid/admin/'});
 for(const key of ['window','document','Option']){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
  t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
 }
 t.after(()=>dom.window.close());
 let rows=[],calls=[],rejectNext=false;
 const client={
  from:()=>({select:()=>({order:async()=>({data:structuredClone(rows),error:null})})}),
  rpc:async(name,args)=>{
   calls.push({name,args:structuredClone(args)});
   if(rejectNext){rejectNext=false;return {error:{message:'conflict'},data:null};}
   let row=rows.find(r=>r.id===args.record_id);
   assert.equal(args.expected_revision,row?.revision??null);
   if(name==='save_valuation_draft')row={id:args.record_id,draft:structuredClone(args.payload),published:row?.published??null,revision:(row?.revision??0)+1};
   else row={...row,published:args.make_public?structuredClone(row.draft):null,revision:row.revision+1};
   rows=[row,...rows.filter(r=>r.id!==row.id)];return {data:structuredClone(row),error:null};
  }
 };
 const editor=setupValuationAdmin(client);
 const byId=id=>dom.window.document.getElementById(id);
 const input=(selector,value)=>{const node=dom.window.document.querySelector(selector);node.value=value;node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 const importRecord=async record=>{
  const file=byId('va-import');Object.defineProperty(file,'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(record)}]});
  await file.onchange({target:file});
 };
 return {editor,byId,input,importRecord,dom,calls,rows:()=>rows,reject:()=>{rejectNext=true;}};
}

test('管理フォーム：取込→保存→公開、編集後は公開版を維持、再取込は同じ版を更新',async t=>{
 const h=setup(t);await h.editor.reload();await h.importRecord(financials);
 assert.equal(h.byId('va-publish').disabled,true);
 h.byId('va-form').requestSubmit();await flush();assert.equal(h.rows().length,1);
 assert.equal(h.rows()[0].draft.facts.adjustments.value,0);assert.equal(h.byId('va-publish').disabled,false);
 h.byId('va-publish').click();await flush();assert.equal(h.rows()[0].published.facts.eps.value,100);
 h.input('[data-fact="eps"] [data-v="value"]','200');assert.equal(h.byId('va-publish').disabled,true);
 h.byId('va-form').requestSubmit();await flush();assert.equal(h.rows()[0].draft.facts.eps.value,200);assert.equal(h.rows()[0].published.facts.eps.value,100);
 await h.importRecord({...financials,notes:'再取込'});h.byId('va-form').requestSubmit();await flush();assert.equal(h.rows().length,1);assert.equal(h.calls.at(-1).args.expected_revision,3);
 h.byId('va-unpublish').click();await flush();assert.equal(h.rows()[0].published,null);
});

test('管理フォーム：空の数値・競合時に公開せず編集を保持、破棄の拒否を守る',async t=>{
 const h=setup(t);await h.editor.reload();await h.importRecord(financials);
 h.input('[data-fact="eps"] [data-v="value"]','');h.byId('va-form').requestSubmit();await flush();assert.equal(h.calls.length,0);
 h.input('[data-fact="eps"] [data-v="value"]','123');h.reject();h.byId('va-form').requestSubmit();await flush();
 assert.equal(h.byId('va-publish').disabled,true);assert.match(h.byId('va-status').textContent,/失敗/);
 h.dom.window.confirm=()=>false;await h.editor.reload();assert.equal(h.dom.window.document.querySelector('[data-fact="eps"] [data-v="value"]').value,'123');
 h.byId('va-new-comparable').click();assert.equal(h.byId('va-kind-label').textContent,'財務数値');
});

test('管理フォーム：TOBの倍率と価格履歴を往復し、読み込んだ文字列をHTMLとして実行しない',async t=>{
 const h=setup(t);await h.editor.reload();await h.importRecord({...comparable,name:'<img src=x onerror=alert(1)>',history:[...comparable.history]});
 assert.equal(h.byId('va-history').children.length,2);h.byId('va-form').requestSubmit();await flush();
 assert.equal(h.rows()[0].draft.history.length,2);assert.equal(h.rows()[0].draft.multiples.per.value,15);
 await h.editor.reload();assert.equal(h.byId('va-history').children.length,2);assert.equal(h.byId('va-editor').querySelector('img'),null);
 h.byId('va-history').querySelector('button').click();h.byId('va-form').requestSubmit();await flush();assert.equal(h.rows()[0].draft.history.length,1);
});
