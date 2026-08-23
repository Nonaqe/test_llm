#!/usr/bin/env bash
# Universal Chat — обновление (docs/20_UPDATES_MIGRATIONS.md, Фаза 7).
# Порядок: pre-update бэкап БД → pull новой версии → up -d → health-проверка.
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"

log() { printf '\033[1;34m[update]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[update] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f .env ] || die ".env не найден — сначала ./install.sh"

# --- 1. Целевая версия ----------------------------------------------------
CURRENT="$(grep -E '^CHAT_VERSION=' .env | cut -d= -f2 || true)"
printf 'Текущая версия: %s\nНовая версия [1.0.0]: ' "${CURRENT:-?}"
read -r NEW_VERSION
NEW_VERSION="${NEW_VERSION:-1.0.0}"

# --- 2. Pre-update бэкап (docs/20 §2) -------------------------------------
STAMP="$(date -u '+%Y%m%d-%H%M%S')"
mkdir -p backups/pre-update
log "Бэкап БД перед обновлением…"
source <(grep -E '^DATABASE_URL=' .env) 2>/dev/null || true
: "${DATABASE_URL:?DATABASE_URL отсутствует в .env}"
# pg_dump внутри контейнера postgres (клиент уже там); файл — на хост.
DBPASS="$(printf '%s' "$DATABASE_URL" | sed -E 's|^postgres://unichat:([^@]+)@.*|\1|')"
docker compose -f infra/docker/docker-compose.prod.yml exec -T \
  -e PGPASSWORD="$DBPASS" postgres \
  pg_dump --format=custom --username=unichat unichat \
  > "backups/pre-update/unichat-${STAMP}.dump"
log "Бэкап: backups/pre-update/unichat-${STAMP}.dump ($(du -h "backups/pre-update/unichat-${STAMP}.dump" | cut -f1))"

# uploads — обязательная часть бэкапа (docs/20 §2): документы знаний живут в volume
log "Бэкап uploads (volume unichat_uploads)…"
docker run --rm \
  -v unichat_uploads:/src:ro \
  -v "$(pwd)/backups/pre-update:/dst" \
  alpine tar czf "/dst/uploads-${STAMP}.tar.gz" -C /src .
log "Бэкап: backups/pre-update/uploads-${STAMP}.tar.gz"

# --- 3. Новая версия -------------------------------------------------------
sed -i.bak "s/^CHAT_VERSION=.*/CHAT_VERSION=${NEW_VERSION}/" .env
rm -f .env.bak

log "Загрузка/сборка ${NEW_VERSION}…"
$COMPOSE pull --ignore-buildable || true
# worker использует тот же образ, build-секции нет
$COMPOSE build api
# Миграции применит сам api при старте (docs/20 §3); раннер идемпотентен.
log "Перекат стека…"
$COMPOSE up -d

# --- 4. Health-проверка (docs/20 §4) --------------------------------------
# Host-заголовок обязателен: Caddy отвечает 200-пустышкой на незнакомый Host,
# из-за чего crash-looping версия выглядела «готовой»
DOMAIN="$(grep -E '^CHAT_DOMAIN=' .env | cut -d= -f2 || true)"
log "Ожидание готовности…"
OK=""
for _ in $(seq 1 60); do
  if curl -fsS -H "Host: ${DOMAIN}" "http://127.0.0.1/widget/v1/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 5
done
if [ -z "$OK" ]; then
  die "api не поднялся. Откат: верните CHAT_VERSION=${CURRENT} в .env и повторите ./update.sh. Логи: $COMPOSE logs api"
fi

VERSION_REPORTED="$(curl -fsS -H "Host: ${DOMAIN}" http://127.0.0.1/widget/v1/health | sed -E 's/.*"version":"([^"]+)".*/\1/')"
log "Готово. Сервер сообщает версию: ${VERSION_REPORTED}"
