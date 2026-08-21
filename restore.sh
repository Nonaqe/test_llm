#!/usr/bin/env bash
# Universal Chat — интерактивное восстановление из бэкапа (docs/19 §4, Фаза 7).
# Останавливает api/worker, восстанавливает БД из выбранного .dump, запускает стек.
# ВАЖНО: секреты настроек расшифровываются только с исходным APP_SECRET (docs/17).
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"

log() { printf '\033[1;34m[restore]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[restore] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f .env ] || die ".env не найден — восстановление возможно только в установленную систему."

# --- 1. Выбор дампа --------------------------------------------------------
DUMP_DIR="backups/pre-update"
log "Доступные дампы (${DUMP_DIR}):"
mapfile -t DUMPS < <(ls -1t "${DUMP_DIR}"/unichat-*.dump 2>/dev/null || true)
[ "${#DUMPS[@]}" -gt 0 ] || die "Дампов нет. Положите .dump в ${DUMP_DIR}/ и повторите."
i=1
for d in "${DUMPS[@]}"; do
  printf '  %d) %s (%s)\n' "$i" "$d" "$(du -h "$d" | cut -f1)"
  i=$((i+1))
done
printf 'Номер дампа для восстановления [1]: '
read -r IDX
IDX="${IDX:-1}"
[[ "$IDX" =~ ^[0-9]+$ ]] && [ "$IDX" -ge 1 ] && [ "$IDX" -le "${#DUMPS[@]}" ] \
  || die "Некорректный выбор: $IDX"
SELECTED="${DUMPS[$((IDX-1))]}"

printf 'ВНИМАНИЕ: текущие данные БД будут ЗАМЕНЕНЫ дампом %s. Продолжить? (yes/no): ' "$(basename "$SELECTED")"
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || die "Отменено пользователем."

# --- 2. Стоп приложения, restore -------------------------------------------
source <(grep -E '^DATABASE_URL=' .env) 2>/dev/null || true
: "${DATABASE_URL:?DATABASE_URL отсутствует в .env}"
DBPASS="$(printf '%s' "$DATABASE_URL" | sed -E 's|^postgres://unichat:([^@]+)@.*|\1|')"

log "Остановка api и worker…"
$COMPOSE stop api worker

log "Восстановление БД из $(basename "$SELECTED")…"
docker compose -f infra/docker/docker-compose.prod.yml exec -T \
  -e PGPASSWORD="$DBPASS" postgres \
  bash -c 'dropdb --force --username=unichat unichat && createdb --username=unichat unichat'
docker compose -f infra/docker/docker-compose.prod.yml exec -T \
  -e PGPASSWORD="$DBPASS" postgres \
  pg_restore --username=unichat --dbname=unichat --no-owner --role=unichat \
  < "$SELECTED"

log "Запуск стека…"
$COMPOSE start api worker

log "Проверка health…"
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1/widget/v1/health >/dev/null 2>&1 && { log "Готово."; exit 0; }
  sleep 5
done
die "api не поднялся после восстановления. Логи: $COMPOSE logs api"
