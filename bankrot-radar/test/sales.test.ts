import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeImportStats, resolveSale } from '../src/enrich/sales.ts';
import type { RawSale } from '../src/enrich/sales.ts';
import { CsvImportError, mapColumns, parseCsv, salesFromCsv } from '../src/import/csv.ts';
import { isResultMessage, salesFromFedresursResultMessage } from '../src/normalize/fromFedresursResult.ts';
import { assembleLot } from '../src/normalize/assemble.ts';
import { ComparablesEstimator } from '../src/enrich/estimator.ts';
import { ComparablesRepo } from '../src/storage/comparablesRepo.ts';
import { openDb } from '../src/storage/db.ts';
import { LotsRepo } from '../src/storage/lotsRepo.ts';
import { importSales } from '../src/pipeline.ts';
import type { PipelineDeps } from '../src/pipeline.ts';
import { loadConfig } from '../src/config.ts';
import { ConsoleNotifier } from '../src/notify/notifier.ts';

const NOW = new Date('2026-08-10T00:00:00.000Z');

function baseSale(overrides: Partial<RawSale> = {}): RawSale {
  return {
    sourceId: 'sale:1',
    title: 'Квартира 50 кв.м',
    assetKind: 'real_estate',
    regionCode: 77,
    areaSqm: 50,
    startPrice: 10_000_000,
    soldPrice: 8_000_000,
    soldAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

test('resolveSale: полная запись принимается', () => {
  const { sale } = resolveSale(baseSale());
  assert.ok(sale);
  assert.equal(sale.soldPrice, 8_000_000);
  assert.equal(sale.assetKind, 'real_estate');
});

test('resolveSale: недостающие поля добираются из связанного лота', () => {
  const lot = assembleLot({
    sourceSystem: 'fedresurs',
    sourceId: 'msg-1',
    title: 'Квартира, общая площадь 50 кв.м, г. Москва',
    description: 'Кадастровый номер 77:06:0004009:1234. Аукцион на повышение.',
    startPrice: 10_000_000,
  });

  const raw = baseSale({
    lotKey: lot.id,
    assetKind: undefined,
    regionCode: undefined,
    areaSqm: undefined,
    startPrice: undefined,
  });

  const { sale } = resolveSale(raw, (key) => (key === lot.id ? lot : null));

  assert.ok(sale, 'сообщение о результатах без характеристик достраивается по объявлению');
  assert.equal(sale.startPrice, 10_000_000);
  assert.equal(sale.assetKind, 'real_estate');
  assert.equal(sale.regionCode, 77);
  assert.equal(sale.areaSqm, 50);
});

test('resolveSale: без начальной цены и без связки запись отклоняется', () => {
  const { sale, reason } = resolveSale(baseSale({ startPrice: undefined }));
  assert.equal(sale, null);
  assert.equal(reason, 'no_start_price');
});

test('resolveSale: неопознанный вид имущества отклоняется', () => {
  const { sale, reason } = resolveSale(baseSale({ assetKind: undefined }));
  assert.equal(sale, null);
  assert.equal(reason, 'no_asset_kind');
});

test('resolveSale: смешанный лот не попадает в выборку', () => {
  const { reason } = resolveSale(baseSale({ assetKind: 'other' }));
  assert.equal(reason, 'no_asset_kind');
});

test('resolveSale: неправдоподобное отношение цен отсекается', () => {
  const { sale, reason } = resolveSale(baseSale({ startPrice: 1_000, soldPrice: 8_000_000 }));
  assert.equal(sale, null);
  assert.equal(reason, 'implausible_ratio', 'лишние нули в колонке не должны перекашивать медиану');
});

test('resolveSale: нулевая цена продажи отклоняется', () => {
  assert.equal(resolveSale(baseSale({ soldPrice: 0 })).reason, 'no_sold_price');
});

test('describeImportStats: причины отказов попадают в отчёт', () => {
  const text = describeImportStats({
    total: 10,
    accepted: 7,
    rejected: { no_sold_price: 1, no_start_price: 2, no_asset_kind: 0, implausible_ratio: 0 },
  });
  assert.match(text, /принято 7 из 10/);
  assert.match(text, /без начальной цены: 2/);
  assert.doesNotMatch(text, /вид имущества/, 'нулевые причины не засоряют вывод');
});

test('parseCsv: кавычки, разделители внутри поля и переносы строк', () => {
  const rows = parseCsv('a,b\n"1,5","строка с ""кавычками"""\n');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1,5', 'строка с "кавычками"'],
  ]);
});

test('parseCsv: определяет точку с запятой как разделитель', () => {
  const rows = parseCsv('наименование;цена продажи\nКвартира;8 000 000\n');
  assert.deepEqual(rows[1], ['Квартира', '8 000 000']);
});

test('parseCsv: BOM в начале файла не ломает заголовок', () => {
  const rows = parseCsv('﻿title,sold_price\nКвартира,100\n');
  assert.equal(rows[0]![0], 'title');
});

test('mapColumns: русские заголовки распознаются', () => {
  const map = mapColumns(['Наименование', 'Регион', 'Площадь', 'Начальная цена', 'Цена продажи', 'Дата']);
  assert.equal(map.title, 0);
  assert.equal(map.regionCode, 1);
  assert.equal(map.areaSqm, 2);
  assert.equal(map.startPrice, 3);
  assert.equal(map.soldPrice, 4);
  assert.equal(map.soldAt, 5);
});

test('salesFromCsv: русская выгрузка разбирается целиком', () => {
  const csv = [
    'Наименование;Регион;Площадь;Начальная цена;Цена продажи;Дата',
    'Квартира 54 кв.м, Москва;77;54;10 000 000;8 100 000;15.05.2026',
    'Автомобиль TOYOTA CAMRY;50;;1 200 000;950 000;20.06.2026',
  ].join('\n');

  const sales = salesFromCsv(csv, { sourcePrefix: 'export' });

  assert.equal(sales.length, 2);
  assert.equal(sales[0]!.sourceId, 'export:1');
  assert.equal(sales[0]!.regionCode, 77);
  assert.equal(sales[0]!.areaSqm, 54);
  assert.equal(sales[0]!.startPrice, 10_000_000);
  assert.equal(sales[0]!.soldPrice, 8_100_000);
  assert.equal(sales[0]!.soldAt, '2026-05-15T00:00:00.000Z');
  assert.equal(sales[0]!.assetKind, 'real_estate', 'вид определяется по наименованию');
  assert.equal(sales[1]!.assetKind, 'vehicle');
  assert.equal(sales[1]!.areaSqm, undefined);
});

test('salesFromCsv: строки без цены продажи пропускаются', () => {
  const csv = 'title,sold_price\nБез цены,\nС ценой,100000\n';
  const sales = salesFromCsv(csv);
  assert.equal(sales.length, 1);
  assert.equal(sales[0]!.soldPrice, 100_000);
});

test('salesFromCsv: отсутствие колонки с ценой — понятная ошибка', () => {
  assert.throws(() => salesFromCsv('наименование;регион\nКвартира;77\n'), CsvImportError);
});

test('salesFromCsv: пустой файл не падает', () => {
  assert.deepEqual(salesFromCsv(''), []);
});

test('isResultMessage: объявление о торгах не принимается за результат', () => {
  assert.equal(isResultMessage({ messageType: 'Объявление о результатах торгов' }), true);
  assert.equal(isResultMessage({ messageType: 'Объявление о проведении торгов' }), false);
  assert.equal(isResultMessage({}), false);
});

test('fromFedresursResult: результат торгов разбирается в запись о продаже', () => {
  const sales = salesFromFedresursResultMessage({
    guid: 'msg-500',
    messageType: 'Сообщение о результатах торгов',
    publishDate: '2026-06-01T00:00:00Z',
    debtor: { inn: '7701234567' },
    lots: [
      {
        lotNumber: 1,
        name: 'Квартира 50 кв.м',
        description: 'Кадастровый номер 77:06:0004009:1234, общая площадь 50 кв.м',
        startPrice: 10_000_000,
        winnerPrice: 8_100_000,
        protocolDate: '25.05.2026',
      },
    ],
  });

  assert.equal(sales.length, 1);
  assert.equal(sales[0]!.soldPrice, 8_100_000);
  assert.equal(sales[0]!.startPrice, 10_000_000);
  assert.equal(sales[0]!.areaSqm, 50);
  assert.equal(sales[0]!.soldAt, '2026-05-25T00:00:00.000Z');
  assert.equal(sales[0]!.lotKey, 'cad:77:06:0004009:1234', 'ключ связывает результат с объявлением');
});

test('fromFedresursResult: несостоявшиеся торги не попадают в выборку', () => {
  const sales = salesFromFedresursResultMessage({
    guid: 'msg-501',
    messageType: 'Сообщение о результатах торгов',
    lots: [{ lotNumber: 1, name: 'Квартира', startPrice: 10_000_000 }],
  });
  assert.deepEqual(sales, [], 'без цены победителя учиться нечему');
});

test('fromFedresursResult: объявление о торгах игнорируется', () => {
  const sales = salesFromFedresursResultMessage({
    guid: 'msg-502',
    messageType: 'Объявление о проведении торгов',
    lots: [{ lotNumber: 1, name: 'Квартира', startPrice: 10_000_000, price: 9_000_000 }],
  });
  assert.deepEqual(sales, []);
});

test('importSales: наполнение выборки включает оценку', async () => {
  const config = loadConfig({ RADAR_DB: ':memory:' } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const comparables = new ComparablesRepo(db);
  const estimator = new ComparablesEstimator(comparables, {
    minComparables: config.estimate.minComparables,
    uplift: config.estimate.uplift,
  });

  const deps: PipelineDeps = {
    db,
    lots: new LotsRepo(db),
    alerts: { shouldSend: () => true, record: () => {}, last: () => null } as never,
    estimator,
    notifier: new ConsoleNotifier(),
    config,
  };

  const lot = assembleLot({
    sourceSystem: 'manual',
    sourceId: 'lot-1',
    title: 'Квартира, общая площадь 50 кв.м, г. Москва',
    description: 'Кадастровый номер 77:06:0004009:9999. Аукцион на повышение.',
    startPrice: 5_000_000,
    applicationEnd: '2026-09-01T00:00:00.000Z',
  });
  deps.lots.upsert(lot, NOW);

  assert.equal(await estimator.estimate(lot), null, 'до наполнения выборки оценки нет');

  const sales: RawSale[] = Array.from({ length: 6 }, (_, i) => ({
    sourceId: `sale:${i}`,
    title: 'Квартира, Москва',
    assetKind: 'real_estate',
    regionCode: 77,
    areaSqm: 50,
    startPrice: 12_000_000,
    soldPrice: 10_000_000,
    soldAt: '2026-05-01T00:00:00.000Z',
  }));

  const stats = importSales(deps, sales);
  assert.equal(stats.accepted, 6);
  assert.equal(comparables.count(), 6);

  const estimate = await estimator.estimate(lot);
  assert.ok(estimate, 'после наполнения выборки оценка появляется');
  assert.equal(estimate.value, 10_000_000);
});

test('importSales: повторный импорт не задваивает записи', () => {
  const config = loadConfig({ RADAR_DB: ':memory:' } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const comparables = new ComparablesRepo(db);

  const deps: PipelineDeps = {
    db,
    lots: new LotsRepo(db),
    alerts: { shouldSend: () => true, record: () => {}, last: () => null } as never,
    estimator: new ComparablesEstimator(comparables, { minComparables: 5, uplift: 1 }),
    notifier: new ConsoleNotifier(),
    config,
  };

  importSales(deps, [baseSale()]);
  importSales(deps, [baseSale({ soldPrice: 8_500_000 })]);

  assert.equal(comparables.count(), 1, 'запись с тем же идентификатором обновляется, а не дублируется');
  assert.equal(comparables.find({ assetKind: 'real_estate' })[0]!.soldPrice, 8_500_000);
});

test('countByKind: показывает наполненность по видам имущества', () => {
  const db = openDb(':memory:');
  const comparables = new ComparablesRepo(db);

  comparables.addMany([
    { id: '1', assetKind: 'real_estate', regionCode: 77, startPrice: 1, soldPrice: 1, soldAt: '2026-01-01' },
    { id: '2', assetKind: 'real_estate', startPrice: 1, soldPrice: 1, soldAt: '2026-01-01' },
    { id: '3', assetKind: 'vehicle', regionCode: 50, startPrice: 1, soldPrice: 1, soldAt: '2026-01-01' },
  ]);

  const byKind = comparables.countByKind();
  assert.equal(byKind[0]!.assetKind, 'real_estate');
  assert.equal(byKind[0]!.total, 2);
  assert.equal(byKind[0]!.withRegion, 1);
});
