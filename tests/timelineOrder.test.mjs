import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderTimeline, latestDatedEvent } from '../src/lib/timelineOrder.ts';
import { publicEventDate } from '../src/lib/trackingDates.ts';

const event=(id,precision,value)=>({id,date:publicEventDate({occurred_at:null},{precision,value,issue_label:'号数'}),sourceName:'出典',sourceUrl:'https://example.com/ir'});
test('表示方向を変えても日付不明は末尾、号数は参考年月に置き、元配列を変更しない',()=>{
  const events=[event('unknown','unknown',''),event('new','date','2026-09-01'),event('issue','issue','2026-07'),event('old','date','2026-05-01')];
  const before=JSON.stringify(events);
  assert.deepEqual(orderTimeline(events,'newest').map(e=>e.id),['new','issue','old','unknown']);
  assert.deepEqual(orderTimeline(events,'oldest').map(e=>e.id),['old','issue','new','unknown']);
  assert.equal(JSON.stringify(events),before);
});
test('同日・同時刻も安定した順序になり、出来事を重複・欠落させない',()=>{
  const events=[event('b','datetime','2026-09-01T03:00:00Z'),event('a','datetime','2026-09-01T03:00:00Z'),event('date','date','2026-09-01')];
  assert.deepEqual(orderTimeline(events,'newest').map(e=>e.id),['a','b','date']);
  assert.deepEqual(orderTimeline(events.toReversed(),'newest'),orderTimeline(events,'newest'));
});
test('直近表示は確認済み公表日と出典を使い、月・号数・登録日・未来の情報から推測しない',()=>{
  const events=[event('dated','date','2026-08-01'),event('month','month','2026-09'),event('issue','issue','2026-09'),event('unknown','unknown',''),event('future','date','2026-10-01'),event('future-time','datetime','2026-09-30T13:00:00Z'),{...event('no-source','date','2026-09-29'),sourceUrl:''}];
  events[3].sitePublishedAt='2026-09-30';
  assert.equal(latestDatedEvent(events,new Date('2026-09-30T12:00:00Z')).id,'dated');
  assert.equal(latestDatedEvent(events.slice(1),new Date('2026-09-30T12:00:00Z')),undefined);
  assert.equal(latestDatedEvent([],new Date('2026-09-30T12:00:00Z')),undefined);
});
