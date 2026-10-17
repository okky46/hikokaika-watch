import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCases, defaultSearch, matchesCase } from '../src/lib/trackingSearch.ts';
import { PUBLIC_TRACKING_STATUS } from '../src/lib/trackingProfile.ts';
import { publicEventDate } from '../src/lib/trackingDates.ts';

const entry = (id, code, status, registeredOn, updatedAt, eventOn) => ({
  id, code, name:id, status, stage:PUBLIC_TRACKING_STATUS[status].stage,
  reason:'', media:[], statementTags:[], registeredOn, updatedAt,
  events:eventOn ? [{id:'event-'+id, title:id, date:publicEventDate({occurred_at:eventOn+'T00:00:00Z'})}] : [],
});
const rows = [
  entry('delisted','1000','delisted','2026-12-01','2026-12-01','2026-12-15'),
  entry('rumor','3000','rumor','2026-03-01','2026-02-01',null),
  entry('privatized','1500','privatized','2026-11-01','2026-11-01','2026-11-15'),
  entry('offer','2000','offer_succeeded','2026-01-01','2026-03-01','2026-01-15'),
  entry('denied','4000','consideration_denied','2026-02-01','2026-01-01','2026-02-15'),
  entry('announced','1100','announced','2026-04-01','2026-01-01','2026-02-01'),
  entry('open','1200','offer_open','2026-02-01','2026-04-01','2026-03-01'),
];
const expected = {
  event:['denied','rumor','open','announced','offer','delisted','privatized'],
  registered:['rumor','denied','announced','open','offer','delisted','privatized'],
  updated:['rumor','denied','open','offer','announced','delisted','privatized'],
  code:['rumor','denied','announced','open','offer','delisted','privatized'],
};
for (const [sort, ids] of Object.entries(expected)) {
  test(`${sort}: 正式発表済みを上場廃止済みの直前へまとめ、各グループ内の順序を保つ`, () => {
    for (const input of [rows, [...rows].reverse()]) {
      assert.deepEqual([...input].sort((a,b)=>compareCases(a,b,sort)).map(c=>c.id),ids);
    }
  });
}
test('TOB成立・否定・撤回・不成立・検討終了を上場廃止として扱わない', () => {
  const delisted=rows[0];
  for (const status of [...Object.keys(PUBLIC_TRACKING_STATUS),'unreviewed'].filter(s=>!['delisted','privatized'].includes(s))) {
    const active={...rows[1],status};
    for (const sort of Object.keys(expected)) {
      assert.ok(compareCases(active,delisted,sort)<0,status);
      assert.ok(compareCases(delisted,active,sort)>0,status);
    }
  }
});
test('正式発表済みの分類は、公開ステータスの定義に従う', () => {
  const rumor=rows[1], delisted=rows[0];
  for (const status of ['announced','offer_open','offer_succeeded']) {
    const announced={...rumor,status,stage:'post'};
    for (const sort of Object.keys(expected)) {
      assert.ok(compareCases(rumor,announced,sort)<0,status);
      assert.ok(compareCases(announced,delisted,sort)<0,status);
    }
  }
  for (const status of ['consideration_denied','report_denied','consideration_ended','withdrawn','failed','unreviewed']) {
    const other={...rumor,status};
    assert.ok(compareCases(other,{...rows[3],events:[]},'event')<0,status);
  }
});
test('完了・終了の絞り込みでも、上場廃止済み以外を先に表示する', () => {
  const ended=entry('ended','9000','consideration_ended','2026-01-01','2026-01-01',null);
  const closed=[rows[0],ended,rows[2]].filter(c=>matchesCase(c,{...defaultSearch(),stage:'closed'}));
  assert.deepEqual(closed.sort((a,b)=>compareCases(a,b,'event')).map(c=>c.id),['ended','delisted','privatized']);
});
test('同じ日付・証券コードでもIDによる安定した順序を保つ', () => {
  for (const base of [rows[0],rows[1],rows[3]]) {
    const a={...base,id:'a'}, b={...base,id:'b'};
    for (const sort of Object.keys(expected)) {
      assert.ok(compareCases(a,b,sort)<0);
      assert.ok(compareCases(b,a,sort)>0);
      assert.equal(compareCases(a,a,sort),0);
    }
  }
});
