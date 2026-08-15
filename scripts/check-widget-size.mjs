/**
 * Проверка бюджета размера виджета: ≤ 60 КБ gzip (NFR-5, docs/08_WIDGET.md §9).
 * Запуск: pnpm check:widget-size (после pnpm build). Падение = падение CI.
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const LIMIT_KB = 60;
const file = fileURLToPath(new URL("../apps/widget/dist/widget.js", import.meta.url));

let code;
try {
  code = readFileSync(file);
} catch {
  console.error(`widget bundle не найден: ${file} — сначала выполните pnpm build`);
  process.exit(1);
}

const gzipKb = gzipSync(code).length / 1024;
const rawKb = code.length / 1024;
console.log(`widget.js: ${rawKb.toFixed(1)} KB raw, ${gzipKb.toFixed(1)} KB gzip (лимит ${LIMIT_KB} KB)`);

if (gzipKb > LIMIT_KB) {
  console.error("FAIL: виджет превышает бюджет размера");
  process.exit(1);
}
