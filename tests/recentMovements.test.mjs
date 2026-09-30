import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentMovements } from '../src/lib/recentMovements.ts';
import { publicEventDate } from '../src/lib/trackingDates.ts';
const now = new Date('2026-09-30T00:00:00Z');
const event = (id, day, extra = {}) => ({ id, title: id, sourceName: '会社開示', sourceUrl: 'https://example.com/ir', date: publicEventDate({ occurred_at: null }, { precision: 'date', value: day }), ...extra });
const company = (id, events) => ({ id, slug: id, companyName: id, securityCode: '1234', events });

test('JSTで当日を含む30日。古い出来事を登録・編集・確認日で繰り上げない', () => {
  const input = [company('a', [event('old', '2026-08-31', { updatedAt: now.toISOString(), sitePublishedAt: now.toISOString() })]), company('b', [event('first', '2026-09-01')]), company('c', [event('today', '2026-09-30')])];
  const result = recentMovements(input, now);
  assert.equal(result.from, '2026-09-01');
  assert.deepEqual(result.items.map(x => x.event.id), ['today', 'first']);
  assert.equal(recentMovements([], new Date('2026-09-30T15:00:00Z')).asOf, '2026-10-01');
});
test('未来・月だけ・号数・日付不明・出典なしを最近の出来事とみなさない', () => {
  const dates = [{precision:'month',value:'2026-09'}, {precision:'issue',value:'2026-09',issue_label:'9月号'}, {precision:'unknown',value:''}, {precision:'datetime',value:'2026-09-30T01:00:00Z'}];
  const events = dates.map((d, i) => event(String(i), '2026-09-30', {date: publicEventDate({occurred_at:'2026-09-30T00:00:00Z'}, d)}));
  events.push(event('future', '2026-10-01'), event('no-source', '2026-09-30', {sourceUrl:''}));
  assert.deepEqual(recentMovements([company('a', events)], now).items, []);
});
test('最大3案件で同一案件の続報が枠を独占しない。入力順・編集日には依存しない', () => {
  const cases = [company('a', [event('a1','2026-09-28'),event('a2','2026-09-29')]), company('b',[event('b','2026-09-27')]),company('c',[event('c','2026-09-26')]),company('d',[event('d','2026-09-25')])];
  const before = JSON.stringify(cases);
  assert.deepEqual(recentMovements(cases,now).items.map(x=>x.event.id), ['a2','b','c']);
  assert.equal(JSON.stringify(cases),before);
  assert.deepEqual(recentMovements(cases.toReversed(),now),recentMovements(cases,now));
});
test('同日の時刻が判明している続報は新しいものを採用し、訂正を保持する', () => {
  const events = ['2026-09-29T02:00:00Z','2026-09-29T05:00:00Z'].map((value,i)=>event(String(i),'2026-09-29',{date:publicEventDate({occurred_at:value}),corrected:i===1}));
  const result=recentMovements([company('a',events)],now);
  assert.equal(result.items[0].event.id,'1');
  assert.equal(result.items[0].event.corrected,true);
});
test('日付のみと日時が混在する同日でも全順序が安定する', () => {
  const inputs = [company('b',[event('date','2026-09-29')]), ...['2026-09-29T05:00:00Z','2026-09-29T02:00:00Z'].map((value,i)=>company(['c','a'][i],[event(String(i),'2026-09-29',{date:publicEventDate({occurred_at:value})})]))];
  const expected = ['c','a','b'];
  for (const data of [inputs, inputs.toReversed(), [inputs[1],inputs[0],inputs[2]]]) assert.deepEqual(recentMovements(data,now).items.map(x=>x.caseId),expected);
});
