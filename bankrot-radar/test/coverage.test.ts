import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bar, coverageReport, needsAttention } from '../src/diagnostics/coverage.ts';
import type { Lot } from '../src/domain/lot.ts';
import { assembleLot } from '../src/normalize/assemble.ts';

function flat(overrides: Partial<Parameters<typeof assembleLot>[0]> = {}): Lot {
  return assembleLot({
    sourceSystem: 'manual',
    sourceId: `lot-${Math.random()}`,
    title: 'Квартира, общая площадь 54,3 кв.м, г. Москва',
    description:
      'Кадастровый номер 77:06:0004009:1234. Аукцион на повышение. Задаток 650 000 руб. ИНН 7701234567.',
    startPrice: 6_500_000,
    applicationEnd: '2026-09-02T09:00:00.000Z',
    ...overrides,
  });
}

function metric(lots: Lot[], code: string) {
  return coverageReport(lots).metrics.find((m) => m.code === code)!;
}

test('coverageReport: полностью разобранный лот покрыт по всем метрикам', () => {
  const report = coverageReport([flat()]);
  assert.equal(report.totalLots, 1);

  for (const m of report.metrics) {
    if (m.applicable === 0) continue;
    assert.equal(m.share, 1, m.code);
  }
});

test('coverageReport: применимость учитывает вид имущества', () => {
  const car = flat({
    title: 'Автомобиль TOYOTA CAMRY',
    description: 'VIN XW7BF4FK50S123456. Аукцион. Задаток 250 000 руб. ИНН 7701234567.',
  });

  // Спрашивать площадь с автомобиля бессмысленно: он не должен портить метрику.
  assert.equal(metric([car], 'area').applicable, 0);
  assert.equal(metric([car], 'area').share, null);
  assert.equal(metric([car], 'stable_key').covered, 1, 'VIN — тоже устойчивый идентификатор');
});

test('coverageReport: доля без применимых лотов равна null, а не единице', () => {
  const schedule = metric([flat()], 'price_schedule');
  assert.equal(schedule.applicable, 0, 'аукцион не подпадает под метрику графика снижения');
  assert.equal(schedule.share, null);
});

test('coverageReport: неразобранная формула снижения видна в метрике графика', () => {
  const parsed = flat({
    description:
      'Продажа посредством публичного предложения. Кадастровый номер 77:06:0004009:1234. ' +
      'Цена снижается каждые 7 календарных дней на 10% от начальной цены до 50% от начальной цены.',
  });
  const unparsed = flat({
    description:
      'Продажа посредством публичного предложения. Кадастровый номер 77:06:0004009:5555. ' +
      'Снижение цены согласно графику, приведённому в приложении к положению о продаже.',
  });

  const m = metric([parsed, unparsed], 'price_schedule');
  assert.equal(m.applicable, 2);
  assert.equal(m.covered, 1, 'график из приложения правилами не разбирается');
  assert.deepEqual(m.samples, [unparsed.title]);
});

test('coverageReport: примеры берутся только из непокрытых и ограничены по числу', () => {
  const bad = Array.from({ length: 5 }, (_, i) =>
    flat({ sourceId: `bad-${i}`, title: `Оборудование ${i}`, description: 'Аукцион.' }),
  );
  const m = coverageReport([flat(), ...bad], { sampleSize: 2 }).metrics.find(
    (x) => x.code === 'debtor_inn',
  )!;

  assert.equal(m.samples.length, 2);
  for (const sample of m.samples) assert.match(sample, /Оборудование/);
});

test('coverageReport: метрики отсортированы от худшего покрытия', () => {
  const lots = [
    flat(),
    flat({ sourceId: 'x', title: 'Оборудование цеха', description: 'Аукцион.' }),
  ];
  const shares = coverageReport(lots).metrics.map((m) => m.share ?? 2);
  assert.deepEqual(shares, [...shares].sort((a, b) => a - b));
});

test('coverageReport: пустая база не роняет отчёт', () => {
  const report = coverageReport([]);
  assert.equal(report.totalLots, 0);
  assert.ok(report.metrics.every((m) => m.share === null && m.samples.length === 0));
});

test('needsAttention: малая выборка не считается проблемой', () => {
  const lots = [flat({ sourceId: 'a', title: 'Оборудование', description: 'Аукцион.' })];
  const report = coverageReport(lots);

  assert.deepEqual(needsAttention(report, 0.8, 10), [], 'на одном лоте любая доля — шум');
  assert.ok(needsAttention(report, 0.8, 1).length > 0, 'порог выборки снимается явно');
});

test('needsAttention: порог покрытия соблюдается', () => {
  // Девять разобранных лотов и один нет: 90% выше порога 0.8, но ниже 0.95.
  const lots = [
    ...Array.from({ length: 9 }, (_, i) => flat({ sourceId: `ok-${i}` })),
    flat({ sourceId: 'bad', title: 'Оборудование', description: 'Аукцион.' }),
  ];
  const report = coverageReport(lots);

  assert.equal(needsAttention(report, 0.8, 10).length, 0);
  assert.ok(needsAttention(report, 0.95, 10).some((m) => m.code === 'debtor_inn'));
});

test('bar: полоска отражает долю и не ломается на null', () => {
  assert.equal(bar(1, 4), '████');
  assert.equal(bar(0, 4), '░░░░');
  assert.equal(bar(0.5, 4), '██░░');
  assert.equal(bar(null, 4), '————');
});
