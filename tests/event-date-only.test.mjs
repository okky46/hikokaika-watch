import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOnlyToIso, eventDateLabel } from '../src/lib/tracking.ts';

test('日付だけの資料はJSTの日付を保持し、架空の時刻を表示しない', () => {
  const occurred_at = dateOnlyToIso('2026-09-25');
  assert.equal(occurred_at, '2026-09-24T15:00:00.000Z');
  assert.equal(eventDateLabel({occurred_at, metadata:{date_precision:'date'}}), '2026/09/25');
  assert.equal(eventDateLabel({occurred_at, metadata:null}), '2026/09/25 00:00');
  assert.equal(dateOnlyToIso('2026-02-30'), null);
  assert.equal(dateOnlyToIso(''), null);
});

test('既存の精度列がある場合は号数・不明の意味を保持する', () => {
  const e = {occurred_at:dateOnlyToIso('2026-09-25'),metadata:{date_precision:'date'}};
  assert.equal(eventDateLabel({...e,date_precision:'issue',issue_label:'2026年9月号'}),'2026年9月号');
  assert.equal(eventDateLabel({...e,date_precision:'unknown'}),'日付未確認');
  assert.equal(eventDateLabel({...e,occurred_at:null}),'日付未確認');
});
