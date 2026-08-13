#!/bin/sh
# Один прогон конвейера: сбор → скоринг → обогащение → алерты → напоминания.
#
# Почему одна команда, а не пять строк в cron. Фазы обязаны идти по порядку:
# скорить нечего до сбора, обогащать некого до скоринга, алертить не о чем
# до обогащения. Пять независимых расписаний рано или поздно разъедутся,
# и сервис начнёт слать алерты по вчерашним баллам.
#
# Блокировка обязательна: сбор при широком окне идёт дольше пятнадцати минут,
# и без неё прогоны наложатся друг на друга, удвоив нагрузку на источники —
# ровно то, за что площадки блокируют доступ.
#
# Падение одной фазы не отменяет следующие: если ЕФРСБ лежит, скоринг
# по уже собранным лотам и напоминания по срокам всё равно нужны.

set -u

RADAR_DIR="${RADAR_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOCK_FILE="${RADAR_LOCK:-/tmp/bankrot-radar.lock}"
BUSY_CODE=99

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*"
}

run_phase() {
  phase="$1"
  shift
  if npm run --silent radar -- "$@"; then
    log "[$phase] готово"
  else
    log "[$phase] ОШИБКА, продолжаем" >&2
    FAILED="$FAILED$phase "
  fi
}

cycle() {
  cd "$RADAR_DIR" || exit 1
  FAILED=''

  run_phase ingest ingest --days "${RADAR_INGEST_DAYS:-1}"
  run_phase score score
  run_phase enrich enrich
  run_phase alert alert
  run_phase remind remind

  if [ -n "$FAILED" ]; then
    log "прогон завершён с ошибками в фазах: $FAILED" >&2
    return 1
  fi
  log 'прогон завершён без ошибок'
  return 0
}

# Повторный вход под захваченной блокировкой.
if [ "${1:-}" = '--locked' ]; then
  cycle
  exit $?
fi

if ! command -v flock >/dev/null 2>&1; then
  log 'flock не найден, прогон без блокировки' >&2
  cycle
  exit $?
fi

# -E задаёт отдельный код возврата для «замок занят», иначе его не отличить
# от обычной ошибки прогона.
flock -n -E "$BUSY_CODE" "$LOCK_FILE" "$0" --locked
status=$?

if [ "$status" -eq "$BUSY_CODE" ]; then
  log 'предыдущий прогон ещё идёт, пропускаем'
  exit 0
fi
exit "$status"
