// Замер производительности настоящего окна: время до первого экрана, память всех процессов,
// время открытия подборки и отклик интерфейса во время работы AI (если локальная модель доступна).
// Запуск: node scripts/perf.mjs  (E2E_EXECUTABLE=<путь к собранному бинарнику> — для проверки сборки)
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-perf-"));
const exe = process.env.E2E_EXECUTABLE;
const t0 = Date.now();
const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: ["."] }), env: { ...process.env, JSD_USER_DATA: dataDir } });
const win = await app.firstWindow();
await win.locator(".onb").waitFor();
const firstScreenMs = Date.now() - t0;
const mem = async () => {
  const ms = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, kb: m.memory.workingSetSize })));
  return Math.round(ms.reduce((s, m) => s + m.kb, 0) / 1024);
};
const memIdleMb = await mem();
await win.evaluate(() => window.jsd.call("demo.load"));
await win.reload();
const t1 = Date.now();
await win.locator("nav.sidebar").waitFor();
await win.locator("nav.sidebar [data-tour='nav-vacancies']").click();
await win.locator(".list-item").first().waitFor();
const vacanciesMs = Date.now() - t1;
// Отклик интерфейса: задержка обработки клика во время AI-разбора (если Ollama с моделью доступна)
let aiMs = null;
let clickLatencyDuringAiMs = null;
const models = await win.evaluate(() => window.jsd.call("models.state")).catch(() => null);
const installed = models?.ok && models.data.status.state === "running" ? models.data.status.models.find((m) => m.name.startsWith("gemma4")) : null;
if (installed) {
  await win.evaluate((m) => window.jsd.call("models.use", { model: m }), installed.name);
  const vid = await win.evaluate(async () => (await window.jsd.call("vacancies.list", { candidateId: "cand-demo" })).data[0].id);
  const ta = Date.now();
  const aiPromise = win.evaluate((id) => window.jsd.call("ai.extract", { vacancyId: id }), vid);
  await win.waitForTimeout(1500);
  const tc = Date.now();
  await win.locator("nav.sidebar [data-tour='nav-applications']").click();
  await win.locator(".page").first().waitFor();
  clickLatencyDuringAiMs = Date.now() - tc;
  await aiPromise;
  aiMs = Date.now() - ta;
}
const memBusyMb = await mem();
const result = {
  at: new Date().toISOString(),
  target: exe ? "packaged" : "source",
  platform: `${process.platform}-${process.arch}`,
  cpu: os.cpus()[0]?.model,
  ramGb: Math.round(os.totalmem() / 1024 ** 3),
  firstScreenMs,
  memIdleMb,
  openVacanciesMs: vacanciesMs,
  aiExtractMs: aiMs,
  clickLatencyDuringAiMs,
  memAfterMb: memBusyMb,
};
console.log(JSON.stringify(result, null, 2));
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(path.join("artifacts", `perf-${process.platform}-${result.target}.json`), JSON.stringify(result, null, 2));
await app.close();
fs.rmSync(dataDir, { recursive: true, force: true });
