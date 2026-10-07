// Build-time only. Uses the Supabase Management API, never a browser credential.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const normalizeSql = sql => sql.replace(/\r\n/g, '\n');
export const checksum = sql => createHash('sha256').update(normalizeSql(sql)).digest('hex');
const literal = value => "E'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";

export function loadMigrations(root = process.cwd()) {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'supabase/deploy/baseline.json'), 'utf8'));
  const directory = path.join(root, 'supabase/migrations');
  const names = fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  if (names.some(name => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name))) throw new Error('DB更新SQLの名前は0009_example.sql形式にしてください');
  if (new Set(names.map(name => name.slice(0, 4))).size !== names.length) throw new Error('DB更新SQLの番号が重複しています');
  const files = names.map(name => {
    const sql = normalizeSql(fs.readFileSync(path.join(directory, name), 'utf8'));
    return { name, sql, sha256: checksum(sql) };
  });
  for (const expected of baseline.files) {
    if (files.find(file => file.name === expected.name)?.sha256 !== expected.sha256) throw new Error(`適用済みSQLを変更・削除できません: ${expected.name}`);
  }
  for (const file of files) {
    if (!baseline.files.some(b => b.name === file.name) && file.name.slice(0, 4) <= baseline.version) throw new Error(`過去の番号は追加できません: ${file.name}`);
  }
  return { baseline, files };
}

export function productionConfig(env) {
  if (env.PUBLIC_SUPABASE_DEPLOY_TOKEN) throw new Error('更新用トークンにPUBLIC_を付けないでください');
  if (env.DEPLOY_ENV !== 'production') {
    if (env.SUPABASE_DEPLOY_TOKEN) throw new Error('更新用トークンはCloudflareのProduction環境だけに設定してください');
    if (!['preview', 'test', 'development'].includes(env.DEPLOY_ENV) || env.DATA_SOURCE !== 'sample') throw new Error('プレビューにはDEPLOY_ENV=preview / DATA_SOURCE=sampleを設定してください');
    return null;
  }
  if (env.CF_PAGES !== '1' || env.CF_PAGES_BRANCH !== 'main' || env.DATA_SOURCE !== 'supabase') throw new Error('本番DBの自動更新はCloudflareのmainブランチだけで実行します');
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { throw new Error('SUPABASE_URLを確認してください'); }
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (!match || url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('SUPABASE_URLには対象プロジェクトの標準HTTPS URLを指定してください');
  if (env.PUBLIC_SUPABASE_URL && env.PUBLIC_SUPABASE_URL.replace(/\/$/, '') !== url.origin) throw new Error('公開用とビルド用のSupabase接続先が一致していません');
  if (!env.SUPABASE_DEPLOY_TOKEN?.trim()) throw new Error('Cloudflare ProductionにSUPABASE_DEPLOY_TOKENを登録してください');
  return { project: match[1], token: env.SUPABASE_DEPLOY_TOKEN.trim() };
}

// Included inside a DO statement: a single transaction owns both changes and history.
export function deploymentSql({ baseline, files }, guards) {
  const manifest = files.map(({ name, sha256 }) => ({ name, sha256 }));
  const baselineNames = baseline.files.map(file => file.name);
  const pending = files.filter(file => !baselineNames.includes(file.name));
  const body = `
declare original_auth text; expected jsonb := ${literal(JSON.stringify(manifest))}::jsonb;
begin
  if not pg_try_advisory_xact_lock(746421, 1) then raise exception 'HW_DEPLOY_BUSY'; end if;
  perform set_config('lock_timeout', '5s', true);
  select string_agg(pg_get_functiondef(oid), E'\\n' order by oid) into original_auth
    from pg_proc where oid in (to_regprocedure('public.is_admin()'),to_regprocedure('auth.uid()'),to_regprocedure('auth.jwt()'));
  ${guards.protected}
  if to_regclass('site_deploy.migrations') is null then
    ${guards.baseline}
    create schema if not exists site_deploy;
    revoke all on schema site_deploy from public, anon, authenticated, service_role;
    create table site_deploy.migrations (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now()
    );
    alter table site_deploy.migrations enable row level security;
    revoke all on site_deploy.migrations from public, anon, authenticated, service_role;
    ${baseline.files.map(file => `insert into site_deploy.migrations(name,sha256) values(${literal(file.name)},${literal(file.sha256)});`).join('\n    ')}
  end if;
  if exists (select 1 from site_deploy.migrations m where not exists (
    select 1 from jsonb_array_elements(expected) e where e->>'name'=m.name and e->>'sha256'=m.sha256
  )) then raise exception 'HW_HISTORY_MISMATCH'; end if;
  if (select count(*) from site_deploy.migrations where name in (${baselineNames.map(literal).join(',')})) <> ${baselineNames.length} then
    raise exception 'HW_BASELINE_HISTORY_MISSING';
  end if;
  ${pending.map(file => `
  if not exists(select 1 from site_deploy.migrations where name=${literal(file.name)}) then
    if exists(select 1 from site_deploy.migrations where name > ${literal(file.name)}) then raise exception 'HW_MIGRATION_ORDER'; end if;
    execute ${literal(file.sql)};
    insert into site_deploy.migrations(name,sha256) values(${literal(file.name)},${literal(file.sha256)});
  end if;`).join('\n')}
  ${guards.protected}
  notify pgrst, 'reload schema';
end`;
  let tag = '$site_deploy$';
  while (body.includes(tag)) tag = tag.slice(0, -1) + '_$';
  return `do ${tag}${body}\n${tag};`;
}

export function loadGuards(root = process.cwd()) {
  return {
    baseline: fs.readFileSync(path.join(root, 'supabase/deploy/verify_baseline.sql'), 'utf8'),
    protected: fs.readFileSync(path.join(root, 'supabase/deploy/protect_notes.sql'), 'utf8'),
  };
}

const failureMessages = {
  HW_DEPLOY_BUSY: '別のDB更新が実行中です。完了後に再ビルドしてください',
  HW_BASELINE_MISMATCH: '現在のDBが確認済みの0008構成と一致しません。自動修復せず停止しました',
  HW_PROTECTED_NOTES: 'メモ・お気に入りのアクセス制御が想定と異なるため停止しました',
  HW_PROTECTED_AUTH: '管理者判定関数の変更を検出したため停止しました',
  HW_PROTECTED_API_PRIVILEGES: 'APIの保護権限が想定と異なるため公開を停止しました。追加SQLの権限設定を確認してください',
  HW_HISTORY_MISMATCH: '適用済みSQLの変更・削除、または古いコードからの更新を検出しました',
  HW_BASELINE_HISTORY_MISSING: 'DB更新履歴が一部欠けています',
  HW_MIGRATION_ORDER: '適用済みの番号より前にSQLが追加されています',
};

export async function queryManagement(config, query, { fetchImpl = fetch, readOnly = false } = {}) {
  let response;
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${config.project}/database/query`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, read_only: readOnly }),
    });
  } catch {
    // A timed-out request may have committed. Do not retry a write blindly.
    throw new Error('Supabaseとの通信を確認できません。公開を停止しました。再実行時に適用履歴を照合します');
  }
  let text;
  try { text = await response.text(); } catch { throw new Error('Supabaseの応答を取得できないため公開を停止しました'); }
  if (!response.ok) {
    const code = Object.keys(failureMessages).find(code => text.includes(code));
    // Do not print server bodies: SQL errors can contain user content and credentials.
    throw new Error(code ? failureMessages[code] : `DB更新に失敗しました（HTTP ${response.status}）。権限・トークン期限・追加SQLを確認してください。公開は停止しました`);
  }
  try { return JSON.parse(text); } catch { throw new Error('Supabaseの応答形式を確認できないため公開を停止しました'); }
}

export async function deployDatabase(config, { root = process.cwd(), fetchImpl = fetch } = {}) {
  const plan = loadMigrations(root);
  const guards = loadGuards(root);
  await queryManagement(config, deploymentSql(plan, guards), { fetchImpl });
  const receipt = await queryManagement(config, 'select name,sha256 from site_deploy.migrations order by name', { fetchImpl, readOnly: true });
  const expected = plan.files.map(({ name, sha256 }) => ({ name, sha256 }));
  if (!Array.isArray(receipt) || JSON.stringify(receipt.map(row => ({ name: row?.name, sha256: row?.sha256 }))) !== JSON.stringify(expected)) throw new Error('適用後のDB更新履歴を確認できないため公開を停止しました');
  return expected.length;
}
