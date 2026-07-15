// ============================================================
// ビルド環境・公開データソースの判定
//
// SITE_URL は canonical / OGP / sitemap 用の公開URLであり、
// 実行環境判定には使わない。Cloudflare Pages 上では CF_PAGES、
// それ以外では DEPLOY_ENV / DATA_SOURCE の組み合わせだけで判定する。
// ============================================================

export type DeployEnv = 'development' | 'test' | 'preview' | 'production';
export type DataSource = 'sample' | 'supabase';

export interface PublicDataEnvironment {
  deployEnv: DeployEnv;
  dataSource: DataSource;
}

const DEPLOY_ENVS: readonly DeployEnv[] = ['development', 'test', 'preview', 'production'];
const DATA_SOURCES: readonly DataSource[] = ['sample', 'supabase'];

const examples = [
  'ローカル: DEPLOY_ENV=development DATA_SOURCE=sample npm run dev',
  'CI: DEPLOY_ENV=test DATA_SOURCE=sample npm run build',
  'Cloudflare Preview: DEPLOY_ENV=preview DATA_SOURCE=sample',
  'Cloudflare Production: DEPLOY_ENV=production DATA_SOURCE=supabase',
].join(' / ');

export function resolvePublicDataEnvironment(env: NodeJS.ProcessEnv): PublicDataEnvironment {
  const cfPages = env.CF_PAGES === '1';
  const rawDeployEnv = env.DEPLOY_ENV;
  const rawDataSource = env.DATA_SOURCE;

  if (!cfPages && rawDeployEnv === undefined && rawDataSource === undefined) {
    return { deployEnv: 'development', dataSource: 'sample' };
  }

  if (rawDeployEnv === undefined || rawDataSource === undefined) {
    const missing = [rawDeployEnv === undefined ? 'DEPLOY_ENV' : null, rawDataSource === undefined ? 'DATA_SOURCE' : null]
      .filter(Boolean)
      .join(' / ');
    throw new Error(`[publicData] ${missing} を明示してください。${examples}`);
  }

  if (!isDeployEnv(rawDeployEnv)) {
    throw new Error(`[publicData] DEPLOY_ENV は development / test / preview / production のいずれかを指定してください: ${rawDeployEnv}`);
  }
  if (!isDataSource(rawDataSource)) {
    throw new Error(`[publicData] DATA_SOURCE は sample または supabase を指定してください: ${rawDataSource}`);
  }

  if (cfPages && (rawDeployEnv.length === 0 || rawDataSource.length === 0)) {
    throw new Error(`[publicData] Cloudflare Pages では DEPLOY_ENV と DATA_SOURCE が必須です。${examples}`);
  }

  if (rawDeployEnv === 'production' && rawDataSource === 'sample') {
    throw new Error('[publicData] DEPLOY_ENV=production で DATA_SOURCE=sample は使用できません');
  }

  return { deployEnv: rawDeployEnv, dataSource: rawDataSource };
}

function isDeployEnv(value: string): value is DeployEnv {
  return (DEPLOY_ENVS as readonly string[]).includes(value);
}

function isDataSource(value: string): value is DataSource {
  return (DATA_SOURCES as readonly string[]).includes(value);
}
