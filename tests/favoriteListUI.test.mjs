import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {setupFavoriteList} from '../src/lib/favoriteListUI.ts';
import {createPersonalWatch,readLocalWatch,LOCAL_WATCH_KEY} from '../src/lib/personalWatch.ts';
const html='<div class="tracking-company"><a class="case-link">確認用会社</a><button data-fav-toggle="demo"></button></div><div data-login-only hidden></div><p data-favorite-status hidden></p>';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('一覧の☆は詳細のブラウザー保存と同じ状態を読み、解除してもメモ・関心度を保持する',async()=>{
 const s=storage(),repo=createPersonalWatch(null,s);await repo.load();await repo.save('demo',{v:1,scenario:'',freeText:'残すメモ',nextCheckDate:'',targetPrice:'',exitCondition:''});await repo.setIntensity('demo',3);
 const dom=new JSDOM(html),prior={document:globalThis.document,window:globalThis.window};globalThis.document=dom.window.document;globalThis.window=dom.window;let rows;
 try{
  await setupFavoriteList(null,value=>rows=value,s);const button=document.querySelector('button');
  assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(rows.get('demo'),3);assert.equal(document.querySelector('[data-login-only]').hidden,false);
  button.click();await flush();assert.equal(button.getAttribute('aria-pressed'),'false');assert.equal(rows.size,0);assert.match(readLocalWatch(s).demo.body,/残すメモ/);
  button.click();await flush();assert.equal(rows.get('demo'),3);assert.equal(button.getAttribute('aria-label'),'確認用会社をお気に入りから外す');
  assert.match(document.querySelector('[data-favorite-status]').textContent,/このブラウザー/);
 }finally{globalThis.document=prior.document;globalThis.window=prior.window;dom.window.close();}
});
test('一覧の保存失敗を成功扱いにせず、別アカウントの記録を残さない',async()=>{
 const s=storage(),dom=new JSDOM(html),prior={document:globalThis.document,window:globalThis.window};globalThis.document=dom.window.document;globalThis.window=dom.window;let rows,changed;
 try{
  const db={auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}}}),onAuthStateChange:fn=>changed=fn},from:table=>({select:async()=>({data:table==='user_case_favorites'?[{case_id:'demo',intensity:2}]:[],error:null}),delete(){const q={eq(){return q;},then(resolve){resolve({error:{}});}};return q;}})};
  await setupFavoriteList(db,value=>rows=value,s);document.querySelector('button').click();await flush();
  assert.equal(rows.get('demo'),2);assert.match(document.querySelector('[data-favorite-status]').textContent,/保存できません/);
  changed('SIGNED_IN',{user:{id:'different'}});assert.equal(rows.size,0);assert.equal(document.querySelector('button').getAttribute('aria-pressed'),'false');assert.equal(document.querySelector('button').disabled,true);assert.equal(s.getItem(LOCAL_WATCH_KEY),null);
 }finally{globalThis.document=prior.document;globalThis.window=prior.window;dom.window.close();}
});
