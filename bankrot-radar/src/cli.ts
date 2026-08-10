#!/usr/bin/env node
// Точка входа. Фазы разнесены по командам, чтобы их можно было ставить
// в cron с разной периодичностью:
//
//   */15 * * * *  cd /opt/bankrot-radar && npm run ingest
//   0    * * * *  cd /opt/bankrot-radar && npm run score
//   5    * * * *  cd /opt/bankrot-radar && npm run alert

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { regionName } from './domain/regions.ts';
import { describeImportStats } from './enrich/sales.ts';
import { salesFromCsv } from './import/csv.ts';
import {
  ComparablesEstimator,
  CompositeEstimator,
  OverridesEstimator,
} from './enrich/estimator.ts';
import type { Estimator } from './enrich/estimator.ts';
import { ConsoleNotifier, TelegramNotifier } from './notify/notifier.ts';
import type { Notifier } from './notify/notifier.ts';
import { harvestSales, importSales, ingest, scoreAll, sendAlerts } from './pipeline.ts';
import type { PipelineDeps } from './pipeline.ts';
import { FedresursSource } from './sources/fedresurs.ts';
import { TorgiGovSource } from './sources/torgiGov.ts';
import type { Source } from './sources/types.ts';
import { AlertsRepo } from './storage/alertsRepo.ts';
import { ComparablesRepo } from './storage/comparablesRepo.ts';
import { openDb } from './storage/db.ts';
import { LotsRepo } from './storage/lotsRepo.ts';
import { demoComparables, demoLots } from './demo/seed.ts';

const HELP = `bankrot-radar — сбор, оценка и скоринг лотов торгов

  ingest [--days N] [--limit N]   собрать лоты из включённых источников
  harvest [--days N] [--limit N]  собрать результаты состоявшихся торгов (обучение оценки)
  import-sales <файл.csv>         загрузить результаты торгов из CSV
  score                           пересчитать оценку и скоринг активных лотов
  alert                           разослать алерты по лотам выше порога
  run [--days N]                  ingest + score + alert одной командой
  top [--min N] [--limit N]       показать лучшие лоты в терминале
  stats                           состояние базы, наполненность выборки, прогоны
  seed-demo                       залить демо-данные и прогнать конвейер офлайн

Конфигурация читается из окружения, см. .env.example.
Файл .env подхватывается автоматически, если лежит рядом.`;

async function main(argv: string[]): Promise<number> {
  loadEnvFileIfPresent();

  const command = argv[0] ?? 'help';
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return 0;
  }

  const flags = parseFlags(argv.slice(1));
  const config = loadConfig();
  const context = createContext(config);
  const now = new Date();

  switch (command) {
    case 'ingest': {
      const results = await runIngest(context, config, flags, now);
      for (const result of results) {
        console.log(
          `${result.source}: получено ${result.fetched}, новых ${result.inserted}, ` +
            `обновлено ${result.updated}, отфильтровано ${result.filtered}` +
            (result.error ? ` — ОШИБКА: ${result.error}` : ''),
        );
      }
      return results.some((r) => r.error) ? 1 : 0;
    }

    case 'harvest': {
      if (!config.fedresurs.enabled) {
        console.error(
          'Источник результатов торгов не включён: задайте FEDRESURS_ENABLED=true и FEDRESURS_KEY.\n' +
            'Пока ключа нет, базу аналогов можно завести командой import-sales из CSV-выгрузки.',
        );
        return 1;
      }

      // Результаты публикуются с задержкой в месяцы, поэтому окно по умолчанию
      // на порядок шире, чем у сбора объявлений.
      const days = Number(flags.days ?? 180);
      const stats = await harvestSales(
        context,
        new FedresursSource({
          baseUrl: config.fedresurs.baseUrl,
          key: config.fedresurs.key,
          searchPath: config.fedresurs.searchPath,
          authHeader: config.fedresurs.authHeader,
        }),
        {
          from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
          to: now,
          limit: flags.limit === undefined ? undefined : Number(flags.limit),
        },
      );
      console.log(`Результаты торгов: ${describeImportStats(stats)}`);
      return 0;
    }

    case 'import-sales': {
      const file = typeof flags.file === 'string' ? flags.file : argv[1];
      if (!file || file.startsWith('--')) {
        console.error('Укажите путь к CSV: radar import-sales sales.csv');
        return 2;
      }

      let content: string;
      try {
        content = await readFile(file, 'utf8');
      } catch (error) {
        console.error(`Не удалось прочитать ${file}: ${error instanceof Error ? error.message : error}`);
        return 1;
      }

      const sales = salesFromCsv(content, { sourcePrefix: basename(file, '.csv') });
      const stats = importSales(context, sales);
      console.log(`Импорт из ${file}: ${describeImportStats(stats)}`);
      return stats.accepted > 0 ? 0 : 1;
    }

    case 'score': {
      const { scored } = await scoreAll(context, now);
      console.log(`Оценено лотов: ${scored}`);
      return 0;
    }

    case 'alert': {
      const { sent, suppressed } = await sendAlerts(context, now);
      console.log(`Отправлено ${sent}, подавлено как повтор ${suppressed}`);
      return 0;
    }

    case 'run': {
      const results = await runIngest(context, config, flags, now);
      for (const result of results) {
        console.log(
          `${result.source}: получено ${result.fetched}, новых ${result.inserted}, обновлено ${result.updated}` +
            (result.error ? ` — ОШИБКА: ${result.error}` : ''),
        );
      }
      const { scored } = await scoreAll(context, now);
      const { sent, suppressed } = await sendAlerts(context, now);
      console.log(`Оценено ${scored}, отправлено ${sent}, подавлено ${suppressed}`);
      return 0;
    }

    case 'top': {
      printTop(context, Number(flags.min ?? 0), Number(flags.limit ?? 20));
      return 0;
    }

    case 'stats': {
      printStats(context);
      return 0;
    }

    case 'seed-demo': {
      const comparables = new ComparablesRepo(context.db);
      comparables.addMany(demoComparables(now));
      for (const lot of demoLots(now)) context.lots.upsert(lot, now);

      const { scored } = await scoreAll(context, now);
      console.log(
        `Демо-данные загружены: ${context.lots.count()} лотов, ` +
          `${comparables.count()} сопоставимых продаж, оценено ${scored}.\n`,
      );
      printTop(context, 0, 10);
      return 0;
    }

    default:
      console.error(`Неизвестная команда: ${command}\n`);
      console.log(HELP);
      return 2;
  }
}

function createContext(config: Config): PipelineDeps {
  const db = openDb(config.dbPath);
  const lots = new LotsRepo(db);
  const alerts = new AlertsRepo(db);
  const comparables = new ComparablesRepo(db);

  const estimator: Estimator = new CompositeEstimator([
    new OverridesEstimator(new Map()),
    new ComparablesEstimator(comparables, {
      minComparables: config.estimate.minComparables,
      uplift: config.estimate.uplift,
    }),
  ]);

  const notifier: Notifier = config.telegram.enabled
    ? new TelegramNotifier(config.telegram.botToken, config.telegram.chatId)
    : new ConsoleNotifier();

  return { db, lots, alerts, estimator, notifier, config };
}

async function runIngest(
  context: PipelineDeps,
  config: Config,
  flags: Record<string, string | boolean>,
  now: Date,
) {
  const days = Number(flags.days ?? 1);
  const limit = flags.limit === undefined ? undefined : Number(flags.limit);
  const window = {
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    to: now,
    limit,
  };

  const sources: Source[] = [];
  if (config.fedresurs.enabled) {
    sources.push(
      new FedresursSource({
        baseUrl: config.fedresurs.baseUrl,
        key: config.fedresurs.key,
        searchPath: config.fedresurs.searchPath,
        authHeader: config.fedresurs.authHeader,
        publicBaseUrl: 'https://bankrot.fedresurs.ru',
      }),
    );
  }
  if (config.torgiGov.enabled) {
    sources.push(new TorgiGovSource({ baseUrl: config.torgiGov.baseUrl }));
  }

  if (sources.length === 0) {
    console.warn('Ни один источник не включён — проверьте FEDRESURS_ENABLED и TORGI_GOV_ENABLED.');
    return [];
  }

  return ingest(context, sources, window, now);
}

function printTop(context: PipelineDeps, minScore: number, limit: number): void {
  const top = context.lots.topScored(minScore, limit);
  if (top.length === 0) {
    console.log('Подходящих лотов нет. Запустите ingest и score либо seed-demo.');
    return;
  }

  for (const item of top) {
    const price = item.currentPrice === null ? '—' : `${Math.round(item.currentPrice).toLocaleString('ru-RU')} ₽`;
    const discount = item.discount === null ? '—' : `${(item.discount * 100).toFixed(0)}%`;
    console.log(
      `\n[${String(item.score).padStart(3)}] ${item.lot.title}\n` +
        `      ${regionName(item.lot.regionCode)} · цена ${price} · дисконт ${discount}\n` +
        item.reasons.map((reason) => `      • ${reason}`).join('\n'),
    );
  }
  console.log('');
}

function printStats(context: PipelineDeps): void {
  const comparables = new ComparablesRepo(context.db);
  console.log(`Лотов в базе: ${context.lots.count()}`);
  console.log(`Сопоставимых продаж: ${comparables.count()}`);

  const byKind = comparables.countByKind();
  if (byKind.length > 0) {
    const minimum = context.config.estimate.minComparables;
    console.log('\nНаполненность выборки по видам имущества:');
    for (const row of byKind) {
      const ready = row.total >= minimum ? 'оценка работает' : `нужно ещё ${minimum - row.total}`;
      console.log(`  ${row.assetKind.padEnd(12)} ${String(row.total).padStart(5)} · ${ready}`);
    }
  } else {
    console.log(
      '\nВыборка пуста — оценка не строится, и скоринг ограничивает лоты 45 баллами.\n' +
        'Наполните её командой harvest или import-sales.',
    );
  }

  const runs = context.db
    .prepare('SELECT source, started_at, fetched, inserted, updated, error FROM runs ORDER BY id DESC LIMIT 5')
    .all();
  if (runs.length === 0) {
    console.log('Прогонов ещё не было.');
    return;
  }

  console.log('\nПоследние прогоны:');
  for (const raw of runs) {
    const row = raw as Record<string, unknown>;
    console.log(
      `  ${row.started_at} ${row.source}: получено ${row.fetched}, новых ${row.inserted}, ` +
        `обновлено ${row.updated}${row.error ? ` — ${row.error}` : ''}`,
    );
  }
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) continue;
    const [name, inline] = arg.slice(2).split('=', 2);
    if (!name) continue;
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

/** .env рядом с проектом — удобство для локального запуска, в проде переменные задаёт окружение. */
function loadEnvFileIfPresent(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Файла нет — это нормальный режим работы.
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
