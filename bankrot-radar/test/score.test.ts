import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectRisks, riskPenalty } from '../src/score/risk.ts';
import { liquidityScore } from '../src/score/liquidity.ts';
import { scoreLot, urgencyScore } from '../src/score/score.ts';
import { ComparablesEstimator, CompositeEstimator, OverridesEstimator, median } from '../src/enrich/estimator.ts';
import type { Comparable, ComparablesQuery, ComparablesSource } from '../src/enrich/estimator.ts';
import { assembleLot } from '../src/normalize/assemble.ts';
import type { Lot } from '../src/domain/lot.ts';

const NOW = new Date('2026-08-10T00:00:00.000Z');

function makeLot(overrides: Partial<Parameters<typeof assembleLot>[0]> = {}): Lot {
  return assembleLot({
    sourceSystem: 'manual',
    sourceId: 'test',
    title: 'Квартира, общая площадь 50 кв.м, г. Москва',
    description: 'Кадастровый номер 77:06:0004009:1234. Открытый аукцион на повышение.',
    startPrice: 5_000_000,
    applicationStart: '2026-08-01T00:00:00.000Z',
    applicationEnd: '2026-08-25T00:00:00.000Z',
    ...overrides,
  });
}

class StubComparables implements ComparablesSource {
  #items: Comparable[];

  constructor(items: Comparable[]) {
    this.#items = items;
  }

  find(query: ComparablesQuery): Comparable[] {
    return this.#items.filter((item) => {
      if (item.assetKind !== query.assetKind) return false;
      if (query.regionCode !== undefined && item.regionCode !== query.regionCode) return false;
      if (query.minArea !== undefined && (item.areaSqm ?? 0) < query.minArea) return false;
      if (query.maxArea !== undefined && (item.areaSqm ?? 0) > query.maxArea) return false;
      return true;
    });
  }
}

test('detectRisks: находит аренду и жильцов в реальной формулировке', () => {
  const flags = detectRisks(
    'В квартире зарегистрированы лица, в том числе несовершеннолетние. ' +
      'Имеется действующий договор аренды сроком до 2028 года. Осмотр не проводится.',
  );

  const codes = flags.map((f) => f.code);
  assert.ok(codes.includes('residents'), 'зарегистрированные лица должны быть найдены');
  assert.ok(codes.includes('lease'), 'договор аренды должен быть найден');
  assert.ok(codes.includes('no_inspection'));
  assert.equal(flags[0]!.severity, 3, 'самые тяжёлые риски идут первыми');
  assert.ok(flags[0]!.evidence.length > 0, 'флаг сопровождается цитатой из текста');
});

test('detectRisks: чистый текст не порождает флагов', () => {
  assert.deepEqual(detectRisks('Автомобиль TOYOTA CAMRY, 2019 года выпуска, пробег 96 000 км'), []);
});

test('riskPenalty: растёт с тяжестью, но ограничен сверху', () => {
  const light = riskPenalty([{ code: 'pledge', severity: 1, label: '', evidence: '' }]);
  const heavy = riskPenalty([
    { code: 'lease', severity: 3, label: '', evidence: '' },
    { code: 'residents', severity: 3, label: '', evidence: '' },
    { code: 'litigation', severity: 3, label: '', evidence: '' },
  ]);

  assert.ok(light < heavy);
  assert.ok(heavy <= 40);
  assert.equal(riskPenalty([]), 0);
});

test('liquidityScore: недвижимость в Москве ликвиднее оборудования в глубинке', () => {
  assert.ok(liquidityScore('real_estate', 77) > liquidityScore('equipment', 43));
  assert.ok(liquidityScore('real_estate', 77) > liquidityScore('real_estate', 43));
  assert.ok(liquidityScore('claim', 77) < liquidityScore('vehicle', 77));
});

test('urgencyScore: срочность падает с ростом срока и обнуляется после дедлайна', () => {
  assert.equal(urgencyScore('2026-08-11T00:00:00.000Z', NOW), 100);
  assert.equal(urgencyScore('2026-08-14T00:00:00.000Z', NOW), 80);
  assert.equal(urgencyScore('2026-09-10T00:00:00.000Z', NOW), 25);
  assert.equal(urgencyScore('2026-08-09T00:00:00.000Z', NOW), 0);
  assert.equal(urgencyScore(undefined, NOW), 20);
});

test('median: чётная и нечётная выборки', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.throws(() => median([]), RangeError);
});

test('ComparablesEstimator: недвижимость оценивается по цене за метр', async () => {
  const comparables: Comparable[] = Array.from({ length: 6 }, (_, i) => ({
    assetKind: 'real_estate',
    regionCode: 77,
    areaSqm: 50,
    startPrice: 12_000_000,
    soldPrice: 10_000_000,
    soldAt: `2026-0${i + 1}-01T00:00:00.000Z`,
  }));

  const estimator = new ComparablesEstimator(new StubComparables(comparables), {
    minComparables: 5,
    uplift: 1,
  });

  const estimate = await estimator.estimate(makeLot());
  assert.ok(estimate);
  assert.equal(estimate.value, 10_000_000, '200 000 ₽/м² × 50 м²');
  assert.equal(estimate.method, 'comparables/price_per_sqm');
  assert.ok(estimate.confidence > 0.5 && estimate.confidence <= 1);
});

test('ComparablesEstimator: неплощадные активы оцениваются долей от начальной цены', async () => {
  const comparables: Comparable[] = Array.from({ length: 6 }, () => ({
    assetKind: 'vehicle',
    regionCode: 50,
    startPrice: 1_000_000,
    soldPrice: 800_000,
    soldAt: '2026-05-01T00:00:00.000Z',
  }));

  const estimator = new ComparablesEstimator(new StubComparables(comparables), {
    minComparables: 5,
    uplift: 1,
  });

  const lot = makeLot({
    title: 'Автомобиль TOYOTA CAMRY, 2019',
    description: 'VIN XW7BF4FK50S123456. Аукцион.',
    startPrice: 1_250_000,
    regionCode: 50,
  });

  const estimate = await estimator.estimate(lot);
  assert.ok(estimate);
  assert.equal(estimate.value, 1_000_000, '80% от начальной цены');
  assert.equal(estimate.method, 'comparables/ratio_to_start');
});

test('ComparablesEstimator: мало данных — оценки нет', async () => {
  const estimator = new ComparablesEstimator(
    new StubComparables([
      {
        assetKind: 'real_estate',
        regionCode: 77,
        areaSqm: 50,
        startPrice: 1,
        soldPrice: 1,
        soldAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
    { minComparables: 5, uplift: 1 },
  );

  assert.equal(await estimator.estimate(makeLot()), null);
});

test('ComparablesEstimator: без региона выборка расширяется, но доверие падает', async () => {
  const comparables: Comparable[] = Array.from({ length: 6 }, () => ({
    assetKind: 'real_estate',
    regionCode: 66,
    areaSqm: 50,
    startPrice: 12_000_000,
    soldPrice: 10_000_000,
    soldAt: '2026-05-01T00:00:00.000Z',
  }));

  const estimator = new ComparablesEstimator(new StubComparables(comparables), {
    minComparables: 5,
    uplift: 1,
  });

  const estimate = await estimator.estimate(makeLot());
  assert.ok(estimate);
  assert.ok(estimate.basis.includes('без учёта региона'));
  assert.ok(estimate.confidence < 0.7);
});

test('CompositeEstimator: ручная оценка имеет приоритет', async () => {
  const lot = makeLot();
  const composite = new CompositeEstimator([
    new OverridesEstimator(new Map([[lot.id, 9_000_000]])),
    new ComparablesEstimator(new StubComparables([]), { minComparables: 5, uplift: 1 }),
  ]);

  const estimate = await composite.estimate(lot);
  assert.equal(estimate?.value, 9_000_000);
  assert.equal(estimate?.method, 'manual');
});

test('scoreLot: дисконт к оценке поднимает балл', async () => {
  const lot = makeLot({ startPrice: 5_000_000 });
  const cheap = scoreLot({
    lot,
    estimate: { value: 10_000_000, confidence: 0.8, method: 'test', basis: 'тест' },
    now: NOW,
  });
  const expensive = scoreLot({
    lot,
    estimate: { value: 5_200_000, confidence: 0.8, method: 'test', basis: 'тест' },
    now: NOW,
  });

  assert.ok(cheap.score > expensive.score);
  assert.equal(Math.round(cheap.discount! * 100), 50);
  assert.ok(cheap.reasons.some((r) => r.includes('ниже оценки')));
});

test('scoreLot: цена выше оценки не даёт отрицательного вклада', () => {
  const result = scoreLot({
    lot: makeLot({ startPrice: 5_000_000 }),
    estimate: { value: 2_000_000, confidence: 0.8, method: 'test', basis: 'тест' },
    now: NOW,
  });

  assert.equal(result.components.discount, 0);
  assert.ok(result.discount! < 0);
  assert.ok(result.reasons.some((r) => r.includes('выше оценки')));
});

test('scoreLot: без оценки балл ограничен потолком', () => {
  const result = scoreLot({ lot: makeLot(), estimate: null, now: NOW });

  assert.ok(result.score <= 45, 'лот без базы сравнения не может выглядеть отличной сделкой');
  assert.equal(result.discount, null);
  assert.ok(result.reasons.some((r) => r.includes('Оценка не построена')));
});

test('scoreLot: после дедлайна балл обнуляется', () => {
  const result = scoreLot({
    lot: makeLot({ applicationEnd: '2026-08-01T00:00:00.000Z' }),
    estimate: { value: 50_000_000, confidence: 0.9, method: 'test', basis: 'тест' },
    now: NOW,
  });

  assert.equal(result.score, 0, 'лот, куда уже нельзя подать заявку, не должен всплывать в топе');
  assert.ok(result.reasons.some((r) => r.includes('Приём заявок завершён')));
});

test('scoreLot: тяжёлые риски снижают балл и попадают в объяснение', () => {
  const clean = scoreLot({
    lot: makeLot(),
    estimate: { value: 10_000_000, confidence: 0.8, method: 'test', basis: 'тест' },
    now: NOW,
  });

  const risky = scoreLot({
    lot: makeLot({
      description:
        'Кадастровый номер 77:06:0004009:1234. В квартире зарегистрированы лица. ' +
        'Имеется действующий договор аренды. Право собственности не зарегистрировано.',
    }),
    estimate: { value: 10_000_000, confidence: 0.8, method: 'test', basis: 'тест' },
    now: NOW,
  });

  assert.ok(risky.score < clean.score);
  assert.ok(risky.components.riskPenalty > 0);
  assert.ok(risky.reasons.some((r) => r.startsWith('Риск:')));
});

test('scoreLot: на публичном предложении в объяснении есть следующее снижение', () => {
  const lot = makeLot({
    title: 'Квартира 50 кв.м',
    description:
      'Продажа посредством публичного предложения. Кадастровый номер 77:06:0004009:1234. ' +
      'Цена снижается каждые 7 календарных дней на 10% от начальной цены до 50% от начальной цены.',
    startPrice: 5_000_000,
    applicationStart: '2026-08-08T00:00:00.000Z',
    applicationEnd: '2026-10-01T00:00:00.000Z',
  });

  const result = scoreLot({
    lot,
    estimate: { value: 10_000_000, confidence: 0.8, method: 'test', basis: 'тест' },
    now: NOW,
  });

  assert.ok(result.reasons.some((r) => r.includes('Следующее снижение')));
  assert.equal(result.currentPrice, 5_000_000);
});
