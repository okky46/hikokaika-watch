import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firstVisibleReportOccurredAt } from '../src/lib/derive.ts';

function event(event_type, occurred_at, is_visible = true) {
  return { event_type, occurred_at, is_visible };
}

describe('firstVisibleReportOccurredAt', () => {
  it('cases.first_reported_at相当の日付があっても、報道イベントが非表示ならnull', () => {
    const r = firstVisibleReportOccurredAt([
      event('observation_report', '2026-01-01T00:00:00Z', false),
    ]);
    assert.equal(r, null);
  });

  it('可視イベントが会社コメントだけならnull', () => {
    const r = firstVisibleReportOccurredAt([
      event('company_comment', '2026-01-02T00:00:00Z'),
    ]);
    assert.equal(r, null);
  });

  it('非表示の古い報道ではなく可視の新しい報道を返す', () => {
    const r = firstVisibleReportOccurredAt([
      event('observation_report', '2026-01-01T00:00:00Z', false),
      event('observation_report', '2026-02-01T00:00:00Z'),
    ]);
    assert.equal(r, '2026-02-01T00:00:00Z');
  });

  it('可視のfollow_up_reportしかない場合はその日時を返す', () => {
    const r = firstVisibleReportOccurredAt([
      event('follow_up_report', '2026-03-01T00:00:00Z'),
    ]);
    assert.equal(r, '2026-03-01T00:00:00Z');
  });

  it('可視報道イベントがない場合はnull', () => {
    const r = firstVisibleReportOccurredAt([
      event('timely_disclosure', '2026-04-01T00:00:00Z'),
      event('correction', '2026-04-02T00:00:00Z'),
    ]);
    assert.equal(r, null);
  });
});
