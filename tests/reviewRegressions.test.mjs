import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before } from 'node:test';
import ts from 'typescript';

let helpers;
let companyHelpers;

before(async () => {
  const compileHelper = async (sourcePath, name) => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
    });
    const file = path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}.mjs`);
    fs.writeFileSync(file, outputText);
    return import(file);
  };
  helpers = await compileHelper('src/lib/noteMetadataHelpers.ts', 'noteMetadataHelpers');
  companyHelpers = await compileHelper('src/lib/publicCompanyHelpers.ts', 'publicCompanyHelpers');
});

const fullV1 = (overrides = {}) => ({
  v: 1,
  scenario: '',
  targetPrice: '',
  exitCondition: '',
  nextCheckDate: '',
  freeText: '',
  ...overrides,
});

const note = (overrides = {}) => fullV1(overrides);

describe('structured note parsing and saving behavior', () => {
  it('recognizes only the complete v1 schema and otherwise preserves legacy body', () => {
    const validBody = JSON.stringify(fullV1({ scenario: '上方修正', targetPrice: '1200', exitCondition: '撤退', nextCheckDate: '2026-07-20', freeText: '確認' }));
    assert.deepEqual(helpers.parseStructuredNote(validBody), { note: JSON.parse(validBody), format: 'v1' });

    for (const body of [
      'プレーンテキスト',
      '{"v":1}',
      '{"v":1,"freeText":123}',
      JSON.stringify({ v: 1, scenario: '', targetPrice: '', exitCondition: '', nextCheckDate: '' }),
      JSON.stringify({ ...fullV1(), freeText: null }),
      JSON.stringify({ ...fullV1(), scenario: 1 }),
      'null',
      '[{"v":1}]',
      '{"other":"json"}',
      '{invalid',
    ]) {
      const parsed = helpers.parseStructuredNote(body);
      assert.equal(parsed.format, 'legacy', body);
      assert.equal(parsed.note.freeText, body, body);
      assert.equal(parsed.note.scenario, '', body);
    }
  });

  it('detects visible note content after structured parsing', () => {
    const emptyV1 = fullV1();
    assert.equal(helpers.hasNoteContent(emptyV1), false);
    assert.equal(helpers.hasNoteContent(fullV1({
      scenario: ' \n ',
      targetPrice: '\t',
      exitCondition: '  \n',
      nextCheckDate: ' ',
      freeText: '\n\n',
    })), false);

    for (const field of ['scenario', 'targetPrice', 'exitCondition', 'nextCheckDate', 'freeText']) {
      assert.equal(helpers.hasNoteContent(fullV1({ [field]: field === 'nextCheckDate' ? '2026-07-16' : '入力あり' })), true, field);
    }

    assert.equal(helpers.hasNoteContent(helpers.parseStructuredNote('通常のlegacy本文').note), true);
    assert.equal(helpers.hasNoteContent(helpers.parseStructuredNote('').note), false);
    assert.equal(helpers.hasNoteContent(helpers.parseStructuredNote('  \n\t  ').note), false);
    assert.equal(helpers.hasNoteContent(helpers.parseStructuredNote('{invalid legacy text').note), true);
  });

  it('builds labeled note preview fields without folding structured content into the free-text limit', () => {
    const preview = helpers.buildNotePreview(fullV1({
      scenario: ' MBO継続観測 ',
      targetPrice: ' 2,500円 ',
      exitCondition: ' 観測否定 ',
      nextCheckDate: '2026-08-01',
      freeText: '次回決算前に再確認',
    }));
    assert.deepEqual(preview, {
      scenario: 'MBO継続観測',
      targetPrice: '2,500円',
      exitCondition: '観測否定',
      nextCheckDate: '2026-08-01',
      freeText: '次回決算前に再確認',
      freeTextPreview: '次回決算前に再確認',
    });

    assert.deepEqual(helpers.buildNotePreview(fullV1({ scenario: '  ', targetPrice: '\n', exitCondition: '\t', nextCheckDate: ' ', freeText: '   ' })), {
      scenario: null,
      targetPrice: null,
      exitCondition: null,
      nextCheckDate: null,
      freeText: null,
      freeTextPreview: null,
    });

    const exactly120 = 'あ'.repeat(120);
    const over120 = 'あ'.repeat(121);
    assert.equal(helpers.buildNotePreview(fullV1({ freeText: exactly120 })).freeTextPreview, exactly120);
    assert.equal(helpers.buildNotePreview(fullV1({ freeText: over120 })).freeTextPreview, `${'あ'.repeat(120)}…`);
    assert.equal(helpers.buildNotePreview(fullV1({ scenario: '構造化だけ', freeText: over120 })).scenario, '構造化だけ');
  });

  it('chooses actual save body at the 1,000 character boundary', () => {
    for (const length of [949, 950, 999, 1000]) {
      const freeText = 'あ'.repeat(length);
      const result = helpers.chooseNoteSaveBody(note({ freeText }), 'legacy');
      if (helpers.textLength(JSON.stringify(note({ freeText }))) <= 1000) {
        assert.equal(result.format, 'v1');
        assert.equal(result.body, JSON.stringify(note({ freeText })));
      } else {
        assert.equal(result.format, 'legacy');
        assert.equal(result.body, freeText);
        assert.equal(result.length, length);
      }
    }

    const tooLong = helpers.chooseNoteSaveBody(note({ freeText: 'あ'.repeat(1001) }), 'legacy');
    assert.equal(tooLong.ok, false);
    assert.equal(tooLong.length, helpers.textLength(JSON.stringify(note({ freeText: 'あ'.repeat(1001) }))));

    const withStructured = helpers.chooseNoteSaveBody(note({ scenario: '入力あり', freeText: 'あ'.repeat(990) }), 'legacy');
    assert.equal(withStructured.ok, false);

    const existingV1 = helpers.chooseNoteSaveBody(note({ freeText: 'あ'.repeat(990) }), 'v1');
    assert.equal(existingV1.ok, false);
  });

  it('counts unicode code points and preserves JSON escaping in save strings', () => {
    const freeText = '日本語😀\n"quote"\\backslash';
    const result = helpers.chooseNoteSaveBody(note({ freeText }), 'legacy');
    assert.equal(result.ok, true);
    assert.equal(result.body, JSON.stringify(note({ freeText })));
    assert.equal(result.length, Array.from(result.body).length);
    assert.equal(helpers.parseStructuredNote(result.body).note.freeText, freeText);
  });

  it('handles exact JSON-wrapper 1,000 and 1,001 character cases', () => {
    const emptyWrapperLength = helpers.textLength(JSON.stringify(note({ freeText: '' })));
    const exact = 'x'.repeat(1000 - emptyWrapperLength);
    const over = 'x'.repeat(1001 - emptyWrapperLength);
    const exactResult = helpers.chooseNoteSaveBody(note({ freeText: exact }), 'legacy');
    assert.equal(exactResult.ok, true);
    assert.equal(exactResult.format, 'v1');
    assert.equal(exactResult.length, 1000);
    const overResult = helpers.chooseNoteSaveBody(note({ freeText: over }), 'legacy');
    assert.equal(overResult.ok, true);
    assert.equal(overResult.format, 'legacy');
    assert.equal(overResult.length, helpers.textLength(over));
  });
});

describe('large shareholding metadata behavior', () => {
  it('validates required ratio boundaries without confusing blank and explicit zero', () => {
    const invalidRatios = ['', '   ', '100.01', '-0.01', 'abc', 'Infinity'];
    for (const ratio of invalidRatios) {
      const result = helpers.buildLargeShareholdingMetadata({ holderName: '株主', ratio, previousRatio: '', filingDate: '2026-07-16', changeType: 'increase', corrected: false, correctionNote: '' });
      assert.equal(result.ok, false, ratio);
    }
    for (const ratio of ['0', '0.00', '100']) {
      const result = helpers.buildLargeShareholdingMetadata({ holderName: ' 株主 ', ratio, previousRatio: '', filingDate: '', changeType: 'exit', corrected: false, correctionNote: '' });
      assert.equal(result.ok, true, ratio);
      assert.equal(result.metadata.holder_name, '株主');
      assert.equal(result.metadata.ratio, Number(ratio));
      assert.equal(result.metadata.previous_ratio, null);
      assert.equal('corrected' in result.metadata, false);
    }
  });

  it('validates optional previous ratio and merges correction metadata', () => {
    for (const previousRatio of ['-0.01', '100.01', 'abc', 'Infinity']) {
      const result = helpers.buildLargeShareholdingMetadata({ holderName: '株主', ratio: '10', previousRatio, filingDate: '', changeType: 'new', corrected: false, correctionNote: '' });
      assert.equal(result.ok, false, previousRatio);
    }
    const corrected = helpers.buildLargeShareholdingMetadata({ holderName: '株主', ratio: '10', previousRatio: '0', filingDate: '2026-07-16', changeType: 'increase', corrected: true, correctionNote: ' 訂正文 ' });
    assert.equal(corrected.ok, true);
    assert.deepEqual(corrected.metadata, {
      holder_name: '株主',
      ratio: 10,
      previous_ratio: 0,
      filing_date: '2026-07-16',
      change_type: 'increase',
      corrected: true,
      correction_note: '訂正文',
    });
    const emptyNote = helpers.buildLargeShareholdingMetadata({ holderName: '株主', ratio: '10', previousRatio: '', filingDate: '', changeType: 'new', corrected: true, correctionNote: '   ' });
    assert.equal(emptyNote.metadata.correction_note, '');
  });

  it('sanitizes public large shareholding metadata while only nulling invalid previous ratios', () => {
    for (const metadata of [
      { holder_name: '   ', ratio: 10 },
      { holder_name: '株主', ratio: -1 },
      { holder_name: '株主', ratio: 100.01 },
      { holder_name: '株主', ratio: Number.NaN },
      { holder_name: '株主', ratio: Number.POSITIVE_INFINITY },
    ]) {
      assert.equal(helpers.sanitizeLargeShareholdingMetadata('large_shareholding_report', metadata), null);
    }
    assert.equal(helpers.sanitizeLargeShareholdingMetadata('other', { holder_name: '株主', ratio: 10 }), null);
    assert.deepEqual(helpers.sanitizeLargeShareholdingMetadata('large_shareholding_report', { holder_name: ' 株主 ', ratio: 0, previous_ratio: 101, filing_date: '2026-07-16', change_type: 'exit' }), {
      holderName: '株主',
      ratio: 0,
      previousRatio: null,
      filingDate: '2026-07-16',
      changeType: 'exit',
    });
    assert.deepEqual(helpers.sanitizeLargeShareholdingMetadata('large_shareholding_report', { holder_name: '株主', ratio: 12.34, previous_ratio: 10, change_type: 'increase' }), {
      holderName: '株主',
      ratio: 12.34,
      previousRatio: 10,
      filingDate: null,
      changeType: 'increase',
    });
  });
});


const rawCompany = (overrides = {}) => ({
  id: overrides.id ?? `co-${overrides.security_code ?? '1000'}`,
  security_code: overrides.security_code ?? '1000',
  name_ja: overrides.name_ja ?? `企業${overrides.security_code ?? '1000'}`,
  market: overrides.market ?? '東証',
  industry: overrides.industry ?? '情報通信',
  is_active: overrides.is_active ?? true,
  created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
  updated_at: overrides.updated_at ?? '2026-01-02T00:00:00.000Z',
});

const caseItem = (overrides = {}) => ({
  id: overrides.id ?? `case-${overrides.securityCode ?? '1000'}`,
  slug: overrides.slug ?? `case-${overrides.securityCode ?? '1000'}`,
  title: overrides.title ?? '公開案件',
  status: overrides.status ?? 'rumored',
  summary: overrides.summary ?? 'summary',
  securityCode: overrides.securityCode ?? '1000',
  companyName: overrides.companyName ?? '企業',
  market: overrides.market ?? '東証',
  firstReportedAt: overrides.firstReportedAt ?? null,
  firstSourceName: overrides.firstSourceName ?? null,
  lastUpdatedAt: overrides.lastUpdatedAt ?? '2026-07-01T00:00:00.000Z',
  hasFormalAnnouncement: overrides.hasFormalAnnouncement ?? false,
  hasAcknowledgedCompanyComment: overrides.hasAcknowledgedCompanyComment ?? false,
  sourceNames: overrides.sourceNames ?? [],
  preReportClose: overrides.preReportClose ?? null,
  currentClose: overrides.currentClose ?? null,
  formalOfferPrice: overrides.formalOfferPrice ?? null,
  dailyCloses: overrides.dailyCloses ?? [],
  sparklineSvg: overrides.sparklineSvg ?? null,
  latestCommentStance: overrides.latestCommentStance ?? null,
  reportCount: overrides.reportCount ?? 1,
  commentCount: overrides.commentCount ?? 0,
  heatLevel: overrides.heatLevel ?? 1,
  speculationPremium: overrides.speculationPremium ?? null,
  tobPremium: overrides.tobPremium ?? null,
  arbSpread: overrides.arbSpread ?? null,
  daysSinceFirstReport: overrides.daysSinceFirstReport ?? null,
  effectiveStatus: overrides.effectiveStatus ?? 'rumored',
  isPreAnnouncement: overrides.isPreAnnouncement ?? true,
});

describe('public company publishing scope', () => {
  it('includes only active companies with at least one public case and keeps security codes as strings', () => {
    const companies = [
      rawCompany({ security_code: '1000', is_active: true, name_ja: '公開あり' }),
      rawCompany({ security_code: '2000', is_active: true, name_ja: '公開なし' }),
      rawCompany({ security_code: '3000', is_active: false, name_ja: '非アクティブ公開なし' }),
      rawCompany({ security_code: '4000', is_active: false, name_ja: '非アクティブ公開あり' }),
      rawCompany({ security_code: '5000', is_active: true, name_ja: '下書きのみ' }),
      rawCompany({ security_code: '6000', is_active: true, name_ja: '公開と下書き' }),
      rawCompany({ security_code: '7000', is_active: true, name_ja: '公開1件' }),
      rawCompany({ security_code: 'A100', is_active: true, name_ja: '英字コード' }),
    ];
    const publicCases = [
      caseItem({ id: 'case-1000', securityCode: '1000', title: '公開案件' }),
      caseItem({ id: 'case-4000', securityCode: '4000', title: '非アクティブ企業の公開案件' }),
      caseItem({ id: 'case-6000-public', securityCode: '6000', title: '公開案件だけ表示' }),
      caseItem({ id: 'case-7000', securityCode: '7000', title: '1件だけ公開' }),
      caseItem({ id: 'case-A100', securityCode: 'A100', title: '英字コード公開' }),
    ];
    const result = companyHelpers.buildPublicCompanies(companies, publicCases);
    assert.deepEqual(result.map((c) => c.securityCode), ['1000', '6000', '7000', 'A100']);
    assert.equal(result.find((c) => c.securityCode === '6000').cases.length, 1);
    assert.equal(result.find((c) => c.securityCode === '6000').cases[0].id, 'case-6000-public');
    assert.equal(typeof result.find((c) => c.securityCode === 'A100').securityCode, 'string');
  });
});
