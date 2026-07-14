// 公開案件の最小情報を静的JSONとして配信する。
// マイページ(お気に入り一覧)が case_id から会社名・URLを解決するために使う。
// Cloudflare から配信される静的ファイルであり、閲覧時に Supabase へはアクセスしない。
import type { APIRoute } from 'astro';
import { loadPublicData } from '../../lib/publicData';

export const GET: APIRoute = async () => {
  const data = await loadPublicData();
  const items = data.cases.map((c) => ({
    id: c.id,
    slug: c.slug,
    securityCode: c.securityCode,
    companyName: c.companyName,
    title: c.title,
    status: c.status,
    lastUpdatedAt: c.lastUpdatedAt,
  }));

  return new Response(JSON.stringify({ generatedAt: data.generatedAt, cases: items }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
