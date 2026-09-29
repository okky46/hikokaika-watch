import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { emptyTrackingProfile, parseTrackingProfile, publicTrackingStatus } from '../src/lib/trackingProfile.ts';
import { publicEventDate, lastTwelveMonths, matchesDate } from '../src/lib/trackingDates.ts';
import { matchesCase, defaultSearch, readSearch, searchParams, compareCases, companySearchAliases } from '../src/lib/trackingSearch.ts';
import { assemble } from '../src/lib/publicData.ts';

const admin='10000000-0000-4000-8000-000000000001', user='10000000-0000-4000-8000-000000000002';
const company='20000000-0000-4000-8000-000000000001', event='30000000-0000-4000-8000-000000000001';
const rumor=()=>({...emptyTrackingProfile(),title:'市場の噂から追跡',short_reason:'Mergermarketとの話はあるが未確認',last_checked_on:'2026-09-29',report_state:'none',report_note:'管理者が把握した市場の噂。報道は未確認。'});

test('会社の略称・正式名称・公開タイトルで探せる',()=>{
  const c={id:'a',code:'4320',name:'CEHD',reason:'非公開化',aliases:companySearchAliases('CEHD','CEホールディングスの経過'),media:[],stage:'pre',status:'rumor',statementTags:[],registeredOn:'',updatedAt:'',events:[]};
  for(const q of ['CEHD','CEホールディングス','ＣＥホールディングス','4320'])assert.ok(matchesCase(c,{...defaultSearch(),q}));
  assert.ok(!matchesCase(c,{...defaultSearch(),q:'他社'}));
});

test('噂と確認済み観測報道を表示・検索で区別し、会社説明を優先する',()=>{
  const p=rumor();
  const evidence={outlet_id:'mergermarket',event_id:'',source_name:'会社開示',source_url:'https://example.com/disclosure',method:'company',access:'unread',checked_on:'2026-09-29',reported_on:'',scope_note:'会社開示で記事の存在を確認。原文未閲覧。'};
  const reported=parseTrackingProfile({...p,report_state:'reported',reports:[evidence]},true);
  assert.equal(publicTrackingStatus(p),'rumor');
  assert.equal(publicTrackingStatus(reported),'reported');
  assert.equal(publicTrackingStatus({...reported,reports:[{...evidence,method:'secondary'}]}),'reported');
  for(const public_status of ['proposal','consideration','consideration_denied','announced','offer_succeeded'])assert.equal(publicTrackingStatus({...reported,public_status}),public_status);
  const f={...defaultSearch(),status:'reported'};
  assert.deepEqual(readSearch(searchParams(f),[]).filters,f);
  const c={id:'case',code:'130A',name:'デモ',reason:'非公開化観測',media:['mergermarket'],stage:'pre',status:publicTrackingStatus(reported),statementTags:[],registeredOn:'',updatedAt:'',events:[]};
  assert.equal(matchesCase(c,f),true);
  assert.equal(matchesCase(c,{...f,status:'rumor'}),false);
});

test('噂だけの登録はURL不要。提案・検討・未決定・否定は別分類',()=>{
  assert.equal(parseTrackingProfile(rumor(),true).reports.length,0);
  assert.throws(()=>parseTrackingProfile({...rumor(),public_status:'proposal'},true),/根拠/);
  assert.throws(()=>parseTrackingProfile({...rumor(),statements:[{event_id:event,subject:'会社',text:'未決定',tags:['invented']}]},true));
  for(const value of ['2026-02-30T12:00:00Z','2026-09-29T24:00:00Z','2026-09-29T10:60:00Z']) assert.throws(()=>parseTrackingProfile({...rumor(),event_dates:[{event_id:event,precision:'datetime',value,issue_label:''}]}));
});
test('号数と不明日は登録日に置換しない。月精度・12か月・JST境界',()=>{
  const raw={occurred_at:null,site_published_at:'2026-09-29T00:00:00Z'};
  assert.equal(publicEventDate(raw).start,null);
  const issue=publicEventDate(raw,{precision:'issue',value:'2026-01',issue_label:'2026年1月号'});
  assert.equal(matchesDate(issue,'2026-01-01','2026-01-31'),false);
  assert.equal(matchesDate(issue,'2026-01-01','2026-01-31',true),true);
  assert.equal(matchesDate(publicEventDate(raw,{precision:'month',value:'2024-02'}),'2024-02-29','2024-03-01'),true);
  assert.deepEqual(lastTwelveMonths('2024-02-29'),{from:'2023-03-01',to:'2024-02-29'});
  assert.deepEqual(lastTwelveMonths('2026-09-29'),{from:'2025-09-30',to:'2026-09-29'});
  assert.equal(publicEventDate({occurred_at:'2026-09-28T15:00:00Z'}).start,'2026-09-29');
});
test('媒体OR・他条件AND、案件内の別時点、条件復元と安定ソート',()=>{
  const c={id:'a',code:'130A',name:'デモ',reason:'市場の噂',media:['none'],stage:'pre',status:'rumor',statementTags:[],registeredOn:'2026-09-29',updatedAt:'2026-09-29',events:[{id:event,title:'出来事',date:publicEventDate({occurred_at:'2026-01-02T00:00:00Z'})}]};
  assert.ok(matchesCase(c,{...defaultSearch(),q:'１３０ａ'}));
  assert.ok(!matchesCase(c,{...defaultSearch(),media:['mergermarket']}));
  assert.ok(matchesCase({...c,media:['nikkei','mergermarket']},{...defaultSearch(),media:['nikkei','sentaku'],from:'2026-01-01',to:'2026-01-31'}));
  const f={...defaultSearch(),q:'噂',media:['nikkei','sentaku'],from:'2026-01-01',sort:'code'};
  assert.deepEqual(readSearch(searchParams(f),f.media).filters,f);
  assert.ok(readSearch('?fav=1&from=2026-02-30&media=madeup',[]).ignored);
  assert.deepEqual(readSearch('?media=none&media=nikkei',['none','nikkei']).filters.media,['none']);
  assert.ok(compareCases(c,{...c,id:'b',events:[],updatedAt:'2099-01-01'},'event')<0);
});
test('公開組み立ては承認済み分類だけを読み、噂の媒体名を検索分類に流用しない',()=>{
  const read=n=>JSON.parse(fs.readFileSync(`data/sample/${n}.json`,'utf8'));
  const raw={companies:read('companies'),cases:read('cases'),events:read('case_events'),prices:[],mediaOutlets:read('media_outlets'),trackingEditions:read('tracking_editions'),isSampleData:true};
  const edition=raw.trackingEditions.at(-1);edition.draft={...rumor(),title:'SECRET_DRAFT'};
  const data=assemble(raw);assert.doesNotMatch(JSON.stringify(data),/SECRET_DRAFT/);
  const c=data.cases.find(c=>c.id===edition.case_id);assert.deepEqual(c.media.map(m=>m.id),['none']);
  assert.equal(c.search.status,'rumor');
  const reportedCase=data.cases.find(c=>c.tracking.public_status==='rumor'&&c.tracking.report_state==='reported');
  assert.equal(reportedCase.search.status,'reported');
  // A published article linked to the rumor-only company does not create external report evidence.
  raw.articles=read('articles');
  raw.articleLinks=[{article_id:raw.articles.find(a=>a.published).id,company_id:c.companyId,edition:'published'}];
  const withArticle=assemble(raw);
  assert.ok(withArticle.articles.some(a=>a.companies.some(co=>co.id===c.companyId)));
  assert.equal(withArticle.cases.find(x=>x.id===c.id).search.status,'rumor');
  const datedEdition=raw.trackingEditions.find(t=>raw.events.some(e=>e.case_id===t.case_id&&e.event_type==='observation_report'));
  const reportEvents=raw.events.filter(e=>e.case_id===datedEdition.case_id&&['observation_report','follow_up_report'].includes(e.event_type));
  datedEdition.published.event_dates=reportEvents.map(e=>({event_id:e.id,precision:'unknown',value:'',issue_label:''}));
  assert.equal(assemble(raw).cases.find(c=>c.id===datedEdition.case_id).firstReportedAt,null);
  const published=edition.published;edition.published={...published,public_status:'consideration',status_event_ids:[event]};
  assert.throws(()=>assemble(raw),/出来事/);
});

test('実DB: 噂銘柄の下書き/公開分離、版競合、参照整合性、権限・個人RLS',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      grant usage on schema public,auth to anon,authenticated,service_role;`);
    for(const name of ['0001_init.sql','0002_comment_mfa_audit_notes.sql','0003_price_event_enums.sql','0004_inbox.sql','0007_tracking_articles.sql','0008_article_validation.sql']) await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
    await db.exec(`grant all on companies,cases,case_events,user_case_notes,user_global_notes,user_case_favorites to authenticated,service_role;
      insert into auth.users values('${admin}'),('${user}');insert into admin_users(user_id) values('${admin}');
      insert into companies(id,security_code,name_ja) values('${company}','130A','デモ');`);
    const policies=()=>db.query("select * from pg_policies where tablename in ('user_case_notes','user_global_notes','user_case_favorites') order by tablename,policyname");
    const before=(await policies()).rows;
    await db.exec(fs.readFileSync('supabase/migrations/0009_tracking_editions.sql','utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/0011_tracking_bidding.sql','utf8'));
    assert.deepEqual((await policies()).rows,before);
    const session=async(role,id='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};
    const save=async(id,p,rev=null)=>(await db.query("select save_tracking_draft($1,$2,'rumor-only',$3,$4) as result",[id,company,p,rev])).rows[0].result;
    const publish=async(id,rev,on=true)=>(await db.query('select set_tracking_publication($1,$2,$3) as result',[id,rev,on])).rows[0].result;
    await session('authenticated',user);await assert.rejects(save(null,rumor()),/管理者/);
    assert.deepEqual((await db.query('select * from tracking_editions')).rows,[]);
    await assert.rejects(db.query('select read_published_tracking()'));
    await session('anon');await assert.rejects(db.query('select * from tracking_editions'));
    await session('authenticated',admin);
    await assert.rejects(db.query("insert into media_outlets(id,name,aliases) values('duplicate','日経',array['別名'])"),/重複/);
    await assert.rejects(db.query("insert into media_outlets(id,name,aliases) values('duplicate','新規媒体',array['ＮＩＫＫＥＩ',NULL])"),/媒体名/);
    let saved=await save(null,rumor());const id=saved.id;
    assert.equal((await db.query('select is_visible from cases where id=$1',[id])).rows[0].is_visible,false);
    await assert.rejects(db.query('update tracking_editions set published=draft'));
    await assert.rejects(publish(id,999),/別の編集/);
    let approved=await publish(id,saved.revision);const version=approved.publication_version;
    saved=await save(id,{...rumor(),title:'SECRET_DRAFT'},approved.revision);
    await session('service_role');let snapshot=(await db.query('select read_published_tracking() as r')).rows[0].r;
    assert.equal(snapshot.editions[0].publication_version,version);assert.doesNotMatch(JSON.stringify(snapshot),/SECRET_DRAFT|"draft"/);
    await session('authenticated',user);await db.query('insert into user_case_notes(user_id,case_id,body) values($1,$2,$3)',[user,id,'private']);
    await session('authenticated',admin);assert.equal((await db.query('select * from user_case_notes')).rows.length,0);
    await db.query("insert into case_events(id,case_id,event_type,title,is_visible) values($1,$2,'company_comment','会社が未決定と説明',true)",[event,id]);
    const considered={...rumor(),public_status:'consideration',status_note:'未決定（9/29会社説明時点）',status_event_ids:[event],statements:[{event_id:event,subject:'対象会社',text:'非公開化を含む選択肢を検討・未決定',tags:['consideration_acknowledged','no_decision']}]};
    saved=await save(id,considered,saved.revision);approved=await publish(id,saved.revision);
    for(const invalid of [{...considered,public_status:' consideration '},{...considered,statements:[{...considered.statements[0],tags:[null]}]},{...considered,event_dates:[{event_id:event,precision:'datetime',value:'2026-09-29T24:00:00Z',issue_label:''}]}]) await assert.rejects(save(id,invalid,approved.revision));
    const bidding={...considered,report_state:'reported',reports:[{outlet_id:'nikkei',event_id:event,source_name:'検証用',source_url:'https://example.com/report',method:'company',access:'unread',checked_on:'2026-09-29',reported_on:'2026-09-28',scope_note:'入札に関する報道の存在を会社開示で確認'}],bidding:{stage:'second_round',event_id:event}};
    saved=await save(id,bidding,approved.revision);
    await session('service_role');snapshot=(await db.query('select read_published_tracking() as r')).rows[0].r;
    assert.equal(snapshot.editions[0].published.bidding,undefined);
    await session('authenticated',admin);approved=await publish(id,saved.revision);
    await session('service_role');snapshot=(await db.query('select read_published_tracking() as r')).rows[0].r;
    assert.deepEqual(snapshot.editions[0].published.bidding,bidding.bidding);
    await session('authenticated',admin);
    for(const change of [{bidding:{stage:'invented',event_id:event}},{bidding:{stage:'first_round',event_id:''}},{reports:[{...bidding.reports[0],event_id:''}]},{public_status:'withdrawn'}]) await assert.rejects(save(id,{...bidding,...change},approved.revision));
    await db.query('update case_events set is_visible=false where id=$1',[event]);
    await assert.rejects(publish(id,approved.revision),/出来事/);
    await session('service_role');await assert.rejects(db.query('select read_published_tracking()'),/出来事/);
    await session('authenticated',admin);await publish(id,approved.revision,false);
    await session('authenticated',user);assert.equal((await db.query('select body from user_case_notes')).rows[0].body,'private');
    await session('service_role');snapshot=(await db.query('select read_published_tracking() as r')).rows[0].r;assert.equal(snapshot.editions.length,0);
  } finally {await db.close();}
});

test('既存11銘柄の移行: 原文未閲覧を保持し、完了段階・媒体・号数を分ける。参照変更時は全件ロールバック',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
    for(const name of ['0001_init.sql','0002_comment_mfa_audit_notes.sql','0003_price_event_enums.sql','0004_inbox.sql','0007_tracking_articles.sql','0008_article_validation.sql','0009_tracking_editions.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
    const fixture=JSON.parse(fs.readFileSync('tests/fixtures/tracking-alignment-20260929.json','utf8'));
    for(const c of fixture){
      const co=(await db.query('insert into companies(security_code,name_ja) values($1,$2) returning id',[c.code,'移行検証 '+c.code])).rows[0].id;
      await db.query('insert into cases(id,company_id,slug,title,is_visible,site_published_at) values($1,$2,$3,$4,true,$5)',[c.id,co,c.slug,'既存タイトル','2026-09-29T00:00:00Z']);
      for(const e of c.expected_events)await db.query("insert into case_events(id,case_id,event_type,title,summary,source_url,is_visible) values($1,$2,'other',$3,$4,$5,true)",[e.id,c.id,e.title,e.summary,e.url]);
    }
    const sql=fs.readFileSync('supabase/migrations/0010_tracking_alignment.sql','utf8');
    const last=fixture.at(-1).expected_events.at(-1);
    await db.query("update case_events set title='編集された根拠' where id=$1",[last.id]);
    await assert.rejects(db.exec(sql),/evidence changed/);
    assert.equal((await db.query('select count(*) from tracking_editions')).rows[0].count,0);
    await db.query('update case_events set title=$1 where id=$2',[last.title,last.id]);await db.exec(sql);
    const result=(await db.query('select read_published_tracking() as value')).rows[0].value;
    assert.equal(result.editions.length,11);
    for(const row of result.editions)assert.doesNotThrow(()=>parseTrackingProfile(row.published,true));
    const p=code=>result.editions.find(e=>e.case_id===fixture.find(c=>c.code===code).id).published;
    assert.equal(p('3593').public_status,'delisted');assert.equal(p('202A').public_status,'privatized');assert.equal(p('4320').public_status,'offer_succeeded');
    assert.equal(p('4967').reports[0].outlet_id,'unknown');assert.equal(p('7630').statements[0].subject,'ハウス食品グループ本社（親会社）');
    assert.ok(!p('9072').reports.some(r=>r.outlet_id==='mergermarket'));
    assert.equal(p('4812').event_dates[0].precision,'issue');assert.equal(p('4812').event_dates[0].value,'2026-01');
    assert.ok(result.editions.flatMap(e=>e.published.reports).filter(r=>r.method!=='direct').every(r=>r.access==='unread'));
    assert.equal((await db.query('select count(*) from cases')).rows[0].count,11);
    assert.equal((await db.query('select count(*) from case_events')).rows[0].count,27);
    assert.equal((await db.query('select count(*) from articles')).rows[0].count,0);
  }finally{await db.close();}
});
