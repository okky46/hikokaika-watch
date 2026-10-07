import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('API privilege hardening preserves owner CRUD and admin/build access while denying cross-user access and TRUNCATE',async()=>{
 const db=new PGlite();
 const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',admin='10000000-0000-4000-8000-000000000003';
 const company='20000000-0000-4000-8000-000000000001',caseId='30000000-0000-4000-8000-000000000001';
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
   grant usage on schema public,auth to anon,authenticated,service_role;
   alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
   alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.exec(`insert into auth.users values('${a}'),('${b}'),('${admin}');
   insert into admin_users(user_id)values('${admin}');
   insert into companies(id,security_code,name_ja)values('${company}','0001','テスト会社');
   insert into cases(id,company_id,title,slug)values('${caseId}','${company}','テスト','test');`);
  const session=async(role,id='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec(`set role ${role}`);};
  const tables=['user_global_notes','user_case_notes','user_case_favorites'];
  await session('authenticated',a);
  await db.query('insert into user_global_notes(user_id,body)values($1,$2)',[a,'A only']);
  await db.query('insert into user_case_notes(user_id,case_id,body)values($1,$2,$3)',[a,caseId,'A only']);
  await db.query('insert into user_case_favorites(user_id,case_id,intensity)values($1,$2,3)',[a,caseId]);
  for(const table of tables){
   assert.equal((await db.query(`select * from ${table}`)).rows.length,1);
   await assert.rejects(db.query(`update ${table} set user_id=$1`,[b]),/row-level security/);
   await assert.rejects(db.exec(`truncate ${table}`),/permission denied/);
  }
  await db.query("update user_global_notes set body='edited'");
  await db.query("update user_case_notes set body='edited'");
  await db.query('update user_case_favorites set intensity=2');
  await session('authenticated',b);
  for(const table of tables){assert.equal((await db.query(`select * from ${table}`)).rows.length,0);assert.equal((await db.query(`delete from ${table} returning *`)).rows.length,0);}
  assert.equal((await db.query("update user_global_notes set body='attack' returning *")).rows.length,0);
  await assert.rejects(db.query('insert into user_global_notes(user_id,body)values($1,$2)',[a,'attack']),/row-level security/);
  assert.equal((await db.query('select is_admin() as allowed')).rows[0].allowed,false);
  await assert.rejects(db.query("select save_valuation_batch('[]')"),/管理者/);
  await assert.rejects(db.query('select read_published_articles()'),/permission denied/);
  await assert.rejects(db.query('insert into admin_users(user_id)values($1)',[b]),/permission denied/);
  await session('authenticated',admin);
  assert.equal((await db.query('select is_admin() as allowed')).rows[0].allowed,true);
  assert.equal((await db.query('select * from user_global_notes')).rows.length,0);
  await db.query("update companies set name_ja='編集後' where id=$1",[company]);
  assert.equal((await db.query('select * from revision_history')).rows.length,1);
  await assert.rejects(db.exec('delete from revision_history'),/permission denied/);
  await session('anon');
  for(const table of [...tables,'admin_users','admin_settings','cases','companies','articles','valuation_editions'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
  await assert.rejects(db.query('select is_admin()'),/permission denied/);
  await session('service_role');
  assert.equal((await db.query('select * from user_global_notes')).rows[0].body,'edited');
  for(const rpc of ['read_published_articles','read_published_tracking','read_published_valuations'])await db.query(`select ${rpc}()`);
  await session('authenticated',a);
  for(const table of tables)assert.equal((await db.query(`delete from ${table} returning *`)).rows.length,1);
  await session('postgres');
  await db.exec('create table public.future_private(id integer);create function public.future_private_function()returns integer language sql as $$select 1$$;');
  for(const role of ['anon','authenticated']){
   assert.equal((await db.query("select has_table_privilege($1,'future_private','select')as allowed",[role])).rows[0].allowed,false);
   assert.equal((await db.query("select has_function_privilege($1,'future_private_function()','execute')as allowed",[role])).rows[0].allowed,false);
  }
 }finally{await db.close();}
});
