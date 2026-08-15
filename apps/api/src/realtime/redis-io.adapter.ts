/**
 * Redis-adapter для Socket.IO (multi-instance fanout — docs/17 §7 модели).
 * Подключается только при REDIS_URL; runtime-проверка — Фаза 4 (см. DOC-031 D-6).
 */
import { IoAdapter } from "@nestjs/platform-socket.io";
import type { INestApplication } from "@nestjs/common";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server, ServerOptions } from "socket.io";

type PubSubClient = Parameters<typeof createAdapter>[0];

export class RedisIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly pubClient: PubSubClient,
    private readonly subClient: PubSubClient,
  ) {
    super(app);
  }

  // сигнатура зеркалит IoAdapter.createIOServer (port, ServerOptions): any
  /* eslint-disable @typescript-eslint/no-explicit-any */
  override createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(createAdapter(this.pubClient, this.subClient));
    return server;
  }
}
