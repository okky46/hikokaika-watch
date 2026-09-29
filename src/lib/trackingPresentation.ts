import { TRACKING_STATUS } from './trackingProfile';
import type { TrackingProfile, MediaOutlet } from './trackingProfile';
export const escapeTrackingText=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Shared by the public detail and the unsaved admin preview. All content is escaped. */
export function trackingSummaryHtml(p:TrackingProfile, media:Pick<MediaOutlet,'id'|'name'>[]):string {
  const esc=escapeTrackingText;
  const labels=p.report_state==='none'?['報道なし']:p.report_state==='unreviewed'?['媒体を確認中']:[...new Set(p.reports.map(r=>media.find(m=>m.id===r.outlet_id)?.name ?? '媒体未特定'))];
  const status=TRACKING_STATUS[p.public_status];
  return `<div class="media-chips">${labels.map(label=>`<span class="media-chip">${esc(label)}</span>`).join('')}</div><p>${esc(p.short_reason)}</p><div class="tracking-current"><span class="badge badge--${status.tone}">${status.label}</span>${p.status_note?`<p class="status-note">${esc(p.status_note)}</p>`:''}</div>`;
}
