/**
 * Воркер-процесс — тот же образ, другой entrypoint (ADR-010).
 * Фаза 0: каркас (heartbeat + graceful shutdown). Очереди BullMQ — Фаза 3 (docs/05 §5).
 */
const TICK_MS = 30_000;

let running = true;
let ticks = 0;

function log(msg: string, extra: Record<string, unknown> = {}): void {
  // Пока без pino-обвязки: единый JSON-формат, читаемый docker logs (docs/19 §1)
  console.log(JSON.stringify({ level: "info", time: Date.now(), msg, ...extra }));
}

function tick(): void {
  if (!running) return;
  ticks += 1;
  log("worker heartbeat", { tick: ticks });
}

const timer = setInterval(tick, TICK_MS);

function shutdown(signal: string): void {
  if (!running) return;
  running = false;
  clearInterval(timer);
  log("worker stopped", { signal, ticks });
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log("worker started", { tick_ms: TICK_MS });
