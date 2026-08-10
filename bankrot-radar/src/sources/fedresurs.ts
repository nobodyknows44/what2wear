/**
 * Источник: ЕФРСБ (Федресурс) — первоисточник по 127-ФЗ.
 *
 * Транспорт намеренно тонкий и полностью параметризуемый: путь метода поиска
 * и заголовок авторизации задаются через конфиг, потому что различаются между
 * версиями спецификации и условиями договора. Вся ценность — в маппере,
 * который покрыт тестами и не зависит от того, как именно вы получили JSON.
 *
 * Если доступ к API ещё не оформлен, источник отключается флагом
 * FEDRESURS_ENABLED=false, и пайплайн работает на остальных источниках.
 */

import type { Lot } from '../domain/lot.ts';
import { lotsFromFedresursMessage } from '../normalize/fromFedresurs.ts';
import { readArray, readNumber } from '../normalize/read.ts';
import { buildUrl, fetchJson } from './http.ts';
import type { FetchWindow, Source } from './types.ts';

export interface FedresursConfig {
  baseUrl: string;
  key: string;
  searchPath: string;
  authHeader: string;
  publicBaseUrl?: string;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_LIMIT = 1000;

export class FedresursSource implements Source {
  readonly name = 'fedresurs';
  readonly system = 'fedresurs' as const;

  #config: FedresursConfig;

  constructor(config: FedresursConfig) {
    this.#config = config;
  }

  async collect(window: FetchWindow): Promise<Lot[]> {
    const pageSize = this.#config.pageSize ?? DEFAULT_PAGE_SIZE;
    const limit = window.limit ?? DEFAULT_LIMIT;
    const lots: Lot[] = [];

    for (let offset = 0; offset < limit; offset += pageSize) {
      const url = buildUrl(this.#config.baseUrl, this.#config.searchPath, {
        // Названия параметров окна тоже различаются между версиями спецификации.
        // Отправляем оба распространённых варианта: лишний параметр игнорируется.
        startDate: window.from.toISOString(),
        endDate: window.to.toISOString(),
        dateFrom: window.from.toISOString(),
        dateTo: window.to.toISOString(),
        limit: Math.min(pageSize, limit - offset),
        offset,
      });

      const payload = await fetchJson<unknown>(url, {
        headers: { [this.#config.authHeader]: this.#config.key },
      });

      const items = readArray(payload, 'pageData', 'data', 'items', 'content', 'messages');
      if (items.length === 0) break;

      for (const item of items) {
        lots.push(
          ...lotsFromFedresursMessage(item, { publicBaseUrl: this.#config.publicBaseUrl }),
        );
      }

      const total = readNumber(payload, 'total', 'totalElements', 'found');
      if (items.length < pageSize) break;
      if (total !== undefined && offset + items.length >= total) break;
    }

    return lots;
  }
}
