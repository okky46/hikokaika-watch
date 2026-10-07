import type { CaseDetail } from './types';
import { OBSERVATION_KIND } from './watchHistory.ts';

/** Public record labels let a returning reader identify a change before opening a case. */
export function watchWorkspaceCase(c:CaseDetail){
  const observations=c.tracking?.observations??[];
  const records=[
    ...observations.map(o=>({key:`observation-${o.id}`,title:o.title,text:o.facts,kind:OBSERVATION_KIND[o.kind],when:o.occurred_on||o.date_note,recorded:o.updated_at})),
    ...c.events.map(e=>({key:`event-${e.id}`,title:e.title,text:e.summary,kind:'報道・開示',when:e.dateLabel,recorded:e.updatedAt||e.sitePublishedAt||''})),
  ].sort((a,b)=>b.recorded.localeCompare(a.recorded));
  return {id:c.id,slug:c.slug,name:c.companyName,code:c.securityCode,manifest:c.watch,
    reason:c.tracking?.short_reason||c.trackingReason,checkedOn:c.lastCheckedOn,
    status:c.tracking?.status_note||c.summary,records,
    origins:observations.filter(o=>o.kind==='origin').length};
}
export type WorkspaceCase=ReturnType<typeof watchWorkspaceCase>;
