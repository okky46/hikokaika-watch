import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemblePublicData } from '../src/lib/publicData.ts';

const read = (name) => JSON.parse(fs.readFileSync(new URL(`../data/sample/${name}`, import.meta.url), 'utf8'));
const sample = () => ({
  companies: read('companies.json'), cases: read('cases.json'), events: read('case_events.json'),
  prices: read('price_snapshots.json'), eventTags: read('event_tags.json'),
  caseEventTags: read('case_event_tags.json'), isSampleData: true,
});

describe('PR1 public data wiring', () => {
  it('loads and aggregates event tags and calculates baseline return', () => {
    const data = assemblePublicData(sample());
    const item = data.cases.find((entry) => entry.id === 'b0000001-0000-4000-8000-000000000001');
    assert.ok(item.sourceTags.length > 0);
    assert.ok(item.contentTags.some((tag) => tag.slug === 'mbo'));
    assert.equal(item.baselineReturn, item.speculationPremium);
    assert.equal(item.canonicalStatus, 'announced');
  });

  it('uses the new report role instead of a conflicting legacy event type', () => {
    const raw = sample();
    const target = raw.events.find((entry) => entry.case_id === 'b0000001-0000-4000-8000-000000000001' && entry.event_type === 'follow_up_report');
    target.event_category = 'media_report'; target.report_role = 'related';
    const item = assemblePublicData(raw).cases.find((entry) => entry.id === target.case_id);
    assert.equal(item.reportCount, 1);
  });

  it('retains an issue-only initial source while keeping the public report date null', () => {
    const raw = sample();
    const targetCase = raw.cases.find((entry) => entry.id === 'b0000001-0000-4000-8000-000000000002');
    raw.events = raw.events.filter((entry) => entry.case_id !== targetCase.id);
    raw.events.push({
      id: 'issue-only', case_id: targetCase.id, event_type: 'observation_report', event_category: 'media_report',
      report_role: 'initial', company_stance: null, occurred_at: null, date_precision: 'issue',
      issue_label: '2026年1月号', issue_year_month: '2026-01-01', market_trigger_date: null,
      sort_at: '2026-01-01T00:00:00Z', title: '号数のみの初報', summary: '', source_name: '月刊誌',
      source_url: '', site_published_at: '2026-01-05T00:00:00Z', updated_at: '2026-01-05T00:00:00Z',
      sort_order: 0, is_visible: true, comment_stance: null, comment_tags: [], metadata: null,
    });
    const item = assemblePublicData(raw).cases.find((entry) => entry.id === targetCase.id);
    assert.equal(item.firstReportedAt, null);
    assert.equal(item.firstSourceName, '月刊誌');
    assert.equal(item.firstReportSortAt, '2026-01-01T00:00:00Z');
  });
});
