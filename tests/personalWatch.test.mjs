import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalWatch,readLocalWatch,LOCAL_WATCH_KEY} from '../src/lib/personalWatch.ts';
import {parseStructuredNote} from '../src/lib/noteMetadataHelpers.ts';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const note=(freeText='出来高をもう一度確認')=>({v:1,scenario:'材料のない上昇',freeText,nextCheckDate:'2026-10-08',targetPrice:'',exitCondition:''});
test('個人監視：初回保存・再訪・監視解除でも記録を保全し、別タブの上書きを拒否',async()=>{
 const s=storage(),a=createPersonalWatch(null,s);await a.load();await a.save('demo',note());
 const b=createPersonalWatch(null,s);await b.load();assert.equal(b.rows.demo.watching,true);assert.equal(parseStructuredNote(b.rows.demo.body).note.scenario,'材料のない上昇');
 await b.follow('demo',false);assert.equal(readLocalWatch(s).demo.watching,false);assert.equal(parseStructuredNote(readLocalWatch(s).demo.body).note.freeText,note().freeText);
 await b.save('demo',note('別のタブで訂正'));await assert.rejects(a.save('demo',note('古い画面から上書き')),/別のタブ/);
 await a.follow('demo',false);assert.equal(parseStructuredNote(readLocalWatch(s).demo.body).note.freeText,'別のタブで訂正');
});
test('個人監視：壊れた保存・容量不足・未読込では元データを上書きしない',async()=>{
 const s=storage();s.setItem(LOCAL_WATCH_KEY,'broken');const a=createPersonalWatch(null,s);await assert.rejects(a.load());await assert.rejects(a.save('demo',note()),/読み込み/);assert.equal(s.getItem(LOCAL_WATCH_KEY),'broken');
 const b=createPersonalWatch(null,{getItem:()=>null,setItem:()=>{throw Error('quota');}});await b.load();await assert.rejects(b.save('demo',note()),/保存できません/);assert.equal(b.rows.demo,undefined);
});
function accountDB(){
 const state={user:'owner',readError:false,writeError:false,favorites:[{case_id:'demo',intensity:3}],notes:[{case_id:'demo',body:'以前の自由メモ'}],calls:[]};
 const db={auth:{getSession:async()=>({data:{session:state.user?{user:{id:state.user}}:null},error:null})},from(table){return {select:async()=>({data:table==='user_case_notes'?state.notes:state.favorites,error:state.readError?{}:null}),upsert:async row=>{state.calls.push({table,row});return {error:state.writeError?{}:null};},delete(){const chain={eq(){return chain;},then(resolve){resolve({error:null});}};return chain;}};}};
 return {db,state};
}
test('アカウント監視：既存メモと関心度を読み、同じテーブルへ保存。匿名記録と混ぜない',async()=>{
 const s=storage(),local=createPersonalWatch(null,s);await local.load();await local.save('demo',note('ブラウザーだけの記録'));
 const before=s.getItem(LOCAL_WATCH_KEY),{db,state}=accountDB(),a=createPersonalWatch(db,s);await a.load();assert.equal(a.account,true);assert.equal(a.rows.demo.body,'以前の自由メモ');assert.equal(a.rows.demo.intensity,3);
 await a.save('demo',note('本人のアカウントメモ'));assert.equal(state.calls[0].table,'user_case_notes');assert.equal(state.calls[0].row.user_id,'owner');assert.equal(state.calls[1].row.intensity,3);assert.equal(s.getItem(LOCAL_WATCH_KEY),before);
 state.user='another';await assert.rejects(a.save('demo',note()),/ログイン状態が変わり/);assert.equal(state.calls.length,2);
});
test('アカウント読込・保存失敗を匿名保存で隠さず、入力を成功扱いにしない',async()=>{
 const s=storage(),{db,state}=accountDB(),a=createPersonalWatch(db,s);state.readError=true;await assert.rejects(a.load(),/読み込めません/);assert.equal(a.ready,false);assert.equal(s.getItem(LOCAL_WATCH_KEY),null);
 state.readError=false;await a.load();state.writeError=true;await assert.rejects(a.save('demo',note()),/保存できません/);assert.equal(a.rows.demo.body,'以前の自由メモ');assert.equal(s.getItem(LOCAL_WATCH_KEY),null);
});
