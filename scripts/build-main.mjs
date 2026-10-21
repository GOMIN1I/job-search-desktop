// Сборка main/preload/worker в CommonJS для Electron (без Node у конечного пользователя).
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  external: ["electron"],
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js" });
await build({ ...common, entryPoints: ["src/main/worker.ts"], outfile: "dist/main/worker.js" });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/main/preload.js" });
await build({ ...common, entryPoints: ["src/cli/cli.ts"], outfile: "dist/cli.js" });
// Сервер поиска (для поиска, когда компьютер выключен) — тот же код ядра
await build({ ...common, external: [], entryPoints: ["server/src/server.ts"], outfile: "server/dist/server.js" });
