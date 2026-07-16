import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('src/components/StatusFunnel.astro', 'utf8');

describe('StatusFunnel branch statuses', () => {
  it('分岐ステータスはreportCount/commentCount/withdrawn正式発表から本線通過を判定する', () => {
    assert.match(source, /effectiveStatus === 'withdrawn'\) return i <= 2 \? 'passed' : 'pending'/);
    assert.match(source, /i === 0\) return reportCount > 0 \? 'passed' : 'pending'/);
    assert.match(source, /i === 1\) return commentCount > 0 \? 'passed' : 'pending'/);
    assert.doesNotMatch(source, /if \(isBranch\) return i <=/);
  });

  it('分岐行自体を現在地として強調する', () => {
    assert.match(source, /status-funnel__branch-row--current/);
    assert.match(source, /aria-current="step"/);
    assert.match(source, /status-funnel__badge--branch-current/);
  });
});
