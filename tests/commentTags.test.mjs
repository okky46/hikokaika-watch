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
const isAcknowledgedCase = (c) => c.hasAcknowledgedCompanyComment === true;
const isAnnouncedCase = (c) => c.hasFormalAnnouncement;
function resolveEnv(env) {
  const cf = env.CF_PAGES === '1';
  if (!cf && env.DEPLOY_ENV === undefined && env.DATA_SOURCE === undefined) return { deployEnv: 'development', dataSource: 'sample' };
  if (env.DEPLOY_ENV === undefined || env.DATA_SOURCE === undefined) throw new Error('missing');
  if (!['development', 'test', 'preview', 'production'].includes(env.DEPLOY_ENV)) throw new Error('bad deploy');
  if (!['sample', 'supabase'].includes(env.DATA_SOURCE)) throw new Error('bad source');
  if (env.DEPLOY_ENV === 'production' && env.DATA_SOURCE === 'sample') throw new Error('production sample');
  return { deployEnv: env.DEPLOY_ENV, dataSource: env.DATA_SOURCE };
}

describe('company comment classification', () => {
  it('acknowledged wins over neutral', () => assert.equal(classify(['consideration_acknowledged', 'not_company_announcement', 'no_decision']), 'acknowledged'));
  it('acknowledged plus denied needs review', () => assert.equal(classify(['consideration_acknowledged', 'report_denied']), 'needs_review'));
  it('denied only is denied', () => assert.equal(classify(['not_under_consideration', 'report_denied']), 'denied'));
});

describe('home quick filters', () => {
  it('acknowledged filter includes cases that advanced to announced', () => assert.equal(isAcknowledgedCase({ status: 'announced', hasAcknowledgedCompanyComment: true }), true));
  it('acknowledged filter includes cases that advanced to completed', () => assert.equal(isAcknowledgedCase({ status: 'completed', hasAcknowledgedCompanyComment: true }), true));
  it('acknowledged filter includes cases that advanced to ended', () => assert.equal(isAcknowledgedCase({ status: 'ended', hasAcknowledgedCompanyComment: true }), true));
  it('acknowledged filter excludes plain commented cases without an acknowledged comment', () => assert.equal(isAcknowledgedCase({ status: 'commented', hasAcknowledgedCompanyComment: false }), false));
  it('acknowledged filter excludes denied- or neutral-only comments', () => {
    assert.equal(classify(['not_under_consideration', 'report_denied']), 'denied');
    assert.equal(classify(['no_decision']), 'neutral');
    assert.equal(isAcknowledgedCase({ status: 'commented', hasAcknowledgedCompanyComment: false }), false);
  });
  it('formal announcement includes withdrawn cases', () => assert.equal(isAnnouncedCase({ status: 'withdrawn', hasFormalAnnouncement: true }), true));
  it('formal announcement keeps announced/completed/withdrawn status fallback', () => {
    const source = fs.readFileSync('src/lib/caseFilters.ts', 'utf8');
    assert.match(source, /FORMAL_ANNOUNCEMENT_STATUS_FALLBACKS = \['announced', 'completed', 'withdrawn'\]/);
    assert.match(source, /event_type === 'formal_announcement'/);
  });
  it('pre-announcement and inactive statuses are not formal fallbacks without formal events', () => {
    const source = fs.readFileSync('src/lib/caseFilters.ts', 'utf8');
    for (const status of ['ended', 'denied', 'dormant', 'commented', 'rumored']) {
      assert.doesNotMatch(source, new RegExp(`FORMAL_ANNOUNCEMENT_STATUS_FALLBACKS = \[[^\]]*'${status}'`));
    }
  });
});

describe('static data and safety rails', () => {
  it('public data filters visibility', () => {
    const source = fs.readFileSync('src/lib/publicData.ts', 'utf8');
    assert.match(source, /cases\.json'\)\.filter\(\(c\) => c\.is_visible\)/);
    assert.match(source, /case_events\.json'\)\.filter\(\(e\) => e\.is_visible\)/);
    assert.match(source, /\.eq\('is_visible', true\)/);
  });
  it('non-Cloudflare unset environment falls back to development sample', () => {
    assert.deepEqual(resolveEnv({}), { deployEnv: 'development', dataSource: 'sample' });
  });
  it('Cloudflare unset environment fails closed', () => {
    assert.throws(() => resolveEnv({ CF_PAGES: '1' }));
  });
  it('production sample, one-sided, and unknown environment settings fail', () => {
    assert.throws(() => resolveEnv({ DEPLOY_ENV: 'production', DATA_SOURCE: 'sample' }));
    assert.throws(() => resolveEnv({ DEPLOY_ENV: 'development' }));
    assert.throws(() => resolveEnv({ DATA_SOURCE: 'sample' }));
    assert.throws(() => resolveEnv({ DEPLOY_ENV: 'staging', DATA_SOURCE: 'sample' }));
    assert.throws(() => resolveEnv({ DEPLOY_ENV: 'development', DATA_SOURCE: 'fixture' }));
  });
  it('SITE_URL does not affect environment resolution', () => {
    assert.deepEqual(resolveEnv({ SITE_URL: 'https://hikokaika-watch.pages.dev' }), { deployEnv: 'development', dataSource: 'sample' });
    assert.deepEqual(resolveEnv({ DEPLOY_ENV: 'test', DATA_SOURCE: 'sample', SITE_URL: 'https://hikokaika-watch.pages.dev' }), { deployEnv: 'test', dataSource: 'sample' });
  });
  it('supabase source fails closed without credentials and environment logic is centralized', () => {
    const publicData = fs.readFileSync('src/lib/publicData.ts', 'utf8');
    const buildEnv = fs.readFileSync('src/lib/buildEnv.ts', 'utf8');
    assert.match(publicData, /DATA_SOURCE=supabase/);
    assert.match(publicData, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(publicData, /resolvePublicDataEnvironment/);
    assert.match(buildEnv, /CF_PAGES/);
    assert.match(buildEnv, /DEPLOY_ENV=production[^]*DATA_SOURCE=sample/);
  });
  it('note 1000 character limit exists in DB and UI', () => {
    const migration = fs.readFileSync('supabase/migrations/0002_comment_mfa_audit_notes.sql', 'utf8');
    assert.match(migration, /char_length\(body\) <= 1000/);
    assert.match(migration, /not valid/i);
    assert.match(migration, /validate constraint user_case_notes_body_length_check/i);
    assert.match(migration, /validate constraint user_global_notes_body_length_check/i);
    assert.match(fs.readFileSync('src/pages/cases/[slug].astro', 'utf8'), /maxlength="1000"/);
    assert.match(fs.readFileSync('src/pages/mypage.astro', 'utf8'), /maxlength="1000"/);
  });
});
