/**
 * Обогащение лотов данными реестров.
 *
 * Главное отличие от источников лотов: запросы к реестрам стоят денег и
 * лимитированы. Отсюда три обязательных элемента, без которых обогащение
 * разорительно или бесполезно:
 *
 *   — кэш с длинным TTL: выписка из ЕГРН не меняется день ото дня;
 *   — бюджет на прогон: сбой в логике не должен вылиться в тысячи платных запросов;
 *   — отрицательное кэширование: упавший провайдер не должен опрашиваться
 *     по кругу на каждом лоте.
 *
 * Поэтому обогащаются не все лоты подряд, а только кандидаты, прошедшие первый,
 * бесплатный проход скоринга. См. enrichCandidates в pipeline.ts.
 */

import type { EnrichmentFact } from '../domain/facts.ts';
import type { Lot } from '../domain/lot.ts';

export interface EnrichmentOutcome {
  provider: string;
  subject: string;
  facts: EnrichmentFact[];
  fetchedAt: string;
  /** Текст ошибки, если провайдер не ответил. Кэшируется отдельно и ненадолго. */
  error?: string;
}

export interface Enricher {
  readonly name: string;
  /** Срок жизни удачного ответа в кэше. Для реестров он длинный: данные меняются редко. */
  readonly ttlDays: number;
  /**
   * Предмет запроса для этого лота: кадастровый номер, VIN, номер дела.
   * null означает, что провайдер к лоту неприменим, и запрос не тратится.
   */
  subjectFor(lot: Lot): string | null;
  fetch(subject: string): Promise<EnrichmentFact[]>;
}

export interface EnrichmentCacheStore {
  get(provider: string, subject: string): EnrichmentOutcome | null;
  put(outcome: EnrichmentOutcome): void;
}

/** Ошибки кэшируются ненадолго: провайдер мог просто полежать пять минут. */
const ERROR_TTL_DAYS = 1;

export interface EnrichmentStats {
  lots: number;
  fromCache: number;
  fetched: number;
  failed: number;
  notApplicable: number;
  budgetExhausted: number;
}

export function emptyEnrichmentStats(): EnrichmentStats {
  return { lots: 0, fromCache: 0, fetched: 0, failed: 0, notApplicable: 0, budgetExhausted: 0 };
}

export interface EnrichmentRunnerOptions {
  /** Максимум платных запросов за прогон, суммарно по всем провайдерам. */
  maxRequests: number;
}

export class EnrichmentRunner {
  readonly stats: EnrichmentStats = emptyEnrichmentStats();

  #enrichers: readonly Enricher[];
  #cache: EnrichmentCacheStore;
  #remaining: number;

  constructor(
    enrichers: readonly Enricher[],
    cache: EnrichmentCacheStore,
    options: EnrichmentRunnerOptions,
  ) {
    this.#enrichers = enrichers;
    this.#cache = cache;
    this.#remaining = options.maxRequests;
  }

  get remainingBudget(): number {
    return this.#remaining;
  }

  /** Все применимые к лоту факты: из кэша, а чего нет в кэше — запросом. */
  async enrich(lot: Lot, now: Date): Promise<EnrichmentFact[]> {
    this.stats.lots++;
    const facts: EnrichmentFact[] = [];

    for (const enricher of this.#enrichers) {
      const subject = enricher.subjectFor(lot);
      if (!subject) {
        this.stats.notApplicable++;
        continue;
      }

      const cached = this.#cache.get(enricher.name, subject);
      if (cached && isFresh(cached, enricher.ttlDays, now)) {
        this.stats.fromCache++;
        facts.push(...cached.facts);
        continue;
      }

      if (this.#remaining <= 0) {
        this.stats.budgetExhausted++;
        continue;
      }
      this.#remaining--;

      try {
        const fetched = await enricher.fetch(subject);
        this.#cache.put({
          provider: enricher.name,
          subject,
          facts: fetched,
          fetchedAt: now.toISOString(),
        });
        this.stats.fetched++;
        facts.push(...fetched);
      } catch (error) {
        this.stats.failed++;
        this.#cache.put({
          provider: enricher.name,
          subject,
          facts: [],
          fetchedAt: now.toISOString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return facts;
  }
}

export function isFresh(outcome: EnrichmentOutcome, ttlDays: number, now: Date): boolean {
  const fetchedAt = Date.parse(outcome.fetchedAt);
  if (Number.isNaN(fetchedAt)) return false;
  const ttl = (outcome.error ? ERROR_TTL_DAYS : ttlDays) * 24 * 60 * 60 * 1000;
  return now.getTime() - fetchedAt < ttl;
}
