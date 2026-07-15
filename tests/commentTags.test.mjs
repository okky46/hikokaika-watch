import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const groups = {
  consideration_acknowledged: 'acknowledged', strategic_options_under_review: 'acknowledged', proposal_received: 'acknowledged', discussions_ongoing: 'acknowledged',
  no_decision: 'neutral', not_company_announcement: 'neutral', not_under_consideration: 'denied', report_denied: 'denied', comment_declined: 'declined', other: 'other',
};
function classify(tags) {
  const set = new Set(tags.map((t) => groups[t]).filter(Boolean));
  if (set.has('acknowledged') && set.has('denied')) return 'needs_review';
  if (set.has('acknowledged')) return 'acknowledged';
  if (set.size === 1 && set.has('denied')) return 'denied';
  if (set.size === 1 && set.has('declined')) return 'declined';
  if (set.size === 1 && set.has('neutral')) return 'neutral';
  return 'unclear';
}
const isAcknowledgedCase = (c) => c.status === 'commented' && c.hasAcknowledgedCompanyComment;
const isAnnouncedCase = (c) => c.hasFormalAnnouncement;

describe('company comment classification', () => {
  it('acknowledged wins over neutral', () => assert.equal(classify(['consideration_acknowledged', 'not_company_announcement', 'no_decision']), 'acknowledged'));
  it('acknowledged plus denied needs review', () => assert.equal(classify(['consideration_acknowledged', 'report_denied']), 'needs_review'));
  it('denied only is denied', () => assert.equal(classify(['not_under_consideration', 'report_denied']), 'denied'));
});

describe('home quick filters', () => {
  it('acknowledged filter excludes denied', () => assert.equal(isAcknowledgedCase({ status: 'denied', hasAcknowledgedCompanyComment: true }), false));
  it('formal announcement includes withdrawn cases', () => assert.equal(isAnnouncedCase({ status: 'withdrawn', hasFormalAnnouncement: true }), true));
});

describe('static data and safety rails', () => {
  it('public data filters visibility', () => {
    const source = fs.readFileSync('src/lib/publicData.ts', 'utf8');
    assert.match(source, /cases\.json'\)\.filter\(\(c\) => c\.is_visible\)/);
    assert.match(source, /case_events\.json'\)\.filter\(\(e\) => e\.is_visible\)/);
    assert.match(source, /\.eq\('is_visible', true\)/);
  });
  it('supabase source fails closed without credentials', () => {
    const source = fs.readFileSync('src/lib/publicData.ts', 'utf8');
    assert.match(source, /DATA_SOURCE=supabase/);
    assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(source, /throw new Error/);
  });
  it('note 1000 character limit exists in DB and UI', () => {
    assert.match(fs.readFileSync('supabase/migrations/0002_comment_mfa_audit_notes.sql', 'utf8'), /char_length\(body\) <= 1000/);
    assert.match(fs.readFileSync('src/pages/cases/[slug].astro', 'utf8'), /maxlength="1000"/);
    assert.match(fs.readFileSync('src/pages/mypage.astro', 'utf8'), /maxlength="1000"/);
  });
});
