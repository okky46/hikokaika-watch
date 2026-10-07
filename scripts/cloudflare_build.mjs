import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { productionConfig, deployDatabase } from './supabase_deploy.mjs';

export async function cloudflareBuild({ env = process.env, migrate = deployDatabase, run = runNode, log = console.log } = {}) {
  const config = productionConfig(env);
  const buildEnv = { ...env };
  delete buildEnv.SUPABASE_DEPLOY_TOKEN;
  // The update token must never reach Astro/Vite or child processes.
  if (config) {
    const testEnv = { ...buildEnv, DEPLOY_ENV: 'test', DATA_SOURCE: 'sample' };
    for (const key of Object.keys(testEnv)) if (/^(PUBLIC_)?SUPABASE_/.test(key)) delete testEnv[key];
    log('[deploy] 公開前のコード検証');
    await run(['node_modules/astro/bin/astro.mjs', 'check'], testEnv);
    // Cloudflare Node 22.16 needs explicit type stripping for tests importing .ts.
    await run(['--experimental-strip-types', '--test', ...fs.readdirSync('tests').filter(name => name.endsWith('.test.mjs')).sort().map(name => `tests/${name}`)], testEnv);
    log('[deploy] DBの状態照合・未適用SQLの更新');
    const count = await migrate(config);
    log(`[deploy] DB更新履歴 ${count}件を確認。サイトをビルドします`);
  } else log('[deploy] サンプル環境: 本番DBへの接続・更新なし');
  await run(['node_modules/astro/bin/astro.mjs', 'build'], buildEnv);
  await run(['scripts/verify_security_build.mjs'], buildEnv);
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit', shell: false });
    child.on('error', () => reject(new Error('検証・ビルド処理を起動できません')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('検証・ビルドが失敗したため公開を停止しました')));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env };
  delete process.env.SUPABASE_DEPLOY_TOKEN;
  cloudflareBuild({ env }).catch(error => { console.error(`[deploy] ${error.message}`); process.exitCode = 1; });
}
