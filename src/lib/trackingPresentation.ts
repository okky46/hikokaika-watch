import { trackingVisual } from './trackingVisual';
import {OBSERVATION_KIND,OBSERVATION_OUTCOME} from './watchHistory';
import type { TrackingProfile, MediaOutlet } from './trackingProfile';
export const escapeTrackingText=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Shared by the public detail and the unsaved admin preview. All content is escaped. */
export function trackingSummaryHtml(p:TrackingProfile, media:Pick<MediaOutlet,'id'|'name'>[]):string {
  const esc=escapeTrackingText;
  const labels=p.report_state==='none'?['報道なし']:p.report_state==='unreviewed'?['媒体を確認中']:[...new Set(p.reports.map(r=>media.find(m=>m.id===r.outlet_id)?.name ?? '媒体未特定'))];
  const status=trackingVisual(p);
  const history=(p.observations??[]).map(o=>`<article class="card section"><p>${OBSERVATION_KIND[o.kind]} ／ ${esc(o.occurred_on||o.date_note)} ／ ${OBSERVATION_OUTCOME[o.outcome]}</p><h4>${esc(o.title)}</h4><p>観測した事実：${esc(o.facts)}</p>${o.interpretation?`<p>見立て：${esc(o.interpretation)}</p>`:''}<p class="small">記録 ${esc(o.recorded_at)} ／ ${esc(o.observer)}${o.source_name?` ／ 出典：${esc(o.source_name)}`:''}</p>${o.price!==null?`<p>株価 ${o.price}円（${esc(o.price_on)}）</p>`:''}</article>`).join('');
  return `<div class="media-chips">${labels.map(label=>`<span class="media-chip">${esc(label)}</span>`).join('')}</div><p>${esc(p.short_reason)}</p><div class="tracking-current"><span class="badge tracking-badge tracking-badge--${status.tone}">${status.label}</span>${status.processLabel?`<span class="small">${status.processLabel}</span>`:''}${p.status_note?`<p class="status-note">${esc(p.status_note)}</p>`:''}</div>${history}`;
}
