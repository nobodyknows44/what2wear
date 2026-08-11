/**
 * Ключ дедупликации.
 *
 * Один лот публикуется в ЕФРСБ, на ЭТП и в агрегаторе — с разными
 * идентификаторами и разными формулировками заголовка. Без стабильного ключа
 * воронка мгновенно наполняется дублями, а история цены рвётся на куски.
 *
 * Порядок приоритетов — от самых надёжных идентификаторов к текстовым.
 */

import type { Lot } from './lot.ts';

export interface DedupeInput {
  title: string;
  assets?: { cadastralNumber?: string; vin?: string }[];
  debtorInn?: string;
  startPrice?: number;
  /** Нужны для запасного ключа, когда никаких устойчивых идентификаторов нет. */
  sourceSystem?: string;
  sourceId?: string;
}

/** Схлопывает регистр, ё/е и любые не-буквенно-цифровые последовательности. */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Цена округляется до тысяч: источники расходятся в копейках и в том,
 * округляют ли они до целых рублей.
 */
function priceBucket(price: number | undefined): string {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 'na';
  return String(Math.round(price / 1000));
}

export function lotKey(input: DedupeInput): string {
  const assets = input.assets ?? [];

  const cadastral = assets.find((a) => a.cadastralNumber)?.cadastralNumber;
  if (cadastral) return `cad:${cadastral}`;

  const vin = assets.find((a) => a.vin)?.vin;
  if (vin) return `vin:${vin.toUpperCase()}`;

  const slug = slugifyTitle(input.title);
  if (input.debtorInn) return `inn:${input.debtorInn}:${priceBucket(input.startPrice)}:${slug}`;

  // Ни кадастрового номера, ни VIN, ни ИНН должника: заголовок с ценой ключом быть
  // не может. Два разных автомобиля «Автомобиль легковой» за 500 000 от разных
  // должников дали бы один ключ, слились бы в mergeLots, и один лот бесследно
  // исчез бы из воронки вместе со своей историей цены.
  //
  // Здесь сознательно теряется склейка между источниками — для лотов без единого
  // устойчивого идентификатора она всё равно была догадкой. Дубль в воронке стоит
  // нескольких секунд внимания, ошибочное слияние — потерянного лота.
  if (input.sourceSystem && input.sourceId) {
    return `src:${input.sourceSystem}:${input.sourceId}`;
  }

  return `t:${priceBucket(input.startPrice)}:${slug}`;
}

export function lotKeyOf(lot: Omit<Lot, 'id'>): string {
  return lotKey({
    title: lot.title,
    assets: lot.assets,
    debtorInn: lot.debtor.inn,
    startPrice: lot.startPrice,
    sourceSystem: lot.sourceSystem,
    sourceId: lot.sourceId,
  });
}

/**
 * Слияние дублей. Побеждает более полная запись, а не более свежая:
 * ЕФРСБ даёт юридически точные реквизиты, ГИС Торги и ЭТП — характеристики и фото.
 * Терять данные при повторной встрече лота нельзя.
 */
export function mergeLots(existing: Lot, incoming: Lot): Lot {
  const pick = <K extends keyof Lot>(key: K): Lot[K] => {
    const next = incoming[key];
    if (next === undefined || next === null || next === '') return existing[key];
    return next;
  };

  return {
    ...existing,
    sourceUrl: pick('sourceUrl'),
    title: existing.title.length >= incoming.title.length ? existing.title : incoming.title,
    description:
      (existing.description?.length ?? 0) >= (incoming.description?.length ?? 0)
        ? existing.description
        : incoming.description,
    debtor: {
      name: incoming.debtor.name ?? existing.debtor.name,
      inn: incoming.debtor.inn ?? existing.debtor.inn,
      caseNumber: incoming.debtor.caseNumber ?? existing.debtor.caseNumber,
    },
    organizer: pick('organizer'),
    etpName: pick('etpName'),
    etpUrl: pick('etpUrl'),
    procedure: incoming.procedure !== 'unknown' ? incoming.procedure : existing.procedure,
    status: incoming.status !== 'unknown' ? incoming.status : existing.status,
    startPrice: incoming.startPrice ?? existing.startPrice,
    priceSchedule:
      incoming.priceSchedule.length > existing.priceSchedule.length
        ? incoming.priceSchedule
        : existing.priceSchedule,
    deposit: incoming.deposit ?? existing.deposit,
    publishedAt: incoming.publishedAt ?? existing.publishedAt,
    applicationStart: incoming.applicationStart ?? existing.applicationStart,
    applicationEnd: incoming.applicationEnd ?? existing.applicationEnd,
    auctionAt: incoming.auctionAt ?? existing.auctionAt,
    assets: incoming.assets.length > existing.assets.length ? incoming.assets : existing.assets,
    regionCode: incoming.regionCode ?? existing.regionCode,
  };
}
