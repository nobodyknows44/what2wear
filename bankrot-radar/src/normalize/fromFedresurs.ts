/**
 * Маппер сообщений ЕФРСБ в канонические лоты.
 *
 * ВАЖНО: имена полей различаются между версиями спецификации REST API
 * («Сервис получения сведений из ЕФРСБ»). Поэтому каждое поле читается по списку
 * допустимых имён, а не по одному жёстко заданному. Перед боевым запуском
 * сверьте набор имён с той версией спецификации, что выдана вам по договору,
 * и допишите фактические имена первыми в списки ниже — остальное продолжит работать.
 *
 * Одно сообщение о торгах может содержать несколько лотов, поэтому маппер
 * возвращает массив.
 */

import type { Lot, ProcedureKind } from '../domain/lot.ts';
import { assembleLot } from './assemble.ts';
import { readArray, readDate, readNumber, readRecord, readString } from './read.ts';

export interface FedresursMapOptions {
  /** Базовый URL для ссылки на карточку сообщения. */
  publicBaseUrl?: string;
}

export function lotsFromFedresursMessage(
  message: unknown,
  options: FedresursMapOptions = {},
): Lot[] {
  const messageId =
    readString(message, 'guid', 'id', 'messageId', 'number', 'messageNumber') ?? '';
  if (!messageId) return [];

  const publishedAt = readDate(message, 'publishDate', 'datePublish', 'publishedAt', 'date');
  const debtorRecord = readRecord(message, 'debtor', 'debtorInfo', 'person');
  const debtor = {
    name: readString(debtorRecord, 'name', 'fullName', 'shortName', 'title'),
    inn: readString(debtorRecord, 'inn', 'INN'),
    caseNumber: readString(message, 'caseNumber', 'legalCaseNumber', 'caseNo', 'case'),
  };

  const etpRecord = readRecord(message, 'etp', 'tradePlace', 'auctionSite');
  const etpName = readString(etpRecord, 'name', 'title') ?? readString(message, 'etpName');
  const etpUrl = readString(etpRecord, 'url', 'site', 'address') ?? readString(message, 'etpUrl');
  const organizer =
    readString(readRecord(message, 'organizer', 'arbitrManager', 'trustee'), 'name', 'fullName') ??
    readString(message, 'organizer', 'arbitrManagerName');

  const procedure = procedureFromCode(
    readString(message, 'tradeType', 'bidType', 'auctionType', 'tradeKind'),
  );

  const sourceUrl = options.publicBaseUrl
    ? `${options.publicBaseUrl.replace(/\/$/, '')}/message/${messageId}`
    : undefined;

  const rawLots = readArray(message, 'lots', 'tradeLots', 'auctionLots', 'tradeObjects');
  const items = rawLots.length > 0 ? rawLots : [message];

  return items
    .map((item, index) => {
      const title =
        readString(item, 'name', 'lotName', 'title', 'shortDescription') ??
        readString(item, 'description', 'content')?.slice(0, 160) ??
        readString(message, 'messageType', 'type') ??
        'Лот без наименования';

      const description = [
        readString(item, 'description', 'content', 'info', 'lotDescription'),
        rawLots.length > 0 ? readString(message, 'content', 'text', 'messageText') : undefined,
      ]
        .filter(Boolean)
        .join('\n');

      const startPrice = readNumber(item, 'startPrice', 'priceStart', 'beginPrice', 'price');
      if (startPrice === undefined && rawLots.length > 0) {
        // Лот без цены бесполезен для скоринга и почти всегда означает,
        // что сообщение — не объявление о торгах, а уведомление о результатах.
        return null;
      }

      return assembleLot({
        sourceSystem: 'fedresurs',
        sourceId: rawLots.length > 0 ? `${messageId}#${readString(item, 'lotNumber', 'number') ?? index + 1}` : messageId,
        sourceUrl,
        title,
        description: description || undefined,
        debtor,
        organizer,
        etpName,
        etpUrl,
        procedure,
        startPrice,
        deposit: readNumber(item, 'deposit', 'depositAmount', 'pledge'),
        publishedAt,
        applicationStart: readDate(item, 'applicationStart', 'startDate', 'dateStart', 'beginDate'),
        applicationEnd: readDate(item, 'applicationEnd', 'endDate', 'dateEnd', 'finishDate'),
        auctionAt: readDate(item, 'auctionDate', 'tradeDate', 'biddingDate'),
        raw: item,
      });
    })
    .filter((lot): lot is Lot => lot !== null);
}

/** Коды видов торгов различаются между площадками; распознаём по подстроке. */
export function procedureFromCode(code: string | undefined): ProcedureKind {
  if (!code) return 'unknown';
  const value = code.toLowerCase();
  if (value.includes('публич') || value.includes('public') || value.includes('offer')) {
    return 'public_offer';
  }
  if (value.includes('конкурс') || value.includes('competition')) return 'competition';
  if (value.includes('аукцион') || value.includes('auction')) return 'auction';
  return 'unknown';
}
