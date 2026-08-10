/**
 * Демо-данные.
 *
 * Позволяют прогнать весь конвейер без ключей и без сети: извещения проходят
 * через тот же нормализатор, ту же оценку и тот же скоринг, что и боевые.
 * Тексты извещений — синтетические, но написаны в той манере, в какой их
 * реально публикуют организаторы торгов.
 */

import { assembleLot } from '../normalize/assemble.ts';
import type { Lot } from '../domain/lot.ts';
import type { SoldLotInput } from '../storage/comparablesRepo.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export function demoLots(now: Date): Lot[] {
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY_MS).toISOString();

  return [
    assembleLot({
      sourceSystem: 'manual',
      sourceId: 'demo-1',
      sourceUrl: 'https://bankrot.fedresurs.ru/',
      title: 'Квартира, общая площадь 54,3 кв.м, г. Москва, ул. Профсоюзная, д. 104',
      description:
        'Продажа посредством публичного предложения. Квартира, назначение: жилое, общая площадь 54,3 кв.м, ' +
        'кадастровый номер 77:06:0004009:1234. Обременение: залог в пользу залогового кредитора. ' +
        'Начальная цена продажи 6 500 000 руб. Цена снижается каждые 7 календарных дней на 10% от начальной ' +
        'цены до 50% от начальной цены. Задаток 10% от начальной цены. Должник: ООО «Ремстройинвест», ' +
        'ИНН 7701234567, дело № А40-112233/2024.',
      procedure: 'public_offer',
      startPrice: 6_500_000,
      publishedAt: iso(-3),
      applicationStart: iso(-3),
      applicationEnd: iso(25),
    }),

    assembleLot({
      sourceSystem: 'manual',
      sourceId: 'demo-2',
      sourceUrl: 'https://bankrot.fedresurs.ru/',
      title: 'Квартира, 38,1 кв.м, г. Москва, ул. Кировоградская, д. 12',
      description:
        'Открытый аукцион на повышение. Квартира, общая площадь 38,1 кв.м, кадастровый номер ' +
        '77:05:0011007:8899. В квартире зарегистрированы лица, в том числе несовершеннолетние. ' +
        'Имеется действующий договор аренды сроком до 2028 года. Начальная цена 7 900 000 руб. ' +
        'Задаток 790 000 руб. Осмотр не проводится. Должник: Иванов И.И., ИНН 770112345678.',
      procedure: 'auction',
      startPrice: 7_900_000,
      publishedAt: iso(-1),
      applicationStart: iso(-1),
      applicationEnd: iso(3),
    }),

    assembleLot({
      sourceSystem: 'manual',
      sourceId: 'demo-3',
      sourceUrl: 'https://torgi.gov.ru/',
      title: 'Автомобиль TOYOTA CAMRY, 2019 года выпуска',
      description:
        'Транспортное средство TOYOTA CAMRY, год выпуска 2019, VIN XW7BF4FK50S123456, пробег 96 000 км. ' +
        'Аукцион на повышение. Начальная цена 1 250 000 руб. Задаток 20% от начальной цены. ' +
        'Место нахождения: Московская область, г. Химки.',
      procedure: 'auction',
      startPrice: 1_250_000,
      regionCode: 50,
      publishedAt: iso(-2),
      applicationStart: iso(-2),
      applicationEnd: iso(9),
    }),

    assembleLot({
      sourceSystem: 'manual',
      sourceId: 'demo-4',
      title: 'Право требования к ООО «Стройпоставка» на сумму 12 400 000 руб.',
      description:
        'Продажа посредством публичного предложения права требования (дебиторская задолженность) ' +
        'к ООО «Стройпоставка», ИНН 7726123456, подтверждённого решением суда. Взыскание не производилось. ' +
        'Начальная цена 620 000 руб. Цена снижается каждые 5 календарных дней на 15% до 20% от начальной цены.',
      procedure: 'public_offer',
      startPrice: 620_000,
      regionCode: 77,
      publishedAt: iso(-5),
      applicationStart: iso(-5),
      applicationEnd: iso(15),
    }),

    assembleLot({
      sourceSystem: 'manual',
      sourceId: 'demo-5',
      title: 'Земельный участок 1200 кв.м, Московская область, Дмитровский район',
      description:
        'Земельный участок, категория: земли населённых пунктов, площадь 1200 кв.м, ' +
        'кадастровый номер 50:04:0060201:445. Аукцион на повышение. Начальная цена 1 800 000 руб. ' +
        'Задаток 360 000 руб.',
      procedure: 'auction',
      startPrice: 1_800_000,
      publishedAt: iso(-4),
      applicationStart: iso(-4),
      applicationEnd: iso(20),
    }),
  ];
}

/**
 * Синтетическая история продаж. В боевом режиме сюда пишутся результаты
 * состоявшихся торгов из ЕФРСБ — именно они делают оценку осмысленной.
 */
export function demoComparables(now: Date): SoldLotInput[] {
  const sold: SoldLotInput[] = [];
  const iso = (offsetDays: number) => new Date(now.getTime() + offsetDays * DAY_MS).toISOString();

  // Москва, жильё: медиана около 200 000 ₽/м² по цене реализации на торгах.
  const moscowFlats = [
    { area: 42, perSqm: 196_000 },
    { area: 55, perSqm: 204_000 },
    { area: 61, perSqm: 188_000 },
    { area: 38, perSqm: 212_000 },
    { area: 47, perSqm: 199_000 },
    { area: 72, perSqm: 185_000 },
    { area: 51, perSqm: 207_000 },
  ];
  moscowFlats.forEach((item, index) => {
    const soldPrice = Math.round(item.area * item.perSqm);
    sold.push({
      id: `demo-sold-msk-${index}`,
      assetKind: 'real_estate',
      regionCode: 77,
      areaSqm: item.area,
      startPrice: Math.round(soldPrice * 1.35),
      soldPrice,
      soldAt: iso(-30 - index * 9),
      title: `Квартира ${item.area} кв.м, Москва`,
    });
  });

  // Московская область, земля.
  [900, 1100, 1250, 1400, 1000, 1500].forEach((area, index) => {
    const perSqm = 1_450 + index * 40;
    const soldPrice = area * perSqm;
    sold.push({
      id: `demo-sold-land-${index}`,
      assetKind: 'land',
      regionCode: 50,
      areaSqm: area,
      startPrice: Math.round(soldPrice * 1.5),
      soldPrice,
      soldAt: iso(-45 - index * 12),
      title: `Земельный участок ${area} кв.м, Московская область`,
    });
  });

  // Транспорт: доля от начальной цены — основной сигнал для неплощадных активов.
  [0.82, 0.74, 0.91, 0.68, 0.79, 0.85].forEach((ratio, index) => {
    const startPrice = 900_000 + index * 150_000;
    sold.push({
      id: `demo-sold-car-${index}`,
      assetKind: 'vehicle',
      regionCode: 50,
      startPrice,
      soldPrice: Math.round(startPrice * ratio),
      soldAt: iso(-20 - index * 15),
      title: 'Легковой автомобиль',
    });
  });

  // Права требования уходят за копейки от номинала — и это видно в данных.
  [0.35, 0.28, 0.42, 0.31, 0.25, 0.38].forEach((ratio, index) => {
    const startPrice = 500_000 + index * 80_000;
    sold.push({
      id: `demo-sold-claim-${index}`,
      assetKind: 'claim',
      regionCode: 77,
      startPrice,
      soldPrice: Math.round(startPrice * ratio),
      soldAt: iso(-25 - index * 11),
      title: 'Право требования',
    });
  });

  return sold;
}
