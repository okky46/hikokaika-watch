type Env = {
  CF_ANALYTICS_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_SITE_TAG?: string;
  CF_ANALYTICS_HOST?: string;
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
};
type PagesContext = { request: Request; env: Env };
const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const PUBLIC_UPSTREAM_ERROR = 'アクセス統計を取得できませんでした。設定と権限を確認してください。';
const PRIVATE_HEADERS = { 'cache-control': 'private, no-store', vary: 'Authorization' };
function timeHoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function readMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export async function queryCloudflare(env: Env) {
  const token = env.CF_ANALYTICS_API_TOKEN;
  const accountTag = env.CF_ACCOUNT_ID;
  const siteTag = env.CF_ANALYTICS_SITE_TAG;
  const host = env.CF_ANALYTICS_HOST || 'hikokaika.com';
  if (!token || !accountTag || !siteTag) {
    return { status: 503, body: { error: 'アクセス統計のサーバー側設定が未完了です。' } };
  }
  const end = new Date();
  const since7 = timeHoursAgo(end, 168);
  const since30 = timeHoursAgo(end, 720);
  const until = end.toISOString();
  // RUM uses account/site scopes. Zone HTTP traffic includes non-page requests.
  const query = `query WebAnalytics($accountTag: string!, $siteTag: string!, $host: string!, $since7: Time!, $since30: Time!, $until: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        last7: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since7, datetime_lt: $until, siteTag: $siteTag, requestHost: $host }) {
          count sum { visits }
        }
        last30: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { datetime_geq: $since30, datetime_lt: $until, siteTag: $siteTag, requestHost: $host }) {
          count sum { visits }
        }
        topUrls: rumPageloadEventsAdaptiveGroups(limit: 20, orderBy: [count_DESC], filter: { datetime_geq: $since30, datetime_lt: $until, siteTag: $siteTag, requestHost: $host }) {
          dimensions { requestPath }
          count
        }
      }
    }
  }`;
  let response: Response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { accountTag, siteTag, host, since7, since30, until } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    console.error('Cloudflare Analytics request failed');
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    console.error('Cloudflare Analytics returned non-JSON', { status: response.status });
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  if (!response.ok || !isRecord(json) || (Array.isArray(json.errors) && json.errors.length > 0)) {
    console.error('Cloudflare Analytics returned an error', { status: response.status });
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  const accounts = isRecord(json.data) && isRecord(json.data.viewer) ? json.data.viewer.accounts : null;
  if (!Array.isArray(accounts) || accounts.length !== 1 || !isRecord(accounts[0])) {
    console.error('Cloudflare Analytics returned no account');
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  const account = accounts[0];
  const summaries = ['last7', 'last30'].map((key) => {
    const groups = account[key];
    if (!Array.isArray(groups) || groups.length > 1) return null;
    if (groups.length === 0) return { pageViews: 0, visits: 0 };
    const group = groups[0];
    if (!isRecord(group) || !isRecord(group.sum)) return null;
    const pageViews = readMetric(group.count);
    const visits = readMetric(group.sum.visits);
    return pageViews === null || visits === null ? null : { pageViews, visits };
  });
  if (summaries.some((summary) => summary === null) || !Array.isArray(account.topUrls)) {
    console.error('Cloudflare Analytics returned an unexpected data shape');
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  const topUrls = [] as { url: string; pageViews: number }[];
  for (const group of account.topUrls) {
    if (!isRecord(group) || !isRecord(group.dimensions) || typeof group.dimensions.requestPath !== 'string') {
      return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
    }
    const pageViews = readMetric(group.count);
    if (pageViews === null) return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
    topUrls.push({ url: group.dimensions.requestPath, pageViews });
  }
  return { status: 200, body: { summary: { last7Days: summaries[0], last30Days: summaries[1] }, topUrls, generatedAt: until } };
}
export async function onRequest(context: PagesContext): Promise<Response> {
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: PRIVATE_HEADERS });
  if (context.request.method !== 'GET') return reply({ error: 'Method Not Allowed' }, 405);
  const authorization = context.request.headers.get('authorization');
  if (!authorization?.match(/^Bearer \S+$/)) return reply({ error: '管理者としてログインしてください。' }, 401);
  const url = context.env.PUBLIC_SUPABASE_URL;
  const anonKey = context.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return reply({ error: '管理者確認のサーバー側設定が未完了です。' }, 503);
  // PostgREST verifies the user's JWT; is_admin checks the existing admin table.
  // No service role key is used for authorization.
  try {
    const admin = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: { authorization, apikey: anonKey, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
    });
    if (admin.status === 401) return reply({ error: '管理者としてログインし直してください。' }, 401);
    if (!admin.ok) return reply({ error: '管理者権限を確認できませんでした。' }, 502);
    if (await admin.json() !== true) return reply({ error: '管理者権限が必要です。' }, 403);
  } catch {
    return reply({ error: '管理者権限を確認できませんでした。' }, 502);
  }
  const result = await queryCloudflare(context.env);
  return reply(result.body, result.status);
}
