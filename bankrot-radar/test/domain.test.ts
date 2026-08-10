import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchedule, finishesAt, minPrice, nextDrop, priceAt } from '../src/domain/priceSchedule.ts';
import { lotKey, mergeLots, slugifyTitle } from '../src/domain/dedupe.ts';
import { parseRegionList, regionFromCadastral, regionName } from '../src/domain/regions.ts';
import type { Lot } from '../src/domain/lot.ts';
import { lotAssetKind, totalArea } from '../src/domain/lot.ts';

const START = new Date('2026-08-01T00:00:00.000Z');

test('buildSchedule: снижение на 10% каждые 7 дней до 50% даёт 6 периодов', () => {
  const schedule = buildSchedule({
    startPrice: 1_000_000,
    startAt: START,
    stepDays: 7,
    stepShareOfStart: 0.1,
    floorShareOfStart: 0.5,
  });

  assert.equal(schedule.length, 6);
  assert.equal(schedule[0]!.price, 1_000_000);
  assert.equal(schedule.at(-1)!.price, 500_000);
  assert.equal(schedule[1]!.price, 900_000);
});

test('buildSchedule: периоды стыкуются без разрывов', () => {
  const schedule = buildSchedule({
    startPrice: 500_000,
    startAt: START,
    stepDays: 5,
    stepShareOfStart: 0.2,
    floorShareOfStart: 0.4,
  });

  for (let i = 1; i < schedule.length; i++) {
    assert.equal(schedule[i]!.from, schedule[i - 1]!.to);
  }
});

test('priceAt: цена берётся из действующего периода', () => {
  const schedule = buildSchedule({
    startPrice: 1_000_000,
    startAt: START,
    stepDays: 7,
    stepShareOfStart: 0.1,
    floorShareOfStart: 0.5,
  });

  assert.equal(priceAt(schedule, new Date('2026-08-03T00:00:00.000Z')), 1_000_000);
  assert.equal(priceAt(schedule, new Date('2026-08-09T00:00:00.000Z')), 900_000);
  assert.equal(priceAt(schedule, new Date('2026-08-16T00:00:00.000Z')), 800_000);
});

test('priceAt: до начала графика возвращается стартовая цена, после конца — null', () => {
  const schedule = buildSchedule({
    startPrice: 100_000,
    startAt: START,
    stepDays: 7,
    stepShareOfStart: 0.25,
    floorShareOfStart: 0.5,
  });

  assert.equal(priceAt(schedule, new Date('2026-07-01T00:00:00.000Z')), 100_000);
  // Завершённые торги не должны выглядеть как «дешёвый лот»: цены больше нет.
  assert.equal(priceAt(schedule, new Date('2027-01-01T00:00:00.000Z')), null);
});

test('priceAt: пустой график не ломает расчёт', () => {
  assert.equal(priceAt([], START), null);
  assert.equal(minPrice([]), null);
  assert.equal(finishesAt([]), null);
});

test('nextDrop: находит ближайшее снижение и его глубину', () => {
  const schedule = buildSchedule({
    startPrice: 1_000_000,
    startAt: START,
    stepDays: 7,
    stepShareOfStart: 0.1,
    floorShareOfStart: 0.5,
  });

  const drop = nextDrop(schedule, new Date('2026-08-03T00:00:00.000Z'));
  assert.ok(drop);
  assert.equal(drop.price, 900_000);
  assert.equal(Math.round(drop.dropShare * 100), 10);
});

test('nextDrop: на последнем периоде снижения больше нет', () => {
  const schedule = buildSchedule({
    startPrice: 200_000,
    startAt: START,
    stepDays: 10,
    stepShareOfStart: 0.5,
    floorShareOfStart: 0.5,
  });

  assert.equal(nextDrop(schedule, new Date('2026-08-15T00:00:00.000Z')), null);
});

test('buildSchedule: отвергает бессмысленные параметры', () => {
  assert.throws(
    () =>
      buildSchedule({
        startPrice: 0,
        startAt: START,
        stepDays: 7,
        stepShareOfStart: 0.1,
        floorShareOfStart: 0.5,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      buildSchedule({
        startPrice: 100,
        startAt: START,
        stepDays: 7,
        stepShareOfStart: 1.5,
        floorShareOfStart: 0.5,
      }),
    RangeError,
  );
});

test('lotKey: кадастровый номер важнее заголовка', () => {
  const a = lotKey({ title: 'Квартира 54 кв.м', assets: [{ cadastralNumber: '77:06:0004009:1234' }] });
  const b = lotKey({
    title: 'Жилое помещение, площадь 54,3',
    assets: [{ cadastralNumber: '77:06:0004009:1234' }],
    startPrice: 999,
  });
  assert.equal(a, b);
});

test('lotKey: VIN используется, когда кадастрового номера нет', () => {
  const key = lotKey({ title: 'Автомобиль', assets: [{ vin: 'xw7bf4fk50s123456' }] });
  assert.equal(key, 'vin:XW7BF4FK50S123456');
});

test('lotKey: без идентификаторов ключ строится по ИНН, цене и заголовку', () => {
  const key = lotKey({ title: 'Оборудование цеха', debtorInn: '7701234567', startPrice: 1_234_500 });
  assert.equal(key, 'inn:7701234567:1235:оборудование-цеха');
});

test('lotKey: расхождение в копейках не порождает дубль', () => {
  const a = lotKey({ title: 'Станок', debtorInn: '7701234567', startPrice: 500_000 });
  const b = lotKey({ title: 'Станок', debtorInn: '7701234567', startPrice: 500_000.4 });
  assert.equal(a, b);
});

test('slugifyTitle: схлопывает регистр и ё', () => {
  assert.equal(slugifyTitle('Ёлочная  ПРОДУКЦИЯ, склад'), 'елочная-продукция-склад');
});

test('mergeLots: слияние добирает недостающие поля, не теряя известных', () => {
  const existing: Lot = {
    id: 'cad:77:06:0004009:1234',
    sourceSystem: 'fedresurs',
    sourceId: 'msg-1',
    title: 'Квартира',
    debtor: { name: 'ООО Ромашка', inn: '7701234567' },
    procedure: 'public_offer',
    status: 'announced',
    startPrice: 1_000_000,
    priceSchedule: [{ from: START.toISOString(), to: '2026-09-01T00:00:00.000Z', price: 1_000_000 }],
    assets: [{ kind: 'real_estate', title: 'Квартира', cadastralNumber: '77:06:0004009:1234' }],
    regionCode: 77,
  };

  const incoming: Lot = {
    ...existing,
    sourceSystem: 'torgi_gov',
    sourceId: 'card-9',
    title: 'Квартира, общая площадь 54,3 кв.м, г. Москва',
    debtor: { name: undefined, inn: undefined, caseNumber: 'А40-112233/2024' },
    procedure: 'unknown',
    etpName: 'ЭТП «Пример»',
    deposit: 100_000,
    priceSchedule: [],
    assets: [],
  };

  const merged = mergeLots(existing, incoming);

  assert.equal(merged.debtor.name, 'ООО Ромашка', 'известное имя должника не затирается пустым');
  assert.equal(merged.debtor.caseNumber, 'А40-112233/2024', 'новое поле добавляется');
  assert.equal(merged.procedure, 'public_offer', 'unknown не перетирает известную процедуру');
  assert.equal(merged.etpName, 'ЭТП «Пример»');
  assert.equal(merged.deposit, 100_000);
  assert.equal(merged.priceSchedule.length, 1, 'пустой график не вытесняет заполненный');
  assert.equal(merged.assets.length, 1, 'пустой список активов не вытесняет заполненный');
  assert.ok(merged.title.length > 'Квартира'.length, 'берётся более информативный заголовок');
});

test('regionFromCadastral: код региона из кадастрового номера', () => {
  assert.equal(regionFromCadastral('77:06:0004009:1234'), 77);
  assert.equal(regionFromCadastral('50:04:0060201:445'), 50);
  assert.equal(regionFromCadastral('99:01:0000001:1'), undefined, 'несуществующий код отбрасывается');
  assert.equal(regionFromCadastral('мусор'), undefined);
});

test('parseRegionList: разбирает список и отбрасывает мусор', () => {
  assert.deepEqual(parseRegionList('77, 50,78'), [77, 50, 78]);
  assert.deepEqual(parseRegionList('77,абв,999'), [77]);
  assert.deepEqual(parseRegionList(undefined), []);
});

test('regionName: неизвестный регион не роняет вывод', () => {
  assert.equal(regionName(77), 'Москва');
  assert.equal(regionName(undefined), 'регион не определён');
});

test('lotAssetKind: разнородный лот считается смешанным', () => {
  const lot = {
    assets: [
      { kind: 'real_estate' as const, title: 'Квартира', areaSqm: 40 },
      { kind: 'vehicle' as const, title: 'Автомобиль' },
    ],
  } as Lot;
  assert.equal(lotAssetKind(lot), 'other');
  assert.equal(totalArea(lot), 40);
});
