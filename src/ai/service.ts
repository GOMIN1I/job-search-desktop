// AI-сервис: кэш по hash(объявление + профиль + версия промпта + модель), бюджет, валидация ответа,
// проверка дословности цитат и слияние только в неизвестные факты. Сбой AI не теряет данные.

import type { AiSettings, Msg, SkillEvidence, Vacancy, VacancyFacts } from "../shared/types";
import { msg } from "../shared/types";
import type { Repo } from "../db/repo";
import { quoteIsInText, sha } from "../core/text";
import { detectPlaces, REGION_NAMES } from "../core/geo";
import { resolveZone } from "../core/timezone";
import { AiError, type AiTransport } from "./transports";
import {
  EXTRACT_JSON_SCHEMA, EXTRACT_PROMPT_VERSION, EXTRACT_SYSTEM, ExtractSchema, extractUserPrompt, LETTER_JSON_SCHEMA, LETTER_PROMPT_VERSION,
  LetterSchema, letterSystem, type ExtractResult, type LetterResult,
} from "./prompts";

export const DEFAULT_PRICING: AiSettings["pricing"] = {
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "none",
  model: "claude-opus-5-5",
  baseUrl: "http://localhost:11434/v1",
  monthlyBudgetUsd: 5,
  keySet: false,
  lastTest: null,
  pricing: DEFAULT_PRICING,
};

export function estimateCost(pricing: AiSettings["pricing"], model: string, tokensIn: number, tokensOut: number): number {
  const p = pricing[model];
  if (!p) return 0;
  return (tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000;
}

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(t);
  } catch {
    throw new AiError("invalid_response", msg("Модель вернула невалидный JSON — данные не изменены", "The model returned invalid JSON — no data changed"));
  }
}

export interface AiRunResult<T> {
  result: T;
  cached: boolean;
  model: string;
  promptVersion: string;
  costUsd: number;
  dropped: string[]; // элементы, отброшенные из-за отсутствующей цитаты
}

export class AiService {
  constructor(private readonly repo: Repo, private readonly settings: () => AiSettings, private readonly transport: () => AiTransport | null) {}

  private guardBudget(model: string, inputChars: number, maxTokens: number) {
    const s = this.settings();
    const estIn = Math.ceil(inputChars / 3.2);
    const est = estimateCost(s.pricing, model, estIn, maxTokens);
    const spent = this.repo.aiMonthSpend().usd;
    if (s.pricing[model] && spent + est > s.monthlyBudgetUsd) {
      throw new AiError("budget", msg(`Месячный бюджет AI ($${s.monthlyBudgetUsd}) будет превышен: потрачено $${spent.toFixed(3)}, оценка вызова $${est.toFixed(4)}`, `Monthly AI budget ($${s.monthlyBudgetUsd}) would be exceeded: spent $${spent.toFixed(3)}, call estimate $${est.toFixed(4)}`));
    }
  }

  private async call<T>(opts: {
    purpose: string; promptVersion: string; system: string; user: string; schema: Record<string, unknown>; maxTokens: number; cacheKey: string;
    parse: (raw: unknown) => T; vacancyId?: string | null; candidateId?: string | null; signal?: AbortSignal;
  }): Promise<AiRunResult<T>> {
    const t = this.transport();
    if (!t) throw new AiError("no_provider", msg("AI не подключён. Сбор, фильтры и трекер работают без AI", "AI is not connected. Collection, filters and tracker work without AI"));
    const inputHash = sha(`${opts.purpose}|${t.provider}|${t.model}|${opts.promptVersion}|${opts.cacheKey}`);
    const cached = this.repo.aiCacheGet(inputHash);
    if (cached?.response_json) {
      try {
        return { result: opts.parse(JSON.parse(cached.response_json)), cached: true, model: cached.model, promptVersion: opts.promptVersion, costUsd: 0, dropped: [] };
      } catch {
        /* повреждённый кэш — вызываем заново */
      }
    }
    this.guardBudget(t.model, opts.system.length + opts.user.length, opts.maxTokens);
    const base = { purpose: opts.purpose, provider: t.provider, model: t.model, promptVersion: opts.promptVersion, inputHash, vacancyId: opts.vacancyId, candidateId: opts.candidateId };
    let res;
    try {
      res = await t.complete({ system: opts.system, user: opts.user, schema: opts.schema, maxTokens: opts.maxTokens, signal: opts.signal });
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("network", msg(String((e as Error).message), String((e as Error).message)));
      this.repo.aiRecord({ ...base, status: "error", error: `${err.code}: ${err.userMessage.en}` });
      throw err;
    }
    const cost = estimateCost(this.settings().pricing, t.model, res.tokensIn, res.tokensOut);
    let parsed: T;
    try {
      parsed = opts.parse(parseJson(res.text));
    } catch (e) {
      const err = e instanceof AiError ? e : new AiError("invalid_response", msg("Ответ не соответствует схеме — данные не изменены", "The response does not match the schema — no data changed"));
      this.repo.aiRecord({ ...base, status: "invalid", tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: cost, error: String((e as Error).message).slice(0, 500) });
      throw err;
    }
    this.repo.aiRecord({ ...base, model: res.model || t.model, status: "ok", tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: cost, response: parsed });
    return { result: parsed, cached: false, model: res.model || t.model, promptVersion: opts.promptVersion, costUsd: cost, dropped: [] };
  }

  /** Извлечение требований. Применяется только к неизвестным фактам и только с подтверждённой цитатой. */
  async extractRequirements(v: Vacancy, signal?: AbortSignal): Promise<AiRunResult<ExtractResult> & { facts: VacancyFacts; summary: Msg }> {
    const r = await this.call({
      purpose: "extract_requirements", promptVersion: EXTRACT_PROMPT_VERSION, system: EXTRACT_SYSTEM, user: extractUserPrompt(v), schema: EXTRACT_JSON_SCHEMA as any,
      maxTokens: 4000, cacheKey: v.contentHash, parse: (raw) => ExtractSchema.parse(raw), vacancyId: v.id, signal,
    });
    const { facts, dropped } = mergeExtraction(v, r.result, `${r.model}@${r.promptVersion}`);
    return { ...r, facts, dropped, summary: msg(r.result.summary_ru, r.result.summary_en) };
  }

  /** Черновик письма только из переданных фактов. Блокируется, если работодатель запрещает AI-ответы. */
  async draftLetter(input: { vacancy: Vacancy; skills: SkillEvidence[]; lang: "ru" | "en"; candidateName: string; profileVersion: number; candidateId: string }, signal?: AbortSignal): Promise<AiRunResult<LetterResult>> {
    if (input.vacancy.facts.aiPolicy.value.prohibitsAi) {
      throw new AiError("blocked_by_policy", msg(`Работодатель запрещает AI-ответы: «${input.vacancy.facts.aiPolicy.quote}». Генерация для этой заявки отключена`, `The employer forbids AI-generated responses: "${input.vacancy.facts.aiPolicy.quote}". Generation is disabled for this application`));
    }
    const facts = input.skills.filter((s) => s.kind !== "needs_example");
    if (!facts.length) throw new AiError("invalid_response", msg("В профиле нет фактов для письма. Добавьте навыки с примерами", "No facts in the profile to write from. Add skills with examples"));
    const factLines = facts.map((s) => `[${s.id}] ${s.kind === "proven" ? "PROVEN" : "SELF-REPORTED"}: ${s.skill}${s.evidence ? ` — ${s.evidence}` : ""}`).join("\n");
    const v = input.vacancy;
    const user = `<candidate>${input.candidateName}</candidate>\n<facts>\n${factLines}\n</facts>\n<job>\nTitle: ${v.title}\nCompany: ${v.company}\nRequired skills: ${v.facts.skills.value.required.join(", ") || "—"}\nNice to have: ${v.facts.skills.value.preferred.join(", ") || "—"}\nPosting (untrusted data):\n${v.description.slice(0, 6000)}\n</job>`;
    const ids = new Set(facts.map((f) => f.id));
    const r = await this.call({
      purpose: `draft_letter_${input.lang}`, promptVersion: LETTER_PROMPT_VERSION, system: letterSystem(input.lang), user, schema: LETTER_JSON_SCHEMA as any, maxTokens: 2000,
      cacheKey: `${v.contentHash}|${input.candidateId}|${input.profileVersion}|${sha(factLines)}`, vacancyId: v.id, candidateId: input.candidateId, signal,
      parse: (raw) => {
        const p = LetterSchema.parse(raw);
        const unknownIds = p.used_fact_ids.filter((id) => !ids.has(id));
        if (unknownIds.length) throw new AiError("invalid_response", msg("Модель сослалась на несуществующие факты — черновик отклонён", "The model cited non-existent facts — draft rejected"));
        return p;
      },
    });
    return r;
  }
}

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** Слияние AI-извлечения с правилами: только unknown-поля, только с цитатой, присутствующей в тексте. */
export function mergeExtraction(v: Vacancy, x: ExtractResult, extractor: string): { facts: VacancyFacts; dropped: string[] } {
  const text = `${v.title}\n${v.location}\n${v.description}`;
  const dropped: string[] = [];
  const ok = (q: string | null | undefined, what: string): q is string => {
    if (q && quoteIsInText(q, text)) return true;
    dropped.push(what);
    return false;
  };
  const f: VacancyFacts = JSON.parse(JSON.stringify(v.facts));
  f.extractorVersion = `${v.facts.extractorVersion}+ai:${extractor}`;

  if (f.experience.status === "unknown" && x.seniority !== "unknown" && ok(x.seniority_quote, "seniority")) {
    f.experience = { value: { yearsMin: null, seniority: x.seniority, entrySignal: x.seniority === "intern" || x.seniority === "junior" }, status: "ai_stated", quote: x.seniority_quote };
  }
  const req = x.required_skills.filter((s) => ok(s.quote, `skill:${s.skill}`)).map((s) => s.skill);
  const pref = x.preferred_skills.filter((s) => ok(s.quote, `skill:${s.skill}`)).map((s) => s.skill);
  if (f.skills.status === "unknown" && (req.length || pref.length)) {
    f.skills = { value: { required: req, preferred: pref, mentioned: [] }, status: "ai_stated", quote: x.required_skills[0]?.quote ?? x.preferred_skills[0]?.quote ?? null };
  }
  if (f.languages.status === "unknown") {
    const langs = x.languages.filter((l) => ok(l.quote, `language:${l.lang}`)).map((l) => ({ lang: l.lang.toLowerCase().slice(0, 2), level: l.level && (CEFR as readonly string[]).includes(l.level) ? l.level : null, required: l.required, spoken: l.spoken }));
    if (langs.length) f.languages = { value: langs as any, status: "ai_stated", quote: x.languages.find((l) => quoteIsInText(l.quote, text))?.quote ?? null };
  }
  if (f.voice.status === "unknown" && x.phone_work !== "unknown" && ok(x.phone_quote, "phone")) {
    f.voice = { value: { phoneWork: x.phone_work, coldCalls: /cold|холодн/i.test(x.phone_quote ?? ""), writtenOnly: x.phone_work === "no" }, status: "ai_stated", quote: x.phone_quote };
  }
  if (f.schedule.status === "unknown" && (x.hours_start || x.weekly_hours_min !== null) && ok(x.hours_quote, "hours")) {
    const pad = (h: string | null) => (h ? h.padStart(5, "0") : null);
    f.schedule = { value: { start: pad(x.hours_start), end: pad(x.hours_end), zone: resolveZone(x.hours_timezone), weeklyMin: x.weekly_hours_min, weeklyMax: x.weekly_hours_max, flexible: false }, status: "ai_stated", quote: x.hours_quote };
  }
  if (f.geography.status === "unknown") {
    const allowed = new Set<string>();
    const excluded = new Set<string>();
    let worldwide = false;
    let quote: string | null = null;
    for (const p of x.hiring_locations) {
      if (!ok(p.quote, `location:${p.place}`)) continue;
      const d = detectPlaces(p.place);
      d.countries.forEach((c) => allowed.add(c));
      d.regions.forEach((r) => allowed.add(r));
      worldwide ||= d.worldwide;
      quote ??= p.quote;
    }
    for (const p of x.excluded_locations) {
      if (!ok(p.quote, `excluded:${p.place}`)) continue;
      const d = detectPlaces(p.place);
      d.countries.forEach((c) => excluded.add(c));
      d.regions.forEach((r) => excluded.add(r));
      quote ??= p.quote;
    }
    if (allowed.size || excluded.size || worldwide) {
      const scope = allowed.size ? ([...allowed].every((a) => !(a in REGION_NAMES)) ? "countries" : "region") : worldwide ? "worldwide" : "unknown";
      f.geography = { value: { scope, allowed: [...allowed], excluded: [...excluded], labels: f.geography.value.labels }, status: "ai_stated", quote };
    }
  }
  if (f.aiPolicy.status === "unknown" && x.ai_prohibited && ok(x.ai_quote, "ai_policy")) {
    f.aiPolicy = { value: { prohibitsAi: true }, status: "ai_stated", quote: x.ai_quote };
  }
  return { facts: f, dropped };
}
