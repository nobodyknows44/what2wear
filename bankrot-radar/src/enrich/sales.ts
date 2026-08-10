/**
 * Результаты состоявшихся торгов.
 *
 * Оценка работает ровно настолько, насколько наполнена таблица sold_lots.
 * Источники результатов дают неполные записи: в сообщении о результатах торгов
 * почти всегда есть цена предложения победителя, но часто нет ни начальной цены,
 * ни характеристик объекта — они были в объявлении о торгах, опубликованном
 * несколькими месяцами ранее.
 *
 * Поэтому запись проходит две стадии: сырая (RawSale) и разрешённая
 * (SoldLotInput). Недостающие поля добираются из уже известного нам лота
 * по тому же ключу дедупликации, каким лоты склеиваются между источниками.
 */

import type { AssetKind, Lot } from '../domain/lot.ts';
import { lotAssetKind, totalArea } from '../domain/lot.ts';
import type { SoldLotInput } from '../storage/comparablesRepo.ts';

/**
 * Отношение цены продажи к начальной, выше которого запись считается ошибкой
 * разбора. На аукционе цена растёт, но двадцатикратный рост — это перепутанные
 * колонки или лишние нули, и одна такая запись перекашивает медиану.
 */
const MAX_SOLD_TO_START_RATIO = 20;

export interface RawSale {
  /** Идентификатор записи в источнике — основа для дедупликации продаж. */
  sourceId: string;
  /** Ключ дедупликации лота, если его удалось построить. Связывает с объявлением о торгах. */
  lotKey?: string;
  title: string;
  assetKind?: AssetKind;
  regionCode?: number;
  areaSqm?: number;
  startPrice?: number;
  soldPrice: number;
  soldAt: string;
}

export type SaleRejectionReason =
  | 'no_sold_price'
  | 'no_start_price'
  | 'no_asset_kind'
  | 'implausible_ratio';

export interface SaleResolution {
  sale: SoldLotInput | null;
  reason?: SaleRejectionReason;
}

export type LotLookup = (lotKey: string) => Lot | null;

/**
 * Достраивает сырую продажу до записи, пригодной для обучения оценки.
 * Возвращает причину отказа, а не просто null: по статистике отказов видно,
 * чего именно не хватает — начальных цен или связки с объявлениями.
 */
export function resolveSale(raw: RawSale, lookup?: LotLookup): SaleResolution {
  if (!Number.isFinite(raw.soldPrice) || raw.soldPrice <= 0) {
    return { sale: null, reason: 'no_sold_price' };
  }

  let { assetKind, regionCode, areaSqm, startPrice } = raw;

  if (raw.lotKey && lookup) {
    const lot = lookup(raw.lotKey);
    if (lot) {
      assetKind ??= lotAssetKind(lot);
      regionCode ??= lot.regionCode;
      areaSqm ??= totalArea(lot);
      startPrice ??= lot.startPrice;
    }
  }

  if (assetKind === undefined || assetKind === 'other') {
    // Смешанные и неопознанные лоты не сравниваются ни с чем: включить их
    // в выборку — значит испортить медиану по всем остальным видам имущества.
    return { sale: null, reason: 'no_asset_kind' };
  }
  if (startPrice === undefined || startPrice <= 0) {
    return { sale: null, reason: 'no_start_price' };
  }
  if (raw.soldPrice / startPrice > MAX_SOLD_TO_START_RATIO) {
    return { sale: null, reason: 'implausible_ratio' };
  }

  return {
    sale: {
      id: raw.sourceId,
      assetKind,
      regionCode,
      areaSqm,
      startPrice,
      soldPrice: raw.soldPrice,
      soldAt: raw.soldAt,
      title: raw.title,
    },
  };
}

export interface SaleImportStats {
  total: number;
  accepted: number;
  rejected: Record<SaleRejectionReason, number>;
}

export function emptyImportStats(): SaleImportStats {
  return {
    total: 0,
    accepted: 0,
    rejected: {
      no_sold_price: 0,
      no_start_price: 0,
      no_asset_kind: 0,
      implausible_ratio: 0,
    },
  };
}

export function describeImportStats(stats: SaleImportStats): string {
  const parts = [`принято ${stats.accepted} из ${stats.total}`];
  const labels: Record<SaleRejectionReason, string> = {
    no_sold_price: 'без цены продажи',
    no_start_price: 'без начальной цены',
    no_asset_kind: 'вид имущества не определён',
    implausible_ratio: 'неправдоподобное отношение цен',
  };

  for (const [reason, count] of Object.entries(stats.rejected)) {
    if (count > 0) parts.push(`${labels[reason as SaleRejectionReason]}: ${count}`);
  }
  return parts.join(', ');
}
