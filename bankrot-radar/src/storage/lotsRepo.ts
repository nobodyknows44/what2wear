import type { Asset, Lot, LotStatus, PricePeriod, ProcedureKind, SourceSystem } from '../domain/lot.ts';
import { mergeLots } from '../domain/dedupe.ts';
import { priceAt } from '../domain/priceSchedule.ts';
import type { ScoreResult } from '../score/score.ts';
import type { Db } from './db.ts';
import { sqlValue } from './db.ts';

export type UpsertAction = 'inserted' | 'updated';

export interface ScoredLot {
  lot: Lot;
  score: number;
  discount: number | null;
  currentPrice: number | null;
  estimateValue: number | null;
  reasons: string[];
  scoredAt: string;
}

export interface LotFilter {
  regions?: readonly number[];
  minPrice?: number;
  maxPrice?: number;
  /** Только лоты, где приём заявок ещё идёт на момент `now`. */
  acceptingAt?: Date;
}

export class LotsRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Вставляет лот либо сливает его с уже известным.
   *
   * Слияние, а не перезапись: один лот приходит из нескольких источников,
   * и каждый добавляет свою часть картины. При изменении текущей цены
   * пишется точка в историю — это основной сигнал на публичном предложении.
   */
  upsert(lot: Lot, now: Date): UpsertAction {
    const existing = this.get(lot.id);
    const nowIso = now.toISOString();

    if (!existing) {
      this.#insert(lot, nowIso);
      this.#recordPrice(lot, now);
      return 'inserted';
    }

    const merged = mergeLots(existing, lot);
    this.#update(merged, nowIso);
    this.#recordPrice(merged, now);
    return 'updated';
  }

  get(id: string): Lot | null {
    const row = this.#db.prepare('SELECT * FROM lots WHERE id = ?').get(id);
    return row ? rowToLot(row as Record<string, unknown>) : null;
  }

  list(filter: LotFilter = {}): Lot[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.regions && filter.regions.length > 0) {
      conditions.push(`region_code IN (${filter.regions.map(() => '?').join(', ')})`);
      params.push(...filter.regions);
    }
    if (typeof filter.minPrice === 'number') {
      conditions.push('start_price >= ?');
      params.push(filter.minPrice);
    }
    if (typeof filter.maxPrice === 'number') {
      conditions.push('start_price <= ?');
      params.push(filter.maxPrice);
    }
    if (filter.acceptingAt) {
      conditions.push('(application_end IS NULL OR application_end > ?)');
      params.push(filter.acceptingAt.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.#db
      .prepare(`SELECT * FROM lots ${where} ORDER BY last_seen_at DESC`)
      .all(...params);
    return rows.map((row) => rowToLot(row as Record<string, unknown>));
  }

  saveScore(lotId: string, result: ScoreResult, at: Date): void {
    this.#db
      .prepare(
        `INSERT INTO lot_scores (
           lot_id, scored_at, score, discount, current_price,
           estimate_value, estimate_method, estimate_confidence,
           components, flags, reasons
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (lot_id) DO UPDATE SET
           scored_at = excluded.scored_at,
           score = excluded.score,
           discount = excluded.discount,
           current_price = excluded.current_price,
           estimate_value = excluded.estimate_value,
           estimate_method = excluded.estimate_method,
           estimate_confidence = excluded.estimate_confidence,
           components = excluded.components,
           flags = excluded.flags,
           reasons = excluded.reasons`,
      )
      .run(
        lotId,
        at.toISOString(),
        result.score,
        sqlValue(result.discount),
        sqlValue(result.currentPrice),
        sqlValue(result.estimate?.value),
        sqlValue(result.estimate?.method),
        sqlValue(result.estimate?.confidence),
        JSON.stringify(result.components),
        JSON.stringify(result.flags),
        JSON.stringify(result.reasons),
      );
  }

  /** Лоты с баллом не ниже порога, от лучших к худшим. */
  topScored(minScore: number, limit: number): ScoredLot[] {
    const rows = this.#db
      .prepare(
        `SELECT l.*, s.score, s.discount, s.current_price, s.estimate_value, s.reasons, s.scored_at
         FROM lot_scores s
         JOIN lots l ON l.id = s.lot_id
         WHERE s.score >= ?
         ORDER BY s.score DESC
         LIMIT ?`,
      )
      .all(minScore, limit);

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        lot: rowToLot(row),
        score: Number(row.score),
        discount: row.discount === null ? null : Number(row.discount),
        currentPrice: row.current_price === null ? null : Number(row.current_price),
        estimateValue: row.estimate_value === null ? null : Number(row.estimate_value),
        reasons: JSON.parse(String(row.reasons ?? '[]')) as string[],
        scoredAt: String(row.scored_at),
      };
    });
  }

  priceHistory(lotId: string): { observedAt: string; price: number }[] {
    const rows = this.#db
      .prepare('SELECT observed_at, price FROM lot_price_history WHERE lot_id = ? ORDER BY observed_at')
      .all(lotId);
    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return { observedAt: String(row.observed_at), price: Number(row.price) };
    });
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM lots').get() as { n: number };
    return Number(row.n);
  }

  #insert(lot: Lot, nowIso: string): void {
    this.#db
      .prepare(
        `INSERT INTO lots (
           id, source_system, source_id, source_url, title, description,
           debtor_name, debtor_inn, case_number, organizer, etp_name, etp_url,
           procedure, status, start_price, deposit, price_schedule,
           published_at, application_start, application_end, auction_at,
           assets, region_code, raw, first_seen_at, last_seen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        lot.id,
        lot.sourceSystem,
        lot.sourceId,
        sqlValue(lot.sourceUrl),
        lot.title,
        sqlValue(lot.description),
        sqlValue(lot.debtor.name),
        sqlValue(lot.debtor.inn),
        sqlValue(lot.debtor.caseNumber),
        sqlValue(lot.organizer),
        sqlValue(lot.etpName),
        sqlValue(lot.etpUrl),
        lot.procedure,
        lot.status,
        sqlValue(lot.startPrice),
        sqlValue(lot.deposit),
        JSON.stringify(lot.priceSchedule),
        sqlValue(lot.publishedAt),
        sqlValue(lot.applicationStart),
        sqlValue(lot.applicationEnd),
        sqlValue(lot.auctionAt),
        JSON.stringify(lot.assets),
        sqlValue(lot.regionCode),
        lot.raw === undefined ? null : JSON.stringify(lot.raw),
        nowIso,
        nowIso,
      );
  }

  #update(lot: Lot, nowIso: string): void {
    this.#db
      .prepare(
        `UPDATE lots SET
           source_url = ?, title = ?, description = ?,
           debtor_name = ?, debtor_inn = ?, case_number = ?,
           organizer = ?, etp_name = ?, etp_url = ?,
           procedure = ?, status = ?, start_price = ?, deposit = ?, price_schedule = ?,
           published_at = ?, application_start = ?, application_end = ?, auction_at = ?,
           assets = ?, region_code = ?, last_seen_at = ?
         WHERE id = ?`,
      )
      .run(
        sqlValue(lot.sourceUrl),
        lot.title,
        sqlValue(lot.description),
        sqlValue(lot.debtor.name),
        sqlValue(lot.debtor.inn),
        sqlValue(lot.debtor.caseNumber),
        sqlValue(lot.organizer),
        sqlValue(lot.etpName),
        sqlValue(lot.etpUrl),
        lot.procedure,
        lot.status,
        sqlValue(lot.startPrice),
        sqlValue(lot.deposit),
        JSON.stringify(lot.priceSchedule),
        sqlValue(lot.publishedAt),
        sqlValue(lot.applicationStart),
        sqlValue(lot.applicationEnd),
        sqlValue(lot.auctionAt),
        JSON.stringify(lot.assets),
        sqlValue(lot.regionCode),
        nowIso,
        lot.id,
      );
  }

  #recordPrice(lot: Lot, now: Date): void {
    const price = priceAt(lot.priceSchedule, now) ?? lot.startPrice;
    if (typeof price !== 'number') return;

    const last = this.#db
      .prepare('SELECT price FROM lot_price_history WHERE lot_id = ? ORDER BY observed_at DESC LIMIT 1')
      .get(lot.id) as { price: number } | undefined;
    if (last && Number(last.price) === price) return;

    this.#db
      .prepare(
        `INSERT INTO lot_price_history (lot_id, observed_at, price) VALUES (?, ?, ?)
         ON CONFLICT (lot_id, observed_at) DO UPDATE SET price = excluded.price`,
      )
      .run(lot.id, now.toISOString(), price);
  }
}

export function rowToLot(row: Record<string, unknown>): Lot {
  return {
    id: String(row.id),
    sourceSystem: String(row.source_system) as SourceSystem,
    sourceId: String(row.source_id),
    sourceUrl: optionalString(row.source_url),
    title: String(row.title),
    description: optionalString(row.description),
    debtor: {
      name: optionalString(row.debtor_name),
      inn: optionalString(row.debtor_inn),
      caseNumber: optionalString(row.case_number),
    },
    organizer: optionalString(row.organizer),
    etpName: optionalString(row.etp_name),
    etpUrl: optionalString(row.etp_url),
    procedure: String(row.procedure) as ProcedureKind,
    status: String(row.status) as LotStatus,
    startPrice: optionalNumber(row.start_price),
    deposit: optionalNumber(row.deposit),
    priceSchedule: JSON.parse(String(row.price_schedule ?? '[]')) as PricePeriod[],
    publishedAt: optionalString(row.published_at),
    applicationStart: optionalString(row.application_start),
    applicationEnd: optionalString(row.application_end),
    auctionAt: optionalString(row.auction_at),
    assets: JSON.parse(String(row.assets ?? '[]')) as Asset[],
    regionCode: optionalNumber(row.region_code),
  };
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}
