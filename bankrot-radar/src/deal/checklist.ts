/**
 * Пакет документов для подачи заявки.
 *
 * Это типовой состав, а не окончательный: организатор вправе устанавливать свою
 * форму заявки и дополнительные требования в положении о продаже. Поэтому каждый
 * чек-лист заканчивается пунктом «сверить с сообщением о торгах» — сервис
 * экономит время на сборе, но не заменяет чтение конкретного извещения.
 *
 * Смысл чек-листа не в том, чтобы перечислить очевидное, а в том, чтобы поймать
 * пункты с длинным сроком получения: нотариальное согласие супруга и одобрение
 * крупной сделки не делаются в день подачи, и именно на них срываются сроки.
 */

import type { BuyerType } from '../domain/deal.ts';
import type { Lot } from '../domain/lot.ts';
import { lotAssetKind } from '../domain/lot.ts';

export interface ChecklistItem {
  code: string;
  title: string;
  /** Пункты с длинным сроком получения: их нельзя оставлять на последний день. */
  slow?: boolean;
  note?: string;
}

const COMMON: readonly ChecklistItem[] = [
  {
    code: 'application_form',
    title: 'Заявка на участие по форме организатора',
    note: 'форма своя у каждого организатора, берётся из сообщения о торгах',
  },
  {
    code: 'affiliation',
    title: 'Сведения о заинтересованности по отношению к должнику, кредиторам и управляющему',
    note: 'входит в состав заявки; отсутствие сведений — основание для отказа в допуске',
  },
  {
    code: 'deposit_proof',
    title: 'Документ о перечислении задатка',
    note: 'платёжное поручение с отметкой банка об исполнении',
  },
  {
    code: 'inventory',
    title: 'Опись представленных документов',
  },
];

const BY_BUYER: Readonly<Record<BuyerType, readonly ChecklistItem[]>> = {
  individual: [
    { code: 'passport', title: 'Копия паспорта' },
    {
      code: 'spouse_consent',
      title: 'Нотариальное согласие супруга на совершение сделки',
      slow: true,
      note: 'требуется при приобретении недвижимости лицом, состоящим в браке; запись к нотариусу занимает дни',
    },
  ],
  entrepreneur: [
    { code: 'passport', title: 'Копия паспорта' },
    { code: 'egrip', title: 'Выписка из ЕГРИП', note: 'актуальная на дату подачи' },
  ],
  company: [
    { code: 'egrul', title: 'Выписка из ЕГРЮЛ', note: 'актуальная на дату подачи' },
    { code: 'charter', title: 'Копия устава' },
    {
      code: 'director_authority',
      title: 'Документ о полномочиях единоличного исполнительного органа',
      note: 'решение или протокол о назначении',
    },
    {
      code: 'major_deal_approval',
      title: 'Решение об одобрении крупной сделки',
      slow: true,
      note: 'требуется, если сделка крупная для общества; созыв органа управления занимает дни',
    },
  ],
};

export function documentChecklist(lot: Lot, buyerType: BuyerType): ChecklistItem[] {
  const kind = lotAssetKind(lot);
  const items = [...COMMON, ...BY_BUYER[buyerType]];

  // Согласие супруга относится к недвижимости. Для автомобиля или дебиторки
  // держать этот пункт в списке — верный способ приучить его игнорировать.
  const needsSpouseConsent = kind === 'real_estate' || kind === 'land';
  const filtered = items.filter(
    (item) => item.code !== 'spouse_consent' || needsSpouseConsent,
  );

  if (kind === 'vehicle') {
    filtered.push({
      code: 'pledge_check',
      title: 'Проверить залог в реестре ФНП по VIN',
      note: 'залог движимого имущества не прекращается сам по себе при продаже',
    });
  }
  if (needsSpouseConsent) {
    filtered.push({
      code: 'egrn_extract',
      title: 'Свежая выписка из ЕГРН по объекту',
      note: 'обременения и зарегистрированные права на дату подачи',
    });
  }

  filtered.push({
    code: 'verify_notice',
    title: 'Сверить состав пакета с сообщением о торгах и положением о продаже',
    note: 'организатор вправе установить дополнительные требования; этот список — типовой',
  });

  return filtered;
}

/** Пункты с длинным сроком получения — их выносим в напоминание отдельно. */
export function slowItems(items: readonly ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => item.slow === true);
}
