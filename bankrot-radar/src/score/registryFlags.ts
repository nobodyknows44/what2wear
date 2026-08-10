/**
 * Превращение реестровых фактов в риск-флаги и поправки к лоту.
 *
 * Живёт в слое скоринга, а не обогащения: провайдеры отдают плоские факты и не
 * должны знать, во что те превращаются. Зависимость только от типа факта,
 * поэтому цикла между слоями нет.
 */

import type { EnrichmentFact } from '../domain/facts.ts';
import { FACT, factValue, hasTruthyFact } from '../domain/facts.ts';
import type { RiskCode, RiskFlag, RiskSeverity } from './risk.ts';

export interface FactApplication {
  /** Флаги, подтверждённые реестром. */
  flags: RiskFlag[];
  /** Виды риска, которые реестр явно опроверг: текстовые догадки по ним снимаются. */
  cleared: RiskCode[];
  /** Уточнённая площадь, если реестр знает её точнее текста извещения. */
  areaSqm?: number;
  regionCode?: number;
}

interface FactRule {
  fact: string;
  code: RiskCode;
  severity: RiskSeverity;
  label: string;
}

const FACT_RULES: readonly FactRule[] = [
  {
    fact: FACT.EGRN_LEASE,
    code: 'lease',
    severity: 3,
    label: 'ЕГРН: зарегистрирована аренда, договор сохранится за новым собственником',
  },
  {
    fact: FACT.EGRN_ARREST,
    code: 'restricted',
    severity: 3,
    label: 'ЕГРН: наложен арест',
  },
  {
    fact: FACT.EGRN_RIGHTS_ABSENT,
    code: 'unregistered',
    severity: 3,
    label: 'ЕГРН: право собственности не зарегистрировано',
  },
  {
    fact: FACT.EGRN_SHARED,
    code: 'fractional',
    severity: 3,
    label: 'ЕГРН: долевая собственность, у сособственников преимущественное право покупки',
  },
  {
    fact: FACT.EGRN_MORTGAGE,
    code: 'pledge',
    severity: 1,
    label: 'ЕГРН: зарегистрирована ипотека',
  },
  {
    fact: FACT.FNP_PLEDGE_ACTIVE,
    code: 'pledge',
    severity: 2,
    label: 'Реестр ФНП: действующий залог движимого имущества',
  },
];

export function applyFacts(facts: readonly EnrichmentFact[]): FactApplication {
  const flags: RiskFlag[] = [];
  const cleared: RiskCode[] = [];

  for (const rule of FACT_RULES) {
    if (!hasTruthyFact(facts, rule.fact)) continue;
    flags.push({
      code: rule.code,
      severity: rule.severity,
      label: rule.label,
      evidence: factValue(facts, rule.fact)?.detail ?? rule.fact,
      source: 'registry',
    });
  }

  // Подтверждённое отсутствие снимает текстовые догадки — но только те виды
  // риска, о которых этот реестр вообще может судить. ЕГРН ничего не знает
  // о залоге автомобиля, а ФНП — об аренде помещения.
  if (hasTruthyFact(facts, FACT.EGRN_ENCUMBRANCE_NONE)) {
    cleared.push('lease', 'pledge', 'restricted');
  }
  if (hasTruthyFact(facts, FACT.FNP_PLEDGE_NONE)) {
    cleared.push('pledge');
  }

  // Флаг, подтверждённый реестром, не может быть снят другим реестром.
  const confirmed = new Set(flags.map((flag) => flag.code));

  return {
    flags,
    cleared: [...new Set(cleared)].filter((code) => !confirmed.has(code)),
    areaSqm: numericFact(facts, FACT.EGRN_AREA),
    regionCode: numericFact(facts, FACT.EGRN_REGION),
  };
}

function numericFact(facts: readonly EnrichmentFact[], code: string): number | undefined {
  const fact = factValue(facts, code);
  if (fact === undefined) return undefined;
  const value = typeof fact.value === 'number' ? fact.value : Number(fact.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
