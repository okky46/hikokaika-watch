import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCaseFields } from '../src/lib/derive.ts';

const NOW = new Date('2026-07-15T00:00:00+09:00');

function daysAgoIso(days) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function baseInput(overrides = {}) {
  return {
    status: 'rumored',
    eventTypes: ['observation_report'],
    lastVisibleEventOccurredAt: daysAgoIso(1),
    firstReportedAt: daysAgoIso(1),
    preReportClose: null,
    currentClose: null,
    formalOfferPrice: null,
    now: NOW,
    ...overrides,
  };
}

describe('heatLevel', () => {
  it('reportCount=0 is clamped to heatLevel 1', () => {
    const r = deriveCaseFields(baseInput({ eventTypes: [] }));
    assert.equal(r.reportCount, 0);
    assert.equal(r.heatLevel, 1);
  });

  it('reportCount=1 is heatLevel 1', () => {
    const r = deriveCaseFields(baseInput({ eventTypes: ['observation_report'] }));
    assert.equal(r.reportCount, 1);
    assert.equal(r.heatLevel, 1);
  });

  it('reportCount=4 is heatLevel 4', () => {
    const r = deriveCaseFields(
      baseInput({
        eventTypes: ['observation_report', 'follow_up_report', 'follow_up_report', 'follow_up_report'],
      }),
    );
    assert.equal(r.reportCount, 4);
    assert.equal(r.heatLevel, 4);
  });

  it('reportCount=5 is still clamped to heatLevel 4', () => {
    const r = deriveCaseFields(
      baseInput({
        eventTypes: [
          'observation_report',
          'follow_up_report',
          'follow_up_report',
          'follow_up_report',
          'follow_up_report',
        ],
      }),
    );
    assert.equal(r.reportCount, 5);
    assert.equal(r.heatLevel, 4);
  });

  it('90日以上経過で1段階冷却される', () => {
    const r = deriveCaseFields(
      baseInput({
        eventTypes: ['observation_report', 'follow_up_report', 'follow_up_report', 'follow_up_report'],
        lastVisibleEventOccurredAt: daysAgoIso(90),
      }),
    );
    assert.equal(r.heatLevel, 3);
  });

  it('90日未満なら冷却されない', () => {
    const r = deriveCaseFields(
      baseInput({
        eventTypes: ['observation_report', 'follow_up_report', 'follow_up_report', 'follow_up_report'],
        lastVisibleEventOccurredAt: daysAgoIso(89),
      }),
    );
    assert.equal(r.heatLevel, 4);
  });

  it('冷却してもheatLevelは1未満にならない', () => {
    const r = deriveCaseFields(
      baseInput({
        eventTypes: ['observation_report'],
        lastVisibleEventOccurredAt: daysAgoIso(90),
      }),
    );
    assert.equal(r.heatLevel, 1);
  });
});

describe('effectiveStatus(dormant判定)', () => {
  it('rumored かつ 240日以上経過で dormant になる', () => {
    const r = deriveCaseFields(baseInput({ status: 'rumored', lastVisibleEventOccurredAt: daysAgoIso(240) }));
    assert.equal(r.effectiveStatus, 'dormant');
    assert.equal(r.isPreAnnouncement, true);
  });

  it('239日ではdormantにならない', () => {
    const r = deriveCaseFields(baseInput({ status: 'rumored', lastVisibleEventOccurredAt: daysAgoIso(239) }));
    assert.equal(r.effectiveStatus, 'rumored');
  });

  it('commented / denied もdormant判定の対象になる', () => {
    const commented = deriveCaseFields(baseInput({ status: 'commented', lastVisibleEventOccurredAt: daysAgoIso(240) }));
    const denied = deriveCaseFields(baseInput({ status: 'denied', lastVisibleEventOccurredAt: daysAgoIso(300) }));
    assert.equal(commented.effectiveStatus, 'dormant');
    assert.equal(denied.effectiveStatus, 'dormant');
  });

  it('announced / completed / withdrawn はdormant判定の対象外', () => {
    for (const status of ['announced', 'completed', 'withdrawn']) {
      const r = deriveCaseFields(baseInput({ status, lastVisibleEventOccurredAt: daysAgoIso(400) }));
      assert.equal(r.effectiveStatus, status);
    }
  });

  it('DBのstatusは書き換えない(effectiveStatusのみがdormantになる)', () => {
    const r = deriveCaseFields(baseInput({ status: 'rumored', lastVisibleEventOccurredAt: daysAgoIso(240) }));
    assert.equal(r.effectiveStatus, 'dormant');
  });

  it('ended / announced / completed のisPreAnnouncementはそれぞれ正しい', () => {
    const ended = deriveCaseFields(baseInput({ status: 'ended' }));
    const announced = deriveCaseFields(baseInput({ status: 'announced' }));
    assert.equal(ended.isPreAnnouncement, true);
    assert.equal(announced.isPreAnnouncement, false);
  });
});

describe('speculationPremium / tobPremium / arbSpread', () => {
  it('価格が両方揃っている場合のみ speculationPremium を計算する', () => {
    const r = deriveCaseFields(
      baseInput({ preReportClose: { price: 1000, priceDate: '2026-01-01', sourceName: null }, currentClose: { price: 1200, priceDate: '2026-02-01', sourceName: null } }),
    );
    assert.ok(Math.abs(r.speculationPremium - 0.2) < 1e-9);
  });

  it('preReportCloseまたはcurrentCloseが欠損していればnull', () => {
    const noPre = deriveCaseFields(baseInput({ currentClose: { price: 1200, priceDate: '2026-02-01', sourceName: null } }));
    const noCurrent = deriveCaseFields(baseInput({ preReportClose: { price: 1000, priceDate: '2026-01-01', sourceName: null } }));
    assert.equal(noPre.speculationPremium, null);
    assert.equal(noCurrent.speculationPremium, null);
  });

  it('tobPremiumはannounced/completed/withdrawnかつ両価格が揃う場合のみ計算する', () => {
    const r = deriveCaseFields(
      baseInput({
        status: 'announced',
        preReportClose: { price: 1000, priceDate: '2026-01-01', sourceName: null },
        formalOfferPrice: { price: 1500, priceDate: '2026-02-01', sourceName: null },
      }),
    );
    assert.ok(Math.abs(r.tobPremium - 0.5) < 1e-9);
  });

  it('rumoredなどの発表前ステータスではtobPremiumはnull', () => {
    const r = deriveCaseFields(
      baseInput({
        status: 'rumored',
        preReportClose: { price: 1000, priceDate: '2026-01-01', sourceName: null },
        formalOfferPrice: { price: 1500, priceDate: '2026-02-01', sourceName: null },
      }),
    );
    assert.equal(r.tobPremium, null);
  });

  it('arbSpreadはannouncedかつformalOfferPriceとcurrentCloseが揃う場合のみ計算する(負値もそのまま)', () => {
    const r = deriveCaseFields(
      baseInput({
        status: 'announced',
        formalOfferPrice: { price: 1500, priceDate: '2026-02-01', sourceName: null },
        currentClose: { price: 1800, priceDate: '2026-03-01', sourceName: null },
      }),
    );
    assert.ok(Math.abs(r.arbSpread - (1500 - 1800) / 1800) < 1e-9);
    assert.ok(r.arbSpread < 0);
  });

  it('completed / withdrawn ではarbSpreadはnullでよい', () => {
    for (const status of ['completed', 'withdrawn']) {
      const r = deriveCaseFields(
        baseInput({
          status,
          formalOfferPrice: { price: 1500, priceDate: '2026-02-01', sourceName: null },
          currentClose: { price: 1800, priceDate: '2026-03-01', sourceName: null },
        }),
      );
      assert.equal(r.arbSpread, null);
    }
  });
});

describe('reportCount / commentCount', () => {
  it('observation_report と follow_up_report のみ reportCount に数える', () => {
    const r = deriveCaseFields(
      baseInput({
        eventTypes: ['observation_report', 'follow_up_report', 'company_comment', 'timely_disclosure', 'formal_announcement'],
      }),
    );
    assert.equal(r.reportCount, 2);
    assert.equal(r.commentCount, 2);
  });
});

describe('daysSinceFirstReport', () => {
  it('firstReportedAtがあれば今日までの日数を切り捨てで計算する', () => {
    const r = deriveCaseFields(baseInput({ firstReportedAt: daysAgoIso(45) }));
    assert.equal(r.daysSinceFirstReport, 45);
  });

  it('firstReportedAtがなければnull', () => {
    const r = deriveCaseFields(baseInput({ firstReportedAt: null }));
    assert.equal(r.daysSinceFirstReport, null);
  });
});

const PRICE = (price) => ({ price, priceDate: '2026-01-01', sourceName: null });

function assertInvalidPriceNulls(overrides, field) {
  for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const r = deriveCaseFields(baseInput(overrides(price)));
    assert.equal(r[field], null, `${field} should be null for invalid price: ${price}`);
  }
}

describe('invalid price guards', () => {
  it('speculationPremium は分母・分子の価格が正の有限値の場合だけ計算する', () => {
    assertInvalidPriceNulls((price) => ({ preReportClose: PRICE(price), currentClose: PRICE(1200) }), 'speculationPremium');
    assertInvalidPriceNulls((price) => ({ preReportClose: PRICE(1000), currentClose: PRICE(price) }), 'speculationPremium');
  });

  it('tobPremium は分母・分子の価格が正の有限値の場合だけ計算する', () => {
    assertInvalidPriceNulls((price) => ({ status: 'announced', preReportClose: PRICE(price), formalOfferPrice: PRICE(1500) }), 'tobPremium');
    assertInvalidPriceNulls((price) => ({ status: 'announced', preReportClose: PRICE(1000), formalOfferPrice: PRICE(price) }), 'tobPremium');
  });

  it('arbSpread は分母・分子の価格が正の有限値の場合だけ計算する', () => {
    assertInvalidPriceNulls((price) => ({ status: 'announced', formalOfferPrice: PRICE(1500), currentClose: PRICE(price) }), 'arbSpread');
    assertInvalidPriceNulls((price) => ({ status: 'announced', formalOfferPrice: PRICE(price), currentClose: PRICE(1200) }), 'arbSpread');
  });
});
