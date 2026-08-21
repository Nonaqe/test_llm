/**
 * Smoke-тест бутстрапа (docs/18 §5, предложено после ddffcaf): поднимает AppModule
 * без слушателя и БД — валидирует весь DI-граф Nest за секунды. Ловит класс ошибок
 * «Nest can't resolve dependencies», который не видят typecheck и юнит-тесты.
 * Запуск: pnpm --filter @uni-chat/api smoke (после build).
 */
const { AppModule } = require("../dist/app.module");

async function main() {
  const { NestFactory } = require("@nestjs/core");
  const app = await NestFactory.create(AppModule, { bufferLogs: true, logger: false });
  await app.init();
  await app.close();
  console.log("bootstrap ok: AppModule инициализируется, DI-граф полон");
}

main().catch((err) => {
  console.error("bootstrap FAILED:", err && err.message ? err.message : err);
  process.exit(1);
});
