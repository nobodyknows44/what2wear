/**
 * Рабочие дни.
 *
 * Дедлайны подачи считаются назад от окончания приёма заявок, и считать их
 * в календарных днях нельзя: банковский перевод задатка не идёт в выходные.
 * Заявка, поданная в пятницу с задатком «в пути», к понедельнику превращается
 * в недопуск — деньги вернут, но лот уйдёт без вас.
 *
 * Производственный календарь здесь не зашит: переносы праздников меняются
 * ежегодно, а устаревший зашитый календарь опаснее его отсутствия — он выглядит
 * точным. Праздники передаются списком дат; по умолчанию учитываются только
 * выходные, и заложенный запас дней должен это компенсировать.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Дата в формате YYYY-MM-DD по UTC — ключ для списка праздников. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWorkingDay(date: Date, holidays: ReadonlySet<string> = new Set()): boolean {
  const weekday = date.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !holidays.has(isoDate(date));
}

/**
 * Отнимает заданное число рабочих дней, возвращая начало полученных суток.
 * Дедлайн «перечислить задаток» — это день целиком, а не момент времени.
 */
export function subtractWorkingDays(
  from: Date,
  days: number,
  holidays: ReadonlySet<string> = new Set(),
): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError('days must be a non-negative integer');
  }

  const cursor = startOfUtcDay(from);
  let remaining = days;

  while (remaining > 0) {
    cursor.setTime(cursor.getTime() - DAY_MS);
    if (isWorkingDay(cursor, holidays)) remaining--;
  }

  return cursor;
}

/** Сколько рабочих дней между двумя моментами. Отрицательных не бывает. */
export function workingDaysBetween(
  from: Date,
  to: Date,
  holidays: ReadonlySet<string> = new Set(),
): number {
  if (to <= from) return 0;

  const cursor = startOfUtcDay(from);
  const end = startOfUtcDay(to).getTime();
  let count = 0;

  while (cursor.getTime() < end) {
    cursor.setTime(cursor.getTime() + DAY_MS);
    if (isWorkingDay(cursor, holidays)) count++;
  }

  return count;
}

/** Разбор списка праздников из конфига: «2027-01-01,2027-01-02». */
export function parseHolidays(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /^\d{4}-\d{2}-\d{2}$/.test(part)),
  );
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
