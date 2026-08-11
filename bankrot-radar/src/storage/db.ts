/**
 * Хранилище на встроенном в Node SQLite.
 *
 * Ноль внешних зависимостей — сервис, который годами крутится по cron,
 * не должен падать из-за пересборки нативного модуля. Схема совместима
 * с Postgres по структуре: миграция сводится к смене драйвера.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

/** SQLite не принимает undefined и boolean — приводим к допустимым типам. */
export function sqlValue(value: unknown): string | number | bigint | null | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lots (
  id                TEXT PRIMARY KEY,
  source_system     TEXT NOT NULL,
  source_id         TEXT NOT NULL,
  source_url        TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  debtor_name       TEXT,
  debtor_inn        TEXT,
  case_number       TEXT,
  organizer         TEXT,
  etp_name          TEXT,
  etp_url           TEXT,
  procedure         TEXT NOT NULL,
  status            TEXT NOT NULL,
  start_price       REAL,
  deposit           REAL,
  price_schedule    TEXT NOT NULL,
  published_at      TEXT,
  application_start TEXT,
  application_end   TEXT,
  auction_at        TEXT,
  assets            TEXT NOT NULL,
  region_code       INTEGER,
  raw               TEXT,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lots_region ON lots (region_code);
CREATE INDEX IF NOT EXISTS idx_lots_application_end ON lots (application_end);
CREATE INDEX IF NOT EXISTS idx_lots_source ON lots (source_system, source_id);

-- История цены нужна не для отчётов, а для стратегии на публичном предложении:
-- по ней видно, на каком периоде снижения лоты этого типа реально уходят.
CREATE TABLE IF NOT EXISTS lot_price_history (
  lot_id      TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  price       REAL NOT NULL,
  PRIMARY KEY (lot_id, observed_at)
);

CREATE TABLE IF NOT EXISTS lot_scores (
  lot_id              TEXT PRIMARY KEY,
  scored_at           TEXT NOT NULL,
  score               INTEGER NOT NULL,
  discount            REAL,
  current_price       REAL,
  estimate_value      REAL,
  estimate_method     TEXT,
  estimate_confidence REAL,
  components          TEXT NOT NULL,
  flags               TEXT NOT NULL,
  reasons             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_score ON lot_scores (score DESC);

-- Состоявшиеся продажи: обучающая выборка для оценки.
CREATE TABLE IF NOT EXISTS sold_lots (
  id          TEXT PRIMARY KEY,
  asset_kind  TEXT NOT NULL,
  region_code INTEGER,
  area_sqm    REAL,
  start_price REAL NOT NULL,
  sold_price  REAL NOT NULL,
  sold_at     TEXT NOT NULL,
  title       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sold_kind_region ON sold_lots (asset_kind, region_code);

-- Кэш ответов реестров. Запросы платные и лимитированные, поэтому кэш здесь
-- не оптимизация, а условие применимости: без него один прогон по кандидатам
-- стоил бы как месяц подписки.
CREATE TABLE IF NOT EXISTS enrichment_cache (
  provider   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  facts      TEXT NOT NULL,
  error      TEXT,
  PRIMARY KEY (provider, subject)
);

-- Факты, применённые к конкретному лоту: нужны, чтобы пересчитать скоринг
-- без повторного обращения к реестрам.
CREATE TABLE IF NOT EXISTS lot_facts (
  lot_id     TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  facts      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  lot_id     TEXT NOT NULL,
  channel    TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  price      REAL,
  PRIMARY KEY (lot_id, channel)
);

-- Сделки принадлежат пользователю и переживают исчезновение лота из выдачи,
-- поэтому внешнего ключа на lots здесь намеренно нет: лот может пропасть
-- из источника, а обязательства по нему — остаться.
CREATE TABLE IF NOT EXISTS deals (
  lot_id     TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  buyer_type TEXT NOT NULL,
  max_price  REAL,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals (status);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  fetched     INTEGER NOT NULL DEFAULT 0,
  inserted    INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
