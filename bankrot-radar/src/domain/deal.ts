/**
 * Сделка — состояние работы по конкретному лоту.
 *
 * Скоринг отвечает на вопрос «стоит ли смотреть», сделка — на вопрос «что я должен
 * сделать по этому лоту и к какому сроку». Разделены намеренно: лот приходит
 * из источника и обновляется без спроса, сделка принадлежит пользователю
 * и переживает исчезновение лота из выдачи.
 */

export type DealStatus =
  | 'interest' // отобран, проверка не начата
  | 'checking' // идёт проверка документов и объекта
  | 'deposit' // задаток перечислен
  | 'application' // заявка подана
  | 'admitted' // допущен к торгам
  | 'rejected' // не допущен
  | 'won'
  | 'lost'
  | 'contract' // договор подписан
  | 'paid'
  | 'registered' // право зарегистрировано
  | 'forfeited' // уклонились от договора, задаток потерян
  | 'dropped'; // отказались до подачи

export type BuyerType = 'individual' | 'entrepreneur' | 'company';

export const BUYER_TYPES: readonly BuyerType[] = ['individual', 'entrepreneur', 'company'];

export interface Deal {
  lotId: string;
  status: DealStatus;
  buyerType: BuyerType;
  /**
   * Потолок цены, выше которого не торгуемся. Задаётся до торгов и в них не меняется:
   * дисциплина здесь стоит дороже азарта, а торговая сессия — худший момент
   * для пересмотра оценки.
   */
  maxPrice?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  /** Явно отмеченные вехи: код вехи → момент выполнения. */
  completed: Record<string, string>;
}

/**
 * Допустимые переходы. Машина состояний нужна не ради строгости, а чтобы
 * не соврать самому себе: «задаток перечислен» после «заявка подана» означает,
 * что что-то пошло не так и это надо заметить, а не молча записать.
 */
const TRANSITIONS: Readonly<Record<DealStatus, readonly DealStatus[]>> = {
  interest: ['checking', 'dropped'],
  checking: ['deposit', 'dropped'],
  deposit: ['application', 'dropped'],
  application: ['admitted', 'rejected', 'dropped'],
  admitted: ['won', 'lost'],
  rejected: [],
  won: ['contract', 'forfeited'],
  lost: [],
  contract: ['paid'],
  paid: ['registered'],
  registered: [],
  forfeited: [],
  dropped: [],
};

/** Порядок продвижения — по нему определяется, пройдена ли веха. */
const RANK: Readonly<Record<DealStatus, number>> = {
  interest: 0,
  checking: 1,
  deposit: 2,
  application: 3,
  admitted: 4,
  rejected: 4,
  won: 5,
  lost: 5,
  contract: 6,
  paid: 7,
  registered: 8,
  forfeited: 8,
  dropped: 8,
};

export function canTransition(from: DealStatus, to: DealStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: DealStatus): readonly DealStatus[] {
  return TRANSITIONS[from];
}

export function isTerminal(status: DealStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function statusRank(status: DealStatus): number {
  return RANK[status];
}

export const STATUS_LABELS: Readonly<Record<DealStatus, string>> = {
  interest: 'интерес',
  checking: 'проверка',
  deposit: 'задаток перечислен',
  application: 'заявка подана',
  admitted: 'допущен к торгам',
  rejected: 'не допущен',
  won: 'победа',
  lost: 'проигрыш',
  contract: 'договор подписан',
  paid: 'оплачен',
  registered: 'право зарегистрировано',
  forfeited: 'отказ от договора, задаток потерян',
  dropped: 'отказались',
};

export const BUYER_LABELS: Readonly<Record<BuyerType, string>> = {
  individual: 'физическое лицо',
  entrepreneur: 'индивидуальный предприниматель',
  company: 'юридическое лицо',
};

export function isDealStatus(value: string): value is DealStatus {
  return value in TRANSITIONS;
}

export function isBuyerType(value: string): value is BuyerType {
  return (BUYER_TYPES as readonly string[]).includes(value);
}
