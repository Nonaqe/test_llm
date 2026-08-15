# Быстрый старт разработки

Подробности — `docs/23_DEVELOPER_GUIDE.md`. Здесь — только команды.

## Предпосылки

- Node.js ≥ 20 (`node --version`)
- pnpm ≥ 9 (`npm i -g pnpm@9`, если нет)
- Docker (только для локальной БД/Redis)

## Первый запуск

```bash
pnpm install                 # установить зависимости всех пакетов
pnpm dev:db                  # поднять PostgreSQL (pgvector) + Redis в Docker
cp .env.example .env         # локальные переменные (дефолты совпадают с dev:db)
pnpm --filter @uni-chat/api dev:migrate   # применить миграции

# API в двух терминалах (NestJS-DI требует tsc — см. примечание ниже):
pnpm --filter @uni-chat/api dev:watch     # терминал 1: tsc --watch
pnpm dev:api                               # терминал 2: node --watch dist/main.js
# → http://localhost:3000/health
```

Примечание: для `apps/api` не используется tsx/esbuild-dev-server — esbuild не
эмитит decorator metadata, без которого NestJS DI не разрешается. Юнит/e2e
тесты используют swc-плагин (vitest.config.ts).

## Прочее

```bash
pnpm test                    # юнит-тесты (shared, core, api)
pnpm build                   # сборка всех пакетов
pnpm lint                    # eslint (всё репо)
pnpm typecheck               # tsc --noEmit всех пакетов
pnpm check:deps              # границы зависимостей пакетов (docs/04 §4)
pnpm check:widget-size       # бюджет 60 КБ gzip (NFR-5)
pnpm dev:widget              # dev-стенд виджета (harness-страница)
pnpm dev:admin               # dev-стенд админки
pnpm dev:db:down             # остановить dev-БД
```

## Структура

`apps/{api,admin,widget}`, `packages/{shared,core,ui}`, `integrations/wordpress`,
`infra/docker`, `docs/` — карта в `docs/DOCUMENTATION_MAP.md`.
