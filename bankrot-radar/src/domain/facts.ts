/**
 * Факты из реестров.
 *
 * Отдельный слой между обогащением и скорингом. Провайдер не знает про риск-флаги,
 * скоринг не знает про HTTP — они общаются плоским списком фактов со стабильными
 * кодами. Это позволяет заменить платного провайдера ЕГРН на другого, не трогая
 * ни одной строки в скоринге.
 *
 * Коды именуются `источник.предмет.признак`. Признак `.none` означает
 * подтверждённое отсутствие: реестр ответил и сказал, что обременений нет.
 * Это не то же самое, что отсутствие факта в списке — там мы просто не спрашивали.
 */

export interface EnrichmentFact {
  code: string;
  value: string | number | boolean;
  /** Человекочитаемая расшифровка: попадает в текст алерта как обоснование. */
  detail?: string;
}

export const FACT = {
  /** Площадь по ЕГРН, м². Точнее той, что вытащена из текста извещения. */
  EGRN_AREA: 'egrn.area',
  /** Код региона по данным реестра. */
  EGRN_REGION: 'egrn.region',
  EGRN_LEASE: 'egrn.encumbrance.lease',
  EGRN_MORTGAGE: 'egrn.encumbrance.mortgage',
  EGRN_ARREST: 'egrn.encumbrance.arrest',
  /** Реестр подтвердил: обременений нет. */
  EGRN_ENCUMBRANCE_NONE: 'egrn.encumbrance.none',
  /** Право собственности в реестре не зарегистрировано. */
  EGRN_RIGHTS_ABSENT: 'egrn.rights.absent',
  EGRN_SHARED: 'egrn.shared_ownership',
  /** Действующий залог движимого имущества в реестре ФНП. */
  FNP_PLEDGE_ACTIVE: 'fnp.pledge.active',
  /** Реестр ФНП подтвердил: залога нет. */
  FNP_PLEDGE_NONE: 'fnp.pledge.none',
} as const;

export function factValue(
  facts: readonly EnrichmentFact[],
  code: string,
): EnrichmentFact | undefined {
  return facts.find((fact) => fact.code === code);
}

export function hasTruthyFact(facts: readonly EnrichmentFact[], code: string): boolean {
  const fact = factValue(facts, code);
  return fact !== undefined && fact.value !== false && fact.value !== 0 && fact.value !== '';
}
