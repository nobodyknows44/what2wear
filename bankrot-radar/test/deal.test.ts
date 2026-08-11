import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.ts';
import { documentChecklist, slowItems } from '../src/deal/checklist.ts';
import { DEFAULT_MILESTONE_OPTIONS, milestonesFor } from '../src/deal/milestones.ts';
import type { MilestoneOptions } from '../src/deal/milestones.ts';
import { allowedTransitions, canTransition, isTerminal } from '../src/domain/deal.ts';
import type { Deal } from '../src/domain/deal.ts';
import type { Lot } from '../src/domain/lot.ts';
import {
  isWorkingDay,
  parseHolidays,
  subtractWorkingDays,
  workingDaysBetween,
} from '../src/domain/workdays.ts';
import { assembleLot } from '../src/normalize/assemble.ts';
import { formatDealReminder } from '../src/notify/format.ts';
import { ConsoleNotifier } from '../src/notify/notifier.ts';
import { remindDeals } from '../src/pipeline.ts';
import type { PipelineDeps } from '../src/pipeline.ts';
import { AlertsRepo } from '../src/storage/alertsRepo.ts';
import { DealTransitionError, DealsRepo } from '../src/storage/dealsRepo.ts';
import { openDb } from '../src/storage/db.ts';
import { LotsRepo } from '../src/storage/lotsRepo.ts';
import { ComparablesEstimator } from '../src/enrich/estimator.ts';
import { ComparablesRepo } from '../src/storage/comparablesRepo.ts';

// Пятница. Все расчёты вокруг выходных проверяются от неё.
const FRIDAY = new Date('2026-08-14T12:00:00.000Z');

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    lotId: 'lot-1',
    status: 'interest',
    buyerType: 'individual',
    createdAt: FRIDAY.toISOString(),
    updatedAt: FRIDAY.toISOString(),
    completed: {},
    ...overrides,
  };
}

function makeLot(overrides: Partial<Parameters<typeof assembleLot>[0]> = {}): Lot {
  return assembleLot({
    sourceSystem: 'manual',
    sourceId: 'lot-1',
    title: 'Квартира, общая площадь 54,3 кв.м, г. Москва',
    description: 'Кадастровый номер 77:06:0004009:1234. Аукцион на повышение. Задаток 650 000 руб.',
    startPrice: 6_500_000,
    // Приём заявок заканчивается в среду 2 сентября.
    applicationEnd: '2026-09-02T09:00:00.000Z',
    auctionAt: '2026-09-10T09:00:00.000Z',
    ...overrides,
  });
}

function makeDeps() {
  const config = loadConfig({ RADAR_DB: ':memory:' } as NodeJS.ProcessEnv);
  const db = openDb(':memory:');
  const deps: PipelineDeps = {
    db,
    lots: new LotsRepo(db),
    alerts: new AlertsRepo(db),
    estimator: new ComparablesEstimator(new ComparablesRepo(db), {
      minComparables: 5,
      uplift: 1,
    }),
    notifier: new ConsoleNotifier(),
    config,
  };
  return { deps, config };
}

test('isWorkingDay: выходные и заданные праздники не рабочие', () => {
  assert.equal(isWorkingDay(new Date('2026-08-14T00:00:00Z')), true, 'пятница');
  assert.equal(isWorkingDay(new Date('2026-08-15T00:00:00Z')), false, 'суббота');
  assert.equal(isWorkingDay(new Date('2026-08-16T00:00:00Z')), false, 'воскресенье');
  assert.equal(
    isWorkingDay(new Date('2026-08-14T00:00:00Z'), parseHolidays('2026-08-14')),
    false,
  );
});

test('subtractWorkingDays: три рабочих дня от среды перескакивают выходные', () => {
  // Среда 02.09 минус 3 рабочих дня = пятница 28.08, а не воскресенье 30.08.
  const result = subtractWorkingDays(new Date('2026-09-02T09:00:00Z'), 3);
  assert.equal(result.toISOString(), '2026-08-28T00:00:00.000Z');
});

test('subtractWorkingDays: от понедельника один рабочий день назад — пятница', () => {
  const result = subtractWorkingDays(new Date('2026-08-17T10:00:00Z'), 1);
  assert.equal(result.toISOString(), '2026-08-14T00:00:00.000Z');
});

test('subtractWorkingDays: ноль дней даёт начало тех же суток', () => {
  assert.equal(
    subtractWorkingDays(new Date('2026-08-14T23:59:00Z'), 0).toISOString(),
    '2026-08-14T00:00:00.000Z',
  );
  assert.throws(() => subtractWorkingDays(FRIDAY, -1), RangeError);
});

test('subtractWorkingDays: праздники учитываются наравне с выходными', () => {
  const holidays = parseHolidays('2026-08-28');
  const result = subtractWorkingDays(new Date('2026-09-02T09:00:00Z'), 3, holidays);
  assert.equal(result.toISOString(), '2026-08-27T00:00:00.000Z', 'сдвигается на день раньше');
});

test('workingDaysBetween: считает только рабочие дни', () => {
  assert.equal(workingDaysBetween(new Date('2026-08-14T00:00:00Z'), new Date('2026-08-17T00:00:00Z')), 1);
  assert.equal(workingDaysBetween(new Date('2026-08-17T00:00:00Z'), new Date('2026-08-14T00:00:00Z')), 0);
});

test('canTransition: машина состояний не пускает назад', () => {
  assert.equal(canTransition('interest', 'checking'), true);
  assert.equal(canTransition('checking', 'deposit'), true);
  assert.equal(canTransition('application', 'interest'), false);
  assert.equal(canTransition('deposit', 'admitted'), false, 'заявку нельзя пропустить');
  assert.equal(canTransition('lost', 'won'), false);
});

test('isTerminal: конечные статусы никуда не ведут', () => {
  assert.equal(isTerminal('registered'), true);
  assert.equal(isTerminal('lost'), true);
  assert.equal(isTerminal('forfeited'), true);
  assert.equal(isTerminal('interest'), false);
  assert.deepEqual(allowedTransitions('admitted'), ['won', 'lost']);
});

test('milestonesFor: сроки считаются назад от окончания приёма заявок', () => {
  const milestones = milestonesFor(makeLot(), makeDeal(), FRIDAY);
  const byCode = new Map(milestones.map((m) => [m.code, m]));

  // Приём до среды 02.09. Задаток — за 3 рабочих дня, то есть пятница 28.08.
  assert.equal(byCode.get('deposit')!.dueAt, '2026-08-28T00:00:00.000Z');
  // Документы — за 3 рабочих дня до задатка: вторник 25.08.
  assert.equal(byCode.get('documents')!.dueAt, '2026-08-25T00:00:00.000Z');
  // Заявка — за 1 рабочий день: вторник 01.09.
  assert.equal(byCode.get('application')!.dueAt, '2026-09-01T00:00:00.000Z');
  assert.equal(byCode.get('auction')!.dueAt, '2026-09-10T09:00:00.000Z');
});

test('milestonesFor: вехи отсортированы по сроку', () => {
  const milestones = milestonesFor(makeLot(), makeDeal(), FRIDAY);
  const dates = milestones.map((m) => Date.parse(m.dueAt));
  assert.deepEqual(dates, [...dates].sort((a, b) => a - b));
});

test('milestonesFor: без срока приёма заявок вехи подготовки не выдумываются', () => {
  const lot = makeLot({ applicationEnd: undefined, auctionAt: undefined });
  assert.deepEqual(milestonesFor(lot, makeDeal(), FRIDAY), []);
});

test('milestonesFor: статус закрывает соответствующие вехи', () => {
  const applied = milestonesFor(makeLot(), makeDeal({ status: 'application' }), FRIDAY);
  const byCode = new Map(applied.map((m) => [m.code, m]));

  assert.equal(byCode.get('deposit')!.done, true, 'заявка подана — значит задаток уже перечислен');
  assert.equal(byCode.get('application')!.done, true);
  assert.equal(byCode.get('auction')!.done, false);
  assert.equal(
    byCode.get('documents')!.done,
    false,
    'собранный пакет ни из какого статуса не следует и отмечается вручную',
  );
});

test('milestonesFor: явная отметка закрывает веху документов', () => {
  const deal = makeDeal({ completed: { documents: FRIDAY.toISOString() } });
  const documents = milestonesFor(makeLot(), deal, FRIDAY).find((m) => m.code === 'documents');
  assert.equal(documents!.done, true);
});

test('milestonesFor: нарушенный срок помечается только у незакрытых вех', () => {
  const late = new Date('2026-08-31T12:00:00.000Z');
  const milestones = milestonesFor(makeLot(), makeDeal(), late);
  const byCode = new Map(milestones.map((m) => [m.code, m]));

  assert.equal(byCode.get('documents')!.overdue, true);
  assert.equal(byCode.get('deposit')!.overdue, true);
  assert.equal(byCode.get('application')!.overdue, false);

  const paid = milestonesFor(makeLot(), makeDeal({ status: 'deposit' }), late);
  assert.equal(paid.find((m) => m.code === 'deposit')!.overdue, false);
});

test('milestonesFor: запас настраивается', () => {
  const options: MilestoneOptions = { ...DEFAULT_MILESTONE_OPTIONS, depositLeadDays: 5 };
  const deposit = milestonesFor(makeLot(), makeDeal(), FRIDAY, options).find(
    (m) => m.code === 'deposit',
  );
  assert.equal(deposit!.dueAt, '2026-08-26T00:00:00.000Z');
});

test('documentChecklist: согласие супруга только для недвижимости', () => {
  const flat = documentChecklist(makeLot(), 'individual').map((i) => i.code);
  assert.ok(flat.includes('spouse_consent'));
  assert.ok(flat.includes('egrn_extract'));

  const car = documentChecklist(
    makeLot({
      title: 'Автомобиль TOYOTA CAMRY',
      description: 'VIN XW7BF4FK50S123456. Аукцион.',
    }),
    'individual',
  ).map((i) => i.code);

  assert.ok(!car.includes('spouse_consent'), 'лишний пункт приучает игнорировать весь список');
  assert.ok(car.includes('pledge_check'), 'залог движимого имущества не прекращается при продаже');
});

test('documentChecklist: состав зависит от типа покупателя', () => {
  const company = documentChecklist(makeLot(), 'company').map((i) => i.code);
  assert.ok(company.includes('egrul'));
  assert.ok(company.includes('major_deal_approval'));
  assert.ok(!company.includes('passport'));

  const entrepreneur = documentChecklist(makeLot(), 'entrepreneur').map((i) => i.code);
  assert.ok(entrepreneur.includes('egrip'));
  assert.ok(!entrepreneur.includes('egrul'));
});

test('documentChecklist: общие пункты и напоминание сверить с извещением', () => {
  const codes = documentChecklist(makeLot(), 'individual').map((i) => i.code);
  for (const code of ['application_form', 'affiliation', 'deposit_proof', 'inventory']) {
    assert.ok(codes.includes(code), code);
  }
  assert.equal(codes.at(-1), 'verify_notice', 'список типовой, последнее слово за извещением');
});

test('slowItems: выделяет то, что нельзя оставить на последний день', () => {
  const slow = slowItems(documentChecklist(makeLot(), 'company')).map((i) => i.code);
  assert.deepEqual(slow, ['major_deal_approval']);

  const forIndividual = slowItems(documentChecklist(makeLot(), 'individual')).map((i) => i.code);
  assert.deepEqual(forIndividual, ['spouse_consent']);
});

test('DealsRepo: заведение, повторное заведение и перевод статуса', () => {
  const { deps } = makeDeps();
  const deals = new DealsRepo(deps.db);

  const created = deals.create('lot-1', 'individual', FRIDAY, 6_000_000);
  assert.equal(created.status, 'interest');
  assert.equal(created.maxPrice, 6_000_000);

  const again = deals.create('lot-1', 'company', FRIDAY);
  assert.equal(again.buyerType, 'individual', 'повторное заведение не перетирает сделку');
  assert.equal(deals.count(), 1);

  const moved = deals.move('lot-1', 'checking', FRIDAY);
  assert.equal(moved.status, 'checking');
});

test('DealsRepo: недопустимый переход — ошибка, а не молчаливая запись', () => {
  const { deps } = makeDeps();
  const deals = new DealsRepo(deps.db);
  deals.create('lot-1', 'individual', FRIDAY);

  assert.throws(() => deals.move('lot-1', 'won', FRIDAY), DealTransitionError);
  assert.equal(deals.get('lot-1')!.status, 'interest', 'состояние не изменилось');
});

test('DealsRepo: активные сделки не включают завершённые', () => {
  const { deps } = makeDeps();
  const deals = new DealsRepo(deps.db);

  deals.create('lot-1', 'individual', FRIDAY);
  deals.create('lot-2', 'individual', FRIDAY);
  deals.move('lot-2', 'dropped', FRIDAY);

  assert.deepEqual(
    deals.active().map((d) => d.lotId),
    ['lot-1'],
  );
  assert.equal(deals.all().length, 2, 'история сохраняется');
});

test('DealsRepo: отметка вехи и потолок цены', () => {
  const { deps } = makeDeps();
  const deals = new DealsRepo(deps.db);
  deals.create('lot-1', 'individual', FRIDAY);

  assert.ok(deals.markDone('lot-1', 'documents', FRIDAY).completed.documents);
  assert.equal(deals.setMaxPrice('lot-1', 5_500_000, FRIDAY).maxPrice, 5_500_000);
});

test('remindDeals: напоминает о сроке в пределах горизонта', async () => {
  const { deps, config } = makeDeps();
  const lot = makeLot();
  deps.lots.upsert(lot, FRIDAY);
  new DealsRepo(deps.db).create(lot.id, 'individual', FRIDAY);

  // 25.08 — срок документов; за трое суток до него горизонт его захватывает.
  const stats = await remindDeals(deps, new Date('2026-08-24T09:00:00.000Z'), {
    horizonHours: 72,
    milestones: DEFAULT_MILESTONE_OPTIONS,
  });

  assert.equal(stats.deals, 1);
  assert.equal(stats.sent, 1, 'только веха документов попадает в горизонт');
});

test('remindDeals: далёкие сроки не беспокоят', async () => {
  const { deps } = makeDeps();
  const lot = makeLot();
  deps.lots.upsert(lot, FRIDAY);
  new DealsRepo(deps.db).create(lot.id, 'individual', FRIDAY);

  const stats = await remindDeals(deps, FRIDAY, {
    horizonHours: 24,
    milestones: DEFAULT_MILESTONE_OPTIONS,
  });

  assert.equal(stats.sent, 0);
});

test('remindDeals: повторный прогон не дублирует напоминание', async () => {
  const { deps } = makeDeps();
  const lot = makeLot();
  deps.lots.upsert(lot, FRIDAY);
  new DealsRepo(deps.db).create(lot.id, 'individual', FRIDAY);

  const at = new Date('2026-08-24T09:00:00.000Z');
  const options = { horizonHours: 72, milestones: DEFAULT_MILESTONE_OPTIONS };

  const first = await remindDeals(deps, at, options);
  const second = await remindDeals(deps, at, options);

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.suppressed, 1);
});

test('remindDeals: нарушенный срок напоминает отдельно от приближающегося', async () => {
  const { deps } = makeDeps();
  const lot = makeLot();
  deps.lots.upsert(lot, FRIDAY);
  new DealsRepo(deps.db).create(lot.id, 'individual', FRIDAY);
  const options = { horizonHours: 72, milestones: DEFAULT_MILESTONE_OPTIONS };

  await remindDeals(deps, new Date('2026-08-24T09:00:00.000Z'), options);
  const afterMiss = await remindDeals(deps, new Date('2026-08-26T09:00:00.000Z'), options);

  assert.ok(afterMiss.sent > 0, 'о нарушенном сроке нужно сказать, даже если уже предупреждали');
});

test('remindDeals: завершённая сделка не напоминает', async () => {
  const { deps } = makeDeps();
  const lot = makeLot();
  deps.lots.upsert(lot, FRIDAY);
  const deals = new DealsRepo(deps.db);
  deals.create(lot.id, 'individual', FRIDAY);
  deals.move(lot.id, 'dropped', FRIDAY);

  const stats = await remindDeals(deps, new Date('2026-08-24T09:00:00.000Z'), {
    horizonHours: 72,
    milestones: DEFAULT_MILESTONE_OPTIONS,
  });

  assert.equal(stats.deals, 0);
  assert.equal(stats.sent, 0);
});

test('remindDeals: исчезнувший из базы лот учитывается отдельно', async () => {
  const { deps } = makeDeps();
  new DealsRepo(deps.db).create('lot-которого-нет', 'individual', FRIDAY);

  const stats = await remindDeals(deps, FRIDAY, {
    horizonHours: 72,
    milestones: DEFAULT_MILESTONE_OPTIONS,
  });

  assert.equal(stats.lotMissing, 1, 'сделка переживает исчезновение лота из выдачи');
  assert.equal(stats.sent, 0);
});

test('formatDealReminder: веха задатка содержит сумму и срок приёма', () => {
  const lot = makeLot();
  const milestone = milestonesFor(lot, makeDeal(), FRIDAY).find((m) => m.code === 'deposit')!;
  const text = formatDealReminder(lot, makeDeal(), milestone, FRIDAY);

  assert.match(text, /Перечислить задаток/);
  assert.match(text, /Срок: 28\.08\.2026 /, 'дневной срок показывается без выдуманного времени');
  assert.match(text, /650\s000\s₽/, 'русская локаль ставит неразрывный пробел');
  assert.match(text, /Приём заявок до/);
  assert.match(text, /должен поступить на счёт/);
});

test('formatDealReminder: неизвестный задаток не выдумывается', () => {
  const lot = makeLot({ description: 'Кадастровый номер 77:06:0004009:1234. Аукцион.' });
  const milestone = milestonesFor(lot, makeDeal(), FRIDAY).find((m) => m.code === 'deposit')!;
  const text = formatDealReminder(lot, makeDeal(), milestone, FRIDAY);

  assert.match(text, /в извещении не указан/, 'ошибка в сумме задатка означает недопуск');
});

test('formatDealReminder: веха документов выносит медленные пункты', () => {
  const lot = makeLot();
  const milestone = milestonesFor(lot, makeDeal(), FRIDAY).find((m) => m.code === 'documents')!;
  const text = formatDealReminder(lot, makeDeal({ buyerType: 'company' }), milestone, FRIDAY);

  assert.match(text, /Решение об одобрении крупной сделки/);
  assert.match(text, /получать заранее/);
});

test('formatDealReminder: нарушенный срок помечен в заголовке', () => {
  const lot = makeLot();
  const late = new Date('2026-08-31T12:00:00.000Z');
  const milestone = milestonesFor(lot, makeDeal(), late).find((m) => m.code === 'deposit')!;
  const text = formatDealReminder(lot, makeDeal(), milestone, late);

  assert.match(text, /Срок нарушен/);
  assert.match(text, /срок истёк/);
});
