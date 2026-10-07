import {createHash} from 'node:crypto';
import type {CaseEventView} from './types';
import type {TrackingProfile} from './trackingProfile';
import type {WatchManifest} from './watchReadState';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
export function watchManifest(profile:TrackingProfile|null,events:CaseEventView[],reason:string,status:string):WatchManifest{
  const {observations=[],...summary}=profile??{};
  const entries:WatchManifest={'summary':digest({summary,reason,status})};
  for(const e of events){const {updatedAt,sitePublishedAt,...content}=e;entries[`event-${e.id}`]=digest(content);}
  for(const o of observations){const {updated_at,...content}=o;entries[`observation-${o.id}`]=digest(content);}
  return entries;
}
