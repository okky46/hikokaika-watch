import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeHttpUrl,
  resolveInboxCaseId,
  resolveInboxCompanyId,
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
});
