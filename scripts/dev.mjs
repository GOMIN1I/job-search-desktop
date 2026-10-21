// Режим разработки: Vite-сервер для renderer + Electron, загружающий его.
import { spawn } from "node:child_process";
import { createServer } from "vite";

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = "http://localhost:5173";
const electron = (await import("electron")).default;
const child = spawn(electron, ["."], { stdio: "inherit", env: { ...process.env, JSD_DEV_URL: url } });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
