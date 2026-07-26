import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/0006_pr1_review_fixes.sql', import.meta.url), 'utf8');

describe('PR1 corrective migration safety rails', () => {
  it('demotes duplicate initials deterministically before recreating the unique index', () => {
    const rank = sql.indexOf('row_number() over');
    const demote = sql.indexOf("set report_role = 'follow_up'");
    const index = sql.indexOf('create unique index if not exists case_events_one_visible_initial_idx');
    assert.ok(rank >= 0 && rank < demote && demote < index);
    assert.match(sql, /coalesce\(occurred_at, site_published_at, updated_at\).*sort_order asc, id asc/s);
    assert.match(sql, /pr1_duplicate_initial_demoted/);
  });
  it('rejects null report roles and makes the backfilled category not null', () => {
    assert.match(sql, /event_category = 'media_report' and report_role is not null/);
    assert.match(sql, /alter column event_category set not null/);
  });
  it('blocks direct review-view access and provides an admin-checked RPC', () => {
    assert.match(sql, /security_invoker = true/);
    assert.match(sql, /revoke all on public\.case_event_migration_review from public, anon, authenticated/);
    assert.match(sql, /admin_case_event_migration_review[\s\S]*public\.is_admin\(\)/);
  });
  it('includes issue, unknown, monthly-tag and demoted-initial review conditions', () => {
    assert.match(sql, /date_precision in \('issue','unknown'\)/);
    assert.match(sql, /monthly-magazine/);
    assert.match(sql, /pr1_duplicate_initial_demoted/);
  });
  it('re-synchronizes legacy changes and audits tags after backfill', () => {
    assert.match(sql, /tg_op = 'INSERT'/);
    assert.match(sql, /tg_op = 'UPDATE'/);
    assert.match(sql, /new\.event_type is distinct from old\.event_type/);
    assert.match(sql, /new\.comment_tags is distinct from old\.comment_tags/);
    assert.match(sql, /new\.event_category <> 'media_report'/);
    assert.match(sql, /new\.event_category <> 'company_disclosure'/);
    assert.match(sql, /legacy_company_stance\(new\.comment_tags\)/);
    assert.match(sql, /record_case_event_tag_revision_history/);
    assert.match(sql, /coalesce\(new\.event_id, old\.event_id\)/);
    assert.ok(sql.indexOf('pr1_duplicate_initial_demoted') < sql.indexOf('create trigger event_tags_revision_history'));
  });
  it('uses idempotent replacement/drop forms for corrected objects', () => {
    assert.doesNotMatch(sql, /create table (?!if not exists)/);
    assert.match(sql, /drop (?:trigger|view|index) if exists/);
    assert.match(sql, /create or replace function/);
  });
});
