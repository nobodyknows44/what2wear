import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACT } from '../src/domain/facts.ts';
import type { EnrichmentFact } from '../src/domain/facts.ts';
import type { Lot } from '../src/domain/lot.ts';
import { EnrichmentRunner, isFresh } from '../src/enrich/enricher.ts';
import type { Enricher, EnrichmentCacheStore, EnrichmentOutcome } from '../src/enrich/enricher.ts';
import {
  ManualFactsEnricher,
  factsFromEgrnResponse,
  factsFromFnpResponse,
} from '../src/enrich/providers.ts';
import { ComparablesEstimator } from '../src/enrich/estimator.ts';
import { assembleLot } from '../src/normalize/assemble.ts';
import { applyFacts } from '../src/score/registryFlags.ts';
import { detectRisks, mergeRiskFlags } from '../src/score/risk.ts';
import { scoreLot } from '../src/score/score.ts';
import { applyCorrections, enrichCandidates, scoreAll } from '../src/pipeline.ts';
import type { PipelineDeps } from '../src/pipeline.ts';
import { loadConfig } from '../src/config.ts';
import { ConsoleNotifier } from '../src/notify/notifier.ts';
import { AlertsRepo } from '../src/storage/alertsRepo.ts';
import { ComparablesRepo } from '../src/storage/comparablesRepo.ts';
import { openDb } from '../src/storage/db.ts';
import { EnrichmentCacheRepo, LotFactsRepo } from '../src/storage/enrichmentRepo.ts';
import { LotsRepo } from '../src/storage/lotsRepo.ts';
import { demoComparables } from '../src/demo/seed.ts';

const NOW = new Date('2026-08-10T00:00:00.000Z');

class MemoryCache implements EnrichmentCacheStore {
  readonly entries = new Map<string, EnrichmentOutcome>();

  get(provider: string, subject: string): EnrichmentOutcome | null {
    return this.entries.get(`${provider}:${subject}`) ?? null;
  }

  put(outcome: EnrichmentOutcome): void {
    this.entries.set(`${outcome.provider}:${outcome.subject}`, outcome);
  }
}

class CountingEnricher implements Enricher {
  readonly name: string;
  readonly ttlDays = 30;
  calls = 0;

  #facts: EnrichmentFact[];
  #error?: Error;
  #subject: (lot: Lot) => string | null;

  constructor(
    name: string,
    facts: EnrichmentFact[],
    subject: (lot: Lot) => string | null,
    error?: Error,
  ) {
    this.name = name;
    this.#facts = facts;
    this.#subject = subject;
    this.#error = error;
  }

  subjectFor(lot: Lot): string | null {
    return this.#subject(lot);
  }

  async fetch(): Promise<EnrichmentFact[]> {
    this.calls++;
    if (this.#error) throw this.#error;
    return this.#facts;
  }
}

function flatLot(overrides: Partial<Parameters<typeof assembleLot>[0]> = {}): Lot {
  return assembleLot({
    sourceSystem: 'manual',
    sourceId: 'lot-1',
    title: 'Квартира, общая площадь 50 кв.м, г. Москва',
    description: 'Кадастровый номер 77:06:0004009:1234. Аукцион на повышение. Имеется залог.',
    startPrice: 5_000_000,
    applicationEnd: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });
}

function makeDeps(): { deps: PipelineDeps; cache: EnrichmentCacheRepo } {
  const config = loadConfig({ RADAR_DB: ':memory:' } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const comparables = new ComparablesRepo(db);
  comparables.addMany(demoComparables(NOW));

  return {
    deps: {
      db,
      lots: new LotsRepo(db),
      alerts: new AlertsRepo(db),
      estimator: new ComparablesEstimator(comparables, {
        minComparables: config.estimate.minComparables,
        uplift: config.estimate.uplift,
      }),
      notifier: new ConsoleNotifier(),
      config,
    },
    cache: new EnrichmentCacheRepo(db),
  };
}

test('applyFacts: обременение из ЕГРН становится реестровым флагом', () => {
  const application = applyFacts([
    { code: FACT.EGRN_LEASE, value: true, detail: 'аренда до 2030 года' },
  ]);

  assert.equal(application.flags.length, 1);
  assert.equal(application.flags[0]!.code, 'lease');
  assert.equal(application.flags[0]!.source, 'registry');
  assert.equal(application.flags[0]!.evidence, 'аренда до 2030 года');
});

test('applyFacts: подтверждённое отсутствие обременений снимает догадки', () => {
  const application = applyFacts([{ code: FACT.EGRN_ENCUMBRANCE_NONE, value: true }]);

  assert.deepEqual(application.flags, []);
  assert.deepEqual(application.cleared.sort(), ['lease', 'pledge', 'restricted']);
});

test('applyFacts: ФНП снимает только залог, аренду не трогает', () => {
  const application = applyFacts([{ code: FACT.FNP_PLEDGE_NONE, value: true }]);
  assert.deepEqual(application.cleared, ['pledge']);
});

test('applyFacts: подтверждённый факт не отменяется другим реестром', () => {
  const application = applyFacts([
    { code: FACT.FNP_PLEDGE_ACTIVE, value: 1 },
    { code: FACT.EGRN_ENCUMBRANCE_NONE, value: true },
  ]);

  assert.ok(application.flags.some((flag) => flag.code === 'pledge'));
  assert.ok(!application.cleared.includes('pledge'), 'залог по ФНП сильнее «чисто» по ЕГРН');
});

test('applyFacts: площадь и регион из реестра', () => {
  const application = applyFacts([
    { code: FACT.EGRN_AREA, value: 54.3 },
    { code: FACT.EGRN_REGION, value: 77 },
  ]);
  assert.equal(application.areaSqm, 54.3);
  assert.equal(application.regionCode, 77);
});

test('mergeRiskFlags: реестровый флаг вытесняет текстовый того же вида', () => {
  const text = detectRisks('Имеется действующий договор аренды. Обременение: залог.');
  const registry = applyFacts([{ code: FACT.EGRN_LEASE, value: true, detail: 'аренда по ЕГРН' }]);
  const merged = mergeRiskFlags(text, registry.flags, registry.cleared);

  const lease = merged.filter((flag) => flag.code === 'lease');
  assert.equal(lease.length, 1, 'дубля быть не должно');
  assert.equal(lease[0]!.source, 'registry');
  assert.ok(merged.some((flag) => flag.code === 'pledge' && flag.source === 'text'),
    'о чём реестр не высказался, остаётся догадкой');
});

test('mergeRiskFlags: реестр опроверг текстовую догадку', () => {
  const text = detectRisks('Обременение: залог в пользу кредитора.');
  assert.ok(text.some((flag) => flag.code === 'pledge'));

  const registry = applyFacts([{ code: FACT.EGRN_ENCUMBRANCE_NONE, value: true }]);
  const merged = mergeRiskFlags(text, registry.flags, registry.cleared);

  assert.equal(merged.length, 0, 'слово «залог» в тексте часто относится к должнику, а не к объекту');
});

test('scoreLot: реестровое подтверждение чистоты поднимает балл', () => {
  const lot = flatLot();
  const estimate = { value: 10_000_000, confidence: 0.8, method: 'test', basis: 'тест' };

  const guessed = scoreLot({ lot, estimate, now: NOW });
  const confirmed = scoreLot({
    lot,
    estimate,
    now: NOW,
    facts: [{ code: FACT.EGRN_ENCUMBRANCE_NONE, value: true }],
  });

  assert.ok(confirmed.score > guessed.score);
  assert.equal(confirmed.components.riskPenalty, 0);
  assert.ok(confirmed.reasons.some((r) => r.includes('Реестр не подтвердил')));
});

test('scoreLot: реестровое обременение опускает балл сильнее догадки', () => {
  const lot = flatLot();
  const estimate = { value: 10_000_000, confidence: 0.8, method: 'test', basis: 'тест' };

  const guessed = scoreLot({ lot, estimate, now: NOW });
  const confirmed = scoreLot({
    lot,
    estimate,
    now: NOW,
    facts: [{ code: FACT.EGRN_LEASE, value: true, detail: 'аренда до 2030' }],
  });

  assert.ok(confirmed.score < guessed.score);
  assert.ok(confirmed.reasons.some((r) => r.includes('ЕГРН: зарегистрирована аренда')));
});

test('EnrichmentRunner: второй прогон берёт факты из кэша', async () => {
  const cache = new MemoryCache();
  const enricher = new CountingEnricher(
    'egrn',
    [{ code: FACT.EGRN_AREA, value: 54.3 }],
    (lot) => lot.assets[0]?.cadastralNumber ?? null,
  );

  const lot = flatLot();
  const first = new EnrichmentRunner([enricher], cache, { maxRequests: 10 });
  await first.enrich(lot, NOW);

  const second = new EnrichmentRunner([enricher], cache, { maxRequests: 10 });
  const facts = await second.enrich(lot, NOW);

  assert.equal(enricher.calls, 1, 'платный запрос делается один раз');
  assert.equal(second.stats.fromCache, 1);
  assert.equal(facts[0]!.value, 54.3);
});

test('EnrichmentRunner: бюджет ограничивает число платных запросов', async () => {
  const cache = new MemoryCache();
  const enricher = new CountingEnricher('egrn', [{ code: FACT.EGRN_AREA, value: 40 }], (lot) =>
    lot.assets[0]?.cadastralNumber ?? null,
  );
  const runner = new EnrichmentRunner([enricher], cache, { maxRequests: 2 });

  for (let i = 0; i < 5; i++) {
    await runner.enrich(
      flatLot({
        sourceId: `lot-${i}`,
        description: `Кадастровый номер 77:06:000400${i}:1234.`,
      }),
      NOW,
    );
  }

  assert.equal(enricher.calls, 2, 'ошибка в отборе кандидатов не должна стоить тысячу запросов');
  assert.equal(runner.stats.budgetExhausted, 3);
  assert.equal(runner.remainingBudget, 0);
});

test('EnrichmentRunner: неприменимый провайдер не тратит бюджет', async () => {
  const cache = new MemoryCache();
  const vinOnly = new CountingEnricher('fnp', [], (lot) => lot.assets[0]?.vin ?? null);
  const runner = new EnrichmentRunner([vinOnly], cache, { maxRequests: 10 });

  await runner.enrich(flatLot(), NOW);

  assert.equal(vinOnly.calls, 0);
  assert.equal(runner.stats.notApplicable, 1);
  assert.equal(runner.remainingBudget, 10);
});

test('EnrichmentRunner: ошибка провайдера кэшируется и не роняет прогон', async () => {
  const cache = new MemoryCache();
  const broken = new CountingEnricher(
    'egrn',
    [],
    (lot) => lot.assets[0]?.cadastralNumber ?? null,
    new Error('503'),
  );
  const runner = new EnrichmentRunner([broken], cache, { maxRequests: 10 });

  const facts = await runner.enrich(flatLot(), NOW);

  assert.deepEqual(facts, []);
  assert.equal(runner.stats.failed, 1);
  assert.match(cache.get('egrn', '77:06:0004009:1234')!.error!, /503/);
});

test('isFresh: ошибка живёт в кэше меньше удачного ответа', () => {
  const threeDaysAgo = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const ok: EnrichmentOutcome = { provider: 'egrn', subject: 'x', facts: [], fetchedAt: threeDaysAgo };
  const failed: EnrichmentOutcome = { ...ok, error: '503' };

  assert.equal(isFresh(ok, 30, NOW), true);
  assert.equal(isFresh(failed, 30, NOW), false, 'упавший провайдер перепроверяется быстро');
});

test('factsFromEgrnResponse: обременения распознаются по тексту', () => {
  const facts = factsFromEgrnResponse({
    object: {
      area: 54.3,
      encumbrances: [{ type: 'Аренда' }, { type: 'Ипотека в силу закона' }],
    },
  });

  const codes = facts.map((fact) => fact.code);
  assert.ok(codes.includes(FACT.EGRN_AREA));
  assert.ok(codes.includes(FACT.EGRN_LEASE));
  assert.ok(codes.includes(FACT.EGRN_MORTGAGE));
  assert.ok(!codes.includes(FACT.EGRN_ENCUMBRANCE_NONE));
});

test('factsFromEgrnResponse: пустой список обременений — это факт, отсутствие поля — нет', () => {
  const withField = factsFromEgrnResponse({ object: { area: 50, encumbrances: [] } });
  assert.ok(withField.some((fact) => fact.code === FACT.EGRN_ENCUMBRANCE_NONE));

  const withoutField = factsFromEgrnResponse({ object: { area: 50 } });
  assert.ok(
    !withoutField.some((fact) => fact.code === FACT.EGRN_ENCUMBRANCE_NONE),
    'сбой разбора не должен читаться как «объект чистый»',
  );
});

test('factsFromFnpResponse: прекращённые залоги не считаются действующими', () => {
  const active = factsFromFnpResponse({ pledges: [{ status: 'Действующий', date: '2024-01-01' }] });
  assert.equal(active[0]!.code, FACT.FNP_PLEDGE_ACTIVE);

  const terminated = factsFromFnpResponse({ pledges: [{ status: 'Прекращён' }] });
  assert.equal(terminated[0]!.code, FACT.FNP_PLEDGE_NONE);

  assert.deepEqual(factsFromFnpResponse({}), [], 'без поля ответа выводов не делаем');
});

test('ManualFactsEnricher: находит факты по кадастровому номеру', async () => {
  const enricher = new ManualFactsEnricher(
    new Map([['77:06:0004009:1234', [{ code: FACT.EGRN_ENCUMBRANCE_NONE, value: true }]]]),
  );
  const lot = flatLot();

  assert.equal(enricher.subjectFor(lot), '77:06:0004009:1234');
  assert.equal((await enricher.fetch('77:06:0004009:1234'))[0]!.code, FACT.EGRN_ENCUMBRANCE_NONE);
  assert.equal(enricher.subjectFor(flatLot({ description: 'Без идентификаторов' })), null);
});

test('applyCorrections: площадь из ЕГРН исправляет вытащенную из текста', () => {
  const lot = flatLot();
  assert.equal(lot.assets[0]!.areaSqm, 50);

  const corrected = applyCorrections(lot, [{ code: FACT.EGRN_AREA, value: 54.3 }]);
  assert.ok(corrected);
  assert.equal(corrected.assets[0]!.areaSqm, 54.3);
});

test('applyCorrections: без изменений возвращает null', () => {
  const lot = flatLot();
  assert.equal(applyCorrections(lot, [{ code: FACT.EGRN_AREA, value: 50 }]), null);
  assert.equal(applyCorrections(lot, []), null);
});

test('enrichCandidates: обогащает только кандидатов выше порога', async () => {
  const { deps, cache } = makeDeps();

  deps.lots.upsert(flatLot({ sourceId: 'good' }), NOW);
  deps.lots.upsert(
    flatLot({
      sourceId: 'weak',
      title: 'Право требования к ООО «Пример»',
      description: 'Дебиторская задолженность. Кадастровый номер 77:06:0004009:5555.',
      startPrice: 5_000_000,
    }),
    NOW,
  );

  await scoreAll(deps, NOW);

  const enricher = new CountingEnricher(
    'egrn',
    [{ code: FACT.EGRN_ENCUMBRANCE_NONE, value: true }],
    (lot) => lot.assets[0]?.cadastralNumber ?? null,
  );
  const runner = new EnrichmentRunner([enricher], cache, { maxRequests: 100 });

  const stats = await enrichCandidates(deps, runner, NOW, { minScore: 50, limit: 10 });

  assert.equal(stats.lots, 1, 'слабый лот не заслуживает платного запроса');
  assert.equal(enricher.calls, 1);
});

test('enrichCandidates: факты сохраняются и переживают повторный скоринг', async () => {
  const { deps, cache } = makeDeps();
  const lot = flatLot();
  deps.lots.upsert(lot, NOW);
  await scoreAll(deps, NOW);

  const before = deps.lots.topScored(0, 1)[0]!.score;

  const runner = new EnrichmentRunner(
    [
      new CountingEnricher(
        'egrn',
        [{ code: FACT.EGRN_ENCUMBRANCE_NONE, value: true }],
        (candidate) => candidate.assets[0]?.cadastralNumber ?? null,
      ),
    ],
    cache,
    { maxRequests: 10 },
  );
  await enrichCandidates(deps, runner, NOW, { minScore: 0, limit: 10 });

  const afterEnrich = deps.lots.topScored(0, 1)[0]!.score;
  assert.ok(afterEnrich > before, 'подтверждённая чистота повышает балл');

  assert.deepEqual(new LotFactsRepo(deps.db).get(lot.id).map((f) => f.code), [
    FACT.EGRN_ENCUMBRANCE_NONE,
  ]);

  // Обычный проход скоринга не должен терять уже оплаченные факты.
  await scoreAll(deps, NOW);
  assert.equal(deps.lots.topScored(0, 1)[0]!.score, afterEnrich);
});

test('enrichCandidates: исправленная площадь меняет оценку', async () => {
  const { deps, cache } = makeDeps();

  // В тексте площадь 50 м², по ЕГРН — 70 м². Оценка считается по цене за метр,
  // поэтому ошибка в площади на 40% — это ошибка в оценке на 40%.
  const lot = flatLot();
  deps.lots.upsert(lot, NOW);
  await scoreAll(deps, NOW);
  const before = deps.lots.topScored(0, 1)[0]!;

  const runner = new EnrichmentRunner(
    [
      new CountingEnricher('egrn', [{ code: FACT.EGRN_AREA, value: 70 }], (candidate) =>
        candidate.assets[0]?.cadastralNumber ?? null,
      ),
    ],
    cache,
    { maxRequests: 10 },
  );
  await enrichCandidates(deps, runner, NOW, { minScore: 0, limit: 10 });

  const after = deps.lots.topScored(0, 1)[0]!;
  assert.ok(after.estimateValue! > before.estimateValue! * 1.3);
  assert.ok(after.discount! > before.discount!);
});
