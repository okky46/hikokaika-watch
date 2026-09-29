import type { APIRoute } from 'astro';
import { loadPublicData } from '../../lib/publicData';
export const GET: APIRoute = async () => {
  const data = await loadPublicData();
  return new Response(JSON.stringify({ generatedAt:data.generatedAt,
    articles:data.articles.map(a => ({id:a.id,slug:a.slug,version:a.publicationVersion})),
    cases:data.cases.map(c => ({id:c.id,slug:c.slug,updatedAt:c.lastUpdatedAt,version:c.publicationVersion}))
  }), { headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache'} });
};
