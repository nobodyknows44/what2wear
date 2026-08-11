/**
 * Форматирование алерта.
 *
 * Сообщение должно отвечать на один вопрос: стоит ли открывать этот лот прямо
 * сейчас. Поэтому наверх выносятся цена, дисконт и дедлайн, а не описание лота.
 */

import { documentChecklist, slowItems } from '../deal/checklist.ts';
import type { Deal } from '../domain/deal.ts';
import { STATUS_LABELS } from '../domain/deal.ts';
import type { Lot } from '../domain/lot.ts';
import { regionName } from '../domain/regions.ts';
import { nextDrop } from '../domain/priceSchedule.ts';
import type { Milestone } from '../deal/milestones.ts';
import type { ScoredLot } from '../storage/lotsRepo.ts';

export function formatAlert(scored: ScoredLot, now: Date): string {
  const { lot } = scored;
  const lines: string[] = [];

  lines.push(`<b>${escapeHtml(truncate(lot.title, 140))}</b>`);
  lines.push(`Балл ${scored.score}/100 · ${regionName(lot.regionCode)} · ${procedureLabel(lot.procedure)}`);
  lines.push('');

  if (scored.currentPrice !== null) {
    const priceLine =
      scored.estimateValue !== null && scored.discount !== null
        ? `Цена ${formatRub(scored.currentPrice)} · оценка ${formatRub(scored.estimateValue)} · дисконт ${(
            scored.discount * 100
          ).toFixed(0)}%`
        : `Цена ${formatRub(scored.currentPrice)}`;
    lines.push(priceLine);
  }

  if (typeof lot.deposit === 'number') lines.push(`Задаток ${formatRub(lot.deposit)}`);

  if (lot.applicationEnd) {
    lines.push(`Заявки до ${formatDateTime(lot.applicationEnd)} (${remaining(lot.applicationEnd, now)})`);
  }

  const drop = nextDrop(lot.priceSchedule, now);
  if (drop) {
    lines.push(`Следующее снижение ${formatDateTime(drop.at.toISOString())} → ${formatRub(drop.price)}`);
  }

  if (lot.debtor.name || lot.debtor.caseNumber) {
    lines.push(
      `Должник: ${escapeHtml(lot.debtor.name ?? 'не указан')}${
        lot.debtor.caseNumber ? ` · дело ${escapeHtml(lot.debtor.caseNumber)}` : ''
      }`,
    );
  }
  if (lot.etpName) lines.push(`Площадка: ${escapeHtml(lot.etpName)}`);

  if (scored.reasons.length > 0) {
    lines.push('');
    for (const reason of scored.reasons.slice(0, 6)) lines.push(`• ${escapeHtml(reason)}`);
  }

  if (lot.sourceUrl) {
    lines.push('');
    lines.push(`<a href="${escapeHtml(lot.sourceUrl)}">Открыть карточку</a>`);
  }

  return lines.join('\n');
}

/**
 * Напоминание по вехе сделки.
 *
 * В отличие от алерта по лоту, здесь на первом месте не выгода, а действие
 * и срок: сообщение должно отвечать на вопрос «что мне сделать сегодня»,
 * а не «стоит ли этим заниматься» — этот вопрос решён при заведении сделки.
 */
export function formatDealReminder(
  lot: Lot,
  deal: Deal,
  milestone: Milestone,
  now: Date,
): string {
  const lines: string[] = [];

  const marker = milestone.overdue ? '⚠️ Срок нарушен' : 'Приближается срок';
  lines.push(`<b>${marker}: ${escapeHtml(milestone.title)}</b>`);
  lines.push(escapeHtml(truncate(lot.title, 120)));
  lines.push('');

  const due = milestone.dayGranular
    ? formatDate(milestone.dueAt)
    : formatDateTime(milestone.dueAt);
  lines.push(`Срок: ${due} (${remaining(milestone.dueAt, now)})`);
  lines.push(`Статус сделки: ${STATUS_LABELS[deal.status]}`);

  if (milestone.code === 'deposit') {
    // Размер задатка не вычисляется: ошибка здесь означает недопуск,
    // поэтому при отсутствии суммы в извещении человек обязан посмотреть сам.
    lines.push(
      typeof lot.deposit === 'number'
        ? `Задаток: ${formatRub(lot.deposit)}`
        : 'Задаток: в извещении не указан — посмотрите сообщение о торгах',
    );
    if (lot.applicationEnd) {
      lines.push(`Приём заявок до ${formatDateTime(lot.applicationEnd)}`);
    }
  }

  if (milestone.code === 'documents') {
    const items = documentChecklist(lot, deal.buyerType);
    const slow = slowItems(items);
    lines.push('');
    lines.push(`Пакет документов, ${items.length} пунктов${slow.length > 0 ? ':' : ''}`);
    for (const item of slow) {
      lines.push(`• ${escapeHtml(item.title)} — <i>получать заранее</i>`);
    }
    lines.push('Полный список: <code>radar deal show</code>');
  }

  if (milestone.code === 'auction' && typeof deal.maxPrice === 'number') {
    lines.push(`Потолок цены: ${formatRub(deal.maxPrice)}`);
  }

  lines.push('');
  lines.push(`<i>${escapeHtml(milestone.rationale)}</i>`);

  if (lot.sourceUrl) lines.push(`<a href="${escapeHtml(lot.sourceUrl)}">Открыть карточку</a>`);

  return lines.join('\n');
}

function procedureLabel(procedure: string): string {
  switch (procedure) {
    case 'public_offer':
      return 'публичное предложение';
    case 'auction':
      return 'аукцион';
    case 'competition':
      return 'конкурс';
    case 'combined':
      return 'комбинированные торги';
    default:
      return 'вид торгов не определён';
  }
}

export function formatRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

/** Дата без времени: для сроков, вычисленных в рабочих днях, время не известно. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function remaining(iso: string, now: Date): string {
  const hours = (Date.parse(iso) - now.getTime()) / 3_600_000;
  if (Number.isNaN(hours)) return 'срок неизвестен';
  if (hours <= 0) return 'срок истёк';
  if (hours < 48) return `осталось ${Math.round(hours)} ч`;
  return `осталось ${Math.round(hours / 24)} дн`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
