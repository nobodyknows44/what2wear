import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBacktest } from '../src/diagnostics/backtest.ts';
import type { Comparable, ComparablesQuery, ComparablesSource } from '../src/enrich/estimator.ts';
import { ComparablesRepo } from '../src/storage/comparablesRepo.ts';
import type { SoldLotInput } from '../src/storage/comparablesRepo.ts';
import { openDb } from '../src/storage/db.ts';

/** Честно исполняет excludeId и soldBefore — иначе проверять было бы нечего. */
class StubSource implements ComparablesSource {
  readonly queries: ComparablesQuery[] = [];
  #items: SoldLotInput[];

  constructor(items: SoldLotInput[]) {
    this.#items = items;
  }

  find(query: ComparablesQuery): Comparable[] {
    this.queries.push(query);
    return this.#items.filter((item) => {
      if (item.assetKind !== query.assetKind) return false;
      if (query.regionCode !== undefined && item.regionCode !== query.regionCode) return false;
      if (query.minArea !== undefined && (item.areaSqm ?? 0) < query.minArea) return false;
      if (query.maxArea !== undefined && (item.areaSqm ?? 0) > query.maxArea) return false;
      if (query.excludeId !== undefined && item.id === query.excludeId) return false;
      if (query.soldBefore !== undefined && item.soldAt >= query.soldBefore) return false;
      return true;
    });
  }
}

function flatSale(index: number, overrides: Partial<SoldLotInput> = {}): SoldLotInput {
  const day = String(index + 1).padStart(2, '0');
  return {
    id: `sale-${index}`,
    assetKind: 'real_estate',
    regionCode: 77,
    areaSqm: 50,
    startPrice: 12_000_000,
    soldPrice: 10_000_000,
    soldAt: `2026-01-${day}T00:00:00.000Z`,
    title: `Квартира ${index}`,
    ...overrides,
  };
}

test('runBacktest: продажа не участвует в собственной оценке', async () => {
  // Двадцать сделок по 10 млн и одна, резко выбивающаяся. Если бы выброс
  // участвовал в своей же оценке, ошибка по нему оказалась бы заметно меньше.
  const normal = Array.from({ length: 20 }, (_, i) => flatSale(i));
  const outlier = flatSale(20, { id: 'outlier', soldPrice: 30_000_000 });
  const source = new StubSource([...normal, outlier]);

  const report = await runBacktest([outlier], source, { minComparables: 5 });

  assert.equal(report.evaluated, 1);
  const outcome = report.outcomes[0]!;
  assert.equal(outcome.estimate, 10_000_000, 'оценка построена только по остальным сделкам');
  assert.ok(outcome.error < -0.6, 'ошибка не скрыта участием лота в собственной выборке');
  assert.ok(
    source.queries.every((q) => q.excludeId === 'outlier'),
    'исключение проверяемой продажи передаётся в каждый запрос',
  );
});

test('runBacktest: сделки позже проверяемой не учитываются', async () => {
  const past = Array.from({ length: 6 }, (_, i) => flatSale(i, { soldPrice: 10_000_000 }));
  const target = flatSale(10, { id: 'target', soldAt: '2026-02-01T00:00:00.000Z' });
  const future = Array.from({ length: 20 }, (_, i) =>
    flatSale(i, {
      id: `future-${i}`,
      soldAt: '2026-03-01T00:00:00.000Z',
      soldPrice: 40_000_000,
    }),
  );

  const source = new StubSource([...past, target, ...future]);
  const report = await runBacktest([target], source, { minComparables: 5 });

  assert.equal(
    report.outcomes[0]!.estimate,
    10_000_000,
    'мартовские сделки в феврале ещё не существовали',
  );
  assert.ok(source.queries.every((q) => q.soldBefore === target.soldAt));
});

test('runBacktest: без достаточной выборки продажа пропускается, а не оценивается наугад', async () => {
  const source = new StubSource([flatSale(0), flatSale(1)]);
  const report = await runBacktest([flatSale(2)], source, { minComparables: 5 });

  assert.equal(report.evaluated, 0);
  assert.equal(report.skipped, 1);
  assert.equal(report.medianAbsError, null);
  assert.equal(report.suggestedUplift, null);
});

test('runBacktest: систематическое занижение даёт отрицательное смещение', async () => {
  // Аналоги уходили по 8 млн, проверяемые — по 10 млн: оценка занижает на 20%.
  const history = Array.from({ length: 10 }, (_, i) =>
    flatSale(i, { id: `hist-${i}`, soldPrice: 8_000_000 }),
  );
  const targets = Array.from({ length: 5 }, (_, i) =>
    flatSale(i, {
      id: `target-${i}`,
      soldAt: '2026-02-01T00:00:00.000Z',
      soldPrice: 10_000_000,
    }),
  );

  const report = await runBacktest(targets, new StubSource([...history, ...targets]), {
    minComparables: 5,
  });

  assert.equal(report.evaluated, 5);
  assert.equal(report.medianBias, -0.2);
  assert.equal(report.medianAbsError, 0.2);
});

test('runBacktest: множитель предлагается только при достаточной выборке', async () => {
  const history = Array.from({ length: 40 }, (_, i) =>
    flatSale(i % 28, { id: `hist-${i}`, soldPrice: 8_000_000 }),
  );
  const targets = Array.from({ length: 40 }, (_, i) =>
    flatSale(i % 28, {
      id: `target-${i}`,
      soldAt: '2026-02-01T00:00:00.000Z',
      soldPrice: 10_000_000,
    }),
  );
  const source = new StubSource([...history, ...targets]);

  const enough = await runBacktest(targets, source, { minComparables: 5, minEvaluated: 30 });
  assert.equal(enough.suggestedUplift, 1.25, 'занижение на 20% компенсируется множителем 1/0.8');

  const notEnough = await runBacktest(targets, source, { minComparables: 5, minEvaluated: 100 });
  assert.equal(notEnough.suggestedUplift, null, 'выборки мало — подгонка под шум не предлагается');
});

test('runBacktest: смещение в пределах шума множителя не рождает', async () => {
  const history = Array.from({ length: 40 }, (_, i) =>
    flatSale(i % 28, { id: `hist-${i}`, soldPrice: 10_000_000 }),
  );
  const targets = Array.from({ length: 40 }, (_, i) =>
    flatSale(i % 28, {
      id: `target-${i}`,
      soldAt: '2026-02-01T00:00:00.000Z',
      soldPrice: 10_200_000,
    }),
  );

  const report = await runBacktest(targets, new StubSource([...history, ...targets]), {
    minComparables: 5,
    minEvaluated: 30,
  });

  assert.ok(Math.abs(report.medianBias!) < 0.05);
  assert.equal(report.suggestedUplift, null);
});

test('runBacktest: разбивка по видам имущества', async () => {
  const flats = Array.from({ length: 10 }, (_, i) => flatSale(i, { id: `flat-${i}` }));
  const cars = Array.from({ length: 10 }, (_, i) =>
    flatSale(i, {
      id: `car-${i}`,
      assetKind: 'vehicle',
      areaSqm: undefined,
      startPrice: 1_000_000,
      soldPrice: 800_000,
    }),
  );
  const targets = [
    flatSale(0, { id: 'flat-target', soldAt: '2026-02-01T00:00:00.000Z' }),
    flatSale(0, {
      id: 'car-target',
      assetKind: 'vehicle',
      areaSqm: undefined,
      startPrice: 1_000_000,
      soldPrice: 800_000,
      soldAt: '2026-02-01T00:00:00.000Z',
    }),
  ];

  const report = await runBacktest(targets, new StubSource([...flats, ...cars, ...targets]), {
    minComparables: 5,
  });

  assert.equal(report.byKind.length, 2);
  assert.deepEqual(report.byKind.map((k) => k.assetKind).sort(), ['real_estate', 'vehicle']);
});

test('runBacktest: пустая история и нулевые цены не роняют отчёт', async () => {
  const empty = await runBacktest([], new StubSource([]), { minComparables: 5 });
  assert.equal(empty.total, 0);
  assert.equal(empty.medianBias, null);

  const broken = await runBacktest([flatSale(0, { soldPrice: 0 })], new StubSource([]), {
    minComparables: 5,
  });
  assert.equal(broken.skipped, 1);
});

test('ComparablesRepo: excludeId и soldBefore работают на настоящем хранилище', () => {
  const repo = new ComparablesRepo(openDb(':memory:'));
  repo.addMany([
    flatSale(0, { id: 'a', soldAt: '2026-01-01T00:00:00.000Z' }),
    flatSale(1, { id: 'b', soldAt: '2026-02-01T00:00:00.000Z' }),
    flatSale(2, { id: 'c', soldAt: '2026-03-01T00:00:00.000Z' }),
  ]);

  assert.equal(repo.find({ assetKind: 'real_estate' }).length, 3);
  assert.equal(repo.find({ assetKind: 'real_estate', excludeId: 'b' }).length, 2);
  assert.equal(
    repo.find({ assetKind: 'real_estate', soldBefore: '2026-02-01T00:00:00.000Z' }).length,
    1,
  );
});

test('ComparablesRepo: list отдаёт выборку по возрастанию даты', () => {
  const repo = new ComparablesRepo(openDb(':memory:'));
  repo.addMany([
    flatSale(0, { id: 'late', soldAt: '2026-03-01T00:00:00.000Z' }),
    flatSale(1, { id: 'early', soldAt: '2026-01-01T00:00:00.000Z' }),
  ]);

  assert.deepEqual(
    repo.list().map((s) => s.id),
    ['early', 'late'],
  );
});
