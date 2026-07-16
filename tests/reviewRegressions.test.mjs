import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before } from 'node:test';
import ts from 'typescript';

let helpers;

before(async () => {
  const source = fs.readFileSync('src/lib/noteMetadataHelpers.ts', 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, strict: true },
  });
  const file = path.join(os.tmpdir(), `noteMetadataHelpers-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(file, outputText);
  helpers = await import(file);
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
