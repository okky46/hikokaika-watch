import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequest, queryCloudflare } from '../functions/api/analytics.ts';

const env = {
  PUBLIC_SUPABASE_URL: 'https://example.supabase.co', PUBLIC_SUPABASE_ANON_KEY: 'public-anon',
  CF_ANALYTICS_API_TOKEN: 'private-analytics', CF_ACCOUNT_ID: 'account', CF_ANALYTICS_SITE_TAG: 'site',
};
const request = (token, method = 'GET') => new Request('https://hikokaika.com/api/analytics', {
  method, headers: token ? { authorization: `Bearer ${token}` } : {},
});
const payload = (last7 = [], last30 = [], topUrls = []) => ({ data: { viewer: { accounts: [{ last7, last30, topUrls }] } } });

test('analytics denies anonymous, invalid and non-admin users before Cloudflare is queried', async () => {
  const originalFetch = globalThis.fetch;
  let calls = [];
  try {
    globalThis.fetch = async url => { calls.push(url); throw new Error('unexpected upstream access'); };
    const anonymous = await onRequest({ request: request(), env });
    assert.equal(anonymous.status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await onRequest({ request: request('user', 'POST'), env })).status, 405);
    for (const [response, expected] of [
      [new Response('false'), 403], [new Response('unauthorized', { status: 401 }), 401],
      [new Response('null'), 403], [new Response('true', { status: 500 }), 502],
    ]) {
      calls = [];
      globalThis.fetch = async url => { calls.push(url); return response; };
      const result = await onRequest({ request: request('user'), env });
      assert.equal(result.status, expected);
      assert.deepEqual(calls, ['https://example.supabase.co/rest/v1/rpc/is_admin']);
      assert.match(result.headers.get('cache-control'), /private, no-store/);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('analytics checks the current user via existing admin RPC and handles a genuine zero-traffic period', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(url.includes('supabase') ? 'true' : JSON.stringify(payload()));
    };
    const result = await onRequest({ request: request('user-session'), env });
    assert.equal(result.status, 200);
    assert.equal(calls[0].init.headers.authorization, 'Bearer user-session');
    assert.equal(calls[0].init.headers.apikey, 'public-anon');
    assert.equal(calls[1].init.headers.authorization, 'Bearer private-analytics');
    const submitted = JSON.parse(calls[1].init.body);
    assert.equal(submitted.variables.siteTag, 'site');
    assert.equal(submitted.variables.host, 'hikokaika.com');
    const json = await result.json();
    assert.deepEqual(json.summary.last30Days, { pageViews: 0, visits: 0 });
    assert.deepEqual(json.topUrls, []);
    assert.equal(result.headers.get('vary'), 'Authorization');
    assert.doesNotMatch(JSON.stringify(json), /private-analytics|user-session/);
  } finally { globalThis.fetch = originalFetch; }
});

test('analytics rejects incomplete/negative metric data rather than showing misleading zeros', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const data of [
      payload([{ count: -1, sum: { visits: 0 } }]),
      payload([{ count: 1, sum: {} }]),
      payload([], [], [{ dimensions: { requestPath: '/' }, count: -1 }]),
    ]) {
      globalThis.fetch = async () => new Response(JSON.stringify(data));
      assert.equal((await queryCloudflare(env)).status, 502);
    }
  } finally { globalThis.fetch = originalFetch; }
});
