// Фоновый поток сбора: сеть и обработка не блокируют главный процесс и интерфейс.
import { parentPort, workerData } from "node:worker_threads";
import { openDatabase } from "../db/db";
import { Repo } from "../db/repo";
import { runSearch } from "../pipeline/run";
import type { RunTrigger } from "../shared/types";

const { dbPath, trigger, sourceIds } = workerData as { dbPath: string; trigger: RunTrigger; sourceIds?: string[] };
const ac = new AbortController();
parentPort?.on("message", (m) => {
  if (m?.type === "cancel") ac.abort();
});

(async () => {
  const { db } = openDatabase(dbPath);
  const repo = new Repo(db);
  try {
    const r = await runSearch(repo, trigger, {
      signal: ac.signal,
      sourceIds,
      onProgress: (p) => parentPort?.postMessage({ type: "progress", ...p }),
    });
    parentPort?.postMessage({ type: "done", ...r });
  } catch (e) {
    const err = e as Error & { runId?: string };
    parentPort?.postMessage({ type: "error", message: err.message, alreadyRunning: err.name === "AlreadyRunningError" || /уже выполняется/.test(err.message), runId: err.runId ?? null });
  } finally {
    db.close();
  }
})();
