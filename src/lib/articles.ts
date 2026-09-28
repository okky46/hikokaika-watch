import { safeHttpUrl } from './tracking.ts';

export interface ArticleSource { name: string; url: string; published_on: string; checked_on: string }

/** 出典欄の区切り文字と、文字としての |・バックスラッシュ・改行を区別する。 */
export function formatArticleSources(sources: ArticleSource[]): string {
  const escape = (value: string) => value.replace(/[\\|\n\r]/g, ch => ({'\\':'\\\\','|':'\\|','\n':'\\n','\r':'\\r'}[ch]!));
  return sources.map(s => [s.name,s.url,s.published_on,s.checked_on].map(escape).join(' | ')).join('\n');
}

export function parseArticleSources(text: string): ArticleSource[] {
  const escapes: Record<string,string> = {'\\':'\\','|':'|',n:'\n',r:'\r'};
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const parts = [''];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\' && Object.hasOwn(escapes, line[i+1])) parts[parts.length-1] += escapes[line[++i]];
      else if (ch === '|') parts.push('');
      else parts[parts.length-1] += ch;
    }
    if (parts.length !== 4) throw new Error('出典は1行4項目を | で区切ってください（文字としての | は \\|）');
    const [name,url,published_on,checked_on] = parts.map(v => v.trim());
    return {name,url,published_on,checked_on};
  });
}

export interface ArticleContent {
  title: string; summary: string; body: string; confirmed_facts: string;
  interpretation: string; unknowns: string; checked_on: string; correction_note: string;
  sources: ArticleSource[];
}
export interface RawArticle {
  id: string; slug: string; published: ArticleContent | null; publication_version: string | null;
  first_published_at: string | null; published_at: string | null;
}
export interface ArticleLink { article_id: string; company_id: string; edition: 'draft' | 'published' }
export interface PublicArticle extends ArticleContent {
  id: string; slug: string; publicationVersion: string; firstPublishedAt: string; publishedAt: string;
  companies: { id: string; securityCode: string; nameJa: string }[];
}
export const emptyArticle = (): ArticleContent => ({ title: '', summary: '', body: '', confirmed_facts: '', interpretation: '', unknowns: '', checked_on: '', correction_note: '', sources: [] });

const validDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;

/** JSON取込と公開ビルドで同じホワイトリストを使い、内部メモ・任意HTMLを流さない。 */
export function parseArticleContent(value: unknown, publish = false): ArticleContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('記事はJSONオブジェクトで指定してください');
  const source = value as Record<string, unknown>;
  const result = emptyArticle();
  for (const key of ['title','summary','body','confirmed_facts','interpretation','unknowns','checked_on','correction_note'] as const) {
    if (typeof source[key] !== 'string') throw new Error(`${key} は文字列で指定してください`);
    result[key] = source[key].trim();
  }
  if (result.title.length > 240 || result.body.length > 50000 || Object.values(result).some(v => typeof v === 'string' && v.length > 50000)) throw new Error('記事の文字数が上限を超えています');
  if (result.checked_on && !validDate(result.checked_on)) throw new Error('確認日はYYYY-MM-DDで指定してください');
  if (!Array.isArray(source.sources) || source.sources.length > 30) throw new Error('出典は30件以下の配列で指定してください');
  result.sources = source.sources.map((s: unknown) => {
    if (!s || typeof s !== 'object') throw new Error('出典の形式を確認してください');
    const v = s as Record<string, unknown>;
    if (typeof v.name !== 'string' || !v.name.trim() || typeof v.url !== 'string' || !safeHttpUrl(v.url)) throw new Error('出典名とhttp(s)のURLが必要です');
    if (typeof v.published_on !== 'string' || (v.published_on && !validDate(v.published_on)) || !validDate(v.checked_on)) throw new Error('出典の日付を確認してください（公表日不明は空欄）');
    return { name: v.name.trim(), url: safeHttpUrl(v.url)!, published_on: v.published_on as string, checked_on: v.checked_on as string };
  });
  if (publish && (!result.title || !result.summary || !result.confirmed_facts || !result.checked_on || !result.sources.length)) throw new Error('公開にはタイトル・要約・確認できた事実・確認日・出典が必要です');
  return result;
}

export function assembleArticles(rows: RawArticle[], links: ArticleLink[], companies: {id:string; securityCode:string; nameJa:string}[]): PublicArticle[] {
  const companyById = new Map(companies.map(c => [c.id,c]));
  return rows.filter(r => r.published !== null).map(r => {
    if (!r.publication_version || !r.published_at || !r.first_published_at) throw new Error(`記事 ${r.slug} の公開版情報が不完全です`);
    return { ...parseArticleContent(r.published, true), id:r.id, slug:r.slug, publicationVersion:r.publication_version, firstPublishedAt:r.first_published_at, publishedAt:r.published_at,
      companies: links.filter(l => l.article_id === r.id && l.edition === 'published').flatMap(l => companyById.has(l.company_id) ? [companyById.get(l.company_id)!] : []) };
  }).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt));
}

export interface ResearchDraft { version: 1; kind: 'article'; slug: string; company_codes: string[]; content: ArticleContent }
export function parseResearchDraft(value: unknown): ResearchDraft {
  const v = value as Partial<ResearchDraft> | null;
  if (!v || v.version !== 1 || v.kind !== 'article' || typeof v.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug)) throw new Error('version:1 / kind:article / 英小文字と数字・ハイフンのslugが必要です');
  if (!Array.isArray(v.company_codes) || !v.company_codes.every(c => typeof c === 'string' && /^[0-9A-Z]{4}$/.test(c))) throw new Error('company_codesは4桁の証券コード文字列の配列にしてください');
  return {version:1, kind:'article', slug:v.slug, company_codes:[...new Set(v.company_codes)], content:parseArticleContent(v.content)};
}
