/**
 * Вехи подготовки к торгам.
 *
 * Считаются назад от окончания приёма заявок — единственного срока, который
 * задан извне и не двигается. Всё остальное подстраивается под него.
 *
 * Порядок обратный интуиции: люди планируют «сначала документы, потом задаток,
 * потом заявка», а календарь работает наоборот — от жёсткого дедлайна назад,
 * в рабочих днях, потому что деньги не ходят в выходные.
 */

import type { Deal, DealStatus } from '../domain/deal.ts';
import { statusRank } from '../domain/deal.ts';
import type { Lot } from '../domain/lot.ts';
import { subtractWorkingDays } from '../domain/workdays.ts';

export type MilestoneCode = 'documents' | 'deposit' | 'application' | 'auction';

export interface Milestone {
  code: MilestoneCode;
  title: string;
  /** ISO. Момент, к которому веха должна быть пройдена. */
  dueAt: string;
  /**
   * Срок известен с точностью до дня, а не до минуты: он получен вычитанием
   * рабочих дней, а не взят из извещения. Показывать у такой вехи время —
   * значит выдавать «до 28 августа» за «до 03:00 28 августа».
   */
  dayGranular: boolean;
  done: boolean;
  overdue: boolean;
  /** Пояснение, откуда взялся срок. */
  rationale: string;
}

export interface MilestoneOptions {
  /** Рабочих дней на прохождение банковского платежа до окончания приёма заявок. */
  depositLeadDays: number;
  /** Рабочих дней на сбор пакета документов до срока перечисления задатка. */
  documentsLeadDays: number;
  /** Рабочих дней запаса на подачу заявки: площадка может лечь в последний час. */
  applicationLeadDays: number;
  holidays: ReadonlySet<string>;
}

export const DEFAULT_MILESTONE_OPTIONS: MilestoneOptions = {
  depositLeadDays: 3,
  documentsLeadDays: 3,
  applicationLeadDays: 1,
  holidays: new Set(),
};

/** Статус, начиная с которого веха считается пройденной без явной отметки. */
const IMPLIED_BY_STATUS: Readonly<Record<MilestoneCode, DealStatus | null>> = {
  documents: null, // отмечается вручную: собранный пакет не следует ни из какого статуса
  deposit: 'deposit',
  application: 'application',
  auction: 'won',
};

export function milestonesFor(
  lot: Lot,
  deal: Deal,
  now: Date,
  options: MilestoneOptions = DEFAULT_MILESTONE_OPTIONS,
): Milestone[] {
  const milestones: Milestone[] = [];

  if (lot.applicationEnd) {
    const applicationEnd = new Date(lot.applicationEnd);

    const applicationDue = subtractWorkingDays(
      applicationEnd,
      options.applicationLeadDays,
      options.holidays,
    );
    const depositDue = subtractWorkingDays(applicationEnd, options.depositLeadDays, options.holidays);
    const documentsDue = subtractWorkingDays(
      depositDue,
      options.documentsLeadDays,
      options.holidays,
    );

    milestones.push(
      build('documents', 'Собрать пакет документов', documentsDue, true, deal, now,
        `за ${options.documentsLeadDays} раб. дн. до срока задатка: нотариальные документы и выписки за день не получить`),
      build('deposit', 'Перечислить задаток', depositDue, true, deal, now,
        `за ${options.depositLeadDays} раб. дн. до окончания приёма: задаток должен поступить на счёт, а не быть отправленным`),
      build('application', 'Подать заявку', applicationDue, true, deal, now,
        `запас ${options.applicationLeadDays} раб. дн.: площадка может быть недоступна в последний час`),
    );
  }

  if (lot.auctionAt) {
    // Единственная веха с точным временем: оно взято из извещения, а не вычислено.
    milestones.push(
      build('auction', 'Торговая сессия', new Date(lot.auctionAt), false, deal, now,
        'дата и время торгов из извещения'),
    );
  }

  return milestones.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

function build(
  code: MilestoneCode,
  title: string,
  dueAt: Date,
  dayGranular: boolean,
  deal: Deal,
  now: Date,
  rationale: string,
): Milestone {
  const done = isDone(code, deal);
  return {
    code,
    title,
    dueAt: dueAt.toISOString(),
    dayGranular,
    done,
    overdue: !done && dueAt.getTime() <= now.getTime(),
    rationale,
  };
}

export function isDone(code: MilestoneCode, deal: Deal): boolean {
  if (deal.completed[code]) return true;
  const implied = IMPLIED_BY_STATUS[code];
  return implied !== null && statusRank(deal.status) >= statusRank(implied);
}
