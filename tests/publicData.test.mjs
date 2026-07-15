import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { latestCommentStanceFromEvent } from '../src/lib/commentTags.ts';
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

describe('latestCommentStanceFromEvent', () => {
  it('最新イベントがtimely_disclosureでcomment_stanceがnullかつcomment_tagsが空ならnull', () => {
    assert.equal(latestCommentStanceFromEvent({ comment_stance: null, comment_tags: [] }), null);
  });

  it('comment_tags自体が未設定でもnull', () => {
    assert.equal(latestCommentStanceFromEvent({ comment_stance: null }), null);
  });

  it('comment_stanceが明示されている場合はその値を維持', () => {
    assert.equal(
      latestCommentStanceFromEvent({ comment_stance: 'declined', comment_tags: ['consideration_acknowledged'] }),
      'declined',
    );
  });

  it('comment_stanceがなく非空のcomment_tagsがある場合は自動分類する', () => {
    assert.equal(
      latestCommentStanceFromEvent({ comment_stance: null, comment_tags: ['consideration_acknowledged'] }),
      'acknowledged',
    );
  });

  it('複数のコメント系イベントがある場合は最新イベントの情報だけが表示に使われる', () => {
    const events = [
      { comment_stance: 'acknowledged', comment_tags: ['consideration_acknowledged'] },
      { comment_stance: null, comment_tags: [] },
    ];
    assert.equal(latestCommentStanceFromEvent(events.at(-1)), null);
  });

  it('コメント系イベントがない場合はnull', () => {
    assert.equal(latestCommentStanceFromEvent(null), null);
  });
});
