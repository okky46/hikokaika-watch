import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const admin = fs.readFileSync('src/pages/admin/index.astro', 'utf8');
const publicData = fs.readFileSync('src/lib/publicData.ts', 'utf8');
const casePage = fs.readFileSync('src/pages/cases/[slug].astro', 'utf8');

describe('review regression guards', () => {
  it('validates large shareholding ratio before Number conversion and allows explicit zero', () => {
    assert.match(admin, /rawValue\.trim\(\)/);
    assert.match(admin, /if \(!trimmed\)/);
    assert.match(admin, /Number\(trimmed\)/);
    assert.match(admin, /value < 0 \|\| value > 100/);
    assert.match(admin, /保有者名を入力してください/);
    assert.match(admin, /parsePercentInput\(\$<HTMLInputElement>\('ev-ratio'\)\.value, '保有割合', true\)/);
    assert.doesNotMatch(admin, /ratio:\s*Number\(\$<HTMLInputElement>\('ev-ratio'\)\.value\)/);
  });

  it('suppresses invalid large shareholding metadata in public data', () => {
    assert.match(publicData, /function isValidPercent\(value: unknown\)/);
    assert.match(publicData, /Number\.isFinite\(value\) && value >= 0 && value <= 100/);
    assert.match(publicData, /const holderName = typeof e\.metadata\?\.holder_name === 'string' \? e\.metadata\.holder_name\.trim\(\) : ''/);
    assert.match(publicData, /if \(!holderName \|\| !isValidPercent\(ratio\)\) return null/);
    assert.match(publicData, /const previousRatio = isValidPercent\(e\.metadata\?\.previous_ratio\) \? e\.metadata\.previous_ratio : null/);
  });

  it('preserves long legacy notes as raw text when JSON serialization exceeds the limit', () => {
    assert.match(casePage, /let loadedNoteFormat: LoadedNoteFormat = 'v1'/);
    assert.match(casePage, /format: 'legacy'/);
    assert.match(casePage, /function buildSaveNoteBody\(\): SaveNoteResult/);
    assert.match(casePage, /if \(jsonLength <= NOTE_BODY_LIMIT\) return \{ ok: true, body: jsonBody, format: 'v1'/);
    assert.match(casePage, /loadedNoteFormat === 'legacy' && !hasStructuredNoteFields\(\) && rawLength <= NOTE_BODY_LIMIT/);
    assert.match(casePage, /body: noteBody\.value, format: 'legacy'/);
    assert.match(casePage, /自由メモを短くしてください/);
    assert.doesNotMatch(casePage, /const body = serializeNote\(\)/);
  });

  it('requires the full v1 note schema before treating JSON as structured', () => {
    assert.match(casePage, /function isStructuredNotePayload\(value: unknown\): value is NotePayload/);
    assert.match(casePage, /typeof value !== 'object' \|\| Array\.isArray\(value\)/);
    assert.match(casePage, /candidate\.v === 1/);
    assert.match(casePage, /typeof candidate\.scenario === 'string'/);
    assert.match(casePage, /typeof candidate\.targetPrice === 'string'/);
    assert.match(casePage, /typeof candidate\.exitCondition === 'string'/);
    assert.match(casePage, /typeof candidate\.nextCheckDate === 'string'/);
    assert.match(casePage, /typeof candidate\.freeText === 'string'/);
    assert.doesNotMatch(casePage, /parsed\?\.v === 1/);
    assert.doesNotMatch(casePage, /parsed\.scenario \?\? ''/);
  });

});
