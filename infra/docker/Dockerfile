# Образ chat-platform: общий для процессов api и worker (ADR-010).
# Build: docker build -t chat-platform:<semver> -f infra/docker/Dockerfile .
# Прод-compose — infra/docker/docker-compose.prod.yml (docs/16_DEPLOYMENT.md §3).

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
# Манифесты ВСЕХ workspace-пакетов до install (реаудит RA-I-5): lockfile
# содержит 6 импортёров — недостающие каталоги ломали --frozen-lockfile
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/widget/package.json apps/widget/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/api apps/api
# widget: манифест уже скопирован выше — исходники для сборки vite lib
COPY apps/widget/src apps/widget/src
COPY apps/widget/index.html apps/widget/index.html
COPY apps/widget/vite.config.ts apps/widget/vite.config.ts
COPY apps/widget/tsconfig.json apps/widget/tsconfig.json
# admin: SPA раздаётся api из /admin (ADMIN_STATIC_DIR, реаудит RA-I-2)
COPY apps/admin/src apps/admin/src
COPY apps/admin/index.html apps/admin/index.html
COPY apps/admin/vite.config.ts apps/admin/vite.config.ts
COPY apps/admin/tsconfig.json apps/admin/tsconfig.json
# api + виджет + админка: /widget.js отдаёт api из apps/widget/dist,
# /admin — из ADMIN_STATIC_DIR (apps/admin/dist)
RUN ADMIN_BASE_PATH=/admin/ pnpm turbo run build --filter=@uni-chat/api --filter=@uni-chat/widget --filter=@uni-chat/admin

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV ADMIN_STATIC_DIR=/app/admin-static
# postgresql-client-16 из PGDG (реаудит RA-I-3): дистрибутивный клиент = v15,
# pg_dump отказывается работать против сервера PG16 («version mismatch») —
# ночные бэкапы worker падали всегда. tar/gzip — упаковка uploads;
# dumb-init — PID 1 и проброс сигналов.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget gnupg tar gzip dumb-init \
 && install -d /usr/share/postgresql-common/pgdg \
 && wget -qO /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 && ln -sf /usr/bin/pg_dump /usr/local/bin/pg_dump \
 && useradd --system --uid 10001 unichat
WORKDIR /app
# Структура pnpm-workspace сохранена: симлинки apps/api/node_modules → ../../../.pnpm
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
# Бандл виджета: GET /widget.js (widget-js.controller читает apps/widget/dist)
COPY --from=build /app/apps/widget/dist ./apps/widget/dist
# SPA админки: GET /admin/** (main.ts serveAdmin)
COPY --from=build /app/apps/admin/dist ./admin-static
USER unichat
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["dumb-init", "--"]
# Воркер — тот же образ: docker run ... node apps/api/dist/worker.js
CMD ["node", "apps/api/dist/main.js"]
