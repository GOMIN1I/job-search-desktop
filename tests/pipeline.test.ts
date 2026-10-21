import { describe, expect, it, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, MIGRATIONS } from "../src/db/db";
import { Repo } from "../src/db/repo";
import { runSearch, AlreadyRunningError, assessAll } from "../src/pipeline/run";
import { applyBackup, applyVacancyImport, exportBackup, previewVacancyImport, readVacancyFile, previewBackup, applyProfileImport, PROFILE_FORMAT } from "../src/importexport/importer";
import { loadDemo, DEMO_CANDIDATE_ID } from "../src/demo/demo";
import { parseHabr, parseRemoteOk, parseHimalayas, parseWwr, repairMojibake } from "../src/sources/adapters";
import { fakeFetcher, FIX } from "./fakeSources";
import { rulesRu } from "./helpers";

const created: string[] = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-test-"));
  created.push(d);
  return d;
}
afterAll(() => {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

function freshRepo(dir = tmpDir()) {
  const { db } = openDatabase(path.join(dir, "app.sqlite"));
  const repo = new Repo(db);
  repo.seedDefaults();
  return { repo, dir, db };
}

describe("парсеры источников", () => {
  it("Remote OK: двойная кодировка исправляется, legal-элемент пропускается", () => {
    const items = parseRemoteOk(FIX.remoteok);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Back Office Assistant — Remote");
    expect(repairMojibake("plain text")).toBe("plain text");
  });
  it("Habr: зарплата, город, удалёнка и уровень", () => {
    const [h] = parseHabr(FIX.habr);
    expect(h.title).toBe("Младший бизнес-аналитик");
    expect(h.salary).toMatchObject({ min: 40000, max: 60000, currency: "RUB" });
    expect(h.location).toContain("Самара (Россия)");
    expect(h.location).toContain("Можно удалённо");
    expect(h.levelText).toBe("junior");
  });
  it("Himalayas: applicationLink для отклика, guid как канон", () => {
    const p = parseHimalayas(FIX.himalayas);
    expect(p.items[0].url).toBe("https://himalayas.app/companies/rater-synth/jobs/ai-response-evaluator");
    expect(p.items[0].applyUrl).toContain("utm_source");
    expect(p.items[0].location).toBe("Armenia, Kazakhstan");
  });
  it("WWR: компания и название из заголовка, HTML описание экранировано", () => {
    const [w] = parseWwr(FIX.wwr);
    expect([w.company, w.title]).toEqual(["Synth Docs", "Documentation Assistant"]);
    expect(w.description).toBe("Maintain documents in Word and Excel.");
  });
});

describe("поиск и база", () => {
  let repo: Repo;
  let dir: string;
  beforeEach(() => {
    ({ repo, dir } = freshRepo());
    repo.createCandidate({ id: "c-ru", name: "Synthetic RU", rules: rulesRu() });
  });

  it("частичный итог при сбое источника, политика hh.ru, дубли между источниками", async () => {
    const r = await runSearch(repo, "manual", { fetcher: fakeFetcher({ workingnomads: "500", remoteok: "429" }) as any, pauseMs: 0 });
    expect(r.status).toBe("partial");
    const attempts = repo.attemptsForRun(r.runId);
    const st = Object.fromEntries(attempts.map((a) => [a.sourceId, a.status]));
    expect(st.workingnomads).toBe("failed");
    expect(st.remoteok).toBe("blocked");
    expect(st.ats).toBe("not_configured");
    expect(st.jobicy).toBe("success");
    expect(r.stats.policyBlocked).toBe(1);
    expect(r.stats.mergedFallback).toBe(1); // Jobicy и Remotive — одна вакансия
    const list = repo.listVacanciesForCandidate("c-ru");
    expect(list.some((v) => /hh\.ru|Mirror job/.test(v.title + v.canonicalUrl))).toBe(false);
    const annot = list.filter((v) => v.title === "Junior Data Annotator");
    expect(annot).toHaveLength(1);
    expect(annot[0].sourceCount).toBe(2);
    // У каждого источника — покрытие
    expect(attempts.find((a) => a.sourceId === "himalayas")!.coverage).toMatchObject({ perPageLimit: 20 });
  });

  it("повторная команда не опрашивает источники второй раз (not_due), повторов нет", async () => {
    const calls: string[] = [];
    await runSearch(repo, "manual", { fetcher: fakeFetcher({}, calls) as any, pauseMs: 0 });
    const n1 = calls.length;
    const before = repo.counts().vacancies;
    const r2 = await runSearch(repo, "manual", { fetcher: fakeFetcher({}, calls) as any, pauseMs: 0 });
    expect(calls.length).toBe(n1);
    expect(r2.stats.sourcesNotDue).toBeGreaterThanOrEqual(7);
    expect(r2.stats.newVacancies).toBe(0);
    expect(repo.counts().vacancies).toBe(before);
  });

  it("повторный сбор того же источника: unchanged, изменение текста: changed с историей", async () => {
    const t0 = new Date("2026-10-21T08:00:00Z");
    await runSearch(repo, "manual", { fetcher: fakeFetcher() as any, now: () => t0, pauseMs: 0 });
    const later = new Date("2026-10-22T09:00:00Z");
    const changed = JSON.parse(JSON.stringify(FIX.jobicy));
    changed.jobs[0].jobDescription += "<p>Now 30 guaranteed hours per week.</p>";
    const fetcher = async (url: string) => (url.includes("jobicy") ? new Response(JSON.stringify(changed)) : (fakeFetcher() as any)(url));
    const r = await runSearch(repo, "scheduled", { fetcher: fetcher as any, now: () => later, pauseMs: 0 });
    expect(r.stats.changedVacancies).toBe(1);
    expect(r.stats.newVacancies).toBe(0);
  });

  it("одиночный запуск: второй параллельный запуск отклоняется", async () => {
    const slow = async (url: string) => {
      await new Promise((r) => setTimeout(r, 50));
      return (fakeFetcher() as any)(url);
    };
    const p1 = runSearch(repo, "manual", { fetcher: slow as any, pauseMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    await expect(runSearch(repo, "manual", { fetcher: slow as any })).rejects.toBeInstanceOf(AlreadyRunningError);
    await p1;
  });

  it("отмена: прогон помечается cancelled, оставшиеся источники не опрашиваются", async () => {
    const ac = new AbortController();
    const calls: string[] = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.includes("remotive")) ac.abort();
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return (fakeFetcher() as any)(url);
    };
    const r = await runSearch(repo, "manual", { fetcher: f as any, signal: ac.signal, pauseMs: 0 });
    expect(r.status).toBe("cancelled");
    expect(calls.some((u) => u.includes("habr"))).toBe(false);
  });

  it("offline: прогон failed, уведомление о сбое, а не «0 вакансий»", async () => {
    const r = await runSearch(repo, "manual", { fetcher: fakeFetcher({ jobicy: "throw", remotive: "throw", himalayas: "throw", remoteok: "throw", workingnomads: "throw", weworkremotely: "throw", habrcareer: "throw" }) as any, pauseMs: 0 });
    expect(r.status).toBe("failed");
    expect(r.stats.sourcesFailed).toBe(7);
    expect(repo.listNotifications("c-ru").some((n) => n.kind === "run_failed")).toBe(true);
  });

  it("нулевые результаты при рабочих источниках — succeeded, 0 новых; пустая база не падает", async () => {
    expect(repo.listVacanciesForCandidate("c-ru")).toEqual([]);
    const r = await runSearch(repo, "manual", { fetcher: fakeFetcher({ jobicy: "empty", remotive: "empty", himalayas: "empty", remoteok: "empty", workingnomads: "empty", weworkremotely: "empty", habrcareer: "empty" }) as any, pauseMs: 0 });
    expect(r.status).toBe("succeeded");
    expect(r.stats.newVacancies).toBe(0);
  });

  it("невалидный JSON источника — failed для этого источника", async () => {
    const r = await runSearch(repo, "manual", { fetcher: fakeFetcher({ jobicy: "badjson" }) as any, pauseMs: 0 });
    expect(repo.attemptsForRun(r.runId).find((a) => a.sourceId === "jobicy")!.status).toBe("failed");
  });

  it("изменение профиля пересчитывает оценку, история сохраняется", async () => {
    await runSearch(repo, "manual", { fetcher: fakeFetcher() as any, pauseMs: 0 });
    const v = repo.listVacanciesForCandidate("c-ru").find((x) => x.title === "Младший бизнес-аналитик")!;
    const a1 = repo.currentAssessment("c-ru", v.id)!;
    const rules = rulesRu({ pay: { mode: "hard", minimums: [{ currency: "RUB", amountMonthly: 100000 }] } });
    const ver = repo.saveRules("c-ru", rules, "выше минимум");
    expect(ver).toBe(2);
    assessAll(repo, { candidateIds: ["c-ru"] });
    const a2 = repo.currentAssessment("c-ru", v.id)!;
    expect(a2.id).not.toBe(a1.id);
    expect(a2.profileVersion).toBe(2);
    expect(a2.dimensions.find((d) => d.key === "pay")!.status).toBe("fail");
    const hist = repo.assessmentHistory("c-ru", v.id);
    expect(hist.length).toBe(2);
    expect(hist.find((h) => h.id === a1.id)!.supersededAt).not.toBeNull();
    expect(repo.profileHistory("c-ru").map((p) => p.version)).toEqual([2, 1]);
  });

  it("сохранность после перезапуска", async () => {
    await runSearch(repo, "manual", { fetcher: fakeFetcher() as any, pauseMs: 0 });
    const n = repo.counts().vacancies;
    const v = repo.listVacanciesForCandidate("c-ru")[0];
    repo.setStage("c-ru", v.id, "saved", "test");
    repo.db.close();
    const { repo: again } = freshRepo(dir);
    expect(again.counts().vacancies).toBe(n);
    expect(again.getApplication("c-ru", v.id)!.stage).toBe("saved");
  });

  it("документы не переносятся между кандидатами", () => {
    repo.createCandidate({ id: "c-2", name: "Other", rules: rulesRu() });
    const mv = repo.createMaterialVersion({ candidateId: "c-ru", kind: "cv", title: "CV", status: "draft", origin: "manual", content: "x" });
    expect(() => repo.createMaterialVersion({ materialId: mv.materialId, candidateId: "c-2", kind: "cv", title: "CV", status: "draft", origin: "manual", content: "y" })).toThrow();
    repo.db.prepare("INSERT INTO vacancies(id,title,company,canonical_url,source_url,source_id,fallback_key,first_seen_at,last_seen_at,content_hash,facts_json) VALUES('v1','t','c','https://e.x/1','https://e.x/1','x','k','2026','2026','h','{}')").run();
    const app = repo.setStage("c-2", "v1", "preparing");
    expect(() => repo.updateApplication(app.id, { materialVersionIds: [mv.id] })).toThrow(/другому кандидату|another candidate/);
    expect(repo.listMaterialVersions("c-2")).toHaveLength(0);
  });

  it("демо изолировано от реального кандидата и загружается идемпотентно", () => {
    loadDemo(repo, "ru");
    const second = loadDemo(repo, "ru");
    expect(second.created).toBe(0);
    expect(repo.listVacanciesForCandidate("c-ru")).toHaveLength(0);
    const demo = repo.listVacanciesForCandidate(DEMO_CANDIDATE_ID);
    expect(demo.length).toBeGreaterThan(8);
    expect(demo.every((v) => v.isDemo)).toBe(true);
    const fits = new Set(demo.map((d) => d.fit));
    expect(fits.has("suitable")).toBe(true);
    expect(fits.has("needs_check")).toBe(true);
    expect(fits.has("unsuitable")).toBe(true);
  });
});

describe("импорт, откат, миграции", () => {
  it("импорт вакансий: предпросмотр, блокировка hh.ru, дубли, идемпотентность", () => {
    const { repo, dir } = freshRepo();
    repo.createCandidate({ id: "c1", name: "A", rules: rulesRu() });
    const csv = [
      "Вакансия,Компания,Ссылка,Дата проверки,Заметки",
      `"Junior BA","Синт, ООО",https://example.org/jobs/1,2026-10-20,"Строка с ""кавычками""\nи переносом"`,
      `Junior BA,"Синт, ООО",https://example.org/jobs/1?utm_source=x,2026-10-20,дубль`,
      `Запрещено,X,https://samara.hh.ru/vacancy/9,2026-10-20,`,
      `,Без названия,https://example.org/jobs/3,,`,
      `Old role,Y,https://example.org/jobs/4,2026-01-10,старое`,
    ].join("\r\n");
    const rows = readVacancyFile(csv, "notion.csv");
    const pv = previewVacancyImport(repo, rows, "notion", new Date("2026-10-21"));
    expect(pv.counts).toMatchObject({ ok: 1, duplicate_in_file: 1, blocked: 1, invalid: 1, stale: 1 });
    const r1 = applyVacancyImport(repo, rows, "notion", path.join(dir, "b"), new Date("2026-10-21"));
    expect(r1.inserted).toBe(2);
    expect(fs.existsSync(r1.backupPath)).toBe(true);
    const r2 = applyVacancyImport(repo, rows, "notion", path.join(dir, "b"), new Date("2026-10-21"));
    expect(r2.inserted).toBe(0);
    expect(repo.counts().vacancies).toBe(2);
    expect(repo.listVacanciesForCandidate("c1").every((v) => v.lifecycle === "unchecked")).toBe(true);
  });

  it("резервная копия JSON: экспорт → импорт в новую базу; повтор идемпотентен; ошибка откатывает всё", () => {
    const a = freshRepo();
    a.repo.createCandidate({ id: "c1", name: "A", rules: rulesRu() });
    loadDemo(a.repo, "en");
    const data = exportBackup(a.repo);
    const b = freshRepo();
    expect(previewBackup(b.repo, data).tables.vacancies.new).toBeGreaterThan(0);
    const r1 = applyBackup(b.repo, data, path.join(b.dir, "bk"));
    expect(r1.inserted).toBeGreaterThan(0);
    expect(applyBackup(b.repo, data, path.join(b.dir, "bk")).inserted).toBe(0);
    expect(b.repo.counts().vacancies).toBe(a.repo.counts().vacancies);
    // Ошибка посреди импорта: NOT NULL нарушен → ничего не вставлено
    const c = freshRepo();
    const bad = JSON.parse(JSON.stringify(data));
    bad.tables.vacancies.push({ id: "broken", title: null });
    expect(() => applyBackup(c.repo, bad, path.join(c.dir, "bk"))).toThrow();
    expect(c.repo.counts().candidates).toBe(0);
    expect(c.repo.counts().vacancies).toBe(0);
  });

  it("миграция: резервная копия перед миграцией, неудачная миграция откатывается", () => {
    const dir = tmpDir();
    const file = path.join(dir, "m.sqlite");
    openDatabase(file).db.close();
    const ok = openDatabase(file, { migrations: [...MIGRATIONS, { version: 2, name: "add col", sql: "ALTER TABLE candidates ADD COLUMN extra TEXT;" }] });
    expect(ok.backupPath && fs.existsSync(ok.backupPath)).toBeTruthy();
    ok.db.close();
    expect(() => openDatabase(file, { migrations: [...MIGRATIONS, { version: 2, name: "add col", sql: "ALTER TABLE candidates ADD COLUMN extra TEXT;" }, { version: 3, name: "broken", sql: "ALTER TABLE nope ADD COLUMN x TEXT;" }] })).toThrow(/Миграция 3/);
    const again = openDatabase(file, { migrations: [...MIGRATIONS, { version: 2, name: "add col", sql: "ALTER TABLE candidates ADD COLUMN extra TEXT;" }] });
    expect(again.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()).toMatchObject({ value: "2" });
  });

  it("импорт профиля: создаёт кандидата, повтор не дублирует", () => {
    const { repo, dir } = freshRepo();
    const file = { format: PROFILE_FORMAT, version: 1 as const, candidates: [{ id: "c-x", name: "X", rules: rulesRu(), skills: [{ skill: "Excel", kind: "self_reported" as const }], materials: [{ kind: "cv" as const, title: "CV RU", filePath: "/nope/cv.pdf" }] }] };
    applyProfileImport(repo, file, path.join(dir, "b"));
    applyProfileImport(repo, file, path.join(dir, "b"));
    expect(repo.listCandidates()).toHaveLength(1);
    expect(repo.listSkills("c-x")).toHaveLength(1);
    const m = repo.listMaterialVersions("c-x");
    expect(m).toHaveLength(1);
    expect(m[0].fileAvailable).toBe(false); // «Ready» без файла не выдаётся за готовый документ
  });
});
