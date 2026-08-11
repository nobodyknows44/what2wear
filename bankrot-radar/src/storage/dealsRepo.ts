import type { BuyerType, Deal, DealStatus } from '../domain/deal.ts';
import { canTransition, isTerminal } from '../domain/deal.ts';
import type { Db } from './db.ts';
import { sqlValue } from './db.ts';

export class DealTransitionError extends Error {
  constructor(from: DealStatus, to: DealStatus) {
    super(`Переход «${from}» → «${to}» не предусмотрен`);
    this.name = 'DealTransitionError';
  }
}

export class DealsRepo {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  create(lotId: string, buyerType: BuyerType, now: Date, maxPrice?: number): Deal {
    const existing = this.get(lotId);
    if (existing) return existing;

    const deal: Deal = {
      lotId,
      status: 'interest',
      buyerType,
      maxPrice,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completed: {},
    };
    this.#write(deal);
    return deal;
  }

  get(lotId: string): Deal | null {
    const raw = this.#db.prepare('SELECT * FROM deals WHERE lot_id = ?').get(lotId);
    return raw ? rowToDeal(raw as Record<string, unknown>) : null;
  }

  /** Незавершённые сделки — те, по которым ещё возможны действия. */
  active(): Deal[] {
    const rows = this.#db.prepare('SELECT * FROM deals ORDER BY updated_at DESC').all();
    return rows
      .map((row) => rowToDeal(row as Record<string, unknown>))
      .filter((deal) => !isTerminal(deal.status));
  }

  all(): Deal[] {
    const rows = this.#db.prepare('SELECT * FROM deals ORDER BY updated_at DESC').all();
    return rows.map((row) => rowToDeal(row as Record<string, unknown>));
  }

  /**
   * Перевод в новый статус. Недопустимый переход — ошибка, а не молчаливая запись:
   * «задаток перечислен» после «заявка подана» означает, что что-то пошло не так,
   * и это надо заметить сразу, а не искать потом в истории.
   */
  move(lotId: string, to: DealStatus, now: Date): Deal {
    const deal = this.get(lotId);
    if (!deal) throw new Error(`Сделка по лоту ${lotId} не заведена`);
    if (!canTransition(deal.status, to)) throw new DealTransitionError(deal.status, to);

    const updated: Deal = { ...deal, status: to, updatedAt: now.toISOString() };
    this.#write(updated);
    return updated;
  }

  /** Явная отметка о выполнении вехи — для тех, что не следуют из статуса. */
  markDone(lotId: string, milestone: string, now: Date): Deal {
    const deal = this.get(lotId);
    if (!deal) throw new Error(`Сделка по лоту ${lotId} не заведена`);

    const updated: Deal = {
      ...deal,
      completed: { ...deal.completed, [milestone]: now.toISOString() },
      updatedAt: now.toISOString(),
    };
    this.#write(updated);
    return updated;
  }

  setMaxPrice(lotId: string, maxPrice: number, now: Date): Deal {
    const deal = this.get(lotId);
    if (!deal) throw new Error(`Сделка по лоту ${lotId} не заведена`);

    const updated: Deal = { ...deal, maxPrice, updatedAt: now.toISOString() };
    this.#write(updated);
    return updated;
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM deals').get() as { n: number };
    return Number(row.n);
  }

  #write(deal: Deal): void {
    this.#db
      .prepare(
        `INSERT INTO deals (lot_id, status, buyer_type, max_price, notes, created_at, updated_at, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (lot_id) DO UPDATE SET
           status = excluded.status,
           buyer_type = excluded.buyer_type,
           max_price = excluded.max_price,
           notes = excluded.notes,
           updated_at = excluded.updated_at,
           completed = excluded.completed`,
      )
      .run(
        deal.lotId,
        deal.status,
        deal.buyerType,
        sqlValue(deal.maxPrice),
        sqlValue(deal.notes),
        deal.createdAt,
        deal.updatedAt,
        JSON.stringify(deal.completed),
      );
  }
}

function rowToDeal(row: Record<string, unknown>): Deal {
  return {
    lotId: String(row.lot_id),
    status: String(row.status) as DealStatus,
    buyerType: String(row.buyer_type) as BuyerType,
    maxPrice: row.max_price === null || row.max_price === undefined ? undefined : Number(row.max_price),
    notes: row.notes === null || row.notes === undefined ? undefined : String(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completed: JSON.parse(String(row.completed ?? '{}')) as Record<string, string>,
  };
}
