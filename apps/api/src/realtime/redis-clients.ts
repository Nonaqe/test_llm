/**
 * Реестр Redis-клиентов api-процесса (docs/30 §Ф7). Клиенты создаются в main.ts
 * только при REDIS_URL (адаптер Socket.IO) и живут вне Nest-DI, поэтому main
 * регистрирует pub-клиент здесь — диагностика отличает «не настроен» от «настроен,
 * но не отвечает». Минимальный структурный тип: без зависимости от пакета redis.
 */
export interface RedisPingClient {
  ping(): Promise<unknown>;
}

let pubClient: RedisPingClient | null = null;

/** Вызывает main.ts после успешного connect() pub-клиента. */
export function registerRedisPubClient(client: RedisPingClient): void {
  pubClient = client;
}

/** Живой pub-клиент этого процесса или null, если Redis не инициализирован. */
export function getRedisPubClient(): RedisPingClient | null {
  return pubClient;
}
