/**
 * Источник: ГИС Торги (torgi.gov.ru).
 *
 * Открытый JSON без авторизации — единственный полностью бесплатный поток лотов.
 * Банкротства здесь нет (его первоисточник — ЕФРСБ), но есть арестованное
 * и гос/муниципальное имущество, которое оценивается той же моделью.
 */

import type { Lot } from '../domain/lot.ts';
import { lotFromTorgiGovCard } from '../normalize/fromTorgiGov.ts';
import { readArray, readNumber } from '../normalize/read.ts';
import { buildUrl, fetchJson } from './http.ts';
import type { FetchWindow, Source } from './types.ts';

export interface TorgiGovConfig {
  baseUrl: string;
  pageSize?: number;
  /** Коды категорий лотов ГИС Торги. Пусто — все категории. */
  categories?: readonly string[];
}

const SEARCH_PATH = 'new/api/public/lotcards/search';
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LIMIT = 1000;

export class TorgiGovSource implements Source {
  readonly name = 'torgi_gov';
  readonly system = 'torgi_gov' as const;

  #config: TorgiGovConfig;

  constructor(config: TorgiGovConfig) {
    this.#config = config;
  }

  async collect(window: FetchWindow): Promise<Lot[]> {
    const pageSize = this.#config.pageSize ?? DEFAULT_PAGE_SIZE;
    const limit = window.limit ?? DEFAULT_LIMIT;
    const maxPages = Math.ceil(limit / pageSize);
    const lots: Lot[] = [];

    for (let page = 0; page < maxPages; page++) {
      const url = buildUrl(this.#config.baseUrl, SEARCH_PATH, {
        size: pageSize,
        page,
        sort: 'firstVersionPublicationDate,desc',
        byFirstVersion: 'true',
        catCode: this.#config.categories?.join(',') || undefined,
      });

      const payload = await fetchJson<unknown>(url, { headers: { accept: 'application/json' } });
      const cards = readArray(payload, 'content', 'items', 'data');
      if (cards.length === 0) break;

      let reachedWindowStart = false;
      for (const card of cards) {
        const lot = lotFromTorgiGovCard(card, { publicBaseUrl: this.#config.baseUrl });
        if (!lot) continue;

        // Выдача отсортирована по дате публикации: как только ушли за начало
        // окна, дальше листать нечего.
        if (lot.publishedAt && Date.parse(lot.publishedAt) < window.from.getTime()) {
          reachedWindowStart = true;
          continue;
        }
        if (lot.publishedAt && Date.parse(lot.publishedAt) > window.to.getTime()) continue;

        lots.push(lot);
      }

      if (reachedWindowStart) break;

      const totalPages = readNumber(payload, 'totalPages');
      if (totalPages !== undefined && page + 1 >= totalPages) break;
      if (cards.length < pageSize) break;
    }

    return lots;
  }
}
