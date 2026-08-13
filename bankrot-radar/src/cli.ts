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
import { documentChecklist } from './deal/checklist.ts';
import { milestonesFor } from './deal/milestones.ts';
import type { MilestoneOptions } from './deal/milestones.ts';
import {
  BUYER_LABELS,
  BUYER_TYPES,
  STATUS_LABELS,
  allowedTransitions,
  isBuyerType,
  isDealStatus,
} from './domain/deal.ts';
import { runBacktest } from './diagnostics/backtest.ts';
import { bar, coverageReport, needsAttention } from './diagnostics/coverage.ts';
import { regionName } from './domain/regions.ts';
import { describeImportStats } from './enrich/sales.ts';
import { EnrichmentRunner } from './enrich/enricher.ts';
import type { Enricher } from './enrich/enricher.ts';
import { EgrnEnricher, FnpPledgeEnricher, ManualFactsEnricher } from './enrich/providers.ts';
import { salesFromCsv } from './import/csv.ts';
import {
  ComparablesEstimator,
  CompositeEstimator,
  OverridesEstimator,
} from './enrich/estimator.ts';
import type { Estimator } from './enrich/estimator.ts';
import { ConsoleNotifier, TelegramNotifier } from './notify/notifier.ts';
import type { Notifier } from './notify/notifier.ts';
import {
  enrichCandidates,
  harvestSales,
  importSales,
  ingest,
  remindDeals,
  scoreAll,
  sendAlerts,
} from './pipeline.ts';
import type { PipelineDeps } from './pipeline.ts';
import { FedresursSource } from './sources/fedresurs.ts';
import { TorgiGovSource } from './sources/torgiGov.ts';
import type { Source } from './sources/types.ts';
import { AlertsRepo } from './storage/alertsRepo.ts';
import { ComparablesRepo } from './storage/comparablesRepo.ts';
import { DealsRepo } from './storage/dealsRepo.ts';
import { openDb } from './storage/db.ts';
import { EnrichmentCacheRepo, LotFactsRepo } from './storage/enrichmentRepo.ts';
import { LotsRepo } from './storage/lotsRepo.ts';
import { demoComparables, demoLots } from './demo/seed.ts';

const HELP = `bankrot-radar — сбор, оценка и скоринг лотов торгов

  ingest [--days N] [--limit N]   собрать лоты из включённых источников
  harvest [--days N] [--limit N]  собрать результаты состоявшихся торгов (обучение оценки)
  import-sales <файл.csv>         загрузить результаты торгов из CSV
  score                           пересчитать оценку и скоринг активных лотов
  enrich [--min N] [--limit N]    обогатить кандидатов данными реестров и пересчитать их балл
  alert                           разослать алерты по лотам выше порога
  deal <add|move|done|show|list>  воронка сделок: сроки, статусы, пакет документов
  remind                          напомнить о приближающихся и нарушенных сроках
  run [--days N]                  ingest + score + alert одной командой
  top [--min N] [--limit N]       показать лучшие лоты в терминале
  stats                           состояние базы, наполненность выборки, прогоны
  doctor [--threshold 0.8]        полнота извлечения данных и примеры того, что не разобралось
  backtest                        проверка оценки на собственной истории продаж
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

    case 'enrich': {
      const enrichers = buildEnrichers(config);
      if (enrichers.length === 0) {
        console.error(
          'Ни один провайдер обогащения не настроен.\n' +
            'Самый быстрый старт без API: проверьте несколько объектов вручную, сложите факты\n' +
            'в JSON и укажите путь в ENRICH_MANUAL_FACTS. См. README, раздел «Обогащение».',
        );
        return 1;
      }

      const runner = new EnrichmentRunner(enrichers, new EnrichmentCacheRepo(context.db), {
        maxRequests: Number(flags['max-requests'] ?? config.enrichment.maxRequests),
      });

      const stats = await enrichCandidates(context, runner, now, {
        minScore: Number(flags.min ?? config.enrichment.minScore),
        limit: Number(flags.limit ?? config.enrichment.limit),
      });

      console.log(
        `Обогащено лотов: ${stats.lots}. Из кэша ${stats.fromCache}, запросов ${stats.fetched}, ` +
          `ошибок ${stats.failed}, неприменимо ${stats.notApplicable}` +
          (stats.budgetExhausted > 0 ? `, упёрлось в бюджет ${stats.budgetExhausted}` : '') +
          `. Остаток бюджета: ${runner.remainingBudget}.`,
      );
      return 0;
    }

    case 'alert': {
      const { sent, suppressed } = await sendAlerts(context, now);
      console.log(`Отправлено ${sent}, подавлено как повтор ${suppressed}`);
      return 0;
    }

    case 'deal':
      return runDeal(context, config, argv.slice(1), flags, now);

    case 'remind': {
      const stats = await remindDeals(context, now, {
        horizonHours: Number(flags.horizon ?? config.deals.remindHorizonHours),
        milestones: milestoneOptions(config),
      });
      console.log(
        `Сделок в работе ${stats.deals}, напоминаний отправлено ${stats.sent}, ` +
          `подавлено ${stats.suppressed}` +
          (stats.lotMissing > 0 ? `, лот не найден у ${stats.lotMissing}` : ''),
      );
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

    case 'backtest': {
      const comparables = new ComparablesRepo(context.db);
      const sales = comparables.list();
      if (sales.length === 0) {
        console.log('История продаж пуста. Наполните её: harvest или import-sales.');
        return 0;
      }

      const report = await runBacktest(sales, comparables, {
        minComparables: config.estimate.minComparables,
        minEvaluated: Number(flags['min-evaluated'] ?? 30),
      });

      console.log(
        `Проверено ${report.evaluated} из ${report.total} продаж ` +
          `(пропущено ${report.skipped}: на дату сделки ещё не набралось аналогов)\n`,
      );

      if (report.evaluated === 0) {
        console.log(
          'Оценить не удалось ни одной продажи. Это не поломка: выборка обязана быть\n' +
            'достаточной на момент КАЖДОЙ сделки, а не в целом — иначе проверка смотрела бы\n' +
            'в будущее. Наполните историю глубже по времени.',
        );
        return 0;
      }

      console.log(`Медианная ошибка оценки: ${percent(report.medianAbsError)}`);
      console.log(
        `Смещение: ${percent(report.medianBias)} ` +
          `(${(report.medianBias ?? 0) < 0 ? 'систематически занижаем' : 'систематически завышаем'})`,
      );

      if (report.byKind.length > 1) {
        console.log('\nПо видам имущества:');
        for (const kind of report.byKind) {
          console.log(
            `  ${kind.assetKind.padEnd(12)} n=${String(kind.evaluated).padStart(4)}  ` +
              `ошибка ${percent(kind.medianAbsError)}  смещение ${percent(kind.medianBias)}`,
          );
        }
      }

      if (report.suggestedUplift !== null) {
        console.log(
          `\nОбоснованный множитель: ESTIMATE_UPLIFT=${report.suggestedUplift}\n` +
            'Это первое число за всю историю сервиса, у которого есть основание, — до сих пор\n' +
            'множитель равнялся единице именно потому, что подтверждения не было.',
        );
      } else {
        console.log(
          '\nМножитель не предлагается: выборки мало либо смещение в пределах шума.\n' +
            'ESTIMATE_UPLIFT остаётся равным 1 — это осознанная позиция, а не недоделка.',
        );
      }

      console.log(
        '\nЧего проверка НЕ подтверждает: риск-флаги и веса скоринга. В истории продаж\n' +
          'нет текста извещения, поэтому проверяется только оценка стоимости.',
      );
      return 0;
    }

    case 'doctor': {
      const lots = context.lots.list();
      if (lots.length === 0) {
        console.log('В базе нет лотов. Запустите ingest или seed-demo.');
        return 0;
      }

      const report = coverageReport(lots, { sampleSize: Number(flags.samples ?? 3) });
      console.log(`Полнота извлечения по ${report.totalLots} лотам\n`);

      for (const metric of report.metrics) {
        const percent = metric.share === null ? ' н/д' : `${Math.round(metric.share * 100)}%`.padStart(4);
        console.log(
          `${bar(metric.share)} ${percent}  ${metric.label} (${metric.covered}/${metric.applicable})`,
        );
      }

      const threshold = Number(flags.threshold ?? 0.8);
      const minApplicable = Number(flags['min-applicable'] ?? 10);
      const problems = needsAttention(report, threshold, minApplicable);

      if (problems.length === 0) {
        // Молчание бывает двух видов, и их нельзя путать: «всё хорошо»
        // и «выборка слишком мала, чтобы судить».
        const belowOnSmallSample = needsAttention(report, threshold, 1).length;
        console.log(
          belowOnSmallSample > 0
            ? `\nМетрик ниже порога: ${belowOnSmallSample}, но применимых лотов меньше ${minApplicable} — ` +
                'на такой выборке доля ещё шум.\nПоказать всё равно: --min-applicable 1'
            : '\nМетрик ниже порога нет.',
        );
        return 0;
      }

      console.log('\nТребуют внимания:\n');
      for (const metric of problems) {
        console.log(`${metric.label} — ${Math.round(metric.share! * 100)}%`);
        console.log(`  ${metric.impact}`);
        for (const sample of metric.samples) console.log(`  · ${sample.slice(0, 100)}`);
        console.log('');
      }
      console.log(
        'Прочитайте примеры глазами: чаще всего не хватает одной формулировки в правиле.\n' +
          'Порядок работы — правило в src/normalize/text.ts, тест на настоящем тексте, повторный doctor.',
      );
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

function milestoneOptions(config: Config): MilestoneOptions {
  return {
    depositLeadDays: config.deals.depositLeadDays,
    documentsLeadDays: config.deals.documentsLeadDays,
    applicationLeadDays: config.deals.applicationLeadDays,
    holidays: config.deals.holidays,
  };
}

const DEAL_HELP = `radar deal <подкоманда>

  add <lotId> [--buyer individual|entrepreneur|company] [--max N]
  move <lotId> <статус>
  done <lotId> <веха>
  show <lotId>
  list`;

function runDeal(
  context: PipelineDeps,
  config: Config,
  argv: string[],
  flags: Record<string, string | boolean>,
  now: Date,
): number {
  const deals = new DealsRepo(context.db);
  const sub = argv[0];
  const lotId = argv[1];

  switch (sub) {
    case 'add': {
      if (!lotId) return fail('Укажите идентификатор лота: radar deal add <lotId>');
      if (!context.lots.get(lotId)) return fail(`Лот ${lotId} не найден в базе`);

      const rawBuyer = typeof flags.buyer === 'string' ? flags.buyer : 'individual';
      if (!isBuyerType(rawBuyer)) {
        return fail(`Тип покупателя должен быть одним из: ${BUYER_TYPES.join(', ')}`);
      }
      const maxPrice = flags.max === undefined ? undefined : Number(flags.max);

      const deal = deals.create(lotId, rawBuyer, now, maxPrice);
      console.log(`Сделка заведена: ${deal.lotId}, ${BUYER_LABELS[deal.buyerType]}`);
      printDeal(context, config, deal, now);
      return 0;
    }

    case 'move': {
      const target = argv[2];
      if (!lotId || !target) return fail('radar deal move <lotId> <статус>');
      if (!isDealStatus(target)) return fail(`Неизвестный статус: ${target}`);

      try {
        const deal = deals.move(lotId, target, now);
        console.log(`Статус: ${STATUS_LABELS[deal.status]}`);
        printDeal(context, config, deal, now);
        return 0;
      } catch (error) {
        const current = deals.get(lotId);
        const hint = current
          ? ` Из «${STATUS_LABELS[current.status]}» возможно: ${allowedTransitions(current.status)
              .map((s) => STATUS_LABELS[s])
              .join(', ') || 'ничего, статус конечный'}`
          : '';
        return fail(`${error instanceof Error ? error.message : String(error)}.${hint}`);
      }
    }

    case 'done': {
      const milestone = argv[2];
      if (!lotId || !milestone) return fail('radar deal done <lotId> <веха>');
      const deal = deals.markDone(lotId, milestone, now);
      console.log(`Веха «${milestone}» отмечена выполненной`);
      printDeal(context, config, deal, now);
      return 0;
    }

    case 'show': {
      if (!lotId) return fail('radar deal show <lotId>');
      const deal = deals.get(lotId);
      if (!deal) return fail(`Сделка по лоту ${lotId} не заведена`);
      printDeal(context, config, deal, now, { checklist: true });
      return 0;
    }

    case 'list': {
      const all = deals.all();
      if (all.length === 0) {
        console.log('Сделок нет. Заведите первую: radar deal add <lotId>');
        return 0;
      }
      for (const deal of all) {
        const lot = context.lots.get(deal.lotId);
        console.log(
          `${STATUS_LABELS[deal.status].padEnd(26)} ${lot ? lot.title.slice(0, 60) : deal.lotId}`,
        );
      }
      return 0;
    }

    default:
      console.log(DEAL_HELP);
      return sub === undefined ? 0 : 2;
  }
}

function printDeal(
  context: PipelineDeps,
  config: Config,
  deal: ReturnType<DealsRepo['get']> & object,
  now: Date,
  options: { checklist?: boolean } = {},
): void {
  const lot = context.lots.get(deal.lotId);
  if (!lot) {
    console.log('Лот больше не в базе — вехи и чек-лист рассчитать не из чего.');
    return;
  }

  console.log(`\n${lot.title}`);
  if (typeof deal.maxPrice === 'number') {
    console.log(`Потолок цены: ${Math.round(deal.maxPrice).toLocaleString('ru-RU')} ₽`);
  }

  const milestones = milestonesFor(lot, deal, now, milestoneOptions(config));
  if (milestones.length === 0) {
    console.log('Сроков в извещении нет — вехи не рассчитаны.');
  } else {
    console.log('\nВехи:');
    for (const milestone of milestones) {
      const mark = milestone.done ? '✓' : milestone.overdue ? '!' : ' ';
      const due = milestone.dayGranular
        ? new Date(milestone.dueAt).toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : new Date(milestone.dueAt).toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Moscow',
          });
      console.log(`  ${mark} ${milestone.title.padEnd(28)} ${due.padEnd(17)} ${milestone.rationale}`);
    }
  }

  if (options.checklist) {
    console.log(`\nПакет документов (${BUYER_LABELS[deal.buyerType]}):`);
    for (const item of documentChecklist(lot, deal.buyerType)) {
      console.log(
        `  ${item.slow ? '⏳' : '·'} ${item.title}${item.note ? `\n      ${item.note}` : ''}`,
      );
    }
  }
  console.log('');
}

function percent(value: number | null): string {
  return value === null ? 'н/д' : `${(value * 100).toFixed(1)}%`;
}

function fail(message: string): number {
  console.error(message);
  return 2;
}

/**
 * Провайдеры обогащения. Ручные факты идут первыми: проверенное человеком
 * достовернее любого автоматического ответа и не тратит бюджет запросов.
 */
function buildEnrichers(config: Config): Enricher[] {
  const enrichers: Enricher[] = [];
  const { manualFactsPath, egrn, fnp } = config.enrichment;

  if (manualFactsPath) {
    try {
      enrichers.push(ManualFactsEnricher.fromFile(manualFactsPath));
    } catch (error) {
      console.warn(
        `Не удалось прочитать ${manualFactsPath}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  if (egrn.enabled) enrichers.push(new EgrnEnricher(egrn));
  if (fnp.enabled) enrichers.push(new FnpPledgeEnricher(fnp));

  return enrichers;
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
