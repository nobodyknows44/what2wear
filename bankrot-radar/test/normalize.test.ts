import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAsset,
  classifyProcedure,
  depositFromShare,
  extractArea,
  extractCadastralNumbers,
  extractCaseNumber,
  extractDeposit,
  extractInn,
  extractReductionFormula,
  extractVins,
  extractYear,
  parseRuNumber,
} from '../src/normalize/text.ts';
import { assembleLot } from '../src/normalize/assemble.ts';
import { lotsFromFedresursMessage } from '../src/normalize/fromFedresurs.ts';
import { lotFromTorgiGovCard } from '../src/normalize/fromTorgiGov.ts';
import { toIso } from '../src/normalize/read.ts';
import { priceAt } from '../src/domain/priceSchedule.ts';

test('parseRuNumber: пробелы, неразрывные пробелы и запятая', () => {
  assert.equal(parseRuNumber('1 234 567,89'), 1234567.89);
  assert.equal(parseRuNumber('1 000'), 1000);
  assert.equal(parseRuNumber('не число'), null);
});

test('extractCadastralNumbers: находит все номера без дублей', () => {
  const text = 'КН 77:06:0004009:1234, а также 50:04:0060201:445 и снова 77:06:0004009:1234';
  assert.deepEqual(extractCadastralNumbers(text), ['77:06:0004009:1234', '50:04:0060201:445']);
});

test('extractVins: отбрасывает строки с запрещёнными буквами и без цифр', () => {
  assert.deepEqual(extractVins('VIN XW7BF4FK50S123456'), ['XW7BF4FK50S123456']);
  // I, O, Q в VIN не используются — это не VIN.
  assert.deepEqual(extractVins('код IOQBF4FK50S123456'), []);
  // 17 букв подряд без цифр — тоже не VIN.
  assert.deepEqual(extractVins('ABCDEFGHJKLMNPRST'), []);
});

test('extractArea: понимает разные написания единиц', () => {
  assert.equal(extractArea('общая площадь 54,3 кв.м'), 54.3);
  assert.equal(extractArea('площадь 120 м2'), 120);
  assert.equal(extractArea('общей площадью 37.90 кв. м.'), 37.9);
  assert.equal(extractArea('без площади'), undefined);
});

// Формулировки взяты из реальных извещений. Обе ловушки занижают площадь,
// а от неё напрямую зависит оценка недвижимости по цене за метр.
test('extractArea: пробел-разделитель разрядов не обрезает число', () => {
  assert.equal(extractArea('Земельный участок площадью 1 075 кв.м.'), 1075);
  assert.equal(extractArea('площадь 1 200 кв. м'), 1200);
  assert.equal(extractArea('площадью 12 500,5 кв.м'), 12_500.5);
});

test('extractArea: семизначная площадь не теряет старшую цифру', () => {
  assert.equal(
    extractArea('доля в земельном участке площадью 1369000 кв.м'),
    1_369_000,
    'ограничение длины числа приводило к захвату последних шести цифр',
  );
});

test('extractArea: номер дома не принимается за площадь', () => {
  assert.equal(
    extractArea('Московская обл., р-н Луховицы, ул. Жуковского, д. 28, кв. 18, площадь 30,4 кв.м'),
    30.4,
  );
});

test('extractInn: только рядом с меткой', () => {
  assert.equal(extractInn('должник ООО «Ромашка», ИНН 7701234567'), '7701234567');
  assert.equal(extractInn('ИНН 770112345678'), '770112345678');
  assert.equal(extractInn('счёт 4070281099'), undefined, 'голое число не является ИНН');
});

test('extractCaseNumber: нормализует латиницу и пробелы', () => {
  assert.equal(extractCaseNumber('дело № А40-112233/2024'), 'А40-112233/2024');
  assert.equal(extractCaseNumber('дело A41 - 5555 / 2023'), 'А41-5555/2023');
});

test('extractDeposit: сумма задатка в рублях', () => {
  assert.equal(extractDeposit('Задаток 790 000 руб.'), 790_000);
  assert.equal(extractDeposit('задаток составляет 1 250 000,50 руб'), 1_250_000.5);
});

test('depositFromShare: задаток в процентах от начальной цены', () => {
  assert.equal(depositFromShare('Задаток 20% от начальной цены', 1_250_000), 250_000);
  assert.equal(depositFromShare('Задаток 20%', undefined), undefined);
});

test('extractYear: год выпуска, а не любой год в тексте', () => {
  assert.equal(extractYear('TOYOTA CAMRY, год выпуска 2019, пробег 96 000 км'), 2019);
  assert.equal(extractYear('решение суда от 2015 г.'), 2015);
});

test('classifyAsset: право требования не путается с обеспечением', () => {
  assert.equal(
    classifyAsset('Право требования к ООО «Стройпоставка», обеспеченное залогом квартиры'),
    'claim',
    'лот с правом требования не должен оцениваться как недвижимость',
  );
  assert.equal(classifyAsset('Квартира, назначение жилое, площадь 54 кв.м'), 'real_estate');
  assert.equal(classifyAsset('Земельный участок 1200 кв.м'), 'land');
  assert.equal(classifyAsset('Автомобиль TOYOTA CAMRY'), 'vehicle');
  assert.equal(classifyAsset('Доля в уставном капитале ООО'), 'share');
  assert.equal(classifyAsset('Нечто неопознанное'), 'other');
});

test('classifyProcedure: публичное предложение важнее слова «аукцион» в тексте', () => {
  assert.equal(
    classifyProcedure('Продажа посредством публичного предложения, организатор аукциона — АУ'),
    'public_offer',
  );
  assert.equal(classifyProcedure('Открытый аукцион на повышение'), 'auction');
  assert.equal(classifyProcedure('Конкурс по продаже'), 'competition');
});

test('extractReductionFormula: разбирает формулу снижения цены', () => {
  const formula = extractReductionFormula(
    'Цена снижается каждые 7 календарных дней на 10% от начальной цены до 50% от начальной цены',
  );
  assert.deepEqual(formula, { stepDays: 7, stepShareOfStart: 0.1, floorShareOfStart: 0.5 });
});

test('extractReductionFormula: без формулы возвращает undefined', () => {
  assert.equal(extractReductionFormula('Открытый аукцион на повышение'), undefined);
});

test('toIso: российский формат читается как московское время', () => {
  // Сроки в извещениях публикуются по Москве. Разбор их как UTC смещал бы дедлайн
  // на три часа вперёд — сервис показывал бы запас там, где приём заявок уже закрыт.
  assert.equal(toIso('31.12.2026 15:04'), '2026-12-31T12:04:00.000Z');
  assert.equal(toIso('31.12.2026'), '2026-12-30T21:00:00.000Z');
  assert.equal(toIso('чепуха'), undefined);
});

test('toIso: строки с явной зоной не сдвигаются', () => {
  assert.equal(toIso('2026-12-31T00:00:00Z'), '2026-12-31T00:00:00.000Z');
  assert.equal(toIso('2026-12-31T10:00:00+03:00'), '2026-12-31T07:00:00.000Z');
});

test('toIso: сдвиг переопределяется для площадок с местным временем', () => {
  assert.equal(toIso('31.12.2026 15:04', 420), '2026-12-31T08:04:00.000Z');
});

test('assembleLot: публичное предложение разворачивается в график цены', () => {
  const lot = assembleLot({
    sourceSystem: 'manual',
    sourceId: 'demo',
    title: 'Квартира, общая площадь 54,3 кв.м, г. Москва',
    description:
      'Продажа посредством публичного предложения. Кадастровый номер 77:06:0004009:1234. ' +
      'Начальная цена 6 500 000 руб. Цена снижается каждые 7 календарных дней на 10% от начальной цены ' +
      'до 50% от начальной цены. Задаток 10% от начальной цены. ИНН 7701234567, дело № А40-112233/2024.',
    startPrice: 6_500_000,
    applicationStart: '2026-08-01T00:00:00.000Z',
    applicationEnd: '2026-10-01T00:00:00.000Z',
  });

  assert.equal(lot.procedure, 'public_offer');
  assert.equal(lot.regionCode, 77);
  assert.equal(lot.debtor.inn, '7701234567');
  assert.equal(lot.debtor.caseNumber, 'А40-112233/2024');
  assert.equal(lot.deposit, 650_000);
  assert.equal(lot.assets[0]!.cadastralNumber, '77:06:0004009:1234');
  assert.equal(lot.assets[0]!.areaSqm, 54.3);
  assert.equal(lot.priceSchedule.length, 6);
  assert.equal(priceAt(lot.priceSchedule, new Date('2026-08-10T00:00:00.000Z')), 5_850_000);
  assert.equal(lot.id, 'cad:77:06:0004009:1234');
});

test('assembleLot: аукцион получает один период с начальной ценой', () => {
  const lot = assembleLot({
    sourceSystem: 'manual',
    sourceId: 'demo',
    title: 'Автомобиль TOYOTA CAMRY, 2019',
    description: 'Открытый аукцион на повышение. VIN XW7BF4FK50S123456. Начальная цена 1 250 000 руб.',
    startPrice: 1_250_000,
    applicationStart: '2026-08-01T00:00:00.000Z',
    applicationEnd: '2026-08-20T00:00:00.000Z',
  });

  assert.equal(lot.procedure, 'auction');
  assert.equal(lot.priceSchedule.length, 1);
  assert.equal(lot.assets[0]!.vin, 'XW7BF4FK50S123456');
  assert.equal(lot.assets[0]!.kind, 'vehicle');
  assert.equal(priceAt(lot.priceSchedule, new Date('2026-08-10T00:00:00.000Z')), 1_250_000);
});

test('assembleLot: несколько кадастровых номеров дают несколько активов', () => {
  const lot = assembleLot({
    sourceSystem: 'manual',
    sourceId: 'demo',
    title: 'Два помещения',
    description: 'Нежилые помещения 77:01:0001001:11 и 77:01:0001001:12, общая площадь 300 кв.м',
    startPrice: 10_000_000,
  });

  assert.equal(lot.assets.length, 2);
  // Площадь не размазывается по объектам: она относится к лоту, а не к каждому.
  assert.equal(lot.assets[0]!.areaSqm, undefined);
});

test('fromFedresurs: сообщение с несколькими лотами разворачивается в несколько записей', () => {
  const message = {
    guid: 'msg-777',
    publishDate: '2026-08-01T10:00:00Z',
    tradeType: 'Публичное предложение',
    debtor: { name: 'ООО «Ромашка»', inn: '7701234567' },
    caseNumber: 'А40-112233/2024',
    etp: { name: 'ЭТП «Пример»', url: 'https://etp.example' },
    lots: [
      {
        lotNumber: 1,
        name: 'Квартира 54,3 кв.м',
        description: 'Кадастровый номер 77:06:0004009:1234. Цена снижается каждые 7 дней на 10% до 50%.',
        startPrice: 6_500_000,
        dateStart: '01.08.2026',
        dateEnd: '01.10.2026',
      },
      {
        lotNumber: 2,
        name: 'Автомобиль',
        description: 'VIN XW7BF4FK50S123456',
        startPrice: 800_000,
      },
    ],
  };

  const lots = lotsFromFedresursMessage(message, { publicBaseUrl: 'https://bankrot.fedresurs.ru' });

  assert.equal(lots.length, 2);
  assert.equal(lots[0]!.debtor.inn, '7701234567');
  assert.equal(lots[0]!.etpName, 'ЭТП «Пример»');
  assert.equal(lots[0]!.procedure, 'public_offer');
  assert.equal(lots[0]!.sourceId, 'msg-777#1');
  assert.equal(lots[0]!.sourceUrl, 'https://bankrot.fedresurs.ru/message/msg-777');
  assert.equal(lots[1]!.assets[0]!.vin, 'XW7BF4FK50S123456');
  assert.notEqual(lots[0]!.id, lots[1]!.id);
});

test('fromFedresurs: лот без цены отбрасывается', () => {
  const lots = lotsFromFedresursMessage({
    guid: 'msg-1',
    lots: [{ lotNumber: 1, name: 'Результаты торгов' }],
  });
  assert.equal(lots.length, 0);
});

test('fromFedresurs: сообщение без идентификатора игнорируется', () => {
  assert.deepEqual(lotsFromFedresursMessage({ name: 'нечто' }), []);
});

test('fromFedresurs: переименование полей в новой версии API не роняет маппер', () => {
  const lots = lotsFromFedresursMessage({
    id: 'msg-2',
    datePublish: 1_754_006_400_000,
    lots: [{ number: 3, lotName: 'Склад', lotDescription: 'Здание склада', priceStart: '2 000 000' }],
  });

  assert.equal(lots.length, 1);
  assert.equal(lots[0]!.startPrice, 2_000_000);
  assert.equal(lots[0]!.title, 'Склад');
});

test('fromTorgiGov: карточка лота нормализуется', () => {
  const lot = lotFromTorgiGovCard(
    {
      id: 'card-42',
      lotName: 'Земельный участок 1200 кв.м',
      lotDescription: 'Кадастровый номер 50:04:0060201:445. Аукцион на повышение.',
      priceMin: 1_800_000,
      subjectRFCode: 50,
      bidEndTime: '20.09.2026 10:00',
      firstVersionPublicationDate: '2026-08-01T09:00:00Z',
    },
    { publicBaseUrl: 'https://torgi.gov.ru' },
  );

  assert.ok(lot);
  assert.equal(lot.sourceSystem, 'torgi_gov');
  assert.equal(lot.regionCode, 50);
  assert.equal(lot.startPrice, 1_800_000);
  // «20.09.2026 10:00» в извещении — московское время, то есть 07:00 UTC.
  assert.equal(lot.applicationEnd, '2026-09-20T07:00:00.000Z');
  assert.equal(lot.sourceUrl, 'https://torgi.gov.ru/new/public/lots/lot/card-42');
  assert.equal(lot.assets[0]!.kind, 'land');
});

test('fromTorgiGov: карточка без идентификатора отбрасывается', () => {
  assert.equal(lotFromTorgiGovCard({ lotName: 'Без id' }), null);
});
