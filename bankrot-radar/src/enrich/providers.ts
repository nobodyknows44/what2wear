/**
 * Провайдеры обогащения.
 *
 * Как и в источниках лотов, транспорт тонкий и параметризуемый: официального
 * открытого API ни у ЕГРН, ни у реестра залогов ФНП нет, доступ идёт через
 * партнёрские сервисы, и у каждого своя схема ответа. Поэтому базовый URL, путь
 * и заголовок авторизации задаются конфигом, а разбор ответа вынесен в отдельную
 * чистую функцию, которую можно переписать под своего провайдера, не трогая
 * ни кэш, ни бюджет, ни скоринг.
 *
 * Оба сетевых провайдера выключены по умолчанию. ManualFactsEnricher работает
 * без всякого API и покрывает самый частый реальный сценарий: десяток объектов
 * проверен руками, результат положен в файл.
 */

import { readFileSync } from 'node:fs';

import type { EnrichmentFact } from '../domain/facts.ts';
import { FACT } from '../domain/facts.ts';
import type { Lot } from '../domain/lot.ts';
import { primaryAsset } from '../domain/lot.ts';
import { asRecord, readArray, readNumber, readString } from '../normalize/read.ts';
import { buildUrl, fetchJson } from '../sources/http.ts';
import type { Enricher } from './enricher.ts';

export interface HttpProviderConfig {
  baseUrl: string;
  path: string;
  authHeader: string;
  key: string;
  /** Имя query-параметра, в котором передаётся предмет запроса. */
  subjectParam: string;
  ttlDays?: number;
}

/**
 * ЕГРН по кадастровому номеру.
 *
 * Даёт то, чего нет в извещении: подтверждённую площадь и список обременений.
 * Реестровый ответ «обременений нет» ценнее найденного обременения — он снимает
 * текстовые догадки и поднимает лот, который иначе выглядел бы проблемным.
 */
export class EgrnEnricher implements Enricher {
  readonly name = 'egrn';
  readonly ttlDays: number;

  #config: HttpProviderConfig;

  constructor(config: HttpProviderConfig) {
    this.#config = config;
    this.ttlDays = config.ttlDays ?? 30;
  }

  subjectFor(lot: Lot): string | null {
    return lot.assets.find((asset) => asset.cadastralNumber)?.cadastralNumber ?? null;
  }

  async fetch(subject: string): Promise<EnrichmentFact[]> {
    const url = buildUrl(this.#config.baseUrl, this.#config.path, {
      [this.#config.subjectParam]: subject,
    });
    const payload = await fetchJson<unknown>(url, {
      headers: { [this.#config.authHeader]: this.#config.key },
    });
    return factsFromEgrnResponse(payload);
  }
}

/** Разбор ответа ЕГРН. Чистая функция — под своего провайдера переписывается только она. */
export function factsFromEgrnResponse(payload: unknown): EnrichmentFact[] {
  const root = asRecord(payload) ?? {};
  const object = asRecord(root.object) ?? asRecord(root.data) ?? root;
  const facts: EnrichmentFact[] = [];

  const area = readNumber(object, 'area', 'areaSqm', 'square', 'площадь');
  if (area !== undefined && area > 0) {
    facts.push({ code: FACT.EGRN_AREA, value: area, detail: `площадь по ЕГРН ${area} м²` });
  }

  const encumbrances = readArray(object, 'encumbrances', 'restrictions', 'обременения');
  const descriptions = encumbrances
    .map(
      (item) =>
        readString(item, 'type', 'name', 'kind', 'description') ?? (typeof item === 'string' ? item : ''),
    )
    .filter((text) => text !== '');

  const joined = descriptions.join('; ');
  let flagged = false;

  if (/аренд|найм/i.test(joined)) {
    facts.push({ code: FACT.EGRN_LEASE, value: true, detail: joined });
    flagged = true;
  }
  if (/ипотек|залог/i.test(joined)) {
    facts.push({ code: FACT.EGRN_MORTGAGE, value: true, detail: joined });
    flagged = true;
  }
  if (/арест|запрещени|запрет/i.test(joined)) {
    facts.push({ code: FACT.EGRN_ARREST, value: true, detail: joined });
    flagged = true;
  }

  // Отсутствие обременений фиксируется, только если провайдер вернул сам список.
  // Пустой ответ из-за ошибки разбора не должен читаться как «всё чисто».
  if (!flagged && encumbrances.length === 0 && hasEncumbranceField(object)) {
    facts.push({
      code: FACT.EGRN_ENCUMBRANCE_NONE,
      value: true,
      detail: 'по данным ЕГРН обременения не зарегистрированы',
    });
  }

  if (readString(object, 'rightsRegistered', 'hasRights') === 'false' || object.rightsRegistered === false) {
    facts.push({
      code: FACT.EGRN_RIGHTS_ABSENT,
      value: true,
      detail: 'право собственности в ЕГРН не зарегистрировано',
    });
  }

  const ownershipType = readString(object, 'ownershipType', 'rightType', 'видПрава') ?? '';
  if (/долев|общая\s+долевая/i.test(ownershipType)) {
    facts.push({ code: FACT.EGRN_SHARED, value: true, detail: ownershipType });
  }

  return facts;
}

function hasEncumbranceField(object: Record<string, unknown>): boolean {
  return (
    Array.isArray(object.encumbrances) ||
    Array.isArray(object.restrictions) ||
    Array.isArray(object['обременения'])
  );
}

/**
 * Реестр залогов движимого имущества ФНП по VIN.
 *
 * Для транспорта это главная проверка: залог не прекращается сам по себе,
 * и покупатель заложенного автомобиля рискует лишиться его по требованию
 * залогодержателя.
 */
export class FnpPledgeEnricher implements Enricher {
  readonly name = 'fnp';
  readonly ttlDays: number;

  #config: HttpProviderConfig;

  constructor(config: HttpProviderConfig) {
    this.#config = config;
    this.ttlDays = config.ttlDays ?? 7;
  }

  subjectFor(lot: Lot): string | null {
    return lot.assets.find((asset) => asset.vin)?.vin ?? null;
  }

  async fetch(subject: string): Promise<EnrichmentFact[]> {
    const url = buildUrl(this.#config.baseUrl, this.#config.path, {
      [this.#config.subjectParam]: subject,
    });
    const payload = await fetchJson<unknown>(url, {
      headers: { [this.#config.authHeader]: this.#config.key },
    });
    return factsFromFnpResponse(payload);
  }
}

export function factsFromFnpResponse(payload: unknown): EnrichmentFact[] {
  const root = asRecord(payload) ?? {};
  const items = readArray(root, 'pledges', 'items', 'data', 'result');

  const active = items.filter((item) => {
    const status = readString(item, 'status', 'state') ?? '';
    return !/прекращ|исключ|closed|terminated/i.test(status);
  });

  if (active.length > 0) {
    const registeredAt = readString(active[0], 'registrationDate', 'date', 'createdAt');
    return [
      {
        code: FACT.FNP_PLEDGE_ACTIVE,
        value: active.length,
        detail: `действующих записей о залоге: ${active.length}${
          registeredAt ? `, с ${registeredAt}` : ''
        }`,
      },
    ];
  }

  // Пустой массив — валидный ответ «залогов нет». Отсутствие самого поля — нет.
  if (Array.isArray(root.pledges) || Array.isArray(root.items) || Array.isArray(root.result)) {
    return [
      {
        code: FACT.FNP_PLEDGE_NONE,
        value: true,
        detail: 'в реестре залогов ФНП действующих записей не найдено',
      },
    ];
  }

  return [];
}

/**
 * Факты, проверенные вручную.
 *
 * Формат файла: { "77:06:0004009:1234": [{ "code": "egrn.encumbrance.none", "value": true }] }
 * Ключ — кадастровый номер, VIN или идентификатор лота.
 */
export class ManualFactsEnricher implements Enricher {
  readonly name = 'manual';
  readonly ttlDays = 365;

  #facts: ReadonlyMap<string, EnrichmentFact[]>;

  constructor(facts: ReadonlyMap<string, EnrichmentFact[]>) {
    this.#facts = facts;
  }

  static fromFile(path: string): ManualFactsEnricher {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const record = asRecord(parsed) ?? {};
    const map = new Map<string, EnrichmentFact[]>();

    for (const [subject, value] of Object.entries(record)) {
      if (!Array.isArray(value)) continue;
      const facts = value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== undefined)
        .filter((item) => typeof item.code === 'string')
        .map((item) => ({
          code: String(item.code),
          value: (item.value ?? true) as string | number | boolean,
          detail: typeof item.detail === 'string' ? item.detail : 'проверено вручную',
        }));
      if (facts.length > 0) map.set(subject, facts);
    }

    return new ManualFactsEnricher(map);
  }

  subjectFor(lot: Lot): string | null {
    const asset = primaryAsset(lot);
    for (const candidate of [asset?.cadastralNumber, asset?.vin, lot.id]) {
      if (candidate && this.#facts.has(candidate)) return candidate;
    }
    return null;
  }

  async fetch(subject: string): Promise<EnrichmentFact[]> {
    return this.#facts.get(subject) ?? [];
  }
}
