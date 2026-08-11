/**
 * Полнота извлечения данных.
 *
 * Три ошибки разбора площади нашлись только потому, что кто-то вручную прогнал
 * шесть строк из настоящих извещений. Так находить баги нельзя: правила молча
 * перестают срабатывать, лот теряет площадь или график снижения, и это видно
 * лишь по тому, что он не всплыл в топе.
 *
 * Отчёт отвечает на вопрос «где именно течёт» и показывает примеры, по которым
 * можно дописать правило: покрытие → примеры → новое правило → тест.
 * Пока покрытие не измерено, подключать языковую модель к разбору незачем —
 * неизвестно, какой остаток она должна закрыть.
 */

import type { Lot } from '../domain/lot.ts';
import { lotAssetKind, totalArea } from '../domain/lot.ts';

export interface CoverageMetric {
  code: string;
  label: string;
  /** Сколько лотов вообще подпадают под метрику: площадь спрашивать с автомобиля незачем. */
  applicable: number;
  covered: number;
  /** Доля 0..1. Для метрики без применимых лотов — null, а не единица. */
  share: number | null;
  /** Заголовки лотов, где не извлеклось. Их и надо читать глазами. */
  samples: string[];
  /** Чем оборачивается пропуск. */
  impact: string;
}

export interface CoverageReport {
  totalLots: number;
  /** Метрики от худшего покрытия к лучшему: сверху то, чем стоит заняться. */
  metrics: CoverageMetric[];
}

interface MetricSpec {
  code: string;
  label: string;
  impact: string;
  applicable: (lot: Lot) => boolean;
  covered: (lot: Lot) => boolean;
}

const SPECS: readonly MetricSpec[] = [
  {
    code: 'region',
    label: 'Регион определён',
    impact: 'без региона лот не проходит фильтр воронки, а оценка ищет аналоги по всей стране',
    applicable: () => true,
    covered: (lot) => lot.regionCode !== undefined,
  },
  {
    code: 'stable_key',
    label: 'Есть устойчивый идентификатор',
    impact:
      'без кадастрового номера или VIN склейка между источниками невозможна: один объект попадёт в воронку дважды',
    applicable: () => true,
    covered: (lot) => lot.assets.some((asset) => asset.cadastralNumber || asset.vin),
  },
  {
    code: 'area',
    label: 'Площадь извлечена',
    impact: 'оценка недвижимости считается по цене за метр — без площади она не строится вовсе',
    applicable: (lot) => ['real_estate', 'land'].includes(lotAssetKind(lot)),
    covered: (lot) => totalArea(lot) !== undefined,
  },
  {
    code: 'price_schedule',
    label: 'График снижения разобран',
    impact:
      'на публичном предложении это самая дорогая потеря: неизвестны текущая цена и момент следующего снижения',
    applicable: (lot) => lot.procedure === 'public_offer' || lot.procedure === 'combined',
    covered: (lot) => lot.priceSchedule.length > 1,
  },
  {
    code: 'application_end',
    label: 'Срок приёма заявок известен',
    impact: 'без него не считаются ни срочность в скоринге, ни вехи подготовки',
    applicable: () => true,
    covered: (lot) => lot.applicationEnd !== undefined,
  },
  {
    code: 'deposit',
    label: 'Размер задатка извлечён',
    impact: 'напоминание не сможет назвать сумму, и человек пойдёт искать её в извещении',
    applicable: () => true,
    covered: (lot) => typeof lot.deposit === 'number',
  },
  {
    code: 'debtor_inn',
    label: 'ИНН должника извлечён',
    impact: 'без него хуже работает дедупликация лотов без кадастрового номера и VIN',
    applicable: () => true,
    covered: (lot) => lot.debtor.inn !== undefined,
  },
  {
    code: 'procedure',
    label: 'Вид процедуры распознан',
    impact: 'неопознанная процедура означает, что график цены построен по умолчанию, а не по формуле',
    applicable: () => true,
    covered: (lot) => lot.procedure !== 'unknown',
  },
];

const DEFAULT_SAMPLE_SIZE = 3;

export function coverageReport(
  lots: readonly Lot[],
  options: { sampleSize?: number } = {},
): CoverageReport {
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;

  const metrics = SPECS.map((spec): CoverageMetric => {
    const applicable = lots.filter(spec.applicable);
    const missing = applicable.filter((lot) => !spec.covered(lot));

    return {
      code: spec.code,
      label: spec.label,
      impact: spec.impact,
      applicable: applicable.length,
      covered: applicable.length - missing.length,
      share: applicable.length === 0 ? null : (applicable.length - missing.length) / applicable.length,
      samples: missing.slice(0, sampleSize).map((lot) => lot.title),
    };
  });

  // Худшее покрытие сверху. Метрики без применимых лотов уходят вниз:
  // о них нечего сказать, и они не должны занимать место в начале отчёта.
  metrics.sort((a, b) => (a.share ?? 2) - (b.share ?? 2));

  return { totalLots: lots.length, metrics };
}

/**
 * Метрики, требующие внимания: покрытие ниже порога при осмысленном размере выборки.
 * На трёх лотах любая доля — шум, поэтому нужен минимум применимых.
 */
export function needsAttention(
  report: CoverageReport,
  threshold = 0.8,
  minApplicable = 10,
): CoverageMetric[] {
  return report.metrics.filter(
    (metric) =>
      metric.share !== null && metric.share < threshold && metric.applicable >= minApplicable,
  );
}

/** Полоска покрытия для терминала. */
export function bar(share: number | null, width = 20): string {
  if (share === null) return '—'.repeat(width);
  const filled = Math.round(share * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
