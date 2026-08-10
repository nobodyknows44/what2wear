import type { EnrichmentFact } from '../domain/facts.ts';
import type { EnrichmentCacheStore, EnrichmentOutcome } from '../enrich/enricher.ts';
import type { Db } from './db.ts';
import { sqlValue } from './db.ts';

/** Кэш ответов реестров поверх SQLite. */
export class EnrichmentCacheRepo implements EnrichmentCacheStore {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(provider: string, subject: string): EnrichmentOutcome | null {
    const raw = this.#db
      .prepare(
        'SELECT provider, subject, fetched_at, facts, error FROM enrichment_cache WHERE provider = ? AND subject = ?',
      )
      .get(provider, subject);
    if (!raw) return null;

    const row = raw as Record<string, unknown>;
    return {
      provider: String(row.provider),
      subject: String(row.subject),
      fetchedAt: String(row.fetched_at),
      facts: JSON.parse(String(row.facts ?? '[]')) as EnrichmentFact[],
      error: row.error === null || row.error === undefined ? undefined : String(row.error),
    };
  }

  put(outcome: EnrichmentOutcome): void {
    this.#db
      .prepare(
        `INSERT INTO enrichment_cache (provider, subject, fetched_at, facts, error)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider, subject) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           facts = excluded.facts,
           error = excluded.error`,
      )
      .run(
        outcome.provider,
        outcome.subject,
        outcome.fetchedAt,
        JSON.stringify(outcome.facts),
        sqlValue(outcome.error),
      );
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM enrichment_cache').get() as { n: number };
    return Number(row.n);
  }
}

/** Факты, применённые к лоту: позволяют пересчитать скоринг без обращения к реестрам. */
export class LotFactsRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(lotId: string): EnrichmentFact[] {
    const raw = this.#db.prepare('SELECT facts FROM lot_facts WHERE lot_id = ?').get(lotId);
    if (!raw) return [];
    const row = raw as Record<string, unknown>;
    return JSON.parse(String(row.facts ?? '[]')) as EnrichmentFact[];
  }

  put(lotId: string, facts: readonly EnrichmentFact[], at: Date): void {
    this.#db
      .prepare(
        `INSERT INTO lot_facts (lot_id, updated_at, facts) VALUES (?, ?, ?)
         ON CONFLICT (lot_id) DO UPDATE SET
           updated_at = excluded.updated_at,
           facts = excluded.facts`,
      )
      .run(lotId, at.toISOString(), JSON.stringify(facts));
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM lot_facts').get() as { n: number };
    return Number(row.n);
  }
}
