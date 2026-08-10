import type { Lot, SourceSystem } from '../domain/lot.ts';
import type { RawSale } from '../enrich/sales.ts';

/** Окно сбора. Источники опрашиваются по времени публикации, а не по номерам страниц. */
export interface FetchWindow {
  from: Date;
  to: Date;
  /** Верхняя граница числа записей за прогон — защита от бесконечной пагинации. */
  limit?: number;
}

/** Источник объявлений о торгах. */
export interface Source {
  readonly name: string;
  readonly system: SourceSystem;
  collect(window: FetchWindow): Promise<Lot[]>;
}

/**
 * Источник результатов состоявшихся торгов — обучающая выборка для оценки.
 * Отделён от Source, потому что не всякий источник лотов публикует результаты.
 */
export interface SalesSource {
  readonly name: string;
  collectSales(window: FetchWindow): Promise<RawSale[]>;
}
