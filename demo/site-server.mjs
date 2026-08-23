/** Статический сервер тестового сайта: http://localhost:8088 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.SITE_PORT ?? 8088);
const root = fileURLToPath(new URL("./site/", import.meta.url));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  // Path traversal guard (реаудит RA-I-14): нормализуем и проверяем, что итог
  // остался внутри demo/site/
  const abs = path.normalize(path.join(root, rel));
  if (!abs.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403");
    return;
  }
  try {
    const data = await readFile(abs);
    const ext = "." + (abs.split(".").pop() ?? "").toLowerCase();
    res.writeHead(200, {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`[demo-site] http://localhost:${PORT}`));
