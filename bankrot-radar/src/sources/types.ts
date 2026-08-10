import type { Lot, SourceSystem } from '../domain/lot.ts';

/** Окно сбора. Источники опрашиваются по времени публикации, а не по номерам страниц. */
export interface FetchWindow {
  from: Date;
  to: Date;
  /** Верхняя граница числа записей за прогон — защита от бесконечной пагинации. */
  limit?: number;
}

export interface Source {
  readonly name: string;
  readonly system: SourceSystem;
  collect(window: FetchWindow): Promise<Lot[]>;
}
