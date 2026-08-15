import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

// swc вместо esbuild: NestJS-DI требует emitDecoratorMetadata,
// которого esbuild (дефолт vitest/tsx) не поддерживает
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true },
        target: "es2022",
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.e2e.ts"],
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
