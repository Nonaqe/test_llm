# Образ chat-platform: общий для процессов api и worker (ADR-010).
# Build: docker build -t chat-platform:<semver> -f infra/docker/Dockerfile .
# Прод-compose — infra/docker/docker-compose.prod.yml (docs/16_DEPLOYMENT.md §3).

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm turbo run build --filter=@uni-chat/api

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
# postgresql-client — pg_dump в BackupService (Ф7); tar/gzip — упаковка uploads;
# dumb-init — PID 1 и проброс сигналов (корректное app.close() при stop).
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client tar gzip dumb-init \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 unichat
WORKDIR /app
# Структура pnpm-workspace сохранена: симлинки apps/api/node_modules → ../../../.pnpm
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
USER unichat
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["dumb-init", "--"]
# Воркер — тот же образ: docker run ... node apps/api/dist/worker.js
CMD ["node", "apps/api/dist/main.js"]
