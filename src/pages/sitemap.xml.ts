// 依存追加なしの手書きサイトマップ。
// ユーザー専用ページ(/mypage)・管理画面(/admin)は含めない(要件 §17)。
import type { APIRoute } from 'astro';
import { loadPublicData } from '../lib/publicData';

export const GET: APIRoute = async ({ site }) => {
  const base = (site ?? new URL('https://hikokaika-watch.pages.dev')).href.replace(/\/$/, '');
  const data = await loadPublicData();

  const staticPaths = ['/', '/guidelines/', '/disclaimer/', '/privacy/'];
  const casePaths = data.details.map((d) => ({
    path: `/cases/${d.slug}/`,
    lastmod: d.lastUpdatedAt,
  }));

  const companyPaths = data.companies.map((c) => ({ path: `/companies/${c.securityCode}/`, lastmod: c.lastUpdatedAt ?? data.generatedAt }));

  const urls = [
    ...staticPaths.map((p) => `  <url><loc>${base}${p}</loc></url>`),
    ...casePaths.map(
      (c) =>
        `  <url><loc>${base}${c.path}</loc><lastmod>${new Date(c.lastmod).toISOString()}</lastmod></url>`,
    ),
    ...companyPaths.map(
      (c) =>
        `  <url><loc>${base}${c.path}</loc><lastmod>${new Date(c.lastmod).toISOString()}</lastmod></url>`,
    ),
  ].join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
