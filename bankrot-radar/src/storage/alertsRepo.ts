/**
 * Учёт отправленных алертов.
 *
 * Без дедупликации сервис за неделю приучает не читать свои же уведомления.
 * Повторный алерт по тому же лоту оправдан только тогда, когда изменилось
 * что-то существенное: цена заметно упала или скоринг вырос.
 */

import type { Db } from './db.ts';
import { sqlValue } from './db.ts';

/** Насколько должна упасть цена, чтобы повторить алерт. */
const PRICE_DROP_THRESHOLD = 0.1;
/** Насколько должен вырасти балл, чтобы повторить алерт. */
const SCORE_GROWTH_THRESHOLD = 10;

export interface AlertRecord {
  lotId: string;
  channel: string;
  sentAt: string;
  score: number;
  price: number | null;
}

export class AlertsRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  last(lotId: string, channel: string): AlertRecord | null {
    const raw = this.#db
      .prepare('SELECT lot_id, channel, sent_at, score, price FROM alerts WHERE lot_id = ? AND channel = ?')
      .get(lotId, channel);
    if (!raw) return null;
    const row = raw as Record<string, unknown>;
    return {
      lotId: String(row.lot_id),
      channel: String(row.channel),
      sentAt: String(row.sent_at),
      score: Number(row.score),
      price: row.price === null ? null : Number(row.price),
    };
  }

  shouldSend(lotId: string, channel: string, score: number, price: number | null): boolean {
    const previous = this.last(lotId, channel);
    if (!previous) return true;
    if (score >= previous.score + SCORE_GROWTH_THRESHOLD) return true;
    if (
      price !== null &&
      previous.price !== null &&
      previous.price > 0 &&
      price <= previous.price * (1 - PRICE_DROP_THRESHOLD)
    ) {
      return true;
    }
    return false;
  }

  record(lotId: string, channel: string, score: number, price: number | null, at: Date): void {
    this.#db
      .prepare(
        `INSERT INTO alerts (lot_id, channel, sent_at, score, price) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (lot_id, channel) DO UPDATE SET
           sent_at = excluded.sent_at,
           score = excluded.score,
           price = excluded.price`,
      )
      .run(lotId, channel, at.toISOString(), score, sqlValue(price));
  }
}
