import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  filterInboxItems,
  inboxEmptyState,
  inboxItemFilterDate,
  normalizeHttpUrl,
  preserveSelectValueIfValid,
  resolveInboxCaseId,
  resolveInboxCompanyId,
  pendingBulkRejectIds,
  visibleSelectionIds,
} from '../src/lib/inboxAdminHelpers.ts';

describe('inbox admin helper regressions', () => {
  const companies = [
    { id: 'company-a', security_code: '130A' },
    { id: 'company-b', security_code: '7203' },
  ];
  const cases = [{ id: 'case-a' }, { id: 'case-b' }];

  it('証券コードがtrim・大文字化され、一致する会社IDを選択する', () => {
    assert.equal(resolveInboxCompanyId(companies, ' 130a '), 'company-a');
  });

  it('会社が見つからない場合に以前の会社IDを利用しない', () => {
    assert.equal(resolveInboxCompanyId(companies, '9999'), null);
    assert.equal(resolveInboxCompanyId(companies, ''), null);
  });

  it('matched_case_idがない/存在しない場合に以前の案件IDを利用しない', () => {
    assert.equal(resolveInboxCaseId(cases, null), '');
    assert.equal(resolveInboxCaseId(cases, 'missing-case'), '');
    assert.equal(resolveInboxCaseId(cases, 'case-b'), 'case-b');
  });

  it('http/httpsだけを絶対URLとして許可する', () => {
    assert.equal(normalizeHttpUrl('https://example.com/news?q=a&b=c'), 'https://example.com/news?q=a&b=c');
    assert.equal(normalizeHttpUrl('http://example.com/path'), 'http://example.com/path');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '/relative', 'not a url']) {
      assert.equal(normalizeHttpUrl(bad), null);
    }
  });

  it('有効な案件ステータス選択値だけを再描画後に復元対象にする', () => {
    const validStatuses = ['rumored', 'commented', 'announced', 'withdrawn'];
    assert.equal(preserveSelectValueIfValid('commented', validStatuses), 'commented');
    assert.equal(preserveSelectValueIfValid('announced', validStatuses), 'announced');
    assert.equal(preserveSelectValueIfValid('withdrawn', validStatuses), 'withdrawn');
    assert.equal(preserveSelectValueIfValid('missing', validStatuses), null);
    assert.equal(preserveSelectValueIfValid('', validStatuses), null);
  });
});



describe('inbox candidate filtering and bulk helpers', () => {
  const items = [
    { id: 'a', status: 'pending', title: '株式会社Alpha（130A）がMBO', security_code: '130A', source_kind: 'news', published_at: '2026-07-21T01:00:00Z', created_at: '2026-07-20T00:00:00Z', raw: { query: '非公開化 報道', description: '公開買付' } },
    { id: 'b', status: 'pending', title: 'Beta', security_code: '7203', source_kind: 'tdnet', published_at: null, created_at: '2026-07-22T23:59:59Z', raw: { query: '', description: 'TOB' } },
    { id: 'c', status: 'rejected', title: 'Gamma', security_code: '9999', source_kind: 'news', published_at: '2026-07-23T00:00:00Z', created_at: '2026-07-23T00:00:00Z', raw: { query: 'MBO', description: '買収提案' } },
  ];

  it('キーワード検索は対象フィールドを部分一致で検索する', () => {
    assert.deepEqual(filterInboxItems(items, { keyword: '公開買付' }).map((x) => x.id), ['a']);
    assert.deepEqual(filterInboxItems(items, { keyword: '7203' }).map((x) => x.id), ['b']);
    assert.deepEqual(filterInboxItems(items, { keyword: 'tdnet' }).map((x) => x.id), ['b']);
  });

  it('キーワード検索は英字の大文字小文字を区別しない', () => {
    assert.deepEqual(filterInboxItems(items, { keyword: 'alpha' }).map((x) => x.id), ['a']);
  });

  it('From/To/From+Toで日付絞り込みし、To当日を含む', () => {
    assert.deepEqual(filterInboxItems(items, { dateFrom: '2026-07-22' }).map((x) => x.id), ['b', 'c']);
    assert.deepEqual(filterInboxItems(items, { dateTo: '2026-07-22' }).map((x) => x.id), ['a']);
    assert.deepEqual(filterInboxItems(items, { dateFrom: '2026-07-22', dateTo: '2026-07-22' }).map((x) => x.id), []);
  });

  it('掲載日フィルターはpublished_atをJST基準で判定する', () => {
    const jstMidnightItem = { id: 'jst', published_at: '2026-07-20T15:30:00Z', created_at: '2026-07-20T00:00:00Z' };
    assert.equal(inboxItemFilterDate(jstMidnightItem), '2026-07-21');
    assert.deepEqual(filterInboxItems([jstMidnightItem], { dateFrom: '2026-07-21' }).map((x) => x.id), ['jst']);
    assert.deepEqual(filterInboxItems([jstMidnightItem], { dateTo: '2026-07-21' }).map((x) => x.id), ['jst']);
    assert.deepEqual(filterInboxItems([jstMidnightItem], { dateTo: '2026-07-20' }).map((x) => x.id), []);
  });

  it('published_atがない場合はcreated_atへJST基準でフォールバックする', () => {
    assert.equal(inboxItemFilterDate(items[1]), '2026-07-23');
    const createdOnlyItem = { id: 'created-only', published_at: null, created_at: '2026-07-20T15:30:00Z' };
    assert.equal(inboxItemFilterDate(createdOnlyItem), '2026-07-21');
    assert.deepEqual(filterInboxItems([createdOnlyItem], { dateFrom: '2026-07-21', dateTo: '2026-07-21' }).map((x) => x.id), ['created-only']);
  });

  it('不正な日時は日付不明として期間条件から安全に除外する', () => {
    const invalidDateItem = { id: 'invalid', published_at: 'not a date', created_at: null };
    assert.equal(inboxItemFilterDate(invalidDateItem), null);
    assert.deepEqual(filterInboxItems([invalidDateItem], { dateFrom: '2026-07-21' }), []);
  });

  it('空表示状態はpending全体とフィルター結果を分けて返す', () => {
    assert.equal(inboxEmptyState(0, 0), 'no-pending');
    assert.equal(inboxEmptyState(2, 0), 'no-filter-results');
    assert.equal(inboxEmptyState(2, 1), 'none');
  });

  it('選択対象は表示中候補に限定される', () => {
    assert.deepEqual(visibleSelectionIds([items[0], items[1]], ['a', 'c']), ['a']);
  });

  it('一括破棄はpending候補だけを対象にする', () => {
    assert.deepEqual(pendingBulkRejectIds(items, ['a', 'c']), ['a']);
  });
});

// 管理画面のDOM密結合部分は、誤承認・重複insert防止に必要な安全レールをソース上で検証する。
describe('admin inbox approval source guards', () => {
  const source = fs.readFileSync('src/pages/admin/index.astro', 'utf8');

  it('既存案件・イベント編集やフォームクリア時にinbox追跡IDを解除する', () => {
    assert.match(source, /data-edit-case[^]*currentInboxIdForCase = null;[^]*currentInboxIdForEvent = null;/);
    assert.match(source, /data-edit-event[^]*currentInboxIdForEvent = null;[^]*currentInboxIdForCase = null;/);
    assert.match(source, /ca-clear[^]*currentInboxIdForCase = null;[^]*currentInboxIdForEvent = null;/);
    assert.match(source, /ev-clear[^]*currentInboxIdForEvent = null;[^]*currentInboxIdForCase = null;/);
  });

  it('inbox承認更新エラーや対象行なしでは追跡IDを解除しない', () => {
    assert.match(source, /\.eq\('status', 'pending'\)[^]*\.select\('id'\)/);
    assert.match(source, /\(data \?\? \[\]\)\.length !== 1/);
    assert.match(source, /if \(approved\) \{\s*currentInboxIdForCase = null;/);
    assert.match(source, /if \(approved\) \{\s*currentInboxIdForEvent = null;/);
  });

  it('承認失敗後の再保存で重複insertしないよう保存後IDをフォームへ保持する', () => {
    assert.match(source, /insert\(row\)\.select\('id'\)\.single\(\)/);
    assert.match(source, /savedCase\?\.id\) \$<HTMLInputElement>\('ca-id'\)\.value = savedCase\.id/);
    assert.match(source, /savedEvent\?\.id\) \$<HTMLInputElement>\('ev-id'\)\.value = savedEvent\.id/);
  });

  it('会社未一致時はinboxを再描画せず候補カード上のエラーを保持する', () => {
    assert.match(source, /if \(!companyId\) \{\s*\$<HTMLSelectElement>\('ca-company'\)\.value = '';\s*\$\(`inbox-status-\$\{item\.id\}`\)\.textContent = '証券コードに一致する会社が見つかりません。先に会社を登録してから再度起票してください。';\s*return;\s*\}/);
  });

  it('案件一覧セレクト再描画後も有効な案件ステータスを復元する', () => {
    assert.match(source, /const currentStatus = statusSel\.value;[^]*const restoredStatus = preserveSelectValueIfValid\(currentStatus, Object\.keys\(statusDefs\)\);[^]*if \(restoredStatus\) statusSel\.value = restoredStatus;/);
  });
});
