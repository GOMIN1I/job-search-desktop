import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: true,
    testTimeout: 20000,
    // Небольшое число воркеров: тесты используют реальные SQLite-файлы во временных папках.
    maxWorkers: 2,
  },
});
