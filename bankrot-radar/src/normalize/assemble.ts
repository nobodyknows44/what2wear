/**
 * Сборка канонического лота из полей источника плюс свободного текста.
 *
 * Оба источника отдают часть данных структурой, а часть — прозой. Здесь они
 * сходятся: структурные поля имеют приоритет, текст добирает остальное.
 * Логика общая для всех источников, поэтому маппер каждого нового источника
 * сводится к перекладыванию полей.
 */

import type { Asset, Debtor, Lot, LotStatus, ProcedureKind, SourceSystem } from '../domain/lot.ts';
import { lotKey } from '../domain/dedupe.ts';
import { buildSchedule } from '../domain/priceSchedule.ts';
import { regionFromCadastral } from '../domain/regions.ts';
import {
  classifyAsset,
  classifyProcedure,
  depositFromShare,
  extractArea,
  extractCadastralNumbers,
  extractCaseNumber,
  extractDeposit,
  extractInn,
  extractReductionFormula,
  extractVins,
  extractYear,
} from './text.ts';

/** Окно приёма заявок по умолчанию, если источник не указал конец. */
const DEFAULT_WINDOW_DAYS = 90;

export interface AssembleInput {
  sourceSystem: SourceSystem;
  sourceId: string;
  sourceUrl?: string;
  title: string;
  description?: string;
  debtor?: Debtor;
  organizer?: string;
  etpName?: string;
  etpUrl?: string;
  /** Вид процедуры, если источник сообщил его явно. Иначе определяется по тексту. */
  procedure?: ProcedureKind;
  status?: LotStatus;
  startPrice?: number;
  deposit?: number;
  regionCode?: number;
  publishedAt?: string;
  applicationStart?: string;
  applicationEnd?: string;
  auctionAt?: string;
  raw?: unknown;
}

export function assembleLot(input: AssembleInput): Lot {
  const text = `${input.title}\n${input.description ?? ''}`;

  const procedure =
    input.procedure && input.procedure !== 'unknown' ? input.procedure : classifyProcedure(text);

  const assets = buildAssets(input.title, text);
  const regionCode = input.regionCode ?? assets.find((a) => a.regionCode)?.regionCode;

  const debtor: Debtor = {
    name: input.debtor?.name,
    inn: input.debtor?.inn ?? extractInn(text),
    caseNumber: input.debtor?.caseNumber ?? extractCaseNumber(text),
  };

  const deposit = input.deposit ?? extractDeposit(text) ?? depositFromShare(text, input.startPrice);

  const priceSchedule = buildPriceSchedule({
    procedure,
    text,
    startPrice: input.startPrice,
    from: input.applicationStart ?? input.publishedAt,
    to: input.applicationEnd,
  });

  const lot: Omit<Lot, 'id'> = {
    sourceSystem: input.sourceSystem,
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl,
    title: input.title,
    description: input.description,
    debtor,
    organizer: input.organizer,
    etpName: input.etpName,
    etpUrl: input.etpUrl,
    procedure,
    status: input.status ?? 'announced',
    startPrice: input.startPrice,
    priceSchedule,
    deposit,
    publishedAt: input.publishedAt,
    applicationStart: input.applicationStart,
    applicationEnd: input.applicationEnd,
    auctionAt: input.auctionAt,
    assets,
    regionCode,
    raw: input.raw,
  };

  return {
    ...lot,
    id: lotKey({
      title: lot.title,
      assets: lot.assets,
      debtorInn: debtor.inn,
      startPrice: lot.startPrice,
    }),
  };
}

/**
 * Активы лота. Кадастровые номера и VIN дают по отдельному активу каждый —
 * так лот из трёх квартир не схлопывается в одну строку и корректно оценивается
 * по суммарной площади.
 */
export function buildAssets(title: string, text: string): Asset[] {
  const cadastrals = extractCadastralNumbers(text);
  const vins = extractVins(text);
  const kind = classifyAsset(text);
  const area = extractArea(text);
  const year = extractYear(text);

  const assets: Asset[] = [];

  for (const cadastralNumber of cadastrals) {
    assets.push({
      kind: kind === 'vehicle' || kind === 'other' ? 'real_estate' : kind,
      title,
      cadastralNumber,
      regionCode: regionFromCadastral(cadastralNumber),
      // Площадь относится к объекту целиком только когда объект один.
      areaSqm: cadastrals.length === 1 ? area : undefined,
      year,
    });
  }

  for (const vin of vins) {
    assets.push({ kind: 'vehicle', title, vin, year });
  }

  if (assets.length === 0) {
    assets.push({ kind, title, areaSqm: area, year });
  }

  return assets;
}

interface ScheduleInput {
  procedure: ProcedureKind;
  text: string;
  startPrice: number | undefined;
  from: string | undefined;
  to: string | undefined;
}

/**
 * График цены. Для публичного предложения разбирается формула снижения,
 * для остальных процедур — один период с начальной ценой.
 */
export function buildPriceSchedule({ procedure, text, startPrice, from, to }: ScheduleInput) {
  if (typeof startPrice !== 'number' || startPrice <= 0) return [];

  const startAt = from ? new Date(from) : new Date();
  if (Number.isNaN(startAt.getTime())) return [];

  if (procedure === 'public_offer' || procedure === 'combined') {
    const formula = extractReductionFormula(text);
    if (formula) {
      return buildSchedule({
        startPrice,
        startAt,
        stepDays: formula.stepDays,
        stepShareOfStart: formula.stepShareOfStart,
        floorShareOfStart: formula.floorShareOfStart,
      });
    }
  }

  const endAt = to
    ? new Date(to)
    : new Date(startAt.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(endAt.getTime()) || endAt <= startAt) return [];

  return [{ from: startAt.toISOString(), to: endAt.toISOString(), price: startPrice }];
}
