import type {
  CaseStatus,
  CommentTag,
  CompanyStance,
  DatePrecision,
  EventCategory,
  EventTagView,
  EventType,
  LegacyCaseStatus,
  ReportRole,
  RawEvent,
} from './types';

export function canonicalCaseStatus(status: LegacyCaseStatus | CaseStatus): CaseStatus {
  if (status === 'tracking' || status === 'closed') return status;
  if (status === 'announced' || status === 'completed' || status === 'withdrawn') return 'announced';
  if (status === 'rumored' || status === 'commented') return 'tracking';
  return 'closed';
}

export function legacyEventClassification(eventType: EventType): {
  eventCategory: EventCategory;
  reportRole: ReportRole | null;
} {
  switch (eventType) {
    case 'observation_report': return { eventCategory: 'media_report', reportRole: 'initial' };
    case 'follow_up_report': return { eventCategory: 'media_report', reportRole: 'follow_up' };
    case 'company_comment':
    case 'timely_disclosure':
    case 'consideration_ended': return { eventCategory: 'company_disclosure', reportRole: null };
    case 'formal_announcement': return { eventCategory: 'formal_announcement', reportRole: null };
    case 'price_revision':
    case 'tender_offer_result':
    case 'withdrawal': return { eventCategory: 'post_announcement_update', reportRole: null };
    case 'correction': return { eventCategory: 'correction', reportRole: null };
    default: return { eventCategory: 'related_information', reportRole: null };
  }
}

export function companyStanceFromLegacyTags(tags: readonly CommentTag[]): CompanyStance | null {
  const candidates = new Set<CompanyStance>();
  for (const tag of tags) {
    if (['consideration_acknowledged', 'proposal_received', 'discussions_ongoing'].includes(tag)) candidates.add('private_consideration');
    else if (tag === 'strategic_options_under_review') candidates.add('capital_policy');
    else if (tag === 'not_under_consideration' || tag === 'report_denied') candidates.add('denied');
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export interface ClassifiedEvent {
  id?: string;
  is_visible: boolean;
  event_category: EventCategory;
  report_role: ReportRole | null;
  company_stance: CompanyStance | null;
  occurred_at: string | null;
  sort_at?: string | null;
  sort_order?: number;
  site_published_at?: string | null;
  updated_at?: string | null;
  tags?: readonly EventTagView[];
}

/** 新カラムを優先し、移行前の行だけ旧 event_type/comment_tags から補完する。 */
export function classifyEvent(event: Pick<RawEvent,
  'id' | 'event_type' | 'event_category' | 'report_role' | 'company_stance' | 'comment_tags' |
  'occurred_at' | 'sort_at' | 'sort_order' | 'site_published_at' | 'updated_at' | 'is_visible'
> & { tags?: readonly EventTagView[] }): ClassifiedEvent {
  const legacy = legacyEventClassification(event.event_type);
  const eventCategory = event.event_category ?? legacy.eventCategory;
  return {
    id: event.id,
    is_visible: event.is_visible,
    event_category: eventCategory,
    report_role: event.report_role ?? (eventCategory === 'media_report' ? legacy.reportRole : null),
    company_stance: event.company_stance ?? (eventCategory === 'company_disclosure'
      ? companyStanceFromLegacyTags(event.comment_tags ?? []) : null),
    occurred_at: event.occurred_at,
    sort_at: event.sort_at,
    sort_order: event.sort_order,
    site_published_at: event.site_published_at,
    updated_at: event.updated_at,
    tags: event.tags,
  };
}

const time = (value?: string | null): number => value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
const chronological = (a: ClassifiedEvent, b: ClassifiedEvent) =>
  time(a.sort_at ?? a.occurred_at) - time(b.sort_at ?? b.occurred_at) ||
  (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
  time(a.site_published_at) - time(b.site_published_at) || time(a.updated_at) - time(b.updated_at);

export function reportCount(events: readonly ClassifiedEvent[]): number {
  return events.filter((e) => e.is_visible && e.event_category === 'media_report' && (e.report_role === 'initial' || e.report_role === 'follow_up')).length;
}

export function latestCompanyStance(events: readonly ClassifiedEvent[]): CompanyStance | null {
  return events.filter((e) => e.is_visible && e.event_category === 'company_disclosure' && e.company_stance !== null)
    .sort(chronological).at(-1)?.company_stance ?? null;
}

export function aggregateEventTags(events: readonly ClassifiedEvent[]): { sourceTags: EventTagView[]; contentTags: EventTagView[] } {
  const unique = new Map<string, EventTagView>();
  for (const event of events) if (event.is_visible) for (const tag of event.tags ?? []) unique.set(tag.id, tag);
  const sorted = [...unique.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ja'));
  return { sourceTags: sorted.filter((t) => t.kind === 'source'), contentTags: sorted.filter((t) => t.kind === 'content') };
}

export function firstReport(events: readonly ClassifiedEvent[]): ClassifiedEvent | null {
  return events.filter((e) => e.is_visible && e.event_category === 'media_report' && e.report_role === 'initial')
    .sort(chronological)[0] ?? null;
}

export function latestEvent(events: readonly ClassifiedEvent[]): ClassifiedEvent | null {
  const visible = events.filter((e) => e.is_visible);
  const nonCorrections = visible.filter((e) => e.event_category !== 'correction');
  return (nonCorrections.length ? nonCorrections : visible).sort(chronological).at(-1) ?? null;
}

export function deriveSortAt(input: Pick<ClassifiedEvent, 'occurred_at' | 'site_published_at' | 'updated_at'> & {
  market_trigger_date?: string | null; issue_year_month?: string | null;
}): string | null {
  return input.occurred_at ?? input.market_trigger_date ?? input.issue_year_month ?? input.site_published_at ?? input.updated_at ?? null;
}

export function eventDateParts(input: { date_precision: DatePrecision; occurred_at: string | null; issue_label?: string | null; market_trigger_date?: string | null }) {
  return {
    occurredAt: input.date_precision === 'datetime' || input.date_precision === 'date' ? input.occurred_at : null,
    showTime: input.date_precision === 'datetime',
    issueLabel: input.issue_label ?? null,
    marketTriggerDate: input.market_trigger_date ?? null,
    isUnknown: input.date_precision === 'unknown',
  };
}

export function baselineReturn(current: number | null | undefined, baseline: number | null | undefined): number | null {
  return Number.isFinite(current) && Number.isFinite(baseline) && current! > 0 && baseline! > 0 ? (current! - baseline!) / baseline! : null;
}

export function classificationErrors(events: readonly ClassifiedEvent[], options: { caseIsVisible?: boolean } = {}): string[] {
  const errors: string[] = [];
  const visibleInitials = events.filter((e) => e.is_visible && e.event_category === 'media_report' && e.report_role === 'initial');
  if (visibleInitials.length > 1) errors.push('公開済み初報は1案件につき1件までです');
  const visibleFollowUps = events.filter((e) => e.is_visible && e.event_category === 'media_report' && e.report_role === 'follow_up');
  if (visibleFollowUps.length > 0 && visibleInitials.length !== 1) errors.push('公開済み続報には公開済み初報が1件必要です');
  if (options.caseIsVisible && visibleInitials.length !== 1) errors.push('公開案件には公開済み初報が1件必要です');
  for (const event of events) {
    if (event.event_category === 'media_report' && event.report_role === null) errors.push('メディア報道には報道上の役割が必要です');
    if (event.event_category !== 'media_report' && event.report_role !== null) errors.push('メディア報道以外には報道上の役割を設定できません');
    if (event.event_category !== 'company_disclosure' && event.company_stance !== null) errors.push('会社開示以外には会社スタンスを設定できません');
  }
  return errors;
}
