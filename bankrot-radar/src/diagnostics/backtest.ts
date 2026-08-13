/**
 * Проверка оценки на собственной истории.
 *
 * `doctor` меряет, что сервис сумел извлечь. Здесь проверяется другое и более
 * важное: насколько оценка вообще предсказывает цену, за которую лот реально
 * ушёл с торгов. Без этого весь дисконт в скоринге — число, полученное делением
 * на неизвестно что.
 *
 * Две методические оговорки, без которых проверка была бы самообманом:
 *
 *   — исключение самого лота из выборки. Если оценивать продажу, включив её же
 *     в число аналогов, оценка подгонится под ответ, и ошибка окажется тем меньше,
 *     чем меньше выборка. Проверка стала бы круговой;
 *   — запрет заглядывать в будущее. На дату торгов более поздних сделок ещё
 *     не существовало. Оценка, построенная на них, в тот день была недоступна,
 *     и её точность ничего не говорит о применимости метода.
 *
 * Побочный, но самый практичный результат — измеренное смещение. Оно превращает
 * ESTIMATE_UPLIFT из догадки в число, у которого есть основание.
 */

import type { Lot } from '../domain/lot.ts';
import type { Comparable, ComparablesQuery, ComparablesSource } from '../enrich/estimator.ts';
import { ComparablesEstimator, median } from '../enrich/estimator.ts';
import type { SoldLotInput } from '../storage/comparablesRepo.ts';

export interface BacktestOutcome {
  id: string;
  assetKind: string;
  soldAt: string;
  /** Фактическая цена реализации. */
  actual: number;
  estimate: number;
  /** Относительная ошибка: положительная — оценка завышена. */
  error: number;
}

export interface KindSummary {
  assetKind: string;
  evaluated: number;
  medianAbsError: number;
  medianBias: number;
}

export interface BacktestReport {
  total: number;
  evaluated: number;
  /** Не оценено: на момент продажи ещё не набралось сопоставимых сделок. */
  skipped: number;
  /** Медиана модуля относительной ошибки. */
  medianAbsError: number | null;
  /** Медиана знаковой ошибки: отрицательная означает систематическое занижение. */
  medianBias: number | null;
  byKind: KindSummary[];
  /** Обоснованный множитель ESTIMATE_UPLIFT либо null, если данных мало. */
  suggestedUplift: number | null;
  outcomes: BacktestOutcome[];
}

export interface BacktestOptions {
  minComparables: number;
  /** Ниже этого числа проверенных лотов выводы не делаются. */
  minEvaluated?: number;
  /** Смещение меньше этого по модулю считается шумом и множителя не рождает. */
  biasThreshold?: number;
}

const DEFAULT_MIN_EVALUATED = 30;
const DEFAULT_BIAS_THRESHOLD = 0.05;

/** Выборка без проверяемой продажи и без сделок, случившихся после неё. */
class LeaveOneOutSource implements ComparablesSource {
  #inner: ComparablesSource;
  #excludeId: string;
  #soldBefore: string;

  constructor(inner: ComparablesSource, excludeId: string, soldBefore: string) {
    this.#inner = inner;
    this.#excludeId = excludeId;
    this.#soldBefore = soldBefore;
  }

  find(query: ComparablesQuery): Comparable[] {
    return this.#inner.find({
      ...query,
      excludeId: this.#excludeId,
      soldBefore: this.#soldBefore,
    });
  }
}

export async function runBacktest(
  sales: readonly SoldLotInput[],
  source: ComparablesSource,
  options: BacktestOptions,
): Promise<BacktestReport> {
  const outcomes: BacktestOutcome[] = [];
  let skipped = 0;

  for (const sale of sales) {
    if (!(sale.soldPrice > 0)) {
      skipped++;
      continue;
    }

    const estimator = new ComparablesEstimator(
      new LeaveOneOutSource(source, sale.id, sale.soldAt),
      // Множитель здесь всегда 1: проверяется сама методика, а не поправка к ней.
      // Иначе измеренное смещение включало бы поправку, которую мы хотим измерить.
      { minComparables: options.minComparables, uplift: 1 },
    );

    const estimate = await estimator.estimate(syntheticLot(sale));
    if (!estimate) {
      skipped++;
      continue;
    }

    outcomes.push({
      id: sale.id,
      assetKind: sale.assetKind,
      soldAt: sale.soldAt,
      actual: sale.soldPrice,
      estimate: estimate.value,
      error: estimate.value / sale.soldPrice - 1,
    });
  }

  const errors = outcomes.map((o) => o.error);
  const medianBias = errors.length > 0 ? round4(median(errors)) : null;
  const medianAbsError = errors.length > 0 ? round4(median(errors.map(Math.abs))) : null;

  return {
    total: sales.length,
    evaluated: outcomes.length,
    skipped,
    medianAbsError,
    medianBias,
    byKind: summarizeByKind(outcomes),
    suggestedUplift: suggestUplift(outcomes.length, medianBias, options),
    outcomes,
  };
}

/**
 * Минимальный лот для оценки. Собирается напрямую, а не через нормализатор:
 * в истории продаж нет текста извещения, и прогонять через разбор нечего.
 * Из этого следует ограничение проверки — риск-флаги она не подтверждает.
 */
function syntheticLot(sale: SoldLotInput): Lot {
  return {
    id: sale.id,
    sourceSystem: 'manual',
    sourceId: sale.id,
    title: sale.title ?? 'Лот из истории продаж',
    debtor: {},
    procedure: 'unknown',
    status: 'finished',
    startPrice: sale.startPrice,
    priceSchedule: [],
    assets: [
      {
        kind: sale.assetKind as Lot['assets'][number]['kind'],
        title: sale.title ?? '',
        areaSqm: sale.areaSqm,
        regionCode: sale.regionCode,
      },
    ],
    regionCode: sale.regionCode,
  };
}

function summarizeByKind(outcomes: readonly BacktestOutcome[]): KindSummary[] {
  const groups = new Map<string, number[]>();
  for (const outcome of outcomes) {
    const bucket = groups.get(outcome.assetKind) ?? [];
    bucket.push(outcome.error);
    groups.set(outcome.assetKind, bucket);
  }

  return [...groups.entries()]
    .map(([assetKind, errors]) => ({
      assetKind,
      evaluated: errors.length,
      medianAbsError: round4(median(errors.map(Math.abs))),
      medianBias: round4(median(errors)),
    }))
    .sort((a, b) => b.evaluated - a.evaluated);
}

/**
 * Множитель, компенсирующий измеренное смещение. Выдаётся только при достаточной
 * выборке и заметном смещении: подкручивать оценку по десятку сделок — это
 * подгонка под шум, ровно то, от чего множитель по умолчанию равен единице.
 */
function suggestUplift(
  evaluated: number,
  medianBias: number | null,
  options: BacktestOptions,
): number | null {
  const minEvaluated = options.minEvaluated ?? DEFAULT_MIN_EVALUATED;
  const threshold = options.biasThreshold ?? DEFAULT_BIAS_THRESHOLD;

  if (medianBias === null || evaluated < minEvaluated) return null;
  if (Math.abs(medianBias) < threshold) return null;
  if (medianBias <= -1) return null;

  return Math.round((1 / (1 + medianBias)) * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
