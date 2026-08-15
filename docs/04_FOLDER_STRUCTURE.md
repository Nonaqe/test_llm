---
id: DOC-004
title: Структура репозитория
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: developer
priority: medium
summary: Монорепозиторий pnpm workspaces + Turborepo: приложения (api, admin, widget), пакеты (core, shared, ui), интеграции (wordpress), инфраструктура (docker, scripts). Правила зависимостей между пакетами и примеры конфигурации.
when_to_read: Перед началом разработки; при добавлении нового пакета или модуля; для навигации по коду.
when_not_to_read: При эксплуатации установленной системы; при пользовательских вопросах.
keywords: структура, монорепо, pnpm, turborepo, пакеты, workspace, правила зависимостей
related:
  - DOC-003
  - DOC-023
  - DOC-029
---

# Структура репозитория

## Краткое содержание

- Дерево монорепозитория и назначение каталогов.
- Правила зависимостей между пакетами.
- Примеры конфигурации workspace.
- Правила размещения нового кода.

## 1. Монорепозиторий

Один репозиторий — весь продукт: backend, admin, widget, WP-плагин, инфраструктура, документация. Менеджер — **pnpm workspaces**, оркестратор задач — **Turborepo**.

Почему монорепо: общие пакеты типов/контрактов (`shared`) для api/admin/widget; атомарные кросс-слойные изменения; один CI.

## 2. Дерево

```text
universal-chat/
├── apps/
│   ├── api/                          # NestJS: REST + Socket.IO + раздача статики
│   │   ├── src/
│   │   │   ├── main.ts               # entrypoint процесса api
│   │   │   ├── worker.ts             # entrypoint процесса worker (тот же образ)
│   │   │   ├── app.module.ts
│   │   │   └── modules/              # 16 модулей ядра — список в DOC-003 §4
│   │   │       └── conversations/
│   │   │           ├── conversations.module.ts
│   │   │           ├── conversations.controller.ts    # REST-роуты
│   │   │           ├── conversations.service.ts       # бизнес-логика
│   │   │           ├── conversation-engine.service.ts # оркестрация AI-хода
│   │   │           └── __tests__/
│   │   ├── test/                     # e2e (Testcontainers)
│   │   └── Dockerfile                # multi-stage, общий для api и worker
│   ├── admin/                        # React + Vite SPA (TypeScript)
│   │   └── src/
│   │       ├── pages/                # login, dashboard, conversations, projects,
│   │       │                         # sites, ai, knowledge, team, settings
│   │       ├── features/             # inbox, widget-constructor, rules-editor
│   │       └── lib/                  # api-client (из shared), socket-client
│   └── widget/                       # Preact + Shadow DOM → единый widget.js
│       ├── src/
│       │   ├── element.ts            # custom element <uni-chat-widget>
│       │   ├── app/                  # UI-компоненты панели чата
│       │   ├── sdk.ts                # публичный API ChatWidget.*
│       │   └── lib/                  # socket-client, markdown-рендер, sanitize
│       └── vite.config.ts            # сборка в один ESM-бандл + проверка размера
├── packages/
│   ├── core/                         # ДОМЕННОЕ ЯДРО, чистый TypeScript
│   │   └── src/
│   │       ├── conversation/         # state machine диалога
│   │       ├── rag/                  # ingest-пайплайн, retrieval, RRF
│   │       ├── ai/                   # LlmProvider/EmbeddingProvider + guardrails
│   │       ├── rules/                # escalation RulesEngine
│   │       └── prompt/               # сборка system prompt
│   ├── shared/                       # КОНТРАКТЫ: DTO, схемы, типы событий
│   │   └── src/
│   │       ├── api/                  # типы запросов/ответов REST
│   │       ├── events/               # типы событий Socket.IO
│   │       └── domain/               # enum'ы: ConversationState, MessageRole...
│   └── ui/                           # общие React-компоненты админки
├── integrations/
│   └── wordpress/                    # PHP-плагин uni-chat (тонкий слой)
│       ├── uni-chat.php
│       ├── includes/
│       │   ├── settings.php
│       │   └── embed.php
│       └── readme.txt
├── infra/
│   ├── docker/                       # docker-compose.yml, Caddyfile, .env.example
│   └── scripts/                      # install.sh, backup.sh, restore.sh
├── docs/                             # эта документация (см. DOC-INDEX)
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── .github/workflows/                # CI: lint, typecheck, test, build
```

## 3. Назначение каталогов

| Путь | Назначение |
|---|---|
| `apps/api` | Серверное приложение: REST, Socket.IO, воркеры, статика админки |
| `apps/admin` | SPA админки и операторского inbox |
| `apps/widget` | Встраиваемый виджет, собирается в один ESM-файл |
| `packages/core` | Доменное ядро без фреймворков: переиспользуется api и worker |
| `packages/shared` | Контракты (DTO/события/enum'ы) для всех TS-приложений |
| `packages/ui` | Общие React-компоненты (только для admin) |
| `integrations/wordpress` | WordPress-плагин (PHP) |
| `infra/` | Docker Compose, Caddy, установочные/резервные скрипты |
| `docs/` | Документация проекта |

## 4. Правила зависимостей (обязательные)

```text
shared   → ни от чего (кроме zod для схем валидации)
core     → shared                  (НЕ зависит от @nestjs/* — чистый TS)
api      → core, shared, @nestjs/* 
admin    → shared, ui
widget   → shared (минимально: только типы событий и DTO)
ui       → shared
integrations/* → НЕ импортируют TS-пакеты (другой рантайм: PHP)
```

Имена пакетов: `@uni-chat/api`, `@uni-chat/admin`, `@uni-chat/widget`, `@uni-chat/core`, `@uni-chat/shared`, `@uni-chat/ui`.

Нарушение направления зависимостей = ошибка сборки (проверяется eslint-plugin-boundaries или dependency-cruiser в CI).

## 5. Примеры конфигурации

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test":      { "dependsOn": ["build"] },
    "lint":      {},
    "typecheck": { "dependsOn": ["^build"] }
  }
}
```

Корневой `package.json` (фрагмент):

```json
{
  "name": "universal-chat",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build":     "turbo run build",
    "test":      "turbo run test",
    "lint":      "turbo run lint",
    "dev:api":    "pnpm --filter @uni-chat/api dev",
    "dev:admin":  "pnpm --filter @uni-chat/admin dev",
    "dev:widget": "pnpm --filter @uni-chat/widget dev"
  }
}
```

## 6. Правила размещения нового кода

| Пишете | Кладёте |
|---|---|
| Доменную логику (состояния, правила, RAG, промпты) | `packages/core` |
| Новый REST-роут / WS-событие | `apps/api/src/modules/<модуль>` + контракт в `packages/shared` |
| Экран админки | `apps/admin/src/pages` или `features` |
| Кастомизация виджета | `apps/widget/src` |
| Новая платформа интеграции | `integrations/<платформа>/` (новый пакет, ядро не трогаем) |
| Инфраструктурные скрипты | `infra/scripts` |

## Чек-лист добавления нового пакета

- [ ] Каталог в `apps/*` или `packages/*` (workflow подхватит автоматически).
- [ ] Имя `@uni-chat/<name>`; зависимости соответствуют разделу 4.
- [ ] Таски build/lint/test/typecheck объявлены в package.json пакета.
- [ ] Структура и назначение отражены в этом документе (раздел 2/3).
- [ ] Если пакет — новый источник истины для домена: строка в таблице DOC-INDEX.

## Частые ошибки

- **Доменная логика в `apps/api`** вместо `packages/core` — её не увидит worker и будущие интеграции.
- **Импорт `@nestjs/*` из `packages/core`** — ядро теряет переносимость; NestJS-обвязка только в `apps/api`.
- **Виджет зависит от React/тяжёлых библиотек** — ломает бюджет 60 КБ gzip (NFR-5).
- **Дублирование типов** в admin/widget вместо импорта из `packages/shared` — контракты расходятся.
- **PHP-код в `apps/`** — всё платформенное живёт в `integrations/`.

## Связанные разделы

- Архитектура и модули ядра — DOC-003
- Backend — DOC-005
- Руководство разработчика (локальный запуск) — DOC-023
- Правила обновления документации — DOC-029
