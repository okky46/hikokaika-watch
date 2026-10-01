import { BIDDING_STAGE, PUBLIC_TRACKING_STATUS, publicTrackingStatus, validDate } from './trackingProfile.ts';
import type { TrackingProfile } from './trackingProfile.ts';
import type { PublicEventDate } from './trackingDates.ts';
import { jstToday } from './trackingDates.ts';

export interface TrackingActivity {
  latestOn: string | null;
  undated: boolean;
}

/** Month/issue/unknown dates cannot establish a precise quiet period. */
export function trackingActivity(dates: PublicEventDate[]): TrackingActivity {
  return {
    latestOn: dates.flatMap(d => d.start && ['date','datetime'].includes(d.precision) ? [d.start] : []).sort().at(-1) ?? null,
    undated: dates.some(d => !['date','datetime'].includes(d.precision)),
  };
}

export function trackingVisual(profile: TrackingProfile | null, activity?: TrackingActivity, today = jstToday()) {
  const key = profile ? publicTrackingStatus(profile) : 'unreviewed';
  const status = key === 'unreviewed' ? null : PUBLIC_TRACKING_STATUS[key];
  const bidding = profile?.bidding;
  let tone = 'neutral';
  if (key === 'rumor') tone = profile?.rumor_strength === 'strong' ? 'rumor_strong' : profile?.rumor_strength === 'medium' ? 'rumor_medium' : 'rumor';
  if (key === 'reported') tone = 'reported';
  // Receiving a proposal or merely commenting is not an acknowledgement of consideration.
  const acknowledged = ['consideration','discussions'].includes(key);
  if (['proposal','comment'].includes(key) && profile?.report_state === 'reported') tone = 'reported';
  if (acknowledged) tone = 'process';
  if (status?.stage === 'post') tone = 'announced';
  if (key === 'privatized' || key === 'delisted') tone = 'complete';
  if (['consideration_denied','report_denied','consideration_ended','withdrawn','failed'].includes(key)) tone = 'stopped';
  const activeBidding = bidding && profile?.report_state === 'reported' && ['reported','proposal','consideration','discussions','comment'].includes(key) ? bidding : null;
  if (activeBidding) tone = acknowledged ? activeBidding.stage : `reported_${activeBidding.stage}`;
  const eligible = ['reported','proposal','consideration','discussions','comment','rumor'].includes(key);
  const days = quietDays(activity, eligible, today);
  const stale = days !== null;
  return {
    label: status?.label ?? '状況を確認中',
    processLabel: activeBidding ? BIDDING_STAGE[activeBidding.stage] : '',
    tone, stale, eligible,
    staleLabel: stale ? `続報未確認・${days}日` : '',
  };
}

export function quietDays(activity: TrackingActivity | undefined, eligible: boolean, today = jstToday()): number | null {
  if (!eligible || !activity || activity.undated || !activity.latestOn || !validDate(activity.latestOn) || !validDate(today)) return null;
  const days = Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(activity.latestOn+'T00:00:00Z'))/86400000);
  return days > 180 ? days : null;
}

/** Only verified report evidence establishes a first report, never a company reply date. */
export function firstReportLabel(profile: TrackingProfile | null, fallback: string | null, reportEvents: {id:string;date:PublicEventDate}[] = []): { label: string; date: string | null; uncertain: boolean } {
  if (!profile) return { label:'初報：確認中', date:null, uncertain:true };
  if (profile.report_state !== 'reported') return { label:'初報：未確認', date:null, uncertain:true };
  const datesById = new Map(reportEvents.filter(e=>['date','datetime'].includes(e.date.precision)).map(e=>[e.id,e.date.start]));
  const evidenceDates = profile.reports.map(r=>validDate(r.reported_on) ? r.reported_on : datesById.get(r.event_id) ?? '');
  const dates = evidenceDates.filter(validDate).sort();
  const uncertain = evidenceDates.some(d=>!validDate(d)) || reportEvents.some(e=>!['date','datetime'].includes(e.date.precision));
  const fallbackDay = fallback && Number.isFinite(Date.parse(fallback)) ? jstToday(new Date(fallback)) : null;
  const date = [...dates, ...(fallbackDay ? [fallbackDay] : [])].sort()[0] ?? null;
  if (!date) return { label:'初報日：未確認', date:null, uncertain:true };
  return { label:uncertain ? '日付確認済みの最初の報道' : '初報', date, uncertain };
}
