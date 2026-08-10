/**
 * Оркестрация: сбор → скоринг → алерты.
 *
 * Три независимые фазы, каждая запускается отдельно. Это важно эксплуатационно:
 * сбор можно гонять раз в 15 минут, скоринг — раз в час, а алерты держать
 * выключенными, пока настраиваются пороги, не трогая накопление данных.
 */

import type { Config } from './config.ts';
import type { Lot } from './domain/lot.ts';
import { lotAssetKind } from './domain/lot.ts';
import { priceAt } from './domain/priceSchedule.ts';
import type { Estimator } from './enrich/estimator.ts';
import type { RawSale, SaleImportStats } from './enrich/sales.ts';
import { emptyImportStats, resolveSale } from './enrich/sales.ts';
import { formatAlert } from './notify/format.ts';
import type { Notifier } from './notify/notifier.ts';
import { scoreLot } from './score/score.ts';
import type { SalesSource, Source } from './sources/types.ts';
import type { Db } from './storage/db.ts';
import { sqlValue } from './storage/db.ts';
import type { AlertsRepo } from './storage/alertsRepo.ts';
import { ComparablesRepo } from './storage/comparablesRepo.ts';
import type { LotsRepo } from './storage/lotsRepo.ts';

export interface PipelineDeps {
  db: Db;
  lots: LotsRepo;
  alerts: AlertsRepo;
  estimator: Estimator;
  notifier: Notifier;
  config: Config;
}

export interface IngestResult {
  source: string;
  fetched: number;
  inserted: number;
  updated: number;
  filtered: number;
  error?: string;
}

/** Лот проходит воронку, только если попадает во все заданные фильтры. */
export function passesFilters(lot: Lot, filters: Config['filters']): boolean {
  if (filters.regions.length > 0) {
    if (lot.regionCode === undefined || !filters.regions.includes(lot.regionCode)) return false;
  }
  if (filters.assetKinds.length > 0 && !filters.assetKinds.includes(lotAssetKind(lot))) {
    return false;
  }
  if (typeof filters.minPrice === 'number') {
    if (lot.startPrice === undefined || lot.startPrice < filters.minPrice) return false;
  }
  if (typeof filters.maxPrice === 'number') {
    if (lot.startPrice === undefined || lot.startPrice > filters.maxPrice) return false;
  }
  return true;
}

export async function ingest(
  deps: PipelineDeps,
  sources: readonly Source[],
  window: { from: Date; to: Date; limit?: number },
  now: Date,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];

  for (const source of sources) {
    const runId = startRun(deps.db, source.name, now);
    const result: IngestResult = {
      source: source.name,
      fetched: 0,
      inserted: 0,
      updated: 0,
      filtered: 0,
    };

    try {
      const lots = await source.collect(window);
      result.fetched = lots.length;

      for (const lot of lots) {
        if (!passesFilters(lot, deps.config.filters)) {
          result.filtered++;
          continue;
        }
        const action = deps.lots.upsert(lot, now);
        if (action === 'inserted') result.inserted++;
        else result.updated++;
      }
    } catch (error) {
      // Один упавший источник не должен останавливать остальные: у ЕФРСБ
      // и ГИС Торги независимые окна доступности.
      result.error = error instanceof Error ? error.message : String(error);
    }

    finishRun(deps.db, runId, result, new Date());
    results.push(result);
  }

  return results;
}

/**
 * Загрузка результатов состоявшихся торгов в обучающую выборку.
 *
 * Отдельная фаза, а не часть ingest: результаты публикуются с задержкой
 * в месяцы, поэтому их собирают по широкому окну и редко, тогда как объявления
 * нужны свежими и часто.
 */
export function importSales(deps: PipelineDeps, raws: readonly RawSale[]): SaleImportStats {
  const comparables = new ComparablesRepo(deps.db);
  const stats = emptyImportStats();
  const lookup = (key: string) => deps.lots.get(key);

  for (const raw of raws) {
    stats.total++;
    const { sale, reason } = resolveSale(raw, lookup);
    if (!sale) {
      if (reason) stats.rejected[reason]++;
      continue;
    }
    comparables.add(sale);
    stats.accepted++;
  }

  return stats;
}

export async function harvestSales(
  deps: PipelineDeps,
  source: SalesSource,
  window: { from: Date; to: Date; limit?: number },
): Promise<SaleImportStats> {
  const raws = await source.collectSales(window);
  return importSales(deps, raws);
}

export async function scoreAll(deps: PipelineDeps, now: Date): Promise<{ scored: number }> {
  const lots = deps.lots.list({ acceptingAt: now });
  let scored = 0;

  for (const lot of lots) {
    const estimate = await deps.estimator.estimate(lot);
    deps.lots.saveScore(lot.id, scoreLot({ lot, estimate, now }), now);
    scored++;
  }

  return { scored };
}

export async function sendAlerts(
  deps: PipelineDeps,
  now: Date,
): Promise<{ sent: number; suppressed: number }> {
  const candidates = deps.lots.topScored(deps.config.alerts.minScore, deps.config.alerts.maxPerRun * 4);
  const channel = deps.notifier.channel;
  let sent = 0;
  let suppressed = 0;

  for (const candidate of candidates) {
    if (sent >= deps.config.alerts.maxPerRun) break;

    const price = candidate.currentPrice ?? priceAt(candidate.lot.priceSchedule, now);
    if (!deps.alerts.shouldSend(candidate.lot.id, channel, candidate.score, price)) {
      suppressed++;
      continue;
    }

    await deps.notifier.send(formatAlert(candidate, now));
    deps.alerts.record(candidate.lot.id, channel, candidate.score, price, now);
    sent++;
  }

  return { sent, suppressed };
}

function startRun(db: Db, source: string, now: Date): number {
  db.prepare('INSERT INTO runs (source, started_at) VALUES (?, ?)').run(source, now.toISOString());
  const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
  return Number(row.id);
}

function finishRun(db: Db, runId: number, result: IngestResult, at: Date): void {
  db.prepare(
    'UPDATE runs SET finished_at = ?, fetched = ?, inserted = ?, updated = ?, error = ? WHERE id = ?',
  ).run(at.toISOString(), result.fetched, result.inserted, result.updated, sqlValue(result.error), runId);
}
