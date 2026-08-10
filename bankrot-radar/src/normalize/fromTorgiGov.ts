/**
 * Маппер карточек лотов ГИС Торги.
 *
 * ГИС Торги — это гос- и муниципальное имущество, аренда, арестованное имущество.
 * Банкротства по 127-ФЗ там нет: его первоисточник — ЕФРСБ. Источник подключён
 * как второй поток, потому что арестованное имущество продаётся по той же логике
 * и оценивается теми же методами.
 */

import type { Lot } from '../domain/lot.ts';
import { isKnownRegion } from '../domain/regions.ts';
import { assembleLot } from './assemble.ts';
import { readDate, readNumber, readRecord, readString } from './read.ts';

export interface TorgiGovMapOptions {
  publicBaseUrl?: string;
}

export function lotFromTorgiGovCard(card: unknown, options: TorgiGovMapOptions = {}): Lot | null {
  const id = readString(card, 'id', 'lotId', 'guid', 'noticeId');
  if (!id) return null;

  const title =
    readString(card, 'lotName', 'name', 'title', 'subject') ?? 'Лот без наименования';
  const description = readString(card, 'lotDescription', 'description', 'shortDescr', 'info');

  const startPrice =
    readNumber(card, 'priceMin', 'startPrice', 'price', 'lotPrice', 'priceStart') ?? undefined;

  const regionCode = regionFromCard(card);

  const noticeNumber = readString(card, 'noticeNumber', 'number');
  const sourceUrl = options.publicBaseUrl
    ? `${options.publicBaseUrl.replace(/\/$/, '')}/new/public/lots/lot/${id}`
    : undefined;

  return assembleLot({
    sourceSystem: 'torgi_gov',
    sourceId: id,
    sourceUrl,
    title,
    description,
    debtor: { name: readString(readRecord(card, 'seller', 'owner'), 'name', 'fullName') },
    organizer: readString(readRecord(card, 'organizer', 'seller'), 'name', 'fullName'),
    etpName: readString(readRecord(card, 'etp', 'tradePlace'), 'name', 'title'),
    etpUrl: readString(readRecord(card, 'etp', 'tradePlace'), 'url', 'site'),
    startPrice,
    deposit: readNumber(card, 'deposit', 'depositAmount'),
    regionCode,
    publishedAt: readDate(card, 'createDate', 'publishDate', 'firstVersionPublicationDate'),
    applicationStart: readDate(card, 'bidStartTime', 'applicationStart', 'startDate'),
    applicationEnd: readDate(card, 'bidEndTime', 'applicationEnd', 'endDate'),
    auctionAt: readDate(card, 'auctionStartDate', 'biddingDate', 'auctionDate'),
    raw: { ...(typeof card === 'object' && card !== null ? card : {}), noticeNumber },
  });
}

/**
 * Код региона. ГИС Торги отдаёт его отдельным полем в нескольких вариантах
 * написания; если поля нет, регион определится из кадастрового номера в assemble.
 */
function regionFromCard(card: unknown): number | undefined {
  const direct =
    readNumber(card, 'subjectRFCode', 'regionCode', 'subjectRfCode') ??
    readNumber(readRecord(card, 'subjectRF', 'region'), 'code', 'id');
  if (direct !== undefined && isKnownRegion(direct)) return direct;
  return undefined;
}
