/**
 * Риск-флаги по тексту извещения.
 *
 * Это не юридическая проверка, а сортировщик: он поднимает наверх то,
 * что человек обязан прочитать глазами до перевода задатка. Основные деньги
 * на торгах теряются не на цене, а на обременениях, которые видны в тексте,
 * но никем не читаются в потоке из трёх тысяч лотов в день.
 */

export type RiskCode =
  | 'lease' // действующая аренда
  | 'residents' // зарегистрированные / проживающие лица
  | 'fractional' // доля в праве
  | 'unregistered' // право собственности не зарегистрировано
  | 'litigation' // спор, оспаривание, обжалование
  | 'sole_housing' // единственное жильё должника
  | 'unauthorized' // самовольная постройка или перепланировка
  | 'claim_only' // продаётся право требования, а не вещь
  | 'no_inspection' // осмотр не проводится
  | 'no_docs' // документы утрачены
  | 'restricted' // ограничения оборота, спецдопуск
  | 'pledge'; // залог, ипотека

/** 3 — может лишить смысла покупку; 2 — заметно бьёт по цене; 1 — требует проверки. */
export type RiskSeverity = 1 | 2 | 3;

export interface RiskFlag {
  code: RiskCode;
  severity: RiskSeverity;
  label: string;
  /** Фрагмент текста, по которому сработало правило — чтобы флаг можно было проверить. */
  evidence: string;
}

interface RiskRule {
  code: RiskCode;
  severity: RiskSeverity;
  label: string;
  pattern: RegExp;
}

/**
 * Во всех шаблонах вместо \w используется [а-яё]: класс \w в JS покрывает только
 * ASCII, поэтому «зарегистрирован\w*\s+лиц» не совпадёт с «зарегистрированы лица».
 * Такая ошибка не падает, а тихо перестаёт находить риски — это худший вид бага
 * для правил, которые должны предупреждать о потере денег.
 */
const RULES: readonly RiskRule[] = [
  {
    code: 'lease',
    severity: 3,
    label: 'Действующая аренда: договор сохраняется при смене собственника',
    pattern:
      /(?:договор|обременени[а-яё]*)\s+аренд|сдан[а-яё]*\s+в\s+аренду|арендатор|найм[а-яё]*\s+жил/i,
  },
  {
    code: 'residents',
    severity: 3,
    label: 'Зарегистрированные или проживающие лица',
    pattern:
      /зарегистрирован[а-яё]*\s+(?:лиц|граждан|по\s+месту)|прописан|проживают?\s+(?:лиц|граждан)/i,
  },
  {
    code: 'fractional',
    severity: 3,
    label: 'Доля в праве: у сособственников преимущественное право покупки',
    pattern: /\b\d+\/\d+\s+дол|дол[яи]\s+в\s+прав|долев[а-яё]*\s+собственност/i,
  },
  {
    code: 'unregistered',
    severity: 3,
    label: 'Право собственности не зарегистрировано',
    pattern:
      /прав[а-яё]*\s+(?:собственности\s+)?не\s+зарегистрирован|отсутству[а-яё]*\s+регистрац[а-яё]*\s+прав/i,
  },
  {
    code: 'litigation',
    severity: 3,
    label: 'Судебный спор или оспаривание',
    pattern:
      /оспарива|обжалу[а-яё]*|судебн[а-яё]*\s+спор|исков[а-яё]*\s+заявлен|признани[а-яё]*\s+сделки\s+недействительн/i,
  },
  {
    code: 'sole_housing',
    severity: 3,
    label: 'Признаки единственного жилья должника',
    pattern: /единственн[а-яё]*\s+жиль|исполнительск[а-яё]*\s+иммунитет/i,
  },
  {
    code: 'unauthorized',
    severity: 2,
    label: 'Самовольная постройка или неузаконенная перепланировка',
    pattern:
      /самовольн[а-яё]*\s+(?:постройк|строен|возвед)|неузаконенн[а-яё]*\s+переплан|переплан[а-яё]*\s+не\s+узаконен/i,
  },
  {
    code: 'claim_only',
    severity: 2,
    label: 'Продаётся право требования, а не имущество',
    pattern: /прав[оа]\s+требовани|дебиторск[а-яё]*\s+задолженност|уступк[а-яё]*\s+прав/i,
  },
  {
    code: 'no_inspection',
    severity: 2,
    label: 'Осмотр не проводится',
    pattern: /осмотр\s+не\s+(?:провод|осуществ)|без\s+осмотра|осмотр\s+невозможен/i,
  },
  {
    code: 'no_docs',
    severity: 2,
    label: 'Правоустанавливающие документы отсутствуют',
    pattern:
      /документ[а-яё]*\s+(?:отсутству|утрачен|не\s+передан)|техническ[а-яё]*\s+документац[а-яё]*\s+отсутству/i,
  },
  {
    code: 'restricted',
    severity: 2,
    label: 'Ограничения оборота или спецтребования к покупателю',
    pattern:
      /ограничен[а-яё]*\s+оборотоспособност|ограниченн[а-яё]*\s+в\s+оборот|специальн[а-яё]*\s+разрешен|лицензи[а-яё]*\s+требуется|под\s+арестом|наложен\s+арест/i,
  },
  {
    code: 'pledge',
    severity: 1,
    label: 'Залог или ипотека: проверьте порядок продажи и снятия обременения',
    pattern: /залог|ипотек/i,
  },
];

const EVIDENCE_CONTEXT = 60;

export function detectRisks(text: string): RiskFlag[] {
  if (!text) return [];
  const flags: RiskFlag[] = [];

  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    flags.push({
      code: rule.code,
      severity: rule.severity,
      label: rule.label,
      evidence: excerpt(text, match.index, match[0].length),
    });
  }

  return flags.sort((a, b) => b.severity - a.severity);
}

/**
 * Штраф к скорингу, 0..40 баллов. Растёт нелинейно: один флаг третьего уровня
 * важнее трёх флагов первого, а десяток мелких замечаний не должен обнулять лот.
 */
export function riskPenalty(flags: readonly RiskFlag[]): number {
  const weight = flags.reduce((sum, flag) => sum + flag.severity ** 2, 0);
  return Math.min(40, Math.round(40 * (1 - Math.exp(-weight / 12))));
}

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - EVIDENCE_CONTEXT);
  const end = Math.min(text.length, index + length + EVIDENCE_CONTEXT);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}
