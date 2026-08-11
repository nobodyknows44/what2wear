import type { AssetKind } from './domain/lot.ts';
import { ASSET_KINDS } from './domain/lot.ts';
import { parseRegionList } from './domain/regions.ts';
import { parseHolidays } from './domain/workdays.ts';

export interface Config {
  dbPath: string;
  fedresurs: {
    enabled: boolean;
    baseUrl: string;
    key: string;
    searchPath: string;
    authHeader: string;
  };
  torgiGov: {
    enabled: boolean;
    baseUrl: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
    chatId: string;
  };
  alerts: {
    minScore: number;
    maxPerRun: number;
  };
  filters: {
    regions: number[];
    assetKinds: AssetKind[];
    minPrice?: number;
    maxPrice?: number;
  };
  estimate: {
    uplift: number;
    minComparables: number;
  };
  deals: {
    /** Рабочих дней на прохождение банковского платежа до окончания приёма заявок. */
    depositLeadDays: number;
    /** Рабочих дней на сбор пакета документов до срока перечисления задатка. */
    documentsLeadDays: number;
    /** Рабочих дней запаса на подачу заявки. */
    applicationLeadDays: number;
    /** За сколько часов до срока начинать напоминать. */
    remindHorizonHours: number;
    /** Праздничные дни: производственный календарь меняется ежегодно и не зашит в код. */
    holidays: Set<string>;
  };
  enrichment: {
    /** Минимальный балл первого прохода, начиная с которого лот достоин платного запроса. */
    minScore: number;
    /** Сколько кандидатов брать за прогон. */
    limit: number;
    /** Потолок платных запросов за прогон — страховка от ошибки в логике отбора. */
    maxRequests: number;
    /** Путь к JSON с проверенными вручную фактами. Работает без всяких API. */
    manualFactsPath?: string;
    egrn: HttpProviderSettings;
    fnp: HttpProviderSettings;
  };
}

export interface HttpProviderSettings {
  enabled: boolean;
  baseUrl: string;
  path: string;
  authHeader: string;
  key: string;
  subjectParam: string;
  ttlDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const fedresursKey = env.FEDRESURS_KEY ?? '';

  return {
    dbPath: env.RADAR_DB ?? './data/radar.db',
    fedresurs: {
      // Источник без ключа молча включить нельзя: прогон бы падал на каждом запросе.
      enabled: flag(env.FEDRESURS_ENABLED) && fedresursKey !== '',
      baseUrl: env.FEDRESURS_BASE_URL ?? 'https://bank-publications-prod.fedresurs.ru',
      key: fedresursKey,
      searchPath: env.FEDRESURS_SEARCH_PATH ?? '/v1/messages',
      authHeader: env.FEDRESURS_AUTH_HEADER ?? 'Authorization',
    },
    torgiGov: {
      enabled: flag(env.TORGI_GOV_ENABLED, true),
      baseUrl: env.TORGI_GOV_BASE_URL ?? 'https://torgi.gov.ru',
    },
    telegram: {
      enabled: flag(env.TELEGRAM_ENABLED) && !!env.TELEGRAM_BOT_TOKEN && !!env.TELEGRAM_CHAT_ID,
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: env.TELEGRAM_CHAT_ID ?? '',
    },
    alerts: {
      minScore: number(env.ALERT_MIN_SCORE, 65),
      maxPerRun: number(env.ALERT_MAX_PER_RUN, 15),
    },
    filters: {
      regions: parseRegionList(env.FILTER_REGIONS),
      assetKinds: parseAssetKinds(env.FILTER_ASSET_KINDS),
      minPrice: optionalNumber(env.FILTER_MIN_PRICE),
      maxPrice: optionalNumber(env.FILTER_MAX_PRICE),
    },
    estimate: {
      uplift: number(env.ESTIMATE_UPLIFT, 1),
      minComparables: number(env.ESTIMATE_MIN_COMPARABLES, 5),
    },
    deals: {
      depositLeadDays: number(env.DEAL_DEPOSIT_LEAD_DAYS, 3),
      documentsLeadDays: number(env.DEAL_DOCUMENTS_LEAD_DAYS, 3),
      applicationLeadDays: number(env.DEAL_APPLICATION_LEAD_DAYS, 1),
      remindHorizonHours: number(env.DEAL_REMIND_HORIZON_HOURS, 72),
      holidays: parseHolidays(env.HOLIDAYS),
    },
    enrichment: {
      minScore: number(env.ENRICH_MIN_SCORE, 55),
      limit: number(env.ENRICH_LIMIT, 50),
      maxRequests: number(env.ENRICH_MAX_REQUESTS, 100),
      manualFactsPath: env.ENRICH_MANUAL_FACTS || undefined,
      egrn: httpProvider(env, 'EGRN', {
        path: '/v1/objects',
        subjectParam: 'cadastralNumber',
        ttlDays: 30,
      }),
      fnp: httpProvider(env, 'FNP', {
        path: '/v1/pledges',
        subjectParam: 'vin',
        ttlDays: 7,
      }),
    },
  };
}

interface ProviderDefaults {
  path: string;
  subjectParam: string;
  ttlDays: number;
}

function httpProvider(
  env: NodeJS.ProcessEnv,
  prefix: string,
  defaults: ProviderDefaults,
): HttpProviderSettings {
  const key = env[`${prefix}_KEY`] ?? '';
  return {
    // Провайдер без ключа не включается: иначе каждый запрос уходил бы в 401,
    // сжигая бюджет прогона на бессмысленные обращения.
    enabled: flag(env[`${prefix}_ENABLED`]) && key !== '',
    baseUrl: env[`${prefix}_BASE_URL`] ?? '',
    path: env[`${prefix}_PATH`] ?? defaults.path,
    authHeader: env[`${prefix}_AUTH_HEADER`] ?? 'Authorization',
    key,
    subjectParam: env[`${prefix}_SUBJECT_PARAM`] ?? defaults.subjectParam,
    ttlDays: number(env[`${prefix}_TTL_DAYS`], defaults.ttlDays),
  };
}

export function parseAssetKinds(raw: string | undefined): AssetKind[] {
  if (!raw) return [];
  const allowed = new Set<string>(ASSET_KINDS);
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is AssetKind => allowed.has(part));
}

function flag(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
