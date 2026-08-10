/**
 * Каноническая модель лота.
 *
 * Один и тот же лот приходит из нескольких источников (ЕФРСБ, ЭТП, агрегатор)
 * в трёх разных форматах. Всё, что ниже по пайплайну — оценка, скоринг, алерты —
 * работает только с этой моделью, а источники живут в src/sources и знают о ней,
 * но не наоборот.
 */

export type AssetKind =
  | 'real_estate' // здания, помещения, квартиры
  | 'land' // земельные участки
  | 'vehicle' // транспорт, спецтехника
  | 'equipment' // оборудование, ТМЦ
  | 'claim' // права требования, дебиторская задолженность
  | 'share' // доли в УК, ценные бумаги
  | 'other';

export const ASSET_KINDS: readonly AssetKind[] = [
  'real_estate',
  'land',
  'vehicle',
  'equipment',
  'claim',
  'share',
  'other',
];

/**
 * Вид процедуры. `combined` — торги, где после снижения цена снова идёт вверх;
 * такой сценарий встречается для крупных активов, поэтому модель цены обязана быть
 * графиком, а не парой «стартовая цена + шаг».
 */
export type ProcedureKind =
  | 'auction' // открытый аукцион на повышение
  | 'competition' // конкурс
  | 'public_offer' // публичное предложение: снижение по графику
  | 'combined' // повышение с переходом на понижение (и обратно)
  | 'unknown';

export type SourceSystem = 'fedresurs' | 'torgi_gov' | 'manual';

export type LotStatus = 'announced' | 'accepting' | 'bidding' | 'finished' | 'cancelled' | 'unknown';

/** Интервал действия одной цены. Для аукциона на повышение — один интервал. */
export interface PricePeriod {
  /** ISO-8601, включительно */
  from: string;
  /** ISO-8601, исключительно */
  to: string;
  price: number;
}

export interface Asset {
  kind: AssetKind;
  title: string;
  /** Кадастровый номер, нормализованный: 77:01:0001001:1234 */
  cadastralNumber?: string;
  vin?: string;
  areaSqm?: number;
  address?: string;
  /** Код субъекта РФ по справочнику regions.ts */
  regionCode?: number;
  /** Год выпуска / постройки */
  year?: number;
}

export interface Debtor {
  name?: string;
  inn?: string;
  /** Номер дела о банкротстве, напр. А40-12345/2024 */
  caseNumber?: string;
}

export interface Lot {
  /** Ключ дедупликации, см. domain/dedupe.ts. Стабилен между источниками. */
  id: string;
  sourceSystem: SourceSystem;
  /** Идентификатор записи в системе-источнике */
  sourceId: string;
  sourceUrl?: string;

  title: string;
  description?: string;

  debtor: Debtor;
  organizer?: string;
  etpName?: string;
  etpUrl?: string;

  procedure: ProcedureKind;
  status: LotStatus;

  /** Начальная цена лота */
  startPrice?: number;
  /**
   * График цены. Для публичного предложения — все периоды снижения.
   * Текущая цена вычисляется из графика, а не хранится: см. priceSchedule.priceAt().
   */
  priceSchedule: PricePeriod[];
  /** Размер задатка в рублях, если удалось извлечь */
  deposit?: number;

  publishedAt?: string;
  applicationStart?: string;
  applicationEnd?: string;
  auctionAt?: string;

  assets: Asset[];
  /** Код региона лота: из активов либо из текста извещения */
  regionCode?: number;

  /** Исходная запись источника — чтобы можно было переразобрать без повторного запроса */
  raw?: unknown;
}

/** Первый актив лота — по нему считаются площадь, регион и ключ дедупликации. */
export function primaryAsset(lot: Lot): Asset | undefined {
  return lot.assets[0];
}

/**
 * Вид имущества всего лота. Если активы разнородные — возвращает 'other',
 * потому что оценивать смешанный лот по одной методике нельзя.
 */
export function lotAssetKind(lot: Lot): AssetKind {
  if (lot.assets.length === 0) return 'other';
  const kinds = new Set(lot.assets.map((a) => a.kind));
  if (kinds.size === 1) return lot.assets[0]!.kind;
  return 'other';
}

/** Суммарная площадь лота — база для оценки недвижимости по цене за м². */
export function totalArea(lot: Lot): number | undefined {
  const areas = lot.assets.map((a) => a.areaSqm).filter((a): a is number => typeof a === 'number');
  if (areas.length === 0) return undefined;
  return areas.reduce((sum, a) => sum + a, 0);
}
