---
id: DOC-023
title: Руководство разработчика
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: developer
priority: medium
summary: Вход в разработку: предпосылки и локальное окружение (Docker для PostgreSQL/pgvector и Redis), запуск api/admin/widget в dev-режиме, миграции в разработке, тесты, стиль кода и коммитов, сборка и релизный процесс. Часть деталей — TBD до создания репозитория.
when_to_read: Перед первым запуском проекта локально; при подготовке релиза; при онбординге нового разработчика.
when_not_to_read: При эксплуатации и интеграции сайтов.
keywords: разработка, локальный запуск, окружение, dev, миграции, тесты, стиль, коммиты, релиз, сборка
related:
  - DOC-004
  - DOC-018
  - DOC-020
---

# Руководство разработчика

## Краткое содержание

- Предпосылки и клонирование.
- Локальное окружение и запуск.
- Разработочные данные и миграции.
- Тесты и линтеры.
- Стиль кода и коммитов.
- Сборка и релиз.

Детали команд — TBD до создания репозитория; структура — DOC-004 (источник истины).

## 1. Предпосылки

| Инструмент | Версия | Зачем |
|---|---|---|
| Node.js | 20 LTS | api/admin/widget |
| pnpm | 9+ | workspaces |
| Docker + Compose | актуальный | Postgres+pgvector, Redis (dev) |
| (widget) — доп. требований нет | | бандл собирается vite |

## 2. Локальный запуск

```bash
git clone <repo> universal-chat && cd universal-chat
pnpm install

# инфраструктура для разработки (только БД и Redis):
docker compose -f infra/docker/docker-compose.dev.yml up -d

# применить миграции в dev-БД:
pnpm --filter @uni-chat/api dev:migrate

# запуск в трёх терминалах (или через turbo dev):
pnpm dev:api      # NestJS watch-режим, http://localhost:3000
pnpm dev:admin    # Vite dev-сервер, http://localhost:5173 (прокси на api)
pnpm dev:widget   # сборка widget.js в watch-режиме
```

`.env.development` (в репозитории, без секретов): дефолтные подключения к dev-контейнерам; `APP_SECRET=dev-secret`. Сид-данные: `pnpm --filter @uni-chat/api dev:seed` — тестовый проект, сайт с ключом `pk_test_...`, оператор (пароль из сида).

## 3. Миграции в разработке

- Новая миграция: файл в `apps/api/migrations/NNNN_name.sql` (+ `.down.sql`).
- Правила стиля — DOC-006 §8 (экспансивные, backward-compatible).
- Локально пересоздать БД с нуля: `dev:reset` (drop → migrate → seed).

## 4. Тесты и линтеры

```bash
pnpm lint        # eslint + boundary-правила зависимостей (DOC-004 §4)
pnpm typecheck
pnpm test        # unit
pnpm test:e2e    # Testcontainers: поднимает pgvector+redis сама
```

Обязательства: новая логика ядра — с юнит-тестами; сценарии — по чек-листу DOC-018. В CI всё то же + проверка размера widget-бандла.

## 5. Стиль кода и коммитов

- TypeScript strict; ESLint + Prettier (конфиги в репозитории — TBD).
- Коммиты: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`...).
- Правило зависимостей пакетов — DOC-004 §4; нарушение = ошибка CI.
- Комментарии в коде — только для неочевидных ограничений; «что делает код» не комментируем.

## 6. Сборка и релиз

```text
Разработка → PR (lint+tests green) → main
Релиз:
  1. version bump (changesets TBD) + changelog
  2. CI на теге: docker build chat-platform:<semver>
  3. smoke: e2e против образа, restore-тест бэкапа (раз в релиз, TBD)
  4. публикация образа в registry; WP-плагин — отдельный релизный цикл
```

Обновление пользовательских установок — процедуры DOC-020.

## Частые ошибки

- **Запуск e2e без Docker** — Testcontainers требует Docker.
- **Правка схемы в обход миграций** — следующий `dev:reset`/CI это вскроет; только миграции.
- **Хардкод URL в виджете** — URL выводятся из src скрипта (DOC-008).
- **Коммит секретов** — секретов в репозитории нет вообще (ключи — в настройках установки).

## Связанные разделы

- Структура репозитория — DOC-004
- Тестирование — DOC-018
- Релизы и обновления — DOC-020
