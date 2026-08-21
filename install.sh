#!/usr/bin/env bash
# Universal Chat — установка на чистой VPS (docs/16_DEPLOYMENT.md §4, Фаза 7).
# Использование: ./install.sh   (из корня клона репозитория)
# Спрашивает домен и email → генерирует .env (600) → поднимает стек → печатает SETUP-токен.
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"

log() { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[install] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

# --- 0. Предпосылки -------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker не найден. Установите Docker Engine: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "docker compose v2 не найден (плагин docker-compose-plugin)."
[ ! -f .env ] || die ".env уже существует. Для обновления используйте ./update.sh; для переустановки удалите .env вручную."

# --- 1. Вопросы -----------------------------------------------------------
printf 'Домен чат-сервера (например chat.example.com): '
read -r CHAT_DOMAIN
[[ "$CHAT_DOMAIN" =~ ^[a-zA-Z0-9.-]+$ ]] || die "Некорректный домен: $CHAT_DOMAIN"

printf 'Email для Let'"'"'s Encrypt: '
read -r ACME_EMAIL
[[ "$ACME_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]] || die "Некорректный email: $ACME_EMAIL"

printf 'Версия образа [1.0.0]: '
read -r CHAT_VERSION
CHAT_VERSION="${CHAT_VERSION:-1.0.0}"

# --- 2. Секреты -----------------------------------------------------------
APP_SECRET="$(openssl rand -hex 32)"
DB_PASSWORD="$(openssl rand -hex 24)"
SETUP_TOKEN="setup_$(openssl rand -hex 16)"

umask 177
cat > .env <<EOF
# Сгенерировано install.sh $(date -u '+%Y-%m-%dT%H:%M:%SZ'). Права 600.
# APP_SECRET хранит шифрование секретов настроек: сохраните в менеджер паролей!
# Потеря APP_SECRET = потеря расшифровки (docs/16 «Частые ошибки»).
NODE_ENV=production
LOG_LEVEL=info
APP_VERSION=${CHAT_VERSION}
CHAT_DOMAIN=${CHAT_DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
CHAT_VERSION=${CHAT_VERSION}
DATABASE_URL=postgres://unichat:${DB_PASSWORD}@postgres:5432/unichat
REDIS_URL=redis://redis:6379
APP_SECRET=${APP_SECRET}
SETUP_TOKEN=${SETUP_TOKEN}
UPLOADS_DIR=/app/uploads
BACKUP_DIR=/app/backups
BACKUP_AT=03:00
EOF
chmod 600 .env

# Caddy global: email для ACME
export CHAT_DOMAIN ACME_EMAIL

# --- 3. Подъём ------------------------------------------------------------
log "Сборка/загрузка образов (${CHAT_VERSION})…"
$COMPOSE pull --ignore-buildable || true
$COMPOSE build api worker
log "Запуск стека…"
$COMPOSE up -d

log "Ожидание готовности api…"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1/health" >/dev/null 2>&1 \
     || curl -fsSk "https://${CHAT_DOMAIN}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

# --- 4. Итог --------------------------------------------------------------
cat <<EOF

============================================================
 Установка завершена.

 Домен:            https://${CHAT_DOMAIN}
 SETUP-токен:      ${SETUP_TOKEN}

 Дальше (≤5 минут, docs/22):
   1) Откройте https://${CHAT_DOMAIN}/wizard
   2) Введите SETUP-токен → создайте администратора
   3) Проект → сайт → AI-провайдер → знания → сниппет

 Сохраните APP_SECRET из .env в менеджер паролей!
 Обновление: ./update.sh   Восстановление: ./restore.sh
============================================================
EOF
