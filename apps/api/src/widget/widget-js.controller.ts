/**
 * GET /widget.js — статика виджета для сниппета (docs/05: api отдаёт статику;
 * docs/08 §9: Cache-Control max-age=300, чтобы исправления доезжали быстро).
 *
 * Путь к файлу: env WIDGET_JS_PATH либо <repo>/apps/widget/dist/widget.js,
 * разрешённый от __dirname (одинаково для запуска из src и из dist).
 * Если файла нет — честный 404: сборка виджета не выполнялась.
 */
import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// src|dist → apps/api → apps → <root>/apps/widget/dist/widget.js
const DEFAULT_WIDGET_JS = resolve(__dirname, "../../../widget/dist/widget.js");

@Controller()
export class WidgetJsController {
  private cachedAt = 0;
  private cachedContent: Buffer | null = null;
  private cachedPath = "";

  @Get("widget.js")
  @Header("Cache-Control", "public, max-age=300")
  @Header("Content-Type", "text/javascript; charset=utf-8")
  async serve(@Res() res: Response): Promise<void> {
    const path = process.env.WIDGET_JS_PATH ?? DEFAULT_WIDGET_JS;
    try {
      // Кэш в процессе с перепрочтением раз в 10 с: правки виджета подхватываются
      // без рестарта API, а файл читается с диска не чаще раза в 10 с.
      if (this.cachedContent === null || this.cachedPath !== path || Date.now() - this.cachedAt > 10_000) {
        this.cachedContent = await readFile(path);
        this.cachedPath = path;
        this.cachedAt = Date.now();
      }
    } catch {
      res.status(404).send("// widget.js не собран: выполните pnpm --filter @uni-chat/widget build");
      return;
    }
    res.send(this.cachedContent);
  }
}
