type Env = {
  CF_ANALYTICS_API_TOKEN?: string;
  CF_ZONE_TAG?: string;
};

type PagesContext = { request: Request; env: Env };

const GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const PUBLIC_UPSTREAM_ERROR = 'アクセス統計を取得できませんでした。設定と権限を確認してください。';

function timeHoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMetric(value: unknown, metric: 'pageViews' | 'visits'): number | null {
  if (!isRecord(value) || typeof value[metric] !== 'number') return null;
  return value[metric] as number;
}

export async function queryCloudflare(env: Env) {
  const token = env.CF_ANALYTICS_API_TOKEN;
  const zoneTag = env.CF_ZONE_TAG;
  if (!token || !zoneTag) {
    return { status: 503, body: { error: 'アクセス統計のサーバー側設定が未完了です。' } };
  }

  const end = new Date();
  const since7 = timeHoursAgo(end, 168);
  const since30 = timeHoursAgo(end, 720);
  const until = end.toISOString();
  const query = `query WebAnalytics($zoneTag: string!, $since7: Time!, $since30: Time!, $until: Time!) {
    viewer {
      zones(filter: { zoneTag: $zoneTag }) {
        last7: httpRequestsAdaptiveGroups(filter: { datetime_geq: $since7, datetime_lt: $until, requestSource: "eyeball" }) {
          sum { pageViews visits }
        }
        last30: httpRequestsAdaptiveGroups(filter: { datetime_geq: $since30, datetime_lt: $until, requestSource: "eyeball" }) {
          sum { pageViews visits }
        }
        topUrls: httpRequestsAdaptiveGroups(
          limit: 20
          orderBy: [sum_pageViews_DESC]
          filter: { datetime_geq: $since30, datetime_lt: $until, requestSource: "eyeball" }
        ) {
          dimensions { clientRequestPath }
          sum { pageViews }
        }
      }
    }
  }`;

  let response: Response;
  try {
    response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { zoneTag, since7, since30, until } }),
    });
  } catch (error) {
    console.error('Cloudflare Analytics request failed', error);
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    console.error('Cloudflare Analytics returned non-JSON', { status: response.status, error });
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  if (!response.ok || !isRecord(json) || Array.isArray(json.errors)) {
    console.error('Cloudflare Analytics returned an error', { status: response.status, hasGraphqlErrors: isRecord(json) && Array.isArray(json.errors) });
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }

  const zones = isRecord(json.data) && isRecord(json.data.viewer) ? json.data.viewer.zones : null;
  if (!Array.isArray(zones) || zones.length === 0 || !isRecord(zones[0])) {
    console.error('Cloudflare Analytics returned no zone', { zoneCount: Array.isArray(zones) ? zones.length : null });
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  const zone = zones[0];
  const summaries = ['last7', 'last30'].map((key) => {
    const groups = zone[key];
    if (!Array.isArray(groups) || groups.length !== 1 || !isRecord(groups[0])) return null;
    const pageViews = readMetric(groups[0].sum, 'pageViews');
    const visits = readMetric(groups[0].sum, 'visits');
    return pageViews === null || visits === null ? null : { pageViews, visits };
  });
  const topUrlGroups = zone.topUrls;
  if (summaries.some((summary) => summary === null) || !Array.isArray(topUrlGroups)) {
    console.error('Cloudflare Analytics returned an unexpected data shape');
    return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
  }
  const topUrls = [] as { url: string; pageViews: number }[];
  for (const group of topUrlGroups) {
    if (!isRecord(group) || !isRecord(group.dimensions) || typeof group.dimensions.clientRequestPath !== 'string') {
      console.error('Cloudflare Analytics returned an invalid URL group');
      return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
    }
    const pageViews = readMetric(group.sum, 'pageViews');
    if (pageViews === null) {
      console.error('Cloudflare Analytics returned an invalid URL metric');
      return { status: 502, body: { error: PUBLIC_UPSTREAM_ERROR } };
    }
    topUrls.push({ url: group.dimensions.clientRequestPath, pageViews });
  }
  return { status: 200, body: { summary: { last7Days: summaries[0], last30Days: summaries[1] }, topUrls } };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const result = await queryCloudflare(context.env);
  return Response.json(result.body, { status: result.status });
}
