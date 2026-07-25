import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateEventTags, baselineReturn, canonicalCaseStatus, classificationErrors,
  companyStanceFromLegacyTags, deriveSortAt, eventDateParts, firstReport,
  latestCompanyStance, latestEvent, legacyEventClassification, reportCount,
} from '../src/lib/classification.ts';

const event = (overrides = {}) => ({
  is_visible: true, event_category: 'media_report', report_role: 'initial', company_stance: null,
  occurred_at: '2026-01-01T00:00:00Z', sort_at: '2026-01-01T00:00:00Z', ...overrides,
});

describe('PR1 compatibility mappings', () => {
  it('maps every legacy status without automatically making an old case dormant', () => {
    assert.equal(canonicalCaseStatus('rumored'), 'tracking');
    assert.equal(canonicalCaseStatus('commented'), 'tracking');
    assert.equal(canonicalCaseStatus('completed'), 'announced');
    assert.equal(canonicalCaseStatus('withdrawn'), 'announced');
    assert.equal(canonicalCaseStatus('dormant'), 'closed');
  });
  it('maps collection candidate event types', () => {
    assert.deepEqual(legacyEventClassification('observation_report'), { eventCategory: 'media_report', reportRole: 'initial' });
    assert.deepEqual(legacyEventClassification('follow_up_report'), { eventCategory: 'media_report', reportRole: 'follow_up' });
    assert.equal(legacyEventClassification('large_shareholding_report').eventCategory, 'related_information');
  });
  it('does not guess a stance when old tags conflict', () => {
    assert.equal(companyStanceFromLegacyTags(['proposal_received']), 'private_consideration');
    assert.equal(companyStanceFromLegacyTags(['strategic_options_under_review']), 'capital_policy');
    assert.equal(companyStanceFromLegacyTags(['report_denied']), 'denied');
    assert.equal(companyStanceFromLegacyTags(['proposal_received', 'report_denied']), null);
  });
});

describe('event derivation', () => {
  it('counts only published initial and follow-up reports', () => {
    assert.equal(reportCount([
      event(), event({ report_role: 'follow_up' }), event({ report_role: 'related' }),
      event({ report_role: 'market_reaction' }), event({ report_role: 'follow_up', is_visible: false }),
    ]), 2);
  });
  it('selects the latest non-null company stance', () => {
    const events = [
      event({ event_category: 'company_disclosure', report_role: null, company_stance: 'denied' }),
      event({ event_category: 'company_disclosure', report_role: null, company_stance: null, sort_at: '2026-02-01T00:00:00Z' }),
    ];
    assert.equal(latestCompanyStance(events), 'denied');
  });
  it('uses only an explicitly classified initial report', () => {
    assert.equal(firstReport([event({ report_role: 'follow_up' }), event({ id: 'initial' })])?.id, 'initial');
  });
  it('excludes corrections from latest movement unless they are the only events', () => {
    const normal = event({ id: 'normal' });
    const correction = event({ id: 'fix', event_category: 'correction', report_role: null, sort_at: '2026-03-01T00:00:00Z' });
    assert.equal(latestEvent([normal, correction])?.id, 'normal');
    assert.equal(latestEvent([correction])?.id, 'fix');
  });
  it('rejects duplicate initials and category-specific values', () => {
    assert.ok(classificationErrors([event(), event()]).some((x) => x.includes('1案件につき1件')));
    assert.ok(classificationErrors([event({ event_category: 'correction' })]).some((x) => x.includes('報道上の役割')));
  });
});

describe('tags, dates and prices', () => {
  it('deduplicates and separates source/content tags while retaining inactive tags', () => {
    const source = { id: 's', kind: 'source', slug: 'monthly', label: '月刊誌', isActive: false, sortOrder: 2 };
    const content = { id: 'c', kind: 'content', slug: 'mbo', label: 'MBO', isActive: true, sortOrder: 1 };
    const result = aggregateEventTags([event({ tags: [source, content] }), event({ tags: [source] })]);
    assert.deepEqual(result.sourceTags, [source]); assert.deepEqual(result.contentTags, [content]);
  });
  it('derives sort_at priority without treating it as a public date', () => {
    assert.equal(deriveSortAt({ occurred_at: null, market_trigger_date: '2026-01-05', issue_year_month: '2026-01-01', site_published_at: null, updated_at: null }), '2026-01-05');
    const issue = eventDateParts({ date_precision: 'issue', occurred_at: null, issue_label: '2026年1月号', market_trigger_date: '2026-01-05' });
    assert.equal(issue.occurredAt, null); assert.equal(issue.issueLabel, '2026年1月号'); assert.equal(issue.marketTriggerDate, '2026-01-05');
    assert.equal(eventDateParts({ date_precision: 'unknown', occurred_at: null }).isUnknown, true);
  });
  it('calculates baseline return only for positive finite prices', () => {
    assert.equal(baselineReturn(1200, 1000), .2);
    for (const [a, b] of [[null, 1000], [1000, 0], [-1, 1000], [Infinity, 1000]]) assert.equal(baselineReturn(a, b), null);
  });
});
