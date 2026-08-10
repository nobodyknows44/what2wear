import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import type { Lot } from '../src/domain/lot.ts';
import { CompositeEstimator, ComparablesEstimator } from '../src/enrich/estimator.ts';
import { assembleLot } from '../src/normalize/assemble.ts';
import { ingest, passesFilters, scoreAll, sendAlerts } from '../src/pipeline.ts';
import type { PipelineDeps } from '../src/pipeline.ts';
import type { Notifier } from '../src/notify/notifier.ts';
import type { FetchWindow, Source } from '../src/sources/types.ts';
import { AlertsRepo } from '../src/storage/alertsRepo.ts';
import { ComparablesRepo } from '../src/storage/comparablesRepo.ts';
import { openDb } from '../src/storage/db.ts';
import { LotsRepo } from '../src/storage/lotsRepo.ts';
import { demoComparables } from '../src/demo/seed.ts';

const NOW = new Date('2026-08-10T00:00:00.000Z');

class StubSource implements Source {
  readonly name: string;
  readonly system = 'manual' as const;

  #lots: Lot[];
  #error?: Error;

  constructor(name: string, lots: Lot[], error?: Error) {
    this.name = name;
    this.#lots = lots;
    this.#error = error;
  }

  async collect(_window: FetchWindow): Promise<Lot[]> {
    if (this.#error) throw this.#error;
    return this.#lots;
  }
}

class CapturingNotifier implements Notifier {
  readonly channel = 'test';
  readonly messages: string[] = [];

  async send(html: string): Promise<void> {
    this.messages.push(html);
  }
}

function makeContext(env: Record<string, string> = {}): {
  deps: PipelineDeps;
  notifier: CapturingNotifier;
  config: Config;
} {
  const config = loadConfig({ ...env, RADAR_DB: ':memory:' } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const comparables = new ComparablesRepo(db);
  const notifier = new CapturingNotifier();

  const deps: PipelineDeps = {
    db,
    lots: new LotsRepo(db),
    alerts: new AlertsRepo(db),
    estimator: new CompositeEstimator([
      new ComparablesEstimator(comparables, {
        minComparables: config.estimate.minComparables,
        uplift: config.estimate.uplift,
      }),
    ]),
    notifier,
    config,
  };

  comparables.addMany(demoComparables(NOW));
  return { deps, notifier, config };
}

function moscowFlat(overrides: Partial<Parameters<typeof assembleLot>[0]> = {}): Lot {
  return assembleLot({
    sourceSystem: 'fedresurs',
    sourceId: 'msg-1',
    title: 'Квартира, общая площадь 50 кв.м, г. Москва',
    description: 'Кадастровый номер 77:06:0004009:1234. Открытый аукцион на повышение.',
    startPrice: 5_000_000,
    applicationStart: '2026-08-05T00:00:00.000Z',
    applicationEnd: '2026-08-25T00:00:00.000Z',
    ...overrides,
  });
}

test('passesFilters: регион, вид имущества и цена', () => {
  const lot = moscowFlat();

  assert.equal(passesFilters(lot, { regions: [77], assetKinds: [] }), true);
  assert.equal(passesFilters(lot, { regions: [50], assetKinds: [] }), false);
  assert.equal(passesFilters(lot, { regions: [], assetKinds: ['real_estate'] }), true);
  assert.equal(passesFilters(lot, { regions: [], assetKinds: ['vehicle'] }), false);
  assert.equal(passesFilters(lot, { regions: [], assetKinds: [], maxPrice: 1_000_000 }), false);
  assert.equal(passesFilters(lot, { regions: [], assetKinds: [], minPrice: 1_000_000 }), true);
});

test('ingest: один и тот же объект из двух источников не порождает дубль', async () => {
  const { deps } = makeContext();

  const fromFedresurs = moscowFlat();
  const fromTorgi = moscowFlat({
    sourceSystem: 'torgi_gov',
    sourceId: 'card-9',
    title: 'Квартира, общая площадь 50 кв.м, город Москва, продажа с торгов',
    description: 'Кадастровый номер 77:06:0004009:1234. Организатор: ЭТП «Пример».',
  });

  const results = await ingest(
    deps,
    [new StubSource('a', [fromFedresurs]), new StubSource('b', [fromTorgi])],
    { from: new Date('2026-08-01T00:00:00.000Z'), to: NOW },
    NOW,
  );

  assert.equal(results[0]!.inserted, 1);
  assert.equal(results[1]!.inserted, 0, 'второй источник не создаёт новую запись');
  assert.equal(results[1]!.updated, 1, 'а обогащает существующую');
  assert.equal(deps.lots.count(), 1);
});

test('ingest: падение одного источника не останавливает остальные', async () => {
  const { deps } = makeContext();

  const results = await ingest(
    deps,
    [
      new StubSource('broken', [], new Error('502 Bad Gateway')),
      new StubSource('working', [moscowFlat()]),
    ],
    { from: new Date('2026-08-01T00:00:00.000Z'), to: NOW },
    NOW,
  );

  assert.match(results[0]!.error!, /502/);
  assert.equal(results[1]!.inserted, 1);
  assert.equal(deps.lots.count(), 1);
});

test('ingest: прогон записывается в журнал вместе с ошибкой', async () => {
  const { deps } = makeContext();

  await ingest(
    deps,
    [new StubSource('broken', [], new Error('таймаут'))],
    { from: new Date('2026-08-01T00:00:00.000Z'), to: NOW },
    NOW,
  );

  const runs = deps.db.prepare('SELECT source, error, finished_at FROM runs').all() as Record<
    string,
    unknown
  >[];
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.source, 'broken');
  assert.match(String(runs[0]!.error), /таймаут/);
  assert.ok(runs[0]!.finished_at, 'прогон закрывается даже при ошибке');
});

test('ingest: фильтр отсекает лоты вне воронки', async () => {
  const { deps } = makeContext({ FILTER_REGIONS: '50' });

  const results = await ingest(
    deps,
    [new StubSource('a', [moscowFlat()])],
    { from: new Date('2026-08-01T00:00:00.000Z'), to: NOW },
    NOW,
  );

  assert.equal(results[0]!.filtered, 1);
  assert.equal(deps.lots.count(), 0);
});

test('upsert: снижение цены попадает в историю', () => {
  const { deps } = makeContext();

  const day1 = new Date('2026-08-10T00:00:00.000Z');
  const day2 = new Date('2026-08-18T00:00:00.000Z');

  const lot = moscowFlat({
    description:
      'Продажа посредством публичного предложения. Кадастровый номер 77:06:0004009:1234. ' +
      'Цена снижается каждые 7 календарных дней на 10% от начальной цены до 50% от начальной цены.',
    applicationStart: '2026-08-10T00:00:00.000Z',
    applicationEnd: '2026-10-01T00:00:00.000Z',
  });

  deps.lots.upsert(lot, day1);
  deps.lots.upsert(lot, day2);

  const history = deps.lots.priceHistory(lot.id);
  assert.equal(history.length, 2);
  assert.equal(history[0]!.price, 5_000_000);
  assert.equal(history[1]!.price, 4_500_000);
});

test('upsert: неизменная цена не плодит записи истории', () => {
  const { deps } = makeContext();
  const lot = moscowFlat();

  deps.lots.upsert(lot, NOW);
  deps.lots.upsert(lot, new Date('2026-08-11T00:00:00.000Z'));

  assert.equal(deps.lots.priceHistory(lot.id).length, 1);
});

test('scoreAll: лоты с истёкшим сроком подачи не оцениваются', async () => {
  const { deps } = makeContext();

  deps.lots.upsert(moscowFlat(), NOW);
  deps.lots.upsert(
    moscowFlat({
      sourceId: 'msg-2',
      title: 'Квартира, 60 кв.м, г. Москва, срок истёк',
      description: 'Кадастровый номер 77:06:0004009:9999.',
      applicationEnd: '2026-08-01T00:00:00.000Z',
    }),
    NOW,
  );

  const { scored } = await scoreAll(deps, NOW);
  assert.equal(scored, 1, 'просроченный лот не тратит запросы оценки');
});

test('scoreAll: дисконт считается по накопленным продажам', async () => {
  const { deps } = makeContext();

  // Демо-история даёт около 200 000 ₽/м² по Москве, лот идёт по 100 000 ₽/м².
  const lot = moscowFlat({ startPrice: 5_000_000 });
  deps.lots.upsert(lot, NOW);
  await scoreAll(deps, NOW);

  const top = deps.lots.topScored(0, 10);
  assert.equal(top.length, 1);
  assert.ok(top[0]!.estimateValue! > 9_000_000);
  assert.ok(top[0]!.discount! > 0.4);
  assert.ok(top[0]!.score > 50);
});

test('sendAlerts: повторный прогон не дублирует уведомление', async () => {
  const { deps, notifier } = makeContext({ ALERT_MIN_SCORE: '0' });

  deps.lots.upsert(moscowFlat(), NOW);
  await scoreAll(deps, NOW);

  const first = await sendAlerts(deps, NOW);
  const second = await sendAlerts(deps, NOW);

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.suppressed, 1);
  assert.equal(notifier.messages.length, 1);
});

test('sendAlerts: заметное падение цены снимает подавление', async () => {
  const { deps, notifier } = makeContext({ ALERT_MIN_SCORE: '0' });

  const lot = moscowFlat({
    description:
      'Продажа посредством публичного предложения. Кадастровый номер 77:06:0004009:1234. ' +
      'Цена снижается каждые 7 календарных дней на 20% от начальной цены до 40% от начальной цены.',
    applicationStart: '2026-08-10T00:00:00.000Z',
    applicationEnd: '2026-10-01T00:00:00.000Z',
  });

  deps.lots.upsert(lot, NOW);
  await scoreAll(deps, NOW);
  await sendAlerts(deps, NOW);

  const later = new Date('2026-08-18T00:00:00.000Z');
  deps.lots.upsert(lot, later);
  await scoreAll(deps, later);
  const second = await sendAlerts(deps, later);

  assert.equal(second.sent, 1, 'цена упала на 20% — об этом стоит сообщить повторно');
  assert.equal(notifier.messages.length, 2);
});

test('sendAlerts: порог балла отсекает слабые лоты', async () => {
  const { deps, notifier } = makeContext({ ALERT_MIN_SCORE: '99' });

  deps.lots.upsert(moscowFlat(), NOW);
  await scoreAll(deps, NOW);
  const result = await sendAlerts(deps, NOW);

  assert.equal(result.sent, 0);
  assert.equal(notifier.messages.length, 0);
});

test('sendAlerts: сообщение содержит цену, дисконт и дедлайн', async () => {
  const { deps, notifier } = makeContext({ ALERT_MIN_SCORE: '0' });

  deps.lots.upsert(moscowFlat(), NOW);
  await scoreAll(deps, NOW);
  await sendAlerts(deps, NOW);

  const message = notifier.messages[0]!;
  assert.match(message, /Цена /);
  assert.match(message, /дисконт \d+%/);
  assert.match(message, /Заявки до/);
  assert.match(message, /Москва/);
});

test('sendAlerts: лимит на прогон соблюдается', async () => {
  const { deps, notifier } = makeContext({ ALERT_MIN_SCORE: '0', ALERT_MAX_PER_RUN: '2' });

  for (let i = 0; i < 5; i++) {
    deps.lots.upsert(
      moscowFlat({
        sourceId: `msg-${i}`,
        title: `Квартира ${i}, общая площадь 50 кв.м, г. Москва`,
        description: `Кадастровый номер 77:06:000400${i}:1234. Аукцион на повышение.`,
      }),
      NOW,
    );
  }
  await scoreAll(deps, NOW);
  const result = await sendAlerts(deps, NOW);

  assert.equal(result.sent, 2);
  assert.equal(notifier.messages.length, 2);
});
