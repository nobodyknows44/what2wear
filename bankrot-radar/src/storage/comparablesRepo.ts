/**
 * Состоявшиеся продажи — обучающая выборка для оценки.
 *
 * Это самый ценный актив сервиса и он накапливается только со временем:
 * результаты торгов публикуются в ЕФРСБ, но нигде не собираются в датасет.
 * Чем дольше сервис работает, тем точнее считается дисконт.
 */

import type { Comparable, ComparablesQuery, ComparablesSource } from '../enrich/estimator.ts';
import type { Db } from './db.ts';
import { sqlValue } from './db.ts';

export interface SoldLotInput extends Comparable {
  id: string;
  title?: string;
}

export class ComparablesRepo implements ComparablesSource {
  #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  add(sold: SoldLotInput): void {
    this.#db
      .prepare(
        `INSERT INTO sold_lots (id, asset_kind, region_code, area_sqm, start_price, sold_price, sold_at, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           asset_kind = excluded.asset_kind,
           region_code = excluded.region_code,
           area_sqm = excluded.area_sqm,
           start_price = excluded.start_price,
           sold_price = excluded.sold_price,
           sold_at = excluded.sold_at,
           title = excluded.title`,
      )
      .run(
        sold.id,
        sold.assetKind,
        sqlValue(sold.regionCode),
        sqlValue(sold.areaSqm),
        sold.startPrice,
        sold.soldPrice,
        sold.soldAt,
        sqlValue(sold.title),
      );
  }

  addMany(items: readonly SoldLotInput[]): void {
    for (const item of items) this.add(item);
  }

  find(query: ComparablesQuery): Comparable[] {
    const conditions = ['asset_kind = ?'];
    const params: (string | number)[] = [query.assetKind];

    if (typeof query.regionCode === 'number') {
      conditions.push('region_code = ?');
      params.push(query.regionCode);
    }
    if (typeof query.minArea === 'number') {
      conditions.push('area_sqm >= ?');
      params.push(query.minArea);
    }
    if (typeof query.maxArea === 'number') {
      conditions.push('area_sqm <= ?');
      params.push(query.maxArea);
    }
    if (query.excludeId !== undefined) {
      conditions.push('id <> ?');
      params.push(query.excludeId);
    }
    if (query.soldBefore !== undefined) {
      conditions.push('sold_at < ?');
      params.push(query.soldBefore);
    }

    const rows = this.#db
      .prepare(
        `SELECT asset_kind, region_code, area_sqm, start_price, sold_price, sold_at
         FROM sold_lots
         WHERE ${conditions.join(' AND ')}
         ORDER BY sold_at DESC
         LIMIT 200`,
      )
      .all(...params);

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        assetKind: String(row.asset_kind),
        regionCode: row.region_code === null ? undefined : Number(row.region_code),
        areaSqm: row.area_sqm === null ? undefined : Number(row.area_sqm),
        startPrice: Number(row.start_price),
        soldPrice: Number(row.sold_price),
        soldAt: String(row.sold_at),
      };
    });
  }

  /** Вся выборка целиком — нужна для проверки оценки на истории. */
  list(limit = 5000): SoldLotInput[] {
    const rows = this.#db
      .prepare(
        `SELECT id, asset_kind, region_code, area_sqm, start_price, sold_price, sold_at, title
         FROM sold_lots ORDER BY sold_at LIMIT ?`,
      )
      .all(limit);

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        id: String(row.id),
        assetKind: String(row.asset_kind),
        regionCode: row.region_code === null ? undefined : Number(row.region_code),
        areaSqm: row.area_sqm === null ? undefined : Number(row.area_sqm),
        startPrice: Number(row.start_price),
        soldPrice: Number(row.sold_price),
        soldAt: String(row.sold_at),
        title: row.title === null ? undefined : String(row.title),
      };
    });
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM sold_lots').get() as { n: number };
    return Number(row.n);
  }

  /**
   * Наполненность выборки по видам имущества. По ней видно, для каких категорий
   * оценка уже работает, а для каких скоринг пока упирается в потолок без оценки.
   */
  countByKind(): { assetKind: string; total: number; withRegion: number }[] {
    const rows = this.#db
      .prepare(
        `SELECT asset_kind,
                COUNT(*) AS total,
                SUM(CASE WHEN region_code IS NOT NULL THEN 1 ELSE 0 END) AS with_region
         FROM sold_lots
         GROUP BY asset_kind
         ORDER BY total DESC`,
      )
      .all();

    return rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        assetKind: String(row.asset_kind),
        total: Number(row.total),
        withRegion: Number(row.with_region ?? 0),
      };
    });
  }
}
