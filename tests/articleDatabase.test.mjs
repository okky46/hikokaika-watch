import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const userA='10000000-0000-4000-8000-000000000001';
const userB='10000000-0000-4000-8000-000000000002';
const admin='10000000-0000-4000-8000-000000000003';
const companyA='20000000-0000-4000-8000-000000000001';
const companyB='20000000-0000-4000-8000-000000000002';
const caseId='30000000-0000-4000-8000-000000000001';
const source={name:'公開会社IR',url:'https://example.com/ir',published_on:'2026-09-01',checked_on:'2026-09-29'};
const content={title:'公表資料の整理',summary:'確認した資本政策',body:'本文',confirmed_facts:'資本政策を見直すと発表',interpretation:'非公開化の決定を示さない',unknowns:'方法・時期',checked_on:'2026-09-29',correction_note:'',sources:[source]};

for(const pr8 of process.env.PR8_SQL_DIR ? [false,'0005','0006'] : [false]) {
  test(`実DB: 記事の承認・下書き隔離・関連付けと個人RLS（PR8=${pr8}）`,async()=>{
    const db=new PGlite();
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
        grant usage on schema public,auth to anon,authenticated,service_role;
        grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;`);
      for(const name of ['0001_init.sql','0002_comment_mfa_audit_notes.sql','0003_price_event_enums.sql','0004_inbox.sql']) await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
      await db.exec(`grant all on all tables in schema public to authenticated,service_role;
        insert into auth.users values ('${userA}'),('${userB}'),('${admin}');
        insert into public.admin_users(user_id) values('${admin}');
        insert into companies(id,security_code,name_ja) values('${companyA}','130A','親会社'),('${companyB}','245B','子会社');
        insert into cases(id,company_id,title,slug,is_visible) values('${caseId}','${companyA}','噂段階の追跡','rumor-only',true);`);
      if(pr8){await db.exec(fs.readFileSync(path.join(process.env.PR8_SQL_DIR,'0005_case_event_classification.sql'),'utf8'));if(pr8==='0006')await db.exec(fs.readFileSync(path.join(process.env.PR8_SQL_DIR,'0006_pr1_review_fixes.sql'),'utf8'));}
      const adminFunction=(await db.query(`select pg_get_functiondef('public.is_admin()'::regprocedure) as def`)).rows[0].def;
      const policySql=`select tablename,policyname,qual,with_check from pg_policies where tablename in ('user_case_notes','user_global_notes','user_case_favorites') order by tablename,policyname`;
      const originalPolicies=(await db.query(policySql)).rows;
      await db.exec(fs.readFileSync('supabase/migrations/0007_tracking_articles.sql','utf8'));
      assert.deepEqual((await db.query(policySql)).rows,originalPolicies);
      assert.equal((await db.query(`select pg_get_functiondef('public.is_admin()'::regprocedure) as def`)).rows[0].def,adminFunction);
      const session=async(role,id='')=>{await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);await db.exec(`set role ${role}`);};
      await session('anon');await assert.rejects(db.query('select * from articles'));
      await session('authenticated',userA);
      await db.query('insert into user_case_notes(user_id,case_id,body) values($1,$2,$3)',[userA,caseId,'自分だけのメモ']);
      await db.query('insert into user_global_notes(user_id,body) values($1,$2)',[userA,'全体メモ']);
      await db.query('insert into user_case_favorites(user_id,case_id,intensity) values($1,$2,3)',[userA,caseId]);
      assert.equal((await db.query('select body from user_case_notes')).rows[0].body,'自分だけのメモ');
      await session('authenticated',userB);
      for(const table of ['user_case_notes','user_global_notes','user_case_favorites']){
        assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
        assert.equal((await db.query(`delete from ${table} returning *`)).rows.length,0);
      }
      assert.equal((await db.query(`update user_case_notes set body='changed' returning *`)).rows.length,0);
      await assert.rejects(db.query('insert into user_case_notes(user_id,case_id,body) values($1,$2,$3)',[userA,caseId,'他人のメモ']));
      await session('authenticated',userA);
      await db.query(`update user_case_notes set body='編集後' where case_id=$1`,[caseId]);
      await session('anon');await session('authenticated',userA);
      assert.equal((await db.query('select body from user_case_notes')).rows[0].body,'編集後');
      assert.equal((await db.query('select intensity from user_case_favorites')).rows[0].intensity,3);
      assert.equal((await db.query('select * from articles')).rows.length,0);
      const save=async(id,slug,payload,ids,revision)=>(await db.query('select save_article_draft($1,$2,$3,$4,$5) as result',[id,slug,payload,ids,revision])).rows[0].result;
      const publish=async(id,revision,visible)=>(await db.query('select set_article_publication($1,$2,$3) as result',[id,revision,visible])).rows[0].result;
      await assert.rejects(save(null,'forbidden',content,[],null),/管理者権限/);
      await assert.rejects(db.query('select read_published_articles()'));
      await session('authenticated',admin);
      let saved=await save(null,'sample',content,[companyA,companyB],null);
      const id=saved.id;
      await assert.rejects(db.query('update articles set published=draft where id=$1',[id]));
      await assert.rejects(publish(id,999,true),/別の編集/);
      let approved=await publish(id,saved.revision,true);
      const version=approved.publication_version;
      saved=await save(id,'sample',{...content,title:'未承認の修正'},[companyB],approved.revision);
      await session('service_role');
      let snapshot=(await db.query('select read_published_articles() as result')).rows[0].result;
      assert.equal(snapshot.articles[0].published.title,content.title);assert.equal(snapshot.links.length,2);
      assert.equal(snapshot.articles[0].publication_version,version);assert.ok(!JSON.stringify(snapshot).includes('未承認'));
      await session('authenticated',admin);
      await assert.rejects(save(id,'changed-url',content,[companyA],saved.revision),/公開済みURL/);
      approved=await publish(id,saved.revision,true);
      await session('service_role');snapshot=(await db.query('select read_published_articles() as result')).rows[0].result;
      assert.equal(snapshot.articles[0].published.title,'未承認の修正');assert.equal(snapshot.links.length,1);assert.equal(snapshot.links[0].company_id,companyB);
      await session('authenticated',admin);await publish(id,approved.revision,false);
      const bad=await save(null,'no-sources',{...content,sources:[]},[],null);
      await assert.rejects(publish(bad.id,bad.revision,true),/公開には/);
      await session('service_role');snapshot=(await db.query('select read_published_articles() as result')).rows[0].result;
      assert.deepEqual(snapshot,{articles:[],links:[]});assert.equal((await db.query('select * from cases where id=$1',[caseId])).rows.length,1);
      // 旧管理画面互換: 出来事なしでも公開銘柄の保存を許可する。
      await session('authenticated',admin);await db.query(`update cases set tracking_reason='追跡理由',last_checked_on='2026-09-29' where id=$1`,[caseId]);
      await db.query(`insert into case_events(case_id,event_type,occurred_at,title,is_visible) values($1,'other',null,'日付未確認',true)`,[caseId]);
      // 本番側で任意設定されるaal2必須版を、記事RPCが迂回しないこと。
      await db.exec(`reset role; create or replace function public.is_admin() returns boolean language sql security definer stable set search_path=public as $$
        select exists(select 1 from admin_users where user_id=auth.uid() and is_active) and coalesce(auth.jwt()->>'aal','aal1')='aal2' $$;`);
      await session('authenticated',admin);
      await assert.rejects(save(null,'mfa-required',content,[],null),/管理者権限/);
      await db.query(`select set_config('request.jwt.claims','{"aal":"aal2"}',false)`);
      assert.ok((await save(null,'mfa-verified',content,[],null)).id);
    } finally {await db.close();}
  });
}
