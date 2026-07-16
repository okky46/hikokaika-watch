type Env = {
  CF_ANALYTICS_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_ZONE_TAG?: string;
};

type PagesContext = { request: Request; env: Env };

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function queryCloudflare(env: Env) {
  const token = env.CF_ANALYTICS_API_TOKEN;
  const zoneTag = env.CF_ZONE_TAG;
  if (!token || !zoneTag) {
    return { status: 503, body: { error: 'Cloudflare Analytics 用のサーバー側環境変数が未設定です。' } };
  }

  const since30 = isoDaysAgo(30);
  const since7 = isoDaysAgo(7);
  const until = isoDaysAgo(0);
  const query = `query WebAnalytics($zoneTag: string!, $since7: Date!, $since30: Date!, $until: Date!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        last7: httpRequests1dGroups(limit: 7, filter: { date_geq: $since7, date_leq: $until }) { sum { pageViews requests } }
        last30: httpRequests1dGroups(limit: 30, filter: { date_geq: $since30, date_leq: $until }) { sum { pageViews requests } }
        topUrls: httpRequestsAdaptiveGroups(limit: 20, orderBy: [sum_pageViews_DESC], filter: { date_geq: $since30, date_leq: $until }) {
          dimensions { clientRequestPath }
          sum { pageViews }
        }
      }
    }
  }`;
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { zoneTag, since7, since30, until } }),
  });
  const json: any = await res.json();
  if (!res.ok || json.errors) {
    return { status: 502, body: { error: 'Cloudflare Analytics API の取得に失敗しました。', details: json.errors ?? json } };
  }
  const zone = json.data?.viewer?.zones?.[0];
  const sum = (groups: any[]) => groups.reduce((acc, g) => ({ pageViews: acc.pageViews + (g.sum?.pageViews ?? 0), visits: acc.visits + (g.sum?.requests ?? 0) }), { pageViews: 0, visits: 0 });
  return { status: 200, body: { summary: { last7Days: sum(zone?.last7 ?? []), last30Days: sum(zone?.last30 ?? []) }, topUrls: (zone?.topUrls ?? []).map((g: any) => ({ url: g.dimensions?.clientRequestPath ?? '/', pageViews: g.sum?.pageViews ?? 0 })) } };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const result = await queryCloudflare(context.env);
  return Response.json(result.body, { status: result.status });
}
