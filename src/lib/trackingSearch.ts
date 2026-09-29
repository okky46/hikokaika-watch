import { matchesDate, timelineDateKey } from './trackingDates.ts';
import type { PublicEventDate } from './trackingDates.ts';
import { PUBLIC_TRACKING_STATUS, validDate } from './trackingProfile.ts';
import type { TrackingStage, PublicTrackingStatus } from './trackingProfile.ts';

export interface SearchEvent { id: string; title: string; date: PublicEventDate }
export interface SearchCase {
  id: string; code: string; name: string; reason: string; media: string[];
  aliases?: string[];
  stage: TrackingStage | 'unreviewed'; status: PublicTrackingStatus | 'unreviewed'; statementTags: string[];
  registeredOn: string; updatedAt: string; events: SearchEvent[];
}
export interface SearchFilters {
  q: string; media: string[]; stage: string; status: string; statement: string;
  from: string; to: string; includeIssues: boolean; sort: 'event' | 'registered' | 'updated' | 'code';
}
export const defaultSearch = (): SearchFilters => ({ q:'', media:[], stage:'', status:'', statement:'', from:'', to:'', includeIssues:false, sort:'event' });
export const normalizeQuery = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('ja');
/** Published titles can contain the full name while the displayed company name is abbreviated. */
export function companySearchAliases(name: string, title: string): string[] {
  return [...new Set([title, name.replace(/HD$/i, 'ホールディングス'), name.replace(/ホールディングス$/, 'HD')])];
}
export const STATEMENT_FILTERS = {
  proposal_received:'提案受領', consideration_acknowledged:'検討に言及', strategic_options_under_review:'選択肢を検討',
  discussions_ongoing:'協議に言及', no_decision:'決定事実なし', not_under_consideration:'検討を否定',
  report_denied:'報道内容を否定', comment_declined:'回答差し控え', not_company_announcement:'会社の発表ではない', other:'その他',
} as const;
export function readSearch(search: string, allowedMedia: string[]): { filters: SearchFilters; ignored: boolean } {
  const p = new URLSearchParams(search); const f = defaultSearch(); let ignored = false;
  f.q=(p.get('q') ?? '').slice(0,150);
  f.media=[...new Set(p.getAll('media'))].filter(m => { const ok=allowedMedia.includes(m); if(!ok)ignored=true; return ok; });
  if(f.media.includes('none') && f.media.length>1) { f.media=['none']; ignored=true; }
  for(const [key,allowed] of [['stage',['pre','post','closed','unreviewed']],['status',[...Object.keys(PUBLIC_TRACKING_STATUS),'unreviewed']],['statement',Object.keys(STATEMENT_FILTERS)],['sort',['event','registered','updated','code']]] as const) {
    const v=p.get(key); if(v && (allowed as readonly string[]).includes(v)) (f as unknown as Record<string,unknown>)[key]=v; else if(v)ignored=true;
  }
  for(const k of ['from','to'] as const) { const v=p.get(k); if(v && validDate(v)) f[k]=v; else if(v)ignored=true; }
  if(f.from && f.to && f.from>f.to) { f.from=''; f.to=''; ignored=true; }
  f.includeIssues=p.get('issues')==='1';
  if(p.has('issues') && !['0','1'].includes(p.get('issues')!))ignored=true;
  const keys=new Set(['q','media','stage','status','statement','sort','from','to','issues']);
  for(const k of p.keys()) if(!keys.has(k)) ignored=true;
  return {filters:f,ignored};
}
/** Personal filters deliberately have no representation in the shareable URL. */
export function searchParams(f: SearchFilters): string {
  const p=new URLSearchParams();
  for(const k of ['q','stage','status','statement','from','to'] as const) if(f[k])p.set(k,f[k]);
  for(const m of [...f.media].sort())p.append('media',m);
  if(f.includeIssues)p.set('issues','1'); if(f.sort!=='event')p.set('sort',f.sort);
  return p.toString();
}
export function matchingEvents(c: SearchCase, f: SearchFilters): SearchEvent[] {
  return c.events.filter(e => matchesDate(e.date,f.from,f.to,f.includeIssues));
}
export function matchesCase(c: SearchCase, f: SearchFilters, withoutMedia = false): boolean {
  const q=normalizeQuery(f.q);
  return (!q || normalizeQuery(`${c.code} ${c.name} ${(c.aliases ?? []).join(' ')} ${c.reason}`).includes(q)) &&
    (!f.stage || c.stage===f.stage) && (!f.status || c.status===f.status) &&
    (!f.statement || c.statementTags.includes(f.statement)) &&
    (withoutMedia || !f.media.length || f.media.some(m=>c.media.includes(m))) &&
    ((!f.from && !f.to) || matchingEvents(c,f).length>0);
}
export function latestDatedEvent(c: Pick<SearchCase,'events'>): SearchEvent | null {
  return c.events.filter(e=>!!e.date.start).sort((a,b)=>timelineDateKey(b.date).localeCompare(timelineDateKey(a.date)) || a.id.localeCompare(b.id))[0] ?? null;
}
export function compareCases(a: SearchCase, b: SearchCase, sort: SearchFilters['sort']): number {
  const stable=()=>a.code.localeCompare(b.code,'en') || a.id.localeCompare(b.id);
  if(sort==='code')return stable();
  if(sort==='updated')return b.updatedAt.localeCompare(a.updatedAt) || stable();
  if(sort==='registered')return b.registeredOn.localeCompare(a.registeredOn) || stable();
  const ae=latestDatedEvent(a),be=latestDatedEvent(b);
  const ad=ae?timelineDateKey(ae.date):'',bd=be?timelineDateKey(be.date):'';
  return bd.localeCompare(ad) || (!ad && !bd ? b.registeredOn.localeCompare(a.registeredOn) : 0) || stable();
}
