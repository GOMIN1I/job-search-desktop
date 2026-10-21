import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activeDirectives, checkInstructions, effectiveRules, findConflicts, parseInstructions, postingLanguage, unresolvedConflicts } from "../src/core/instructions";
import { assess } from "../src/core/assess";
import { openDatabase } from "../src/db/db";
import { Repo } from "../src/db/repo";
import { runSearch } from "../src/pipeline/run";
import { normalizeInstructions } from "../src/main/api";
import { rulesRu, vac } from "./helpers";
import { fakeFetcher } from "./fakeSources";
import type { SearchRules } from "../src/shared/types";

const withText = (text: string, base: SearchRules = rulesRu(), resolutions: Record<string, "instruction" | "settings"> = {}): SearchRules => ({
  ...base,
  aiInstructions: { text, parsed: parseInstructions(text), parsedBy: "rules", parsedAt: null, parsedFor: text, resolutions },
});

describe("дополнительные инструкции для ИИ: разбор", () => {
  it("«Не используй hh.ru и связанные сервисы» исключает всё семейство HeadHunter", () => {
    const d = parseInstructions("Не используй hh.ru и связанные сервисы");
    expect(d.excludeSources).toContain("hh");
    expect(d.excludeHosts).toEqual(expect.arrayContaining(["hh.ru", "hh.kz", "rabota.by"]));
    expect(d.notes).toEqual([]);
  });
  it("страны в любом падеже, языки, формат, слова-исключения (русский)", () => {
    const d = parseInstructions("Рассматривай вакансии из Германии и Польши. Вакансии на английском языке. Только удалённая работа. Без продаж и холодных звонков.");
    expect(d.countries).toEqual(expect.arrayContaining(["DE", "PL"]));
    expect(d.postingLanguages).toEqual(["en"]);
    expect(d.workFormats).toEqual(["remote"]);
    expect(d.excludeKeywords).toEqual(expect.arrayContaining(["продаж", "холодных звонков"]));
  });
  it("английский текст и обязательные слова; непонятое остаётся заметкой для ИИ", () => {
    const d = parseInstructions('Don\'t use LinkedIn. Jobs must mention "data labeling". I prefer small friendly teams');
    expect(d.excludeHosts).toContain("linkedin.com");
    expect(d.requireKeywords).toEqual(["data labeling"]);
    expect(d.notes).toEqual(["I prefer small friendly teams"]);
  });
  it("язык объявления определяется по тексту", () => {
    expect(postingLanguage({ title: "Аналитик", description: "Мы ищем аналитика данных для работы с таблицами и отчётами в нашей команде." })).toBe("ru");
    expect(postingLanguage({ title: "Analyst", description: "We are looking for an analyst to join our team and work with the data for our clients." })).toBe("en");
  });
});

describe("инструкции применяются и решаются человеком", () => {
  it("вакансия с исключённой площадки — жёсткий отказ с причиной", () => {
    const rules = withText("не используй hh.ru");
    const v = vac({ title: "Junior Data Annotator", description: "Remote. Entry level. Label images.", url: "https://hh.ru/vacancy/1", sourceId: "hh" });
    const a = assess({ rules, profileVersion: 1, skills: [], vacancy: v, candidateId: "c" });
    const dim = a.dimensions.find((d) => d.key === "instructions")!;
    expect(dim).toMatchObject({ status: "fail", constraint: "hard" });
    expect(a.fit).toBe("unsuitable");
  });
  it("слово, которого просили избегать, найдено в тексте", () => {
    const d = activeDirectives(withText("Без продаж"))!;
    expect(checkInstructions(d, vac({ title: "Chat Support", description: "Answer chats. Some sales of upgrades." })).status).toBe("pass"); // «sales» ≠ «продаж»
    expect(checkInstructions(d, vac({ title: "Поддержка", description: "Ответы в чате и продажи доп. услуг, продаж много." })).status).toBe("fail");
  });
  it("противоречие формата: показывается, без решения профиль не сохраняется молча", () => {
    const base = rulesRu();
    const rules = withText("Только офис", base);
    expect(findConflicts(rules, rules.aiInstructions!.parsed!).map((c) => c.id)).toContain("format");
    expect(unresolvedConflicts(rules)).toHaveLength(1);
    // Человек выбрал инструкцию → настройка формата меняется
    const chosen = withText("Только офис", base, { format: "instruction" });
    expect(unresolvedConflicts(chosen)).toHaveLength(0);
    expect(effectiveRules(chosen).workFormat).toMatchObject({ office: true, remote: false, mode: "hard" });
    // Человек выбрал настройки → формат профиля остаётся
    expect(effectiveRules(withText("Только офис", base, { format: "settings" })).workFormat.remote).toBe(true);
  });
  it("сохранение: пустой текст очищает инструкции, изменённый текст пересобирается", () => {
    const r1 = normalizeInstructions({ ...rulesRu(), aiInstructions: { text: "  ", parsed: null, parsedBy: null, parsedAt: null, resolutions: {} } });
    expect(r1.aiInstructions).toBeUndefined();
    const stale = withText("не используй hh.ru");
    const r2 = normalizeInstructions({ ...stale, aiInstructions: { ...stale.aiInstructions!, text: "не используй linkedin" } });
    expect(r2.aiInstructions!.parsed!.excludeHosts).toContain("linkedin.com");
    expect(r2.aiInstructions!.parsed!.excludeSources).not.toContain("hh");
  });
  it("площадку, исключённую всеми профилями, поиск не опрашивает; без инструкции — опрашивает", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-instr-"));
    const { db } = openDatabase(path.join(dir, "app.sqlite"));
    const repo = new Repo(db);
    repo.seedDefaults();
    repo.updateSource("hh", { enabled: true });
    repo.createCandidate({ id: "c1", name: "A", rules: withText("Не используй hh.ru и связанные сервисы") });
    const calls: string[] = [];
    const r = await runSearch(repo, "manual", { fetcher: fakeFetcher({}, calls) as any, pauseMs: 0, credentials: { hhToken: "tok" } });
    expect(repo.attemptsForRun(r.runId).find((x) => x.sourceId === "hh")!.status).toBe("excluded");
    expect(calls.some((u) => u.includes("api.hh.ru"))).toBe(false);
    // Другой человек без такой инструкции — hh.ru опрашивается
    repo.createCandidate({ id: "c2", name: "B", rules: rulesRu() });
    repo.updateSource("hh", { enabled: true });
    repo.db.prepare("UPDATE sources SET next_allowed_at=NULL").run();
    const calls2: string[] = [];
    const r2 = await runSearch(repo, "manual", { fetcher: fakeFetcher({}, calls2) as any, pauseMs: 0, credentials: { hhToken: "tok" } });
    expect(repo.attemptsForRun(r2.runId).find((x) => x.sourceId === "hh")!.status).toBe("success");
    // …но для человека с инструкцией вакансия hh.ru — «не подходит»
    const hhVac = repo.listVacanciesForCandidate("c1").find((v) => v.canonicalUrl.includes("hh.ru"));
    expect(hhVac?.fit).toBe("unsuitable");
    const id2 = repo.listVacanciesForCandidate("c2").find((v) => v.canonicalUrl.includes("hh.ru"))!.id;
    expect(repo.currentAssessment("c2", id2)!.dimensions.some((d) => d.key === "instructions")).toBe(false);
    expect(repo.currentAssessment("c1", hhVac!.id)!.dimensions.find((d) => d.key === "instructions")!.status).toBe("fail");
    db.close();
  });
});
