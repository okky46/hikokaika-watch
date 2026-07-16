import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderSparkline } from '../src/lib/sparkline.ts';

describe('renderSparkline', () => {
  it('renders accessible svg with css variable colors', () => {
    const svg = renderSparkline({
      points: [{ date: '2026-07-01', price: 100 }, { date: '2026-07-02', price: 110 }],
      markers: [{ date: '2026-07-01', kind: 'report' }, { date: '2026-07-02', kind: 'announce' }],
      offerPrice: 120,
      width: 100,
      height: 24,
    });
    assert.match(svg, /^<svg/);
    assert.match(svg, /<title>株価推移/);
    assert.match(svg, /var\(--heat-3-fg\)/);
    assert.match(svg, /var\(--post-announced-fg\)/);
    assert.match(svg, /stroke-dasharray="3 3"/);
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,6}/);
  });

  it('skips invalid points and still connects remaining points', () => {
    const svg = renderSparkline({
      points: [{ date: 'bad', price: 999 }, { date: '2026-07-01', price: 100 }, { date: '2026-07-03', price: 105 }],
      markers: [],
      width: 80,
      height: 20,
    });
    assert.match(svg, /2点/);
    assert.match(svg, /<path d="M/);
  });
});
