/**
 * Импорт результатов торгов из CSV.
 *
 * Нужен, чтобы завести базу аналогов до получения ключа ЕФРСБ: выгрузка
 * закрытых торгов из агрегатора или собственная таблица в Excel загружаются
 * одной командой, и оценка начинает работать сразу.
 *
 * Парсер свой, а не библиотечный: формат простой, а лишняя зависимость
 * в сервисе с нулевым рантаймом обойдётся дороже сорока строк кода.
 */

import type { AssetKind } from '../domain/lot.ts';
import { ASSET_KINDS } from '../domain/lot.ts';
import { isKnownRegion } from '../domain/regions.ts';
import type { RawSale } from '../enrich/sales.ts';
import { classifyAsset, parseRuNumber } from '../normalize/text.ts';
import { toIso } from '../normalize/read.ts';

/**
 * Разбирает CSV с кавычками, переносами строк внутри полей и BOM.
 * Разделитель определяется автоматически: Excel в русской локали пишет ';'.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;

  if (tabs > semicolons && tabs > commas) return '\t';
  return semicolons > commas ? ';' : ',';
}

/**
 * Синонимы заголовков. Выгрузки приходят и на английском, и на русском,
 * и заставлять человека переименовывать колонки руками — верный способ
 * получить импорт «когда-нибудь потом».
 */
const COLUMN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  title: ['title', 'name', 'наименование', 'название', 'лот', 'описание'],
  assetKind: ['asset_kind', 'assetkind', 'kind', 'вид', 'вид имущества', 'категория', 'тип'],
  regionCode: ['region_code', 'region', 'регион', 'код региона', 'субъект'],
  areaSqm: ['area_sqm', 'area', 'площадь', 'площадь кв.м', 'кв.м'],
  startPrice: ['start_price', 'startprice', 'начальная цена', 'нач. цена', 'цена начальная'],
  soldPrice: [
    'sold_price',
    'soldprice',
    'price',
    'цена продажи',
    'цена реализации',
    'итоговая цена',
    'цена победителя',
  ],
  soldAt: ['sold_at', 'soldat', 'date', 'дата', 'дата продажи', 'дата торгов'],
  id: ['id', 'идентификатор', 'номер лота', 'номер'],
};

export type ColumnMap = Partial<Record<keyof typeof COLUMN_ALIASES, number>>;

export function mapColumns(header: readonly string[]): ColumnMap {
  const normalized = header.map((cell) => cell.trim().toLowerCase().replace(/ё/g, 'е'));
  const map: ColumnMap = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalized.findIndex((cell) => aliases.includes(cell));
    if (index >= 0) map[field as keyof ColumnMap] = index;
  }

  return map;
}

export interface CsvImportOptions {
  /** Префикс идентификатора: чтобы записи из разных файлов не затирали друг друга. */
  sourcePrefix?: string;
}

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvImportError';
  }
}

export function salesFromCsv(content: string, options: CsvImportOptions = {}): RawSale[] {
  const rows = parseCsv(content);
  if (rows.length < 2) return [];

  const columns = mapColumns(rows[0]!);
  if (columns.soldPrice === undefined) {
    throw new CsvImportError(
      `В файле нет колонки с ценой продажи. Ожидается одна из: ${COLUMN_ALIASES.soldPrice!.join(', ')}`,
    );
  }

  const prefix = options.sourcePrefix ?? 'csv';

  return rows.slice(1).flatMap((cells, index): RawSale[] => {
    const soldPrice = readCell(cells, columns.soldPrice, parseRuNumber);
    if (soldPrice === null || soldPrice === undefined) return [];

    const title = pickCell(cells, columns.title) ?? 'Лот без наименования';
    const assetKind = parseAssetKind(pickCell(cells, columns.assetKind), title);
    const regionCode = readCell(cells, columns.regionCode, parseRegionCell);
    const soldAt = toIso(pickCell(cells, columns.soldAt) ?? '') ?? new Date().toISOString();
    const externalId = pickCell(cells, columns.id) ?? String(index + 1);

    return [
      {
        sourceId: `${prefix}:${externalId}`,
        title,
        assetKind,
        regionCode: regionCode ?? undefined,
        areaSqm: readCell(cells, columns.areaSqm, parseRuNumber) ?? undefined,
        startPrice: readCell(cells, columns.startPrice, parseRuNumber) ?? undefined,
        soldPrice,
        soldAt,
      },
    ];
  });
}

function pickCell(cells: readonly string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  const value = cells[index]?.trim();
  return value === '' ? undefined : value;
}

function readCell<T>(
  cells: readonly string[],
  index: number | undefined,
  parse: (raw: string) => T | null,
): T | null | undefined {
  const value = pickCell(cells, index);
  return value === undefined ? undefined : parse(value);
}

function parseRegionCell(raw: string): number | null {
  const value = Number(raw.trim());
  return Number.isInteger(value) && isKnownRegion(value) ? value : null;
}

/** Вид имущества берётся из колонки, а если её нет — определяется по наименованию. */
function parseAssetKind(raw: string | undefined, title: string): AssetKind | undefined {
  if (raw) {
    const normalized = raw.trim().toLowerCase();
    const direct = ASSET_KINDS.find((kind) => kind === normalized);
    if (direct) return direct;

    const byText = classifyAsset(raw);
    if (byText !== 'other') return byText;
  }

  const byTitle = classifyAsset(title);
  return byTitle === 'other' ? undefined : byTitle;
}
