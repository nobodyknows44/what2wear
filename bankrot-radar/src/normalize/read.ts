/**
 * Безопасное чтение полей из ответов источников.
 *
 * Схемы у ЕФРСБ и ГИС Торги меняются между версиями, а поля переименовываются
 * без предупреждения. Маппер, который жёстко разыменовывает `data.lot.price`,
 * роняет весь прогон из-за одного изменившегося ответа. Здесь — терпимое чтение:
 * перечисляем несколько допустимых имён поля и берём первое найденное.
 */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function readString(source: unknown, ...keys: string[]): string | undefined {
  const record = asRecord(source);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function readNumber(source: unknown, ...keys: string[]): number | undefined {
  const record = asRecord(source);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function readArray(source: unknown, ...keys: string[]): unknown[] {
  const record = asRecord(source);
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function readRecord(source: unknown, ...keys: string[]): Record<string, unknown> | undefined {
  const record = asRecord(source);
  if (!record) return undefined;
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Дата в ISO-8601. Понимает ISO, миллисекунды эпохи и российский формат
 * «31.12.2026» / «31.12.2026 15:04», который встречается в текстовых полях извещений.
 */
export function readDate(source: unknown, ...keys: string[]): string | undefined {
  const record = asRecord(source);
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    const iso = toIso(value);
    if (iso) return iso;
  }
  return undefined;
}

export function toIso(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const text = value.trim();
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (ru) {
    const [, day, month, year, hour = '00', minute = '00', second = '00'] = ru;
    const date = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
    );
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}
