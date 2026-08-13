/**
 * Оценка ожидаемой цены реализации.
 *
 * Важно понимать, что именно считается. Публичных API рыночной цены у Авито,
 * Циан и Авто.ру нет, поэтому базой служат собственные накопленные результаты
 * состоявшихся торгов: за сколько реально уходили сопоставимые лоты.
 * Это оценка «цены выхода на торгах», а не рыночной цены объявления —
 * она консервативнее и лучше подходит для расчёта дисконта.
 *
 * ESTIMATE_UPLIFT позволяет поднять оценку до рыночной, но только если у вас
 * есть подтверждённые данные о премии. По умолчанию множитель равен 1.
 */

import type { Lot } from '../domain/lot.ts';
import { lotAssetKind, totalArea } from '../domain/lot.ts';

export interface Estimate {
  value: number;
  /** 0..1 — насколько можно доверять. Идёт в алерт, чтобы не выглядеть точнее, чем есть. */
  confidence: number;
  method: string;
  /** Человекочитаемое обоснование: что именно легло в основу. */
  basis: string;
}

export interface Estimator {
  readonly name: string;
  estimate(lot: Lot): Promise<Estimate | null>;
}

/** Состоявшаяся продажа, по которой учится оценка. */
export interface Comparable {
  assetKind: string;
  regionCode?: number;
  areaSqm?: number;
  startPrice: number;
  soldPrice: number;
  soldAt: string;
}

export interface ComparablesQuery {
  assetKind: string;
  regionCode?: number;
  /** Диапазон площади: ±50% от площади лота, чтобы гараж не сравнивался со складом. */
  minArea?: number;
  maxArea?: number;
  /**
   * Исключить конкретную продажу из выборки. Нужно для проверки оценки на истории:
   * без этого лот участвует в собственной оценке, и проверка становится круговой.
   */
  excludeId?: string;
  /**
   * Только продажи строго раньше этого момента. На дату торгов будущих сделок
   * ещё не существовало, и учитывать их — значит проверять оценку, которой
   * в тот день не могло быть.
   */
  soldBefore?: string;
}

export interface ComparablesSource {
  find(query: ComparablesQuery): Comparable[];
}

export interface ComparablesEstimatorOptions {
  minComparables: number;
  uplift: number;
}

export class ComparablesEstimator implements Estimator {
  readonly name = 'comparables';

  #source: ComparablesSource;
  #options: ComparablesEstimatorOptions;

  constructor(source: ComparablesSource, options: ComparablesEstimatorOptions) {
    this.#source = source;
    this.#options = options;
  }

  async estimate(lot: Lot): Promise<Estimate | null> {
    const kind = lotAssetKind(lot);
    if (kind === 'other') return null;

    const area = totalArea(lot);
    const withRegion = this.#source.find({
      assetKind: kind,
      regionCode: lot.regionCode,
      ...areaBand(area),
    });

    let sample = withRegion;
    let regionMatched = true;
    if (sample.length < this.#options.minComparables) {
      sample = this.#source.find({ assetKind: kind, ...areaBand(area) });
      regionMatched = false;
    }
    if (sample.length < this.#options.minComparables) return null;

    // Для площадных активов сравниваем цену за метр — иначе размер объекта
    // полностью забивает сигнал. Для остальных — долю от начальной цены,
    // потому что стартовая цена уже содержит оценку конкретного актива.
    const byArea = area !== undefined && (kind === 'real_estate' || kind === 'land');

    if (byArea) {
      const perSqm = sample
        .filter((c) => typeof c.areaSqm === 'number' && c.areaSqm > 0)
        .map((c) => c.soldPrice / c.areaSqm!);
      if (perSqm.length < this.#options.minComparables) return null;

      const value = median(perSqm) * area! * this.#options.uplift;
      return {
        value: round2(value),
        confidence: confidenceOf(perSqm.length, regionMatched),
        method: 'comparables/price_per_sqm',
        basis: `медиана ${formatRub(median(perSqm))}/м² по ${perSqm.length} сопоставимым продажам${
          regionMatched ? ' в регионе' : ' без учёта региона'
        }`,
      };
    }

    if (typeof lot.startPrice !== 'number' || lot.startPrice <= 0) return null;

    const ratios = sample
      .filter((c) => c.startPrice > 0)
      .map((c) => c.soldPrice / c.startPrice);
    if (ratios.length < this.#options.minComparables) return null;

    const ratio = median(ratios);
    return {
      value: round2(lot.startPrice * ratio * this.#options.uplift),
      confidence: confidenceOf(ratios.length, regionMatched) * 0.85,
      method: 'comparables/ratio_to_start',
      basis: `сопоставимые лоты уходят за ${(ratio * 100).toFixed(0)}% начальной цены (${
        ratios.length
      } продаж${regionMatched ? ' в регионе' : ', без учёта региона'})`,
    };
  }
}

/**
 * Ручные оценки. Десять объектов, оценённых экспертом, дают более полезный
 * сигнал, чем сто автоматических — этот эстиматор ставится первым в композите.
 */
export class OverridesEstimator implements Estimator {
  readonly name = 'overrides';

  #values: ReadonlyMap<string, number>;

  constructor(values: ReadonlyMap<string, number>) {
    this.#values = values;
  }

  async estimate(lot: Lot): Promise<Estimate | null> {
    const value = this.#values.get(lot.id);
    if (value === undefined) return null;
    return {
      value,
      confidence: 0.95,
      method: 'manual',
      basis: 'экспертная оценка, задана вручную',
    };
  }
}

/** Возвращает первую сработавшую оценку в порядке убывания доверия. */
export class CompositeEstimator implements Estimator {
  readonly name = 'composite';

  #estimators: readonly Estimator[];

  constructor(estimators: readonly Estimator[]) {
    this.#estimators = estimators;
  }

  async estimate(lot: Lot): Promise<Estimate | null> {
    for (const estimator of this.#estimators) {
      const result = await estimator.estimate(lot);
      if (result) return result;
    }
    return null;
  }
}

function areaBand(area: number | undefined): { minArea?: number; maxArea?: number } {
  if (area === undefined || area <= 0) return {};
  return { minArea: area * 0.5, maxArea: area * 1.5 };
}

function confidenceOf(sampleSize: number, regionMatched: boolean): number {
  const bySize = Math.min(0.9, 0.35 + Math.log10(sampleSize + 1) * 0.35);
  return round2(regionMatched ? bySize : bySize * 0.75);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of empty sample');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}
