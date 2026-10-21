import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/db";
import { Repo } from "../src/db/repo";
import { AiError, AnthropicTransport, OpenAICompatibleTransport, TestTransport } from "../src/ai/transports";
import { AiService, DEFAULT_AI_SETTINGS, mergeExtraction } from "../src/ai/service";
import type { AiSettings } from "../src/shared/types";
import { msg } from "../src/shared/types";
import { vac } from "./helpers";

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-ai-"));
  const { db } = openDatabase(path.join(dir, "a.sqlite"));
  const r = new Repo(db);
  r.seedDefaults();
  return r;
}

const v = vac({
  title: "Junior Data Annotator",
  description: "Entry level. Label images with clear guidelines. Requirements: Excel. Nice to have: Python. Candidates must be located in Kazakhstan. Shift 10:00-18:00 MSK. English B2 written.",
  location: "Remote",
});

const good = {
  summary_ru: "Разметка изображений по инструкции.", summary_en: "Image labeling by guidelines.",
  seniority: "junior", seniority_quote: "Entry level",
  required_skills: [{ skill: "Excel", quote: "Requirements: Excel" }], preferred_skills: [{ skill: "Python", quote: "Nice to have: Python" }],
  languages: [{ lang: "en", level: "B2", required: true, spoken: false, quote: "English B2 written" }],
  phone_work: "unknown", phone_quote: null, hours_start: "10:00", hours_end: "18:00", hours_timezone: "MSK", weekly_hours_min: null, weekly_hours_max: null, hours_quote: "Shift 10:00-18:00 MSK",
  hiring_locations: [{ place: "Kazakhstan", quote: "Candidates must be located in Kazakhstan" }, { place: "Russia", quote: "We also hire in Russia" }],
  excluded_locations: [], ai_prohibited: false, ai_quote: null,
};

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({ ...DEFAULT_AI_SETTINGS, provider: "openai_compatible", model: "test-model", pricing: { "test-model": { inputPerMTok: 1, outputPerMTok: 2 } }, ...over });

describe("AI-сервис", () => {
  it("валидный ответ кэшируется по hash объявления+модели+промпта; повтор не вызывает провайдера", async () => {
    const r = repo();
    r.insertVacancy(v);
    const t = new TestTransport("test-model", [{ text: JSON.stringify(good), tokensIn: 1000, tokensOut: 300, model: "test-model" }]);
    const ai = new AiService(r, () => settings(), () => t);
    const a = await ai.extractRequirements(v);
    expect(a.cached).toBe(false);
    expect(a.costUsd).toBeCloseTo((1000 * 1 + 300 * 2) / 1e6);
    const b = await ai.extractRequirements(v);
    expect(b.cached).toBe(true);
    expect(t.calls.length).toBe(1);
  });

  it("выдуманная цитата отбрасывается; AI не перезаписывает факты, найденные правилами", () => {
    const v2 = vac({ title: "Junior Data Annotator", description: "Entry level. Label images with clear guidelines. Our team welcomes people from Kazakhstan. English B2 written.", location: "Remote" });
    expect(v2.facts.geography.status).toBe("unknown");
    const x = { ...good, hiring_locations: [{ place: "Kazakhstan", quote: "Our team welcomes people from Kazakhstan" }, { place: "Russia", quote: "We also hire in Russia" }] };
    const m2 = mergeExtraction(v2, x as any, "test@p");
    expect(m2.dropped).toContain("location:Russia");
    expect(m2.facts.geography.value.allowed).toEqual(["KZ"]);
    expect(m2.facts.geography.status).toBe("ai_stated");
    const { facts } = mergeExtraction(v, good as any, "test@p");
    expect(facts.languages.status).toBe("stated"); // правила уже нашли язык — AI не заменяет
  });

  it("невалидный JSON — ошибка invalid_response, данные не изменяются, вызов записан", async () => {
    const r = repo();
    r.insertVacancy(v);
    const before = JSON.stringify(r.getVacancy(v.id)!.facts);
    const ai = new AiService(r, () => settings(), () => new TestTransport("test-model", [{ text: "{not json", tokensIn: 10, tokensOut: 5, model: "test-model" }, { text: "{still not json", tokensIn: 10, tokensOut: 5, model: "test-model" }]));
    await expect(ai.extractRequirements(v)).rejects.toMatchObject({ code: "invalid_response" });
    expect(JSON.stringify(r.getVacancy(v.id)!.facts)).toBe(before);
    expect(r.aiRecentCalls(5)[0].status).toBe("invalid");
  });

  it("одна повторная попытка: второй ответ валиден — результат принят", async () => {
    const r = repo();
    const t = new TestTransport("test-model", [{ text: "oops", tokensIn: 1, tokensOut: 1, model: "test-model" }, { text: JSON.stringify(good), tokensIn: 1, tokensOut: 1, model: "test-model" }]);
    const ai = new AiService(r, () => settings(), () => t);
    const res = await ai.extractRequirements(v);
    expect(res.result.seniority).toBe("junior");
    expect(t.calls.length).toBe(2);
  });

  it("ответ не по схеме — invalid_response", async () => {
    const r = repo();
    const ai = new AiService(r, () => settings(), () => new TestTransport("test-model", [{ text: JSON.stringify({ ...good, seniority: "god-tier" }), tokensIn: 1, tokensOut: 1, model: "test-model" }, { text: JSON.stringify({ ...good, seniority: "god-tier" }), tokensIn: 1, tokensOut: 1, model: "test-model" }]));
    await expect(ai.extractRequirements(v)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("429 провайдера — rate_limited, без потери данных", async () => {
    const r = repo();
    const ai = new AiService(r, () => settings(), () => new TestTransport("test-model", [new AiError("rate_limited", msg("429", "429"), 1000)]));
    await expect(ai.extractRequirements(v)).rejects.toMatchObject({ code: "rate_limited" });
    expect(r.aiRecentCalls(5)[0].status).toBe("error");
  });

  it("бюджет: вызов, превышающий месячный лимит, не выполняется", async () => {
    const r = repo();
    const t = new TestTransport("test-model", []);
    const ai = new AiService(r, () => settings({ monthlyBudgetUsd: 0.000001 }), () => t);
    await expect(ai.extractRequirements(v)).rejects.toMatchObject({ code: "budget" });
    expect(t.calls.length).toBe(0);
  });

  it("без провайдера — понятная ошибка no_provider", async () => {
    const ai = new AiService(repo(), () => ({ ...DEFAULT_AI_SETTINGS }), () => null);
    await expect(ai.extractRequirements(v)).rejects.toMatchObject({ code: "no_provider" });
  });

  it("запрет работодателя на AI-ответы блокирует генерацию письма", async () => {
    const r = repo();
    const banned = vac({ title: "Junior Data Annotator", description: "Entry level. Please don't use AI to write your answers — AI-generated applications will be rejected.", location: "Remote" });
    const t = new TestTransport("test-model", []);
    const ai = new AiService(r, () => settings(), () => t);
    await expect(ai.draftLetter({ vacancy: banned, skills: [], lang: "ru", candidateName: "X", profileVersion: 1, candidateId: "c" })).rejects.toMatchObject({ code: "blocked_by_policy" });
    expect(t.calls.length).toBe(0);
  });

  it("письмо со ссылкой на несуществующий факт отклоняется", async () => {
    const r = repo();
    const skills = [{ id: "s1", candidateId: "c", skill: "Excel", kind: "proven" as const, evidence: "отчёт", url: null, createdAt: "", updatedAt: "" }];
    const bad = { text: JSON.stringify({ letter: "Здравствуйте! ".repeat(10), used_fact_ids: ["s1", "invented"], gaps: [] }), tokensIn: 1, tokensOut: 1, model: "test-model" };
    const t = new TestTransport("test-model", [bad, { ...bad }]);
    const ai = new AiService(r, () => settings(), () => t);
    await expect(ai.draftLetter({ vacancy: v, skills, lang: "ru", candidateName: "X", profileVersion: 1, candidateId: "c" })).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("транспорты", () => {
  it("Anthropic: отсутствующий ключ — no_key", () => {
    expect(() => new AnthropicTransport("", "claude-opus-5-5")).toThrow(AiError);
  });
  it("Anthropic: неверный ключ (401) — auth; 429 — rate_limited (через официальный SDK)", async () => {
    const f401 = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
    const t = new AnthropicTransport("sk-ant-test-invalid", "claude-opus-5-5", { fetch: f401 as any });
    await expect(t.complete({ system: "s", user: "u", schema: {}, maxTokens: 10 })).rejects.toMatchObject({ code: "auth" });
    expect((await t.test()).ok).toBe(false);
    const f429 = async () => new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } });
    const t2 = new AnthropicTransport("sk-ant-test", "claude-opus-5-5", { fetch: f429 as any });
    await expect(t2.complete({ system: "s", user: "u", schema: {}, maxTokens: 10 })).rejects.toMatchObject({ code: "rate_limited" });
  });
  it("OpenAI-совместимый: неизвестная модель в /models, 401, сеть недоступна", async () => {
    const models = async () => new Response(JSON.stringify({ data: [{ id: "a" }] }), { status: 200 });
    expect((await new OpenAICompatibleTransport("http://x.local/v1", null, "missing", models as any).test()).ok).toBe(false);
    const unauthorized = async () => new Response("no", { status: 401 });
    await expect(new OpenAICompatibleTransport("http://x.local/v1", "bad", "m", unauthorized as any).complete({ system: "", user: "", schema: {}, maxTokens: 5 })).rejects.toMatchObject({ code: "auth" });
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(new OpenAICompatibleTransport("http://x.local/v1", null, "m", offline as any).complete({ system: "", user: "", schema: {}, maxTokens: 5 })).rejects.toMatchObject({ code: "network" });
  });
});
