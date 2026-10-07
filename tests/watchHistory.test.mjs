import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {parseObservations,newObservation,mergeObservationImport} from '../src/lib/watchHistory.ts';
import {emptyTrackingProfile,parseTrackingProfile} from '../src/lib/trackingProfile.ts';
import {premiumPrice,evPrice,navPrice} from '../src/lib/quickValuation.ts';
import {watchManifest} from '../src/lib/watchManifest.ts';
import {changedEntries,saveChecked,readChecked} from '../src/lib/watchReadState.ts';
const observation=(changes={})=>({...newObservation('2026-10-07T00:00:00.000Z'),title:'出来高増加',occurred_on:'2026-09-01',facts:'観測した出来高は前日より増加',...changes});
test('三方式：百万円と百万株で円/株、負債を二重控除せず、ゼロ・負数・欠損を拒否',()=>{
 assert.equal(premiumPrice(1000,30),1300);assert.equal(premiumPrice(1000,-20),800);
 assert.equal(evPrice(100,8,300,100,20,10),58);
 assert.equal(navPrice(1000,200,10),120);
 for(const n of [NaN,Infinity,0,-1]){assert.equal(premiumPrice(n,30),null);assert.equal(evPrice(100,8,300,100,0,n),null);assert.equal(navPrice(100,0,n),null);}
 assert.equal(premiumPrice(100,-100),null);assert.equal(evPrice(-1,8,0,0,0,10),null);assert.equal(navPrice(-100,0,10),null);
});
test('観察：複数起点・後日解釈・成果なしを保持、不明日を記録日に置換しない',()=>{
 const a=observation({kind:'origin',occurred_on:'',date_note:'9月上旬ごろ'});
 const b=observation({kind:'retrospective',related_id:a.id,outcome:'explained',interpretation:'別の材料と整合する'});
 const parsed=parseObservations([a,b]);assert.equal(parsed[0].occurred_on,'');assert.equal(parsed[1].recorded_at,'2026-10-07T00:00:00.000Z');
 assert.throws(()=>parseObservations([{...a,date_note:''}]));assert.throws(()=>parseObservations([a,{...b,related_id:b.id}]));
 assert.throws(()=>parseObservations([{...a,related_id:b.id},b]));
 assert.throws(()=>parseObservations([{...a,source_url:'javascript:alert(1)',source_name:'test'}]));
 assert.throws(()=>parseObservations([{...a,price:123,price_on:'2026-02-30'}]));
 const p=parseTrackingProfile({...emptyTrackingProfile(),observations:parsed});assert.deepEqual(p.observations,parsed);
});
test('確認差分：古い出来事への追記・訂正・取り下げを検出、再ビルドだけでは更新扱いしない',()=>{
 const a=observation(),p={...emptyTrackingProfile(),observations:[a]};
 const initial=watchManifest(p,[],'気になった理由','rumored');
 assert.deepEqual(changedEntries(watchManifest({...p,observations:[{...a,updated_at:'2026-10-08T00:00:00.000Z'}]},[],'気になった理由','rumored'),initial),[]);
 const changed=watchManifest({...p,observations:[{...a,interpretation:'後日修正'}]},[],'気になった理由','rumored');
 assert.deepEqual(changedEntries(changed,initial),[`observation-${a.id}`]);
 assert.deepEqual(changedEntries(watchManifest({...p,observations:[]},[],'気になった理由','rumored'),initial),[`observation-${a.id}`]);
 let data='broken';const storage={getItem:()=>data,setItem:(_k,v)=>data=v};assert.deepEqual(readChecked(storage),{});saveChecked(storage,'test-case',initial);assert.deepEqual(readChecked(storage)['test-case'].entries,initial);
});
test('AI取り込み：省略項目を補い、既存記録と関連付け、重複IDを拒否する',()=>{
 const a=observation();
 const result=mergeObservationImport([a],[{title:'後日の確認',facts:'公開開示を照合した',date_note:'9月上旬',related_id:a.id,kind:'check',outcome:'no_change'}]);
 assert.equal(result.length,2);assert.equal(result[1].related_id,a.id);assert.equal(result[1].occurred_on,'');
 assert.deepEqual(result[0],a);
 const edited=mergeObservationImport(result,[{id:a.id,interpretation:'解釈を訂正'}]);
 assert.equal(edited[0].facts,a.facts);assert.equal(edited[0].interpretation,'解釈を訂正');
 assert.throws(()=>mergeObservationImport([a],[{id:a.id},{id:a.id}]));
 assert.throws(()=>parseObservations([a,{...a,id:a.id.toUpperCase()}]));
 assert.doesNotThrow(()=>parseObservations([{...a,recorded_at:'2026-10-07T00:00:00Z'}]));
});
test('DB：観察の保存・編集・下書き隔離・承認・競合拒否・記録日時の保護',async()=>{
 const db=new PGlite();
 const admin='10000000-0000-4000-8000-000000000001',company='20000000-0000-4000-8000-000000000001';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
   grant usage on schema public,auth to anon,authenticated,service_role;`);
  for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(`insert into auth.users values('${admin}');insert into admin_users(user_id)values('${admin}');insert into companies(id,security_code,name_ja)values('${company}','0001','架空会社');`);
  const session=async(role)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);await db.exec(`set role ${role}`);};
  const p={...emptyTrackingProfile(),title:'監視',short_reason:'気になる動き',last_checked_on:'2026-10-07',report_state:'none',report_note:'報道未確認',observations:[observation()]};
  const save=async(id,p,revision)=>(await db.query('select save_tracking_draft($1,$2,$3,$4,$5) as r',[id,company,'watch-test',p,revision])).rows[0].r;
  const publish=async(id,revision)=>(await db.query('select set_tracking_publication($1,$2,true) as r',[id,revision])).rows[0].r;
  await session('anon');await assert.rejects(save(null,p,null));
  await session('authenticated');let saved=await save(null,p,null);const id=saved.id;
  let draft=(await db.query('select draft from tracking_editions where case_id=$1',[id])).rows[0].draft;
  const recorded=draft.observations[0].recorded_at;assert.notEqual(recorded,p.observations[0].recorded_at);assert.doesNotThrow(()=>parseTrackingProfile(draft));
  let approval=await publish(id,saved.revision);
  draft.observations[0].interpretation='後日発見した別の材料';draft.observations[0].recorded_at='2000-01-01T00:00:00.000Z';
  saved=await save(id,draft,approval.revision);await assert.rejects(save(id,draft,approval.revision),/別の編集/);
  draft=(await db.query('select draft from tracking_editions where case_id=$1',[id])).rows[0].draft;assert.equal(draft.observations[0].recorded_at,recorded);
  await session('service_role');let snapshot=(await db.query('select read_published_tracking() as r')).rows[0].r;assert.equal(snapshot.editions[0].published.observations[0].interpretation,'');
  await session('authenticated');approval=await publish(id,saved.revision);
  await session('service_role');snapshot=(await db.query('select read_published_tracking() as r')).rows[0].r;assert.equal(snapshot.editions[0].published.observations[0].interpretation,'後日発見した別の材料');
  await session('authenticated');
  for(const key of ['kind','outcome','facts','recorded_at','price','volume']){const invalid={...draft.observations[0]};delete invalid[key];await assert.rejects(save(id,{...draft,observations:[invalid]},approval.revision));}
  for(const invalid of [{...draft.observations[0],price:120,price_on:''},{...draft.observations[0],source_url:'javascript:alert(1)'},{...draft.observations[0],related_id:draft.observations[0].id},{...draft.observations[0],event_id:company}])await assert.rejects(save(id,{...draft,observations:[invalid]},approval.revision));
 }finally{await db.close();}
});
