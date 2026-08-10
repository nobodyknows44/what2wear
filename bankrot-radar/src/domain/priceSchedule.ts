/**
 * Работа с графиком цены.
 *
 * Ключевая абстракция всего сервиса. На публичном предложении цена снижается
 * по расписанию, и вся стратегия сводится к вопросу «на каком периоде входить».
 * Поэтому цена — не число, а функция от времени.
 */

import type { PricePeriod } from './lot.ts';

export interface NextDrop {
  /** Момент следующего снижения */
  at: Date;
  /** Цена после снижения */
  price: number;
  /** Насколько упадёт относительно текущей цены, доля 0..1 */
  dropShare: number;
}

/** Периоды по возрастанию времени начала. Не мутирует вход. */
export function sortSchedule(schedule: readonly PricePeriod[]): PricePeriod[] {
  return [...schedule].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
}

/**
 * Цена, действующая в момент `at`.
 *
 * Возвращает null, если график пуст либо `at` позже последнего периода —
 * то есть торги уже закончились. Это осознанно: «последняя известная цена»
 * для завершённого лота вводит в заблуждение при расчёте дисконта.
 * До начала первого периода возвращается цена первого периода (стартовая).
 */
export function priceAt(schedule: readonly PricePeriod[], at: Date): number | null {
  const sorted = sortSchedule(schedule);
  if (sorted.length === 0) return null;

  const t = at.getTime();
  const first = sorted[0]!;
  if (t < Date.parse(first.from)) return first.price;

  for (const period of sorted) {
    if (t >= Date.parse(period.from) && t < Date.parse(period.to)) return period.price;
  }
  return null;
}

/** Период, действующий в момент `at`, либо null. */
export function currentPeriod(
  schedule: readonly PricePeriod[],
  at: Date,
): PricePeriod | null {
  const t = at.getTime();
  for (const period of sortSchedule(schedule)) {
    if (t >= Date.parse(period.from) && t < Date.parse(period.to)) return period;
  }
  return null;
}

/**
 * Ближайшее снижение после момента `at`.
 * Периоды, где цена не падает (например, обратный ход на комбинированных торгах),
 * пропускаются — ждать их бессмысленно.
 */
export function nextDrop(schedule: readonly PricePeriod[], at: Date): NextDrop | null {
  const sorted = sortSchedule(schedule);
  const current = priceAt(sorted, at);
  if (current === null) return null;

  const t = at.getTime();
  for (const period of sorted) {
    if (Date.parse(period.from) <= t) continue;
    if (period.price >= current) continue;
    return {
      at: new Date(period.from),
      price: period.price,
      dropShare: current === 0 ? 0 : (current - period.price) / current,
    };
  }
  return null;
}

/** Минимальная цена по всему графику — цена отсечения на публичном предложении. */
export function minPrice(schedule: readonly PricePeriod[]): number | null {
  if (schedule.length === 0) return null;
  return schedule.reduce((min, p) => (p.price < min ? p.price : min), schedule[0]!.price);
}

/** Момент окончания графика. */
export function finishesAt(schedule: readonly PricePeriod[]): Date | null {
  const sorted = sortSchedule(schedule);
  const last = sorted.at(-1);
  return last ? new Date(last.to) : null;
}

export interface BuildScheduleOptions {
  startPrice: number;
  /** Начало первого периода */
  startAt: Date;
  /** Длительность одного периода в днях */
  stepDays: number;
  /** Снижение на каждом шаге, доля от начальной цены (0.1 = «на 10% от начальной») */
  stepShareOfStart: number;
  /** Нижняя граница как доля от начальной цены (0.5 = «до 50% начальной») */
  floorShareOfStart: number;
}

/**
 * Строит график из типовой формулировки публичного предложения:
 * «цена снижается каждые N дней на X% от начальной цены до Y% от начальной».
 *
 * Нужен и для тестов, и для лотов, где в извещении есть формула, но нет таблицы.
 */
export function buildSchedule(options: BuildScheduleOptions): PricePeriod[] {
  const { startPrice, startAt, stepDays, stepShareOfStart, floorShareOfStart } = options;
  if (startPrice <= 0) throw new RangeError('startPrice must be positive');
  if (stepDays <= 0) throw new RangeError('stepDays must be positive');
  if (stepShareOfStart <= 0 || stepShareOfStart >= 1) {
    throw new RangeError('stepShareOfStart must be within (0, 1)');
  }
  if (floorShareOfStart < 0 || floorShareOfStart >= 1) {
    throw new RangeError('floorShareOfStart must be within [0, 1)');
  }

  const stepMs = stepDays * 24 * 60 * 60 * 1000;
  const floor = startPrice * floorShareOfStart;
  const decrement = startPrice * stepShareOfStart;

  const periods: PricePeriod[] = [];
  let price = startPrice;
  let from = startAt.getTime();

  // Верхняя граница на число итераций: график не может быть длиннее,
  // чем количество шагов до пола, плюс сам стартовый период.
  const maxSteps = Math.ceil((startPrice - floor) / decrement) + 1;

  for (let i = 0; i < maxSteps; i++) {
    const to = from + stepMs;
    periods.push({
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      price: Math.round(price * 100) / 100,
    });
    const next = price - decrement;
    if (next < floor - 1e-9) break;
    price = next;
    from = to;
  }

  return periods;
}
