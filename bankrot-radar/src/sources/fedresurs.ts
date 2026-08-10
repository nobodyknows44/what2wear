/**
 * Источник: ЕФРСБ (Федресурс) — первоисточник по 127-ФЗ.
 *
 * Транспорт намеренно тонкий и полностью параметризуемый: путь метода поиска
 * и заголовок авторизации задаются через конфиг, потому что различаются между
 * версиями спецификации и условиями договора. Вся ценность — в мапперах,
 * которые покрыты тестами и не зависят от того, как именно вы получили JSON.
 *
 * Один и тот же поток сообщений даёт и объявления о торгах, и их результаты,
 * поэтому класс обслуживает оба интерфейса: разбираются они разными мапперами,
 * но ходят по одному эндпоинту.
 *
 * Если доступ к API ещё не оформлен, источник отключается флагом
 * FEDRESURS_ENABLED=false, и пайплайн работает на остальных источниках.
 */

import type { Lot } from '../domain/lot.ts';
import type { RawSale } from '../enrich/sales.ts';
import { lotsFromFedresursMessage } from '../normalize/fromFedresurs.ts';
import { salesFromFedresursResultMessage } from '../normalize/fromFedresursResult.ts';
import { readArray, readNumber } from '../normalize/read.ts';
import { buildUrl, fetchJson } from './http.ts';
import type { FetchWindow, SalesSource, Source } from './types.ts';

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

export class FedresursSource implements Source, SalesSource {
  readonly name = 'fedresurs';
  readonly system = 'fedresurs' as const;

  #config: FedresursConfig;

  constructor(config: FedresursConfig) {
    this.#config = config;
  }

  async collect(window: FetchWindow): Promise<Lot[]> {
    const lots: Lot[] = [];
    for await (const message of this.#messages(window)) {
      lots.push(
        ...lotsFromFedresursMessage(message, { publicBaseUrl: this.#config.publicBaseUrl }),
      );
    }
    return lots;
  }

  /**
   * Результаты состоявшихся торгов. Собираются по более широкому окну, чем
   * объявления: сообщение о результатах публикуется через месяцы после торгов,
   * а ценность накопленной истории растёт с её глубиной.
   */
  async collectSales(window: FetchWindow): Promise<RawSale[]> {
    const sales: RawSale[] = [];
    for await (const message of this.#messages(window)) {
      sales.push(...salesFromFedresursResultMessage(message));
    }
    return sales;
  }

  async *#messages(window: FetchWindow): AsyncGenerator<unknown> {
    const pageSize = this.#config.pageSize ?? DEFAULT_PAGE_SIZE;
    const limit = window.limit ?? DEFAULT_LIMIT;

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
      if (items.length === 0) return;

      for (const item of items) yield item;

      const total = readNumber(payload, 'total', 'totalElements', 'found');
      if (items.length < pageSize) return;
      if (total !== undefined && offset + items.length >= total) return;
    }
  }
}
