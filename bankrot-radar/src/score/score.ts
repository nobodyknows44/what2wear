/**
 * Сводный скоринг лота.
 *
 * Одно число, по которому лоты выстраиваются в очередь на ручную проверку.
 * Скоринг ничего не покупает и ничего не решает — он расставляет приоритеты
 * внимания человека. Поэтому важнее прозрачность, чем точность: каждый балл
 * должен объясняться строкой в `reasons`.
 */

import type { Lot } from '../domain/lot.ts';
import { lotAssetKind } from '../domain/lot.ts';
import { priceAt, nextDrop } from '../domain/priceSchedule.ts';
import type { Estimate } from '../enrich/estimator.ts';
import { liquidityScore } from './liquidity.ts';
import type { RiskFlag } from './risk.ts';
import { detectRisks, riskPenalty } from './risk.ts';

/** Дисконт, при котором компонент цены даёт максимум баллов. */
const TARGET_DISCOUNT = 0.6;

const WEIGHTS = { discount: 0.55, liquidity: 0.3, urgency: 0.15 } as const;

/** Потолок для лота без оценки: без базы сравнения высокий балл не заслужен. */
const SCORE_CAP_WITHOUT_ESTIMATE = 45;

export interface ScoreComponents {
  discount: number;
  liquidity: number;
  urgency: number;
  riskPenalty: number;
}

export interface ScoreResult {
  score: number;
  /** Доля 0..1, либо null если оценки нет. */
  discount: number | null;
  currentPrice: number | null;
  estimate: Estimate | null;
  components: ScoreComponents;
  flags: RiskFlag[];
  reasons: string[];
}

export interface ScoreInput {
  lot: Lot;
  estimate: Estimate | null;
  now: Date;
}

export function scoreLot({ lot, estimate, now }: ScoreInput): ScoreResult {
  const text = `${lot.title}\n${lot.description ?? ''}`;
  const flags = detectRisks(text);
  const penalty = riskPenalty(flags);
  const currentPrice = priceAt(lot.priceSchedule, now) ?? lot.startPrice ?? null;
  const reasons: string[] = [];

  const deadlinePassed =
    lot.applicationEnd !== undefined && Date.parse(lot.applicationEnd) <= now.getTime();

  let discount: number | null = null;
  let discountComponent = 0;
  if (estimate && currentPrice !== null && estimate.value > 0) {
    discount = 1 - currentPrice / estimate.value;
    discountComponent = clamp01(discount / TARGET_DISCOUNT) * 100;
    reasons.push(
      discount > 0
        ? `Цена ниже оценки на ${(discount * 100).toFixed(0)}% (${estimate.basis})`
        : `Цена выше оценки на ${(-discount * 100).toFixed(0)}% (${estimate.basis})`,
    );
  } else {
    reasons.push('Оценка не построена: недостаточно сопоставимых продаж в базе');
  }

  const liquidity = liquidityScore(lotAssetKind(lot), lot.regionCode);
  const urgency = urgencyScore(lot.applicationEnd, now);

  if (deadlinePassed) {
    reasons.push('Приём заявок завершён');
  } else if (urgency >= 70) {
    reasons.push(`Заявки принимаются ещё ${formatRemaining(lot.applicationEnd!, now)}`);
  }

  const drop = nextDrop(lot.priceSchedule, now);
  if (drop) {
    reasons.push(
      `Следующее снижение ${formatDate(drop.at)} до ${formatRub(drop.price)} (−${(
        drop.dropShare * 100
      ).toFixed(0)}%)`,
    );
  }

  for (const flag of flags.filter((f) => f.severity === 3)) {
    reasons.push(`Риск: ${flag.label}`);
  }

  let score =
    WEIGHTS.discount * discountComponent +
    WEIGHTS.liquidity * liquidity +
    WEIGHTS.urgency * urgency -
    penalty;

  if (!estimate) score = Math.min(score, SCORE_CAP_WITHOUT_ESTIMATE);
  if (deadlinePassed) score = 0;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    discount,
    currentPrice,
    estimate,
    components: {
      discount: Math.round(discountComponent),
      liquidity,
      urgency,
      riskPenalty: penalty,
    },
    flags,
    reasons,
  };
}

/**
 * Срочность: чем меньше времени до конца приёма заявок, тем выше приоритет,
 * потому что на подготовку пакета документов и перевод задатка нужны дни, а не часы.
 */
export function urgencyScore(applicationEnd: string | undefined, now: Date): number {
  if (!applicationEnd) return 20;
  const hours = (Date.parse(applicationEnd) - now.getTime()) / 3_600_000;
  if (Number.isNaN(hours) || hours <= 0) return 0;
  if (hours <= 48) return 100;
  if (hours <= 120) return 80;
  if (hours <= 336) return 55;
  return 25;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatRemaining(deadline: string, now: Date): string {
  const hours = Math.max(0, (Date.parse(deadline) - now.getTime()) / 3_600_000);
  if (hours < 48) return `${Math.round(hours)} ч`;
  return `${Math.round(hours / 24)} дн`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}
