/**
 * Оценка ликвидности: как быстро актив превращается обратно в деньги.
 *
 * Дисконт без ликвидности — ловушка: оборудование за 10% от оценки может
 * простоять на продаже год и съесть всю маржу хранением и логистикой.
 *
 * Базовые значения — экспертные, это стартовая точка. Как только в базе
 * накопятся собственные результаты, их надо заменить на статистику:
 * медианный срок от покупки до перепродажи по вашим же сделкам.
 */

import type { AssetKind } from '../domain/lot.ts';

const BASE_BY_KIND: Readonly<Record<AssetKind, number>> = {
  real_estate: 75,
  vehicle: 70,
  land: 45,
  equipment: 40,
  share: 25,
  claim: 20,
  other: 30,
};

/** Регионы с плотным вторичным рынком: продать там заметно быстрее. */
const TIER_1_REGIONS = new Set([77, 78, 50, 47]);
const TIER_2_REGIONS = new Set([16, 23, 24, 52, 54, 61, 63, 66, 74, 36, 59, 34]);

export function regionMultiplier(regionCode: number | undefined): number {
  if (regionCode === undefined) return 0.95;
  if (TIER_1_REGIONS.has(regionCode)) return 1.15;
  if (TIER_2_REGIONS.has(regionCode)) return 1.05;
  return 0.9;
}

/** 0..100. */
export function liquidityScore(kind: AssetKind, regionCode: number | undefined): number {
  const base = BASE_BY_KIND[kind];
  return Math.max(0, Math.min(100, Math.round(base * regionMultiplier(regionCode))));
}
