import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { checksum, loadMigrations, loadGuards, deploymentSql, productionConfig, queryManagement, deployDatabase } from '../scripts/supabase_deploy.mjs';
import { cloudflareBuild } from '../scripts/cloudflare_build.mjs';

const env = { CF_PAGES:'1', CF_PAGES_BRANCH:'main', DEPLOY_ENV:'production', DATA_SOURCE:'supabase',
  SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_DEPLOY_TOKEN:'secret-for-test', SUPABASE_SERVICE_ROLE_KEY:'other-secret' };
const plan=loadMigrations();const guards=loadGuards();
const append=(name,sql,base=plan)=>({...base,files:[...base.files,{name,sql,sha256:checksum(sql)}]});
const sql=p=>deploymentSql(p,guards);
async function database() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;`);
  for(const file of plan.files)await db.exec(file.sql);
  return db;
}

test('本番mainだけ更新可能。プレビュー、誤接続、秘密情報のプレビュー設定は拒否',()=>{
  assert.equal(productionConfig(env).project,'abcdefghijklmnopqrst');
  assert.equal(productionConfig({DEPLOY_ENV:'preview',DATA_SOURCE:'sample'}),null);
  for(const change of [{CF_PAGES:'0'},{CF_PAGES_BRANCH:'feature'},{DATA_SOURCE:'sample'},{SUPABASE_DEPLOY_TOKEN:''},
    {SUPABASE_URL:'http://abcdefghijklmnopqrst.supabase.co'},{SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co.evil.test'},
    {PUBLIC_SUPABASE_URL:'https://anotherprojectabcdef.supabase.co'},{DEPLOY_ENV:'preview'}])assert.throws(()=>productionConfig({...env,...change}));
  assert.equal(checksum('select 1;\r\n'),checksum('select 1;\n'));
});

test('既存DBを照合して履歴のみ採用。新SQLは1回だけ実行し、履歴は一般ユーザーから不可視',async()=>{
  const db=await database();try{
    const user='10000000-0000-4000-8000-000000000001';
    await db.exec(`insert into auth.users values('${user}');insert into user_global_notes(user_id,body) values('${user}','KEEP_ME');`);
    const authBefore=(await db.query("select pg_get_functiondef('is_admin()'::regprocedure) as value")).rows[0].value;
    await db.exec(sql(plan));await db.exec(sql(plan));
    assert.equal((await db.query('select count(*) from site_deploy.migrations')).rows[0].count,6);
    assert.equal((await db.query('select body from user_global_notes')).rows[0].body,'KEEP_ME');
    assert.equal((await db.query("select pg_get_functiondef('is_admin()'::regprocedure) as value")).rows[0].value,authBefore);
    const next=append('0009_test.sql',"create table public.deploy_test(id integer); insert into public.deploy_test values(1); -- quote ' \\ $site_deploy$\n");
    await db.exec(sql(next));await db.exec(sql(next));
    assert.equal((await db.query('select count(*) from deploy_test')).rows[0].count,1);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from site_deploy.migrations'));await db.exec('reset role');
    }
    await assert.rejects(db.exec(sql(plan)),/HW_HISTORY_MISMATCH/);
    await assert.rejects(db.exec(sql(append('0009_test.sql','select 1;'))),/HW_HISTORY_MISMATCH/);
    assert.equal((await db.query('select count(*) from deploy_test')).rows[0].count,1);
  }finally{await db.close();}
});

test('更新途中の失敗、RLS解除、認証関数変更、COMMITで全更新をロールバック',async()=>{
  const db=await database();try{
    await db.exec(sql(plan));
    const badSql=[
      "create table public.must_rollback(id int); select 1/0;",
      "create table public.must_rollback(id int); alter table user_global_notes disable row level security;",
      "create table public.must_rollback(id int); create or replace function public.is_admin() returns boolean language sql as $$select true$$;",
      "create table public.must_rollback(id int); commit;",
      "create policy leak on user_case_notes for select using(true);",
    ];
    for(const migration of badSql){
      await assert.rejects(db.exec(sql(append('0009_failure.sql',migration))));
      assert.equal((await db.query("select to_regclass('public.must_rollback') as table_name")).rows[0].table_name,null);
      assert.equal((await db.query('select count(*) from site_deploy.migrations')).rows[0].count,6);
      await db.exec(sql(plan));
    }
    const first=append('0009_good.sql','create table public.must_rollback(id int);');
    await assert.rejects(db.exec(sql(append('0010_bad.sql','select 1/0;',first))));
    assert.equal((await db.query("select to_regclass('public.must_rollback') as table_name")).rows[0].table_name,null);
  }finally{await db.close();}
});

test('部分適用・定義の相違を未適用扱いでやり直さず停止。MFA版は維持',async()=>{
  const db=await database();try{
    await db.exec('drop function article_source_url_valid(text)');
    await assert.rejects(db.exec(sql(plan)),/HW_BASELINE_MISMATCH/);
    assert.equal((await db.query("select to_regclass('site_deploy.migrations') as name")).rows[0].name,null);
    await db.exec(fs.readFileSync('supabase/migrations/0008_article_validation.sql','utf8'));
    await db.exec(`create or replace function is_admin() returns boolean language sql security definer set search_path=public as $$select exists(select 1 from admin_users where user_id=auth.uid() and is_active) and coalesce(auth.jwt()->>'aal','aal1')='aal2'$$;`);
    await db.exec(sql(plan));
    assert.match((await db.query("select prosrc from pg_proc where oid='is_admin()'::regprocedure")).rows[0].prosrc,/aal2/);
  }finally{await db.close();}
});

test('APIエラーに含まれる秘密・本文をログ用例外に出さず、書込の無条件再送もしない',async()=>{
  let count=0;
  await assert.rejects(queryManagement(productionConfig(env),'select 1',{fetchImpl:async(url,options)=>{
    count++;assert.equal(options.redirect,'error');assert.match(url,/^https:\/\/api.supabase.com\//);
    return new Response('secret-for-test PRIVATE_NOTE',{status:500});
  }}),error=>!error.message.includes('secret-for-test')&&!error.message.includes('PRIVATE_NOTE'));
  assert.equal(count,1);
  await assert.rejects(queryManagement(productionConfig(env),'select 1',{fetchImpl:async()=>{throw new Error('secret-for-test');}}),error=>!error.message.includes('secret-for-test'));
});

test('API成功後にも履歴を確認。サーバーでキー順が変わっても照合可能',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push(JSON.parse(options.body));
    return Response.json(calls.length===1?[]:plan.files.map(f=>({sha256:f.sha256,name:f.name})),{status:201});
  };
  assert.equal(await deployDatabase(productionConfig(env),{fetchImpl}),6);
  assert.equal(calls[0].read_only,false);assert.equal(calls[1].read_only,true);
  await assert.rejects(deployDatabase(productionConfig(env),{fetchImpl:async()=>Response.json([])}),/履歴/);
});

test('検証→DB更新→ビルドの順。失敗時は公開ビルドへ進まず、子プロセスに更新トークンを渡さない',async()=>{
  const order=[];
  const run=async(args,childEnv)=>{
    assert.equal(childEnv.SUPABASE_DEPLOY_TOKEN,undefined);
    if(args.includes('check')||args.includes('--test'))assert.equal(childEnv.SUPABASE_SERVICE_ROLE_KEY,undefined);
    order.push(args.includes('--test')?'test':args.at(-1));
  };
  await cloudflareBuild({env,run,migrate:async()=>{order.push('migrate');return 6;},log:()=>{}});
  assert.deepEqual(order,['check','test','migrate','build']);
  order.length=0;
  await assert.rejects(cloudflareBuild({env,run,migrate:async()=>{throw new Error('stop');},log:()=>{}}));
  assert.deepEqual(order,['check','test']);
  order.length=0;
  await cloudflareBuild({env:{DEPLOY_ENV:'preview',DATA_SOURCE:'sample'},run,migrate:async()=>assert.fail('preview must never migrate'),log:()=>{}});
  assert.deepEqual(order,['build']);
});
