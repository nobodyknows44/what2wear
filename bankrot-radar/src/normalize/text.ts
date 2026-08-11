/**
 * Извлечение структуры из свободного текста извещения.
 *
 * Источники отдают описание лота одной простынёй: «Квартира, назначение жилое,
 * общая площадь 54,3 кв.м, кадастровый номер 77:01:0001001:1234, обременение: залог».
 * Ниже — детерминированные правила: они дешёвые, воспроизводимые и покрывают
 * большую часть реальных описаний. LLM имеет смысл подключать поверх, на остаток,
 * а не вместо — иначе теряются воспроизводимость и стоимость прогона.
 */

import type { AssetKind, ProcedureKind } from '../domain/lot.ts';

const NBSP = /[   ]/g;

/** Русское число: «1 234 567,89» → 1234567.89. Возвращает null для мусора. */
export function parseRuNumber(raw: string): number | null {
  const cleaned = raw
    .replace(NBSP, ' ')
    .replace(/\s+/g, '')
    .replace(/,/g, '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Кадастровые номера в порядке появления, без дублей. */
export function extractCadastralNumbers(text: string): string[] {
  const pattern = /\b\d{2}:\d{2}:\d{6,7}:\d{1,7}\b/g;
  return unique(text.match(pattern) ?? []);
}

/**
 * VIN. Стандарт запрещает I, O и Q, поэтому строка из 17 символов с ними — не VIN.
 * Дополнительно отсекаем последовательности без букв или без цифр: это почти всегда
 * кадастровый номер без разделителей, номер счёта или инвентарный номер.
 */
export function extractVins(text: string): string[] {
  const pattern = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
  const candidates = text.match(pattern) ?? [];
  return unique(
    candidates
      .map((v) => v.toUpperCase())
      .filter((v) => /[A-HJ-NPR-Z]/.test(v) && /\d/.test(v)),
  );
}

/**
 * Площадь в м². Берётся первое совпадение: в описании лота оно относится к объекту.
 *
 * Две ловушки, обе занижают площадь, а от неё напрямую зависит оценка недвижимости
 * по цене за метр:
 *
 *   — «1 075 кв.м» с пробелом-разделителем разрядов. Шаблон без учёта пробела
 *     прочитает 75 вместо 1075. Формулировка встречается в реальных извещениях
 *     на участки постоянно;
 *   — «1369000 кв.м». Ограничение \d{1,6} не даёт захватить семизначное число:
 *     движок отступает и матчит последние шесть цифр, молча отбрасывая старшую.
 *     136 гектаров превращаются в 36.
 *
 * Отсюда обе альтернативы и запрет цифры слева от совпадения.
 */
const AREA_PATTERN =
  /(?<![\d.,])(\d{1,3}(?: \d{3})+(?:[.,]\d{1,3})?|\d{1,9}(?:[.,]\d{1,3})?)\s*(?:кв\.?\s*м|м\s*2\b|м²)/i;

export function extractArea(text: string): number | undefined {
  const match = AREA_PATTERN.exec(text.replace(NBSP, ' '));
  if (!match?.[1]) return undefined;
  const value = parseRuNumber(match[1]);
  return value !== null && value > 0 ? value : undefined;
}

/** ИНН должника. Ищется только рядом с меткой — голое 10-значное число ей не является. */
export function extractInn(text: string): string | undefined {
  const pattern = /ИНН[\s:№]{0,10}(\d{12}|\d{10})\b/i;
  return pattern.exec(text)?.[1];
}

/**
 * Номер арбитражного дела: «А40-12345/2024». Латинская A приводится к кириллической.
 *
 * Границу слова здесь нельзя задавать через \b: в JS этот якорь опирается на
 * ASCII-класс \w, поэтому перед кириллической «А» он не срабатывает никогда.
 */
export function extractCaseNumber(text: string): string | undefined {
  const pattern = /(?:^|[^A-Za-zА-Яа-яЁё0-9])[АA]\s?(\d{1,3})\s?[-–—]\s?(\d{1,7})\s?\/\s?(\d{4})/;
  const match = pattern.exec(text);
  if (!match) return undefined;
  return `А${match[1]}-${match[2]}/${match[3]}`;
}

/** Размер задатка в рублях. Задаток в процентах здесь не разбирается — см. depositFromShare. */
export function extractDeposit(text: string): number | undefined {
  const pattern =
    /задат(?:ок|ка|ке)[^\d%]{0,60}?(\d[\d\s ]*(?:[.,]\d{1,2})?)\s*(?:руб|₽|р\.)/i;
  const match = pattern.exec(text);
  if (!match?.[1]) return undefined;
  const value = parseRuNumber(match[1]);
  return value !== null && value > 0 ? value : undefined;
}

/** Задаток, заданный долей от начальной цены: «задаток 20% от начальной цены». */
export function depositFromShare(text: string, startPrice: number | undefined): number | undefined {
  if (typeof startPrice !== 'number') return undefined;
  const pattern = /задат(?:ок|ка|ке)[^\d]{0,60}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i;
  const match = pattern.exec(text);
  if (!match?.[1]) return undefined;
  const share = parseRuNumber(match[1]);
  if (share === null || share <= 0 || share > 100) return undefined;
  return Math.round(startPrice * (share / 100) * 100) / 100;
}

/** Год выпуска или постройки. Метка может стоять как до года, так и после него. */
export function extractYear(text: string): number | undefined {
  const labelledBefore = /год[а-яё]*\s+(?:выпуска|постройки|изготовления)[^\d]{0,10}((?:19|20)\d{2})/i;
  const labelledAfter = /((?:19|20)\d{2})\s*год[а-яё]*\s+(?:выпуска|постройки|изготовления)/i;
  const bare = /\b((?:19|20)\d{2})\s*(?:г\.|года|год)/i;

  const value =
    labelledBefore.exec(text)?.[1] ?? labelledAfter.exec(text)?.[1] ?? bare.exec(text)?.[1];
  if (!value) return undefined;
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  return year >= 1900 && year <= currentYear + 1 ? year : undefined;
}

/**
 * Классификаторы имущества.
 *
 * Во всех шаблонах вместо \w используется [а-яё]: JS-класс \w покрывает только
 * ASCII, поэтому «земельн\w*\s+участок» не совпадает никогда — \w* съедает ноль
 * символов и \s+ упирается в «ый». Ошибка тихая: лот просто уходит в 'other'.
 */
const ASSET_PATTERNS: readonly { kind: AssetKind; pattern: RegExp }[] = [
  // Порядок значим: право требования часто описывается через объект-обеспечение,
  // и если сначала сматчить «квартира», лот будет оценён как недвижимость.
  {
    kind: 'claim',
    pattern:
      /прав[оа]\s+требовани|дебиторск|цесси|уступк[аи]\s+прав|задолженност[ьи]\s+перед|вексел/i,
  },
  {
    kind: 'share',
    pattern: /дол[яи]\s+в\s+уставном|акци[ияй]|цен(?:ные|ных)\s+бумаг/i,
  },
  {
    kind: 'land',
    pattern:
      /земельн[а-яё]*\s+участ|сельскохозяйственн[а-яё]*\s+назначен|садов[а-яё]*\s+участ|земл[иья]\s+населённ|земл[иья]\s+населенн/i,
  },
  {
    kind: 'vehicle',
    pattern:
      /автомобил|транспортн[а-яё]*\s+средств|грузов[а-яё]*\s+(?:авто|машин)|прицеп|полуприцеп|экскаватор|погрузчик|трактор|автобус|катер|мотоцикл/i,
  },
  {
    kind: 'real_estate',
    pattern:
      /квартир|нежил[а-яё]*\s+помещен|жил[а-яё]*\s+помещен|здани|сооружени|комнат|коттедж|склад|офис|машино-?мест|апартамент|незаверш[её]нн[а-яё]*\s+строительств/i,
  },
  {
    kind: 'equipment',
    pattern:
      /оборудован|станок|станк|товарно-материальн|мебель|инвентар|лини[яи]\s+по\s+производств/i,
  },
];

/** Вид имущества по описанию. Неопознанное остаётся 'other' и не идёт в оценку по аналогам. */
export function classifyAsset(text: string): AssetKind {
  for (const { kind, pattern } of ASSET_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'other';
}

/** Вид процедуры по формулировке извещения. */
export function classifyProcedure(text: string): ProcedureKind {
  if (/публичн[а-яё]*\s+предложени/i.test(text)) return 'public_offer';
  if (/повышени[а-яё]*[\s\S]{0,60}пониж|пониж[а-яё]*[\s\S]{0,60}повышени/i.test(text)) {
    return 'combined';
  }
  if (/конкурс/i.test(text)) return 'competition';
  if (/аукцион/i.test(text)) return 'auction';
  return 'unknown';
}

/**
 * Формула снижения цены на публичном предложении:
 * «цена снижается каждые 7 дней на 10% от начальной цены до 50%».
 */
export interface PriceReductionFormula {
  stepDays: number;
  stepShareOfStart: number;
  floorShareOfStart: number;
}

export function extractReductionFormula(text: string): PriceReductionFormula | undefined {
  const stepDays = /кажд[а-яё]*\s+(\d{1,3})\s*(?:календарн[а-яё]*\s+|рабоч[а-яё]*\s+)?дн/i.exec(
    text,
  )?.[1];
  const stepShare = /(?:сниж|уменьш)[а-яё]*[^%]{0,80}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i.exec(
    text,
  )?.[1];
  if (!stepDays || !stepShare) return undefined;

  const days = Number(stepDays);
  const share = parseRuNumber(stepShare);
  if (!Number.isInteger(days) || days <= 0 || share === null || share <= 0 || share >= 100) {
    return undefined;
  }

  const floorRaw =
    /(?:^|[^а-яё])(?:до|не\s+ниже)[^%]{0,60}?(\d{1,3}(?:[.,]\d{1,2})?)\s*%\s*(?:от\s+)?(?:начальн|первоначальн)/i.exec(
      text,
    )?.[1];
  const floorShare = floorRaw ? parseRuNumber(floorRaw) : null;

  return {
    stepDays: days,
    stepShareOfStart: share / 100,
    floorShareOfStart:
      floorShare !== null && floorShare > 0 && floorShare < 100 ? floorShare / 100 : 0.1,
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
