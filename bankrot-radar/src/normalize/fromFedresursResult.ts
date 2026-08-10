/**
 * Маппер сообщений о результатах торгов в записи о состоявшихся продажах.
 *
 * Это второй по важности маппер в проекте: объявления о торгах говорят, что
 * продаётся, а результаты — за сколько это реально уходит. Без второго первое
 * не с чем сравнивать.
 *
 * Как и в fromFedresurs.ts, поля читаются по списку допустимых имён — набор
 * различается между версиями спецификации.
 */

import { lotKey } from '../domain/dedupe.ts';
import type { RawSale } from '../enrich/sales.ts';
import {
  classifyAsset,
  extractArea,
  extractCadastralNumbers,
  extractInn,
  extractVins,
} from './text.ts';
import { readArray, readDate, readNumber, readRecord, readString } from './read.ts';

/** Сообщение является результатом торгов, а не объявлением о них. */
export function isResultMessage(message: unknown): boolean {
  const type = readString(message, 'messageType', 'type', 'kind', 'title') ?? '';
  return /результат|итог/i.test(type);
}

export function salesFromFedresursResultMessage(message: unknown): RawSale[] {
  if (!isResultMessage(message)) return [];

  const messageId = readString(message, 'guid', 'id', 'messageId', 'number');
  if (!messageId) return [];

  const publishedAt =
    readDate(message, 'publishDate', 'datePublish', 'publishedAt', 'date') ??
    new Date().toISOString();
  const debtorInn = readString(readRecord(message, 'debtor', 'debtorInfo'), 'inn', 'INN');

  const rawLots = readArray(message, 'lots', 'tradeLots', 'auctionLots', 'results');
  const items = rawLots.length > 0 ? rawLots : [message];

  return items
    .map((item, index): RawSale | null => {
      // Несостоявшиеся торги тоже публикуются результатом, но цены победителя
      // в них нет — такие записи ничему не учат.
      const soldPrice = readNumber(
        item,
        'soldPrice',
        'winnerPrice',
        'offerPrice',
        'priceOffer',
        'resultPrice',
        'price',
      );
      if (soldPrice === undefined || soldPrice <= 0) return null;

      const title =
        readString(item, 'name', 'lotName', 'title') ??
        readString(item, 'description', 'lotDescription')?.slice(0, 160) ??
        'Лот без наименования';
      const description = readString(item, 'description', 'lotDescription', 'content') ?? '';
      const text = `${title}\n${description}`;

      const startPrice = readNumber(item, 'startPrice', 'priceStart', 'beginPrice');
      const inn = debtorInn ?? extractInn(text);

      const cadastral = extractCadastralNumbers(text)[0];
      const vin = extractVins(text)[0];
      const assets = [{ cadastralNumber: cadastral, vin }];

      const soldAt =
        readDate(item, 'resultDate', 'protocolDate', 'tradeDate', 'date') ?? publishedAt;

      // 'other' здесь означает «не смог определить», а не «смешанный лот».
      // Возвращаем undefined, иначе значение заблокирует добор вида имущества
      // из связанного объявления о торгах.
      const kind = classifyAsset(text);

      return {
        sourceId: `sale:${messageId}#${readString(item, 'lotNumber', 'number') ?? index + 1}`,
        // Ключ строится так же, как для объявления о торгах, — это и позволяет
        // связать результат с лотом и добрать начальную цену, площадь и регион.
        // Надёжно работает, когда в тексте есть кадастровый номер или VIN;
        // без них ключ зависит от начальной цены, которой в результатах может не быть.
        lotKey: lotKey({ title, assets, debtorInn: inn, startPrice }),
        title,
        assetKind: kind === 'other' ? undefined : kind,
        regionCode: readNumber(item, 'regionCode', 'subjectRFCode'),
        areaSqm: extractArea(text),
        startPrice,
        soldPrice,
        soldAt,
      };
    })
    .filter((sale): sale is RawSale => sale !== null);
}
