// Командная строка для разработчика/администратора: те же функции ядра, что и в приложении.
//   node dist/cli.js run --data <dir> [--sources a,b] [--enable hh] — один поиск по включённым источникам (с лимитами);
//     доступы: JSD_HH_TOKEN, JSD_ADZUNA_APP_ID, JSD_ADZUNA_APP_KEY
//   node dist/cli.js import-profile <file> --data <dir> — импорт профилей кандидатов (JSON)
//   node dist/cli.js import-vacancies <file> --label <l> --data <dir>
//   node dist/cli.js ai-test --base <url> --model <m> [--data <dir>] [--vacancy <id>] — проверка OpenAI-совместимого backend
//   node dist/cli.js summary --data <dir>              — сводка без личных данных
// Папка данных по умолчанию — как у приложения на macOS/Windows.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../db/db";
import { Repo } from "../db/repo";
import { assessAll, refreshFacts, runSearch } from "../pipeline/run";
import { applyProfileImport, applyVacancyImport, previewVacancyImport, readVacancyFile } from "../importexport/importer";
import { OpenAICompatibleTransport } from "../ai/transports";
import { AiService, DEFAULT_AI_SETTINGS, mergeExtraction } from "../ai/service";
import { EXTRACT_JSON_SCHEMA, EXTRACT_SYSTEM, ExtractSchema, extractUserPrompt } from "../ai/prompts";

function defaultDataDir(): string {
  const name = "Job Search Desktop";
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", name);
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), name);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), name);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string, def?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const dataDir = path.resolve(opt("data", defaultDataDir())!);
const open = () => {
  const { db } = openDatabase(path.join(dataDir, "jobsearch.sqlite"), { backupDir: path.join(dataDir, "backups") });
  const repo = new Repo(db);
  repo.seedDefaults();
  return repo;
};

async function main() {
  if (cmd === "run") {
    const repo = open();
    // --enable hh,adzuna — включить источники; --sources a,b — опросить только их; доступы — из переменных окружения
    for (const id of (opt("enable") ?? "").split(",").filter(Boolean)) repo.updateSource(id, { enabled: true });
    const sourceIds = opt("sources")?.split(",").filter(Boolean);
    const credentials = {
      hhToken: process.env.JSD_HH_TOKEN || null,
      adzuna: process.env.JSD_ADZUNA_APP_ID && process.env.JSD_ADZUNA_APP_KEY ? { appId: process.env.JSD_ADZUNA_APP_ID, appKey: process.env.JSD_ADZUNA_APP_KEY } : null,
    };
    const r = await runSearch(repo, "manual", { sourceIds, credentials, onProgress: (p) => p.sourceId && p.status && console.log(`  ${p.sourceId}: ${p.status}`) });
    const attempts = repo.attemptsForRun(r.runId).map((a) => ({ source: a.sourceId, status: a.status, http: a.httpStatus, items: a.items, coverage: a.coverage ? { pages: `${a.coverage.pagesFetched}/${a.coverage.pagesRequested}`, perPage: a.coverage.perPageLimit, exhausted: a.coverage.exhausted } : null, error: a.error }));
    const out = { at: new Date().toISOString(), runId: r.runId, status: r.status, stats: r.stats, attempts };
    console.log(JSON.stringify(out, null, 2));
    const outFile = opt("out");
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === "import-profile") {
    const repo = open();
    const data = JSON.parse(fs.readFileSync(argv[1], "utf8"));
    console.log(applyProfileImport(repo, data, path.join(dataDir, "backups"), (p) => fs.existsSync(p)));
    return;
  }
  if (cmd === "import-vacancies") {
    const repo = open();
    const rows = readVacancyFile(fs.readFileSync(argv[1], "utf8"), argv[1]);
    const label = opt("label", path.basename(argv[1]).replace(/\.[^.]+$/, ""))!;
    const pv = previewVacancyImport(repo, rows, label);
    console.log("preview", pv.counts);
    if (argv.includes("--dry")) return;
    console.log(applyVacancyImport(repo, rows, label, path.join(dataDir, "backups")));
    return;
  }
  if (cmd === "ai-test") {
    const base = opt("base", "http://localhost:11434/v1")!;
    const model = opt("model", "gemma4:e2b")!;
    const t = new OpenAICompatibleTransport(base, null, model);
    console.log("connection:", await t.test());
    const repo = open();
    const vid = opt("vacancy") ?? repo.allActiveVacancies().find((v) => v.postingKind === "job_posting" && v.description.length > 400)?.id;
    if (!vid) return console.log("no vacancy to analyze");
    const v = repo.getVacancy(vid)!;
    const svc = new AiService(repo, () => ({ ...DEFAULT_AI_SETTINGS, provider: "openai_compatible", model, baseUrl: base }), () => t);
    const started = Date.now();
    const r = await svc.extractRequirements(v);
    console.log(JSON.stringify({ vacancy: `${v.title} — ${v.company}`, seconds: (Date.now() - started) / 1000, cached: r.cached, model: r.model, summary: r.summary, dropped: r.dropped, required: r.result.required_skills.map((s) => s.skill), languages: r.result.languages, phone: r.result.phone_work }, null, 2));
    return;
  }
  if (cmd === "reassess") {
    const repo = open();
    const refreshed = refreshFacts(repo);
    const changed = assessAll(repo);
    const fits: Record<string, Record<string, number>> = {};
    for (const c of repo.listCandidates()) {
      fits[c.id] = {};
      for (const v of repo.listVacanciesForCandidate(c.id)) fits[c.id][v.fit ?? "none"] = (fits[c.id][v.fit ?? "none"] ?? 0) + 1;
    }
    console.log(JSON.stringify({ refreshed, reassessed: changed.length, fits }, null, 2));
    return;
  }
  if (cmd === "ai-bench") {
    // Сравнение локальных моделей на нашей задаче: валидность ответа, время, отброшенные цитаты.
    const repo = open();
    const models = (opt("models", "gemma4:e2b,gemma4:e4b") as string).split(",");
    const n = Number(opt("n", "5"));
    const vs = repo.allActiveVacancies().filter((v) => v.postingKind === "job_posting" && v.description.length > 800 && !v.isDemo).slice(0, n);
    const report: Record<string, unknown>[] = [];
    for (const model of models) {
      const t = new OpenAICompatibleTransport(opt("base", "http://localhost:11434/v1")!, null, model);
      let valid = 0, seconds = 0, dropped = 0, items = 0, summaryLangOk = 0;
      for (const v of vs) {
        const started = Date.now();
        try {
          const r = await t.complete({ system: EXTRACT_SYSTEM, user: extractUserPrompt(v), schema: EXTRACT_JSON_SCHEMA as any, maxTokens: 3000 });
          const parsed = ExtractSchema.safeParse(JSON.parse(r.text.replace(/^```(?:json)?|```$/g, "").trim()));
          if (parsed.success) {
            valid++;
            const merged = mergeExtraction(v, parsed.data, model);
            dropped += merged.dropped.length;
            items += parsed.data.required_skills.length + parsed.data.preferred_skills.length + parsed.data.languages.length + parsed.data.hiring_locations.length;
            if (/[а-яё]/i.test(parsed.data.summary_ru)) summaryLangOk++;
          }
        } catch {
          /* считается невалидным ответом */
        }
        seconds += (Date.now() - started) / 1000;
      }
      const row = { model, vacancies: vs.length, validJson: valid, avgSeconds: +(seconds / Math.max(1, vs.length)).toFixed(1), droppedQuotes: dropped, extractedItems: items, russianSummary: summaryLangOk };
      console.log(JSON.stringify(row));
      report.push(row);
    }
    const outFile = opt("out");
    if (outFile) fs.writeFileSync(outFile, JSON.stringify({ at: new Date().toISOString(), host: { ramGb: Math.round(os.totalmem() / 1024 ** 3), arch: process.arch }, report }, null, 2));
    return;
  }
  if (cmd === "ollama-selftest") {
    // Реальная проверка интеграции на маленькой модели: загрузка → обрыв → продолжение → список → удаление.
    const { OllamaManager } = await import("../main/ollama");
    const model = opt("model", "smollm2:135m")!;
    const log: string[] = [];
    let cancelAt = Number(opt("cancel-at", "0.35"));
    const mgr: any = new OllamaManager({
      downloadsDir: path.join(os.tmpdir(), "jsd-selftest"),
      emit: (p) => {
        if (p.total && p.completed !== undefined) {
          const frac = p.completed / p.total;
          if (cancelAt > 0 && frac >= cancelAt) {
            log.push(`cancel at ${(frac * 100).toFixed(0)}%`);
            cancelAt = 0;
            mgr.cancel(model);
          }
        }
        if (p.phase !== "pull") log.push(`${p.phase}${p.total ? ` ${p.completed}/${p.total}` : ""}`);
      },
    });
    const st0 = await mgr.status();
    log.push(`engine ${st0.state} ${st0.version}`);
    try {
      await mgr.pull(model, { allowAny: true });
    } catch (e) {
      log.push(`first pull stopped: ${(e as Error).message}`);
    }
    const started = Date.now();
    await mgr.pull(model, { allowAny: true });
    log.push(`resumed and finished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const st1 = await mgr.status();
    log.push(`listed after pull: ${st1.models.some((m: { name: string }) => m.name.startsWith(model))}`);
    await mgr.remove(model);
    const st2 = await mgr.status();
    log.push(`listed after remove: ${st2.models.some((m: { name: string }) => m.name.startsWith(model))}`);
    console.log(log.join("\n"));
    return;
  }
  if (cmd === "summary") {
    const repo = open();
    console.log(JSON.stringify({ counts: repo.counts(), runs: repo.listRuns(3).map((r) => ({ at: r.startedAt, status: r.status, stats: r.stats })) }, null, 2));
    return;
  }
  console.log("commands: run | import-profile <file> | import-vacancies <file> | ai-test | summary   [--data <dir>]");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
