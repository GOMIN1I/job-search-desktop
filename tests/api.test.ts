import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/db";
import { Repo } from "../src/db/repo";
import { createApi, type Platform } from "../src/main/api";
import { rulesRu } from "./helpers";

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-api-"));
  const { db } = openDatabase(path.join(dir, "a.sqlite"));
  const repo = new Repo(db);
  repo.seedDefaults();
  const opened: string[] = [];
  const saveTargets: string[] = [];
  const platform: Platform = {
    dataDir: dir, dbPath: path.join(dir, "a.sqlite"), materialsDir: path.join(dir, "m"), backupDir: path.join(dir, "b"),
    appVersion: "test", platform: process.platform, systemLocale: "ru-RU",
    openFile: async () => null,
    saveFile: async (o) => {
      const p = path.join(dir, o.defaultPath);
      saveTargets.push(p);
      return p;
    },
    openExternal: async (u) => void opened.push(u),
    openPath: async () => "",
    encryptionAvailable: () => true,
    encrypt: (s) => Buffer.from(`enc:${s}`).toString("base64"),
    decrypt: (b) => Buffer.from(b, "base64").toString().replace(/^enc:/, ""),
    printToPdf: async () => Buffer.from("%PDF-1.4 test"),
    startRun: async () => ({ runId: null, error: null }),
    cancelRun: () => false,
    runState: () => ({ running: false, runId: null, progress: null }),
    emit: () => {},
    onScheduleChanged: () => {},
  };
  return { api: createApi(repo, platform), repo, opened, saveTargets, dir };
}

describe("API главного процесса", () => {
  it("валидация входа и понятная ошибка", async () => {
    const { api } = setup();
    const r = await api("candidates.create", { name: "", rules: {} });
    expect(r.ok).toBe(false);
    expect((await api("no.such.method", {})).ok).toBe(false);
  });

  it("онбординг → оценка → сохранение → отклик → черновик письма → экспорт PDF", async () => {
    const { api, repo, saveTargets } = setup();
    const c: any = await api("candidates.create", { name: "Синт", rules: rulesRu(), skills: [{ skill: "Excel", kind: "proven", evidence: "отчёт" }] });
    expect(c.ok).toBe(true);
    const cid = c.data.id;
    await api("demo.load", {});
    // демо-вакансии не видны реальному кандидату
    expect(((await api("vacancies.list", { candidateId: cid })) as any).data).toHaveLength(0);
    const list: any = await api("vacancies.list", { candidateId: "cand-demo" });
    const target = list.data.find((v: any) => v.fit === "suitable");
    expect(target).toBeTruthy();
    expect((await api("applications.setStage", { candidateId: "cand-demo", vacancyId: target.id, stage: "preparing" })).ok).toBe(true);
    const d: any = await api("materials.createDraft", { candidateId: "cand-demo", vacancyId: target.id, kind: "letter", lang: "ru", mode: "template" });
    expect(d.ok).toBe(true);
    expect(d.data.material.content).toContain("Excel"); // подтверждённый навык демо-кандидата
    const exp: any = await api("materials.export", { candidateId: "cand-demo", id: d.data.material.id, format: "pdf" });
    expect(exp.ok).toBe(true);
    expect(fs.readFileSync(saveTargets[0], "utf8")).toContain("%PDF");
    // документ демо-кандидата нельзя прикрепить к отклику другого кандидата
    repo.setStage(cid, target.id, "saved");
    const app2 = repo.getApplication(cid, target.id)!;
    const att: any = await api("applications.update", { id: app2.id, materialVersionIds: [d.data.material.id] });
    expect(att.ok).toBe(false);
    // AI без провайдера — понятная ошибка, а не падение
    const aiR: any = await api("materials.createDraft", { candidateId: "cand-demo", vacancyId: target.id, kind: "letter", lang: "ru", mode: "ai" });
    expect(aiR.ok).toBe(false);
    expect(aiR.code).toBe("no_provider");
  });

  it("внешние ссылки: исключённые пользователем домены и небезопасные схемы не открываются; hh.ru по умолчанию открывается", async () => {
    const { api, opened } = setup();
    expect((await api("vacancies.openExternal", { url: "https://hh.ru/vacancy/1" })).ok).toBe(true);
    expect((await api("excluded.add", { host: "blocked.example" })).ok).toBe(true);
    expect((await api("vacancies.openExternal", { url: "https://blocked.example/vacancy/1" })).ok).toBe(false);
    expect((await api("vacancies.openExternal", { url: "javascript:alert(1)" })).ok).toBe(false);
    expect((await api("vacancies.openExternal", { url: "https://example.com/job/1" })).ok).toBe(true);
    expect(opened).toEqual(["https://hh.ru/vacancy/1", "https://example.com/job/1"]);
  });

  it("интервал источника не опускается ниже официального лимита; исключения добавляет и снимает пользователь", async () => {
    const { api } = setup();
    const r: any = await api("sources.update", { id: "remotive", minIntervalMinutes: 60 });
    expect(r.data.minIntervalMinutes).toBe(360);
    expect(((await api("excluded.list", {})) as any).data).toEqual([]);
    expect((await api("excluded.add", { host: "spam.example" })).ok).toBe(true);
    expect((await api("excluded.remove", { host: "spam.example" })).ok).toBe(true);
  });

  it("ключ AI хранится только зашифрованным и не возвращается в renderer", async () => {
    const { api, repo } = setup();
    await api("ai.update", { provider: "anthropic", model: "claude-opus-5-5", baseUrl: "", monthlyBudgetUsd: 1 });
    await api("ai.setKey", { key: "sk-ant-secret-value-123" });
    const g: any = await api("ai.get", {});
    expect(JSON.stringify(g.data)).not.toContain("sk-ant-secret");
    expect(g.data.settings.keySet).toBe(true);
    expect(String(repo.getMeta("ai_key_enc", ""))).not.toContain("sk-ant-secret");
    expect(JSON.stringify(repo.recentLogs())).not.toContain("sk-ant-secret");
  });

  it("расписание: включение и следующий запуск", async () => {
    const { api } = setup();
    await api("schedule.update", { enabled: true, paused: false, cadence: "weekly", time: "08:30", weekday: 3, runInBackground: true });
    const s: any = await api("schedule.get", {});
    expect(s.data.next).toBeTruthy();
    expect(new Date(s.data.next).getDay()).toBe(3);
    expect(s.data.events[0].kind).toBe("enabled");
  });
});
