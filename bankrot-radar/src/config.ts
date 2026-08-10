import type { AssetKind } from './domain/lot.ts';
import { ASSET_KINDS } from './domain/lot.ts';
import { parseRegionList } from './domain/regions.ts';

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
