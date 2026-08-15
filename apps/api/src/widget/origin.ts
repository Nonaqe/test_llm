/**
 * Матчинг Origin против allowlist сайта (docs/10 §4).
 * Строгий: Origin обязателен (кроме '*' в allowlist), сравнение после нормализации.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, "");
}

export function matchOrigin(allowed: readonly string[], origin: string | undefined): boolean {
  if (allowed.includes("*")) return true;
  if (!origin) return false; // не-браузерные клиенты обязаны идти с Origin (curl -H)
  const normalized = normalizeOrigin(origin);
  return allowed.some((entry) => normalizeOrigin(entry) === normalized);
}
