// Обработчики API главного процесса. Каждый метод валидирует вход (zod) и работает только через Repo/Platform.
// Модуль не импортирует Electron: платформенные возможности передаются через интерфейс Platform (тестируемо в Node).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Repo } from "../db/repo";
import type { AiSettings, ApplicationStage, Msg, ScheduleSettings, ScheduleState, SearchRules, UiLang } from "../shared/types";
import { APPLICATION_STAGES, msg } from "../shared/types";
import { ROLE_TEMPLATES, emptyRules, DEFAULT_EXCLUDED_TOPICS } from "../core/templates";
import { safeExternalUrl } from "../core/policy";
import { lineDiff } from "../core/diff";
import { nextSlot } from "../core/schedule";
import { isValidZone } from "../core/timezone";
import { COUNTRIES, countryName } from "../core/geo";
import { assessAll, recheckVacancy } from "../pipeline/run";
import { atsBoardUrl, parseAshby, parseGreenhouse, parseLever } from "../sources/adapters";
import { httpGet } from "../sources/http";
import { AiError, AnthropicTransport, OpenAICompatibleTransport, type AiTransport } from "../ai/transports";
import { AiService, DEFAULT_AI_SETTINGS } from "../ai/service";
import { materialFileName, templateCv, templateLetter, textToHtml, TEMPLATE_VERSION } from "../docs/drafts";
import { applyBackup, applyProfileImport, applyVacancyImport, exportBackup, previewBackup, previewProfileImport, previewVacancyImport, readVacancyFile } from "../importexport/importer";
import { toCsv } from "../importexport/csv";
import { loadDemo } from "../demo/demo";
import { backupTo, SCHEMA_VERSION, timestampSlug } from "../db/db";
import { CATALOG, OLLAMA_BASE, OllamaManager } from "./ollama";

export interface Platform {
  dataDir: string;
  dbPath: string;
  materialsDir: string;
  backupDir: string;
  appVersion: string;
  platform: string;
  systemLocale: string;
  openFile(opts: { title: string; filters: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  saveFile(opts: { title: string; defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  openPath(p: string): Promise<string>;
  encryptionAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(b64: string): string;
  printToPdf(html: string): Promise<Buffer>;
  startRun(trigger: "manual" | "scheduled" | "catchup"): Promise<{ runId: string | null; error: string | null; alreadyRunning?: boolean }>;
  cancelRun(): boolean;
  runState(): { running: boolean; runId: string | null; progress: unknown };
  emit(event: string, payload: unknown): void;
  onScheduleChanged(): void;
  setLoginItem?(enabled: boolean): void;
}

export class ApiError extends Error {
  constructor(public readonly userMessage: Msg, public readonly code = "error") {
    super(userMessage.en);
  }
}

const DEFAULT_SCHEDULE: ScheduleSettings = { enabled: false, paused: false, cadence: "daily", time: "09:00", weekday: 1, runInBackground: true };

const id = z.string().min(1).max(100);
const cefr = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).nullable();
const mode = z.enum(["hard", "soft", "unset"]);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const RulesSchema: z.ZodType<SearchRules> = z.object({
  tracks: z.array(z.object({
    id: z.string().min(1).max(80), name: z.string().min(1).max(120), enabled: z.boolean(),
    titleKeywords: z.array(z.string().max(120)).max(80), bodyKeywords: z.array(z.string().max(120)).max(80), excludeKeywords: z.array(z.string().max(120)).max(80),
    noCalls: z.boolean(), templateId: z.string().nullable().optional(),
  })).max(100),
  location: z.object({ country: z.string().max(4).nullable(), city: z.string().max(120).nullable(), timezone: z.string().refine(isValidZone, "invalid timezone") }),
  countryEligibility: z.object({ mode }),
  workFormat: z.object({ mode, remote: z.boolean(), hybrid: z.boolean(), office: z.boolean(), hybridCities: z.array(z.string().max(120)).max(20) }),
  pay: z.object({ mode, minimums: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), amountMonthly: z.number().positive().max(1e9) })).max(10) }),
  hours: z.object({ mode, earliestLocal: hhmm, latestLocal: hhmm, maxWeeklyHours: z.number().min(1).max(80).nullable() }),
  languages: z.object({ mode, items: z.array(z.object({ lang: z.string().min(2).max(8), written: cefr, spoken: cefr, basis: z.enum(["self_reported", "certified", "unset"]) })).max(12) }),
  voice: z.object({ mode, noPhoneWork: z.boolean(), noVoiceScreening: z.boolean() }),
  experience: z.object({ mode, maxYearsRequired: z.number().min(0).max(30), allowSenior: z.boolean() }),
  excludedKeywords: z.array(z.string().max(80)).max(100),
  freshnessDays: z.number().int().min(1).max(365),
}) as any;

function hashFile(p: string): string {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 32);
}

export function createApi(repo: Repo, platform: Platform) {
  const pending = new Map<string, { kind: string; data: any; label: string; createdAt: number }>();
  const putPending = (kind: string, data: any, label: string) => {
    const token = createHash("sha256").update(`${kind}${Date.now()}${Math.random()}`).digest("hex").slice(0, 20);
    pending.set(token, { kind, data, label, createdAt: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.createdAt > 3600_000) pending.delete(k);
    return token;
  };
  const takePending = (token: string, kind: string) => {
    const p = pending.get(token);
    if (!p || p.kind !== kind) throw new ApiError(msg("Предпросмотр устарел — выберите файл заново", "Preview expired — choose the file again"));
    pending.delete(token);
    return p;
  };

  const lang = (): UiLang => repo.getMeta<UiLang | null>("ui_lang", null) ?? (platform.systemLocale.toLowerCase().startsWith("ru") ? "ru" : "en");
  const schedule = (): ScheduleSettings => ({ ...DEFAULT_SCHEDULE, ...repo.getMeta<Partial<ScheduleSettings>>("schedule", {}) });
  const aiSettings = (): AiSettings => {
    const s = { ...DEFAULT_AI_SETTINGS, ...repo.getMeta<Partial<AiSettings>>("ai_settings", {}) };
    s.pricing = { ...DEFAULT_AI_SETTINGS.pricing, ...(s.pricing ?? {}) };
    s.keySet = !!repo.getMeta<string | null>("ai_key_enc", null);
    return s;
  };
  const aiKey = (): string | null => {
    const enc = repo.getMeta<string | null>("ai_key_enc", null);
    if (!enc) return null;
    try {
      return platform.decrypt(enc);
    } catch {
      return null;
    }
  };
  const transport = (): AiTransport | null => {
    const s = aiSettings();
    if (s.provider === "anthropic") {
      const k = aiKey();
      if (!k) throw new AiError("no_key", msg("Ключ Anthropic не задан или не может быть расшифрован", "Anthropic key is not set or cannot be decrypted"));
      return new AnthropicTransport(k, s.model);
    }
    if (s.provider === "openai_compatible") return new OpenAICompatibleTransport(s.baseUrl, aiKey(), s.model);
    return null;
  };
  const ai = new AiService(repo, aiSettings, transport);
  const ollama = new OllamaManager({ downloadsDir: path.join(platform.dataDir, "downloads"), emit: (p) => platform.emit("models-progress", p) });
  const useLocalModel = (model: string) => {
    const cur = repo.getMeta<Partial<AiSettings>>("ai_settings", {});
    repo.setMeta("ai_settings", { ...cur, provider: "openai_compatible", baseUrl: `${OLLAMA_BASE}/v1`, model, lastTest: { at: new Date().toISOString(), ok: true, message: msg("Локальная модель проверена", "Local model verified") } });
    changed("ai");
  };
  const background = (job: string, fn: () => Promise<unknown>) => {
    fn().catch((e) => repo.log("warn", "models", `${job}: ${(e as Error).message}`));
  };

  const activeCandidate = (): string | null => {
    const cur = repo.getMeta<string | null>("active_candidate", null);
    if (cur && repo.getCandidate(cur)) return cur;
    const first = repo.listCandidates()[0];
    return first?.id ?? null;
  };
  const needCandidate = (cid: string) => {
    const c = repo.getCandidate(cid);
    if (!c) throw new ApiError(msg("Кандидат не найден", "Candidate not found"));
    return c;
  };
  const changed = (what: string) => platform.emit("data-changed", { what });

  const handlers: Record<string, (a: any) => unknown | Promise<unknown>> = {
    // ---------- приложение ----------
    "app.info": () => ({
      version: platform.appVersion, platform: platform.platform, dataDir: platform.dataDir, schemaVersion: SCHEMA_VERSION, lang: lang(),
      activeCandidate: activeCandidate(), counts: repo.counts(), onboarded: repo.listCandidates().length > 0,
    }),
    "app.setLang": (a) => {
      const l = z.enum(["ru", "en"]).parse(a?.lang);
      repo.setMeta("ui_lang", l);
      return { lang: l };
    },
    "app.countries": () => COUNTRIES.map((c) => ({ code: c.code, ru: countryName(c.code, "ru"), en: countryName(c.code, "en") })),
    "app.templates": () => ROLE_TEMPLATES,
    "app.defaults": () => ({ rules: emptyRules(), excludedTopics: DEFAULT_EXCLUDED_TOPICS }),

    // ---------- кандидаты/профиль ----------
    "candidates.list": () => repo.listCandidates(),
    "candidates.setActive": (a) => {
      needCandidate(id.parse(a?.id));
      repo.setMeta("active_candidate", a.id);
      return { ok: true };
    },
    "candidates.create": (a) => {
      const p = z.object({
        name: z.string().min(1).max(120), notes: z.string().max(5000).default(""), rules: RulesSchema,
        skills: z.array(z.object({ skill: z.string().min(1).max(120), kind: z.enum(["proven", "self_reported", "needs_example"]), evidence: z.string().max(2000).default(""), url: z.string().max(500).nullable().default(null) })).max(200).default([]),
      }).parse(a);
      const c = repo.createCandidate({ name: p.name, rules: p.rules, notes: p.notes, note: "onboarding" });
      for (const s of p.skills) repo.upsertSkill({ candidateId: c.id, ...s });
      repo.setMeta("active_candidate", c.id);
      assessAll(repo, { candidateIds: [c.id] });
      changed("candidates");
      return c;
    },
    "candidates.update": (a) => {
      const p = z.object({ id, name: z.string().min(1).max(120).optional(), notes: z.string().max(5000).optional() }).parse(a);
      repo.updateCandidate(p.id, p);
      changed("candidates");
      return { ok: true };
    },
    "candidates.delete": (a) => {
      const cid = id.parse(a?.id);
      needCandidate(cid);
      backupTo(repo.db, path.join(platform.backupDir, `pre-delete-${timestampSlug()}.sqlite`));
      repo.deleteCandidate(cid);
      changed("candidates");
      return { ok: true };
    },
    "profile.get": (a) => {
      const cid = id.parse(a?.candidateId);
      const c = needCandidate(cid);
      return { candidate: c, profile: repo.currentProfile(cid), history: repo.profileHistory(cid), skills: repo.listSkills(cid), materials: repo.listMaterialVersions(cid) };
    },
    "profile.saveRules": (a) => {
      const p = z.object({ candidateId: id, rules: RulesSchema, note: z.string().max(300).default("") }).parse(a);
      needCandidate(p.candidateId);
      const v = repo.saveRules(p.candidateId, p.rules, p.note);
      const ch = assessAll(repo, { candidateIds: [p.candidateId] });
      changed("profile");
      return { version: v, reassessed: ch.length };
    },
    "skills.upsert": (a) => {
      const p = z.object({ id: z.string().optional(), candidateId: id, skill: z.string().min(1).max(120), kind: z.enum(["proven", "self_reported", "needs_example"]), evidence: z.string().max(2000).default(""), url: z.string().max(500).nullable().default(null) }).parse(a);
      needCandidate(p.candidateId);
      const sid = repo.upsertSkill(p);
      assessAll(repo, { candidateIds: [p.candidateId] });
      changed("skills");
      return { id: sid };
    },
    "skills.delete": (a) => {
      const p = z.object({ candidateId: id, id }).parse(a);
      repo.deleteSkill(p.candidateId, p.id);
      assessAll(repo, { candidateIds: [p.candidateId] });
      changed("skills");
      return { ok: true };
    },

    // ---------- сегодня ----------
    "today.summary": (a) => {
      const cid = id.parse(a?.candidateId);
      needCandidate(cid);
      const ack = repo.getMeta<string | null>(`ack:${cid}`, null) ?? new Date(Date.now() - 7 * 86400000).toISOString();
      const list = repo.listVacanciesForCandidate(cid);
      const open = list.filter((v) => v.stage !== "archived");
      const fresh = open.filter((v) => v.firstSeenAt > ack && v.postingKind === "job_posting" && v.fit !== "unsuitable");
      const changedItems = open.filter((v) => v.lastChangedAt && v.lastChangedAt > ack && v.fit !== "unsuitable" && v.firstSeenAt <= ack);
      const apps = repo.listApplications(cid);
      const soon = new Date(Date.now() + 3 * 86400000).toISOString();
      const followUps = repo.dueFollowUps(cid, soon).map((ap) => ({ application: ap, vacancy: list.find((v) => v.id === ap.vacancyId) ?? null }));
      const deadlines = open
        .map((v) => ({ v, d: repo.getVacancy(v.id)?.facts.deadline.value ?? null }))
        .filter((x) => x.d && x.d >= new Date().toISOString().slice(0, 10) && x.d <= new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10))
        .map((x) => ({ vacancy: x.v, deadline: x.d }));
      const runs = repo.listRuns(1);
      const last = runs[0] ?? null;
      const s = schedule();
      const count = (f: string) => open.filter((v) => v.fit === f && v.postingKind === "job_posting").length;
      return {
        ack,
        fresh: fresh.sort((x, y) => (y.relevance ?? 0) - (x.relevance ?? 0)).slice(0, 30),
        changed: changedItems.slice(0, 20),
        counts: {
          total: list.length, suitable: count("suitable"), needsCheck: count("needs_check"), unsuitable: count("unsuitable"),
          nonPostings: list.filter((v) => v.postingKind !== "job_posting").length,
          saved: apps.filter((x) => x.stage === "saved").length, preparing: apps.filter((x) => x.stage === "preparing").length,
          submitted: apps.filter((x) => ["submitted", "response", "interview"].includes(x.stage)).length,
        },
        followUps,
        deadlines,
        search: {
          schedule: s,
          nextRun: s.enabled && !s.paused ? nextSlot(s, new Date()).toISOString() : null,
          running: platform.runState(),
          lastRun: last ? { ...last, attempts: repo.attemptsForRun(last.id) } : null,
        },
        notifications: repo.listNotifications(cid, 10),
      };
    },
    "today.ack": (a) => {
      const cid = id.parse(a?.candidateId);
      repo.setMeta(`ack:${cid}`, new Date().toISOString());
      repo.markNotificationsRead(cid);
      changed("today");
      return { ok: true };
    },

    // ---------- вакансии ----------
    "vacancies.list": (a) => repo.listVacanciesForCandidate(id.parse(a?.candidateId)),
    "vacancies.get": (a) => {
      const p = z.object({ candidateId: id, vacancyId: id }).parse(a);
      const v = repo.getVacancy(p.vacancyId);
      if (!v) throw new ApiError(msg("Вакансия не найдена", "Job not found"));
      return {
        vacancy: v,
        assessment: repo.currentAssessment(p.candidateId, p.vacancyId),
        history: repo.assessmentHistory(p.candidateId, p.vacancyId).map((h) => ({ id: h.id, createdAt: h.createdAt, fit: h.fit, profileVersion: h.profileVersion, rulesVersion: h.rulesVersion, supersededAt: h.supersededAt })),
        application: repo.getApplication(p.candidateId, p.vacancyId),
        links: repo.linksFor(p.vacancyId),
        merges: repo.mergesFor(p.vacancyId),
        observations: repo.observationsFor(p.vacancyId),
        factHistory: repo.factHistory(p.vacancyId).slice(0, 40),
        materials: repo.listMaterialVersions(p.candidateId).filter((m) => m.vacancyId === p.vacancyId),
        aiSummary: repo.getMeta<Msg | null>(`ai_summary:${p.vacancyId}:${v.contentHash}`, null),
        sourceAttribution: repo.getSource(v.sourceId)?.attribution ?? v.sourceId,
      };
    },
    "vacancies.recheck": async (a) => {
      const p = z.object({ vacancyId: id }).parse(a);
      const r = await recheckVacancy(repo, p.vacancyId);
      changed("vacancies");
      return r;
    },
    "vacancies.revertMerge": (a) => {
      const r = repo.revertMerge(id.parse(a?.mergeId));
      if (r) assessAll(repo, { vacancyIds: [r] });
      changed("vacancies");
      return { restored: r };
    },
    "vacancies.openExternal": async (a) => {
      const url = z.string().max(4000).parse(a?.url);
      const check = safeExternalUrl(url, repo.excludedHosts());
      if (!check.ok) throw new ApiError(msg(check.reason, check.reason), "blocked");
      await platform.openExternal(check.url);
      return { ok: true };
    },

    // ---------- отклики ----------
    "applications.setStage": (a) => {
      const p = z.object({
        candidateId: id, vacancyId: id, stage: z.enum(["saved", "preparing", "submitted", "response", "interview", "offer", "rejected", "archived"]),
        note: z.string().max(1000).default(""), dismissReason: z.string().max(300).nullable().optional(), submittedAt: z.string().max(40).nullable().optional(),
      }).parse(a);
      needCandidate(p.candidateId);
      if (!repo.getVacancy(p.vacancyId)) throw new ApiError(msg("Вакансия не найдена", "Job not found"));
      const ap = repo.setStage(p.candidateId, p.vacancyId, p.stage as ApplicationStage, p.note, { dismissReason: p.dismissReason ?? null, submittedAt: p.submittedAt ?? null });
      changed("applications");
      return ap;
    },
    "applications.update": (a) => {
      const p = z.object({ id, followUpAt: z.string().max(40).nullable().optional(), notes: z.string().max(10000).optional(), checklist: z.record(z.string(), z.boolean()).optional(), materialVersionIds: z.array(id).max(20).optional() }).parse(a);
      try {
        repo.updateApplication(p.id, p);
      } catch (e) {
        throw new ApiError(msg((e as Error).message, (e as Error).message));
      }
      changed("applications");
      return { ok: true };
    },
    "applications.list": (a) => {
      const cid = id.parse(a?.candidateId);
      const vs = new Map(repo.listVacanciesForCandidate(cid).map((v) => [v.id, v]));
      return repo.listApplications(cid).map((ap) => ({ ...ap, vacancy: vs.get(ap.vacancyId) ?? null }));
    },
    "applications.stages": () => APPLICATION_STAGES,

    // ---------- материалы ----------
    "materials.importFile": async (a) => {
      const p = z.object({ candidateId: id, kind: z.enum(["cv", "letter", "portfolio", "other"]), title: z.string().max(200).optional(), materialId: z.string().nullable().optional() }).parse(a);
      needCandidate(p.candidateId);
      const file = await platform.openFile({ title: lang() === "ru" ? "Выберите документ" : "Choose a document", filters: [{ name: "Documents", extensions: ["pdf", "docx", "doc", "txt", "md", "rtf", "odt", "html"] }] });
      if (!file) return { cancelled: true };
      const hash = hashFile(file);
      const dir = path.join(platform.materialsDir, p.candidateId);
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${hash.slice(0, 12)}-${path.basename(file).replace(/[\r\n]/g, " ")}`);
      fs.copyFileSync(file, target);
      const isText = /\.(txt|md)$/i.test(file);
      const content = isText ? fs.readFileSync(file, "utf8").slice(0, 200000) : "";
      const mv = repo.createMaterialVersion({
        materialId: p.materialId ?? null, candidateId: p.candidateId, kind: p.kind, title: p.title || path.basename(file), status: "draft", origin: "imported",
        content, filePath: target, fileHash: hash, fileAvailable: fs.existsSync(target),
      });
      changed("materials");
      return mv;
    },
    "materials.createDraft": async (a) => {
      const p = z.object({ candidateId: id, vacancyId: z.string().nullable().default(null), kind: z.enum(["cv", "letter"]), lang: z.enum(["ru", "en"]), mode: z.enum(["template", "ai"]) }).parse(a);
      const c = needCandidate(p.candidateId);
      const skills = repo.listSkills(p.candidateId);
      const profile = repo.currentProfile(p.candidateId);
      const v = p.vacancyId ? repo.getVacancy(p.vacancyId) : null;
      if (p.kind === "letter" && !v) throw new ApiError(msg("Письмо создаётся для конкретной вакансии", "A letter is created for a specific job"));
      if (p.mode === "ai") {
        if (p.kind !== "letter") throw new ApiError(msg("AI-черновик доступен для писем", "AI drafts are available for letters"));
        try {
          const r = await ai.draftLetter({ vacancy: v!, skills, lang: p.lang, candidateName: c.name, profileVersion: profile.version, candidateId: c.id });
          const mv = repo.createMaterialVersion({
            candidateId: c.id, vacancyId: v!.id, kind: "letter", title: `${p.lang === "ru" ? "Письмо" : "Letter"} — ${v!.company || v!.title}`, status: "draft", origin: "ai",
            content: r.result.letter + (r.result.gaps.length ? `\n\n---\n${p.lang === "ru" ? "Пробелы (не включены в письмо)" : "Gaps (not claimed in the letter)"}:\n${r.result.gaps.map((g) => `- ${g}`).join("\n")}` : ""),
            aiModel: r.model, promptVersion: r.promptVersion, profileVersion: profile.version, vacancyHash: v!.contentHash, usedFacts: r.result.used_fact_ids,
          });
          changed("materials");
          return { material: mv, costUsd: r.costUsd, cached: r.cached };
        } catch (e) {
          if (e instanceof AiError) throw new ApiError(e.userMessage, e.code);
          throw e;
        }
      }
      if (p.kind === "letter" && v!.facts.aiPolicy.value.prohibitsAi) {
        // Шаблон без AI допустим, но пользователь видит предупреждение работодателя.
      }
      const t = p.kind === "letter" ? templateLetter({ candidateName: c.name, vacancy: v!, skills, lang: p.lang }) : { ...templateCv({ candidateName: c.name, notes: c.notes, skills, lang: p.lang }), gaps: [] as string[] };
      const content = t.content + (t.gaps.length ? `\n\n---\n${p.lang === "ru" ? "Пробелы (не включены)" : "Gaps (not claimed)"}:\n${t.gaps.map((g) => `- ${g}`).join("\n")}` : "");
      const mv = repo.createMaterialVersion({
        candidateId: c.id, vacancyId: v?.id ?? null, kind: p.kind, title: p.kind === "cv" ? (p.lang === "ru" ? "Резюме (черновик)" : "CV (draft)") : `${p.lang === "ru" ? "Письмо" : "Letter"} — ${v!.company || v!.title}`,
        status: "draft", origin: "template", content, promptVersion: TEMPLATE_VERSION, profileVersion: profile.version, vacancyHash: v?.contentHash ?? null, usedFacts: t.usedFacts,
      });
      changed("materials");
      return { material: mv, costUsd: 0, cached: false };
    },
    "materials.saveVersion": (a) => {
      const p = z.object({ candidateId: id, fromId: id, content: z.string().max(200000) }).parse(a);
      const base = repo.getMaterialVersion(p.fromId);
      if (!base || base.candidateId !== p.candidateId) throw new ApiError(msg("Документ не найден у этого кандидата", "Document not found for this candidate"));
      const mv = repo.createMaterialVersion({ materialId: base.materialId, candidateId: p.candidateId, vacancyId: base.vacancyId, kind: base.kind, title: base.title, status: "draft", origin: "manual", content: p.content, profileVersion: base.profileVersion, vacancyHash: base.vacancyHash, usedFacts: base.usedFacts });
      changed("materials");
      return mv;
    },
    "materials.setStatus": (a) => {
      const p = z.object({ candidateId: id, id, status: z.enum(["draft", "human_reviewed", "stale"]) }).parse(a);
      const m = repo.getMaterialVersion(p.id);
      if (!m || m.candidateId !== p.candidateId) throw new ApiError(msg("Документ не найден", "Document not found"));
      repo.updateMaterialVersion(p.id, { status: p.status });
      changed("materials");
      return { ok: true };
    },
    "materials.checkFiles": (a) => {
      const cid = id.parse(a?.candidateId);
      let missing = 0;
      for (const m of repo.listMaterialVersions(cid)) {
        if (!m.filePath) continue;
        const ok = fs.existsSync(m.filePath);
        if (!ok) missing++;
        if (ok !== m.fileAvailable) repo.updateMaterialVersion(m.id, { fileAvailable: ok });
      }
      changed("materials");
      return { missing };
    },
    "materials.diff": (a) => {
      const p = z.object({ candidateId: id, a: id, b: id }).parse(a);
      const x = repo.getMaterialVersion(p.a);
      const y = repo.getMaterialVersion(p.b);
      if (!x || !y || x.candidateId !== p.candidateId || y.candidateId !== p.candidateId) throw new ApiError(msg("Версии не найдены", "Versions not found"));
      return lineDiff(x.content, y.content);
    },
    "materials.delete": (a) => {
      const p = z.object({ candidateId: id, id }).parse(a);
      repo.deleteMaterialVersion(p.candidateId, p.id);
      changed("materials");
      return { ok: true };
    },
    "materials.openFile": async (a) => {
      const p = z.object({ candidateId: id, id }).parse(a);
      const m = repo.getMaterialVersion(p.id);
      if (!m || m.candidateId !== p.candidateId || !m.filePath) throw new ApiError(msg("Файл не найден", "File not found"));
      if (!fs.existsSync(m.filePath)) {
        repo.updateMaterialVersion(m.id, { fileAvailable: false });
        throw new ApiError(msg("Файл недоступен по сохранённому пути", "The file is not available at the saved path"));
      }
      const err = await platform.openPath(m.filePath);
      if (err) throw new ApiError(msg(err, err));
      return { ok: true };
    },
    "materials.export": async (a) => {
      const p = z.object({ candidateId: id, id, format: z.enum(["md", "txt", "html", "pdf"]) }).parse(a);
      const m = repo.getMaterialVersion(p.id);
      if (!m || m.candidateId !== p.candidateId) throw new ApiError(msg("Документ не найден", "Document not found"));
      const target = await platform.saveFile({ title: lang() === "ru" ? "Сохранить документ" : "Save document", defaultPath: materialFileName(m, p.format), filters: [{ name: p.format.toUpperCase(), extensions: [p.format] }] });
      if (!target) return { cancelled: true };
      const html = textToHtml(m.title, m.content, lang());
      if (p.format === "pdf") fs.writeFileSync(target, await platform.printToPdf(html));
      else if (p.format === "html") fs.writeFileSync(target, html, "utf8");
      else fs.writeFileSync(target, m.content.replace(/\r?\n/g, platform.platform === "win32" ? "\r\n" : "\n"), "utf8");
      return { path: target };
    },

    // ---------- поиск ----------
    "run.start": async () => platform.startRun("manual"),
    "run.cancel": () => ({ cancelled: platform.cancelRun() }),
    "run.state": () => platform.runState(),
    "runs.list": () => repo.listRuns(30).map((r) => ({ ...r, attempts: repo.attemptsForRun(r.id) })),
    "sources.list": () => repo.listSources(),
    "sources.update": (a) => {
      const p = z.object({ id, enabled: z.boolean().optional(), minIntervalMinutes: z.number().int().min(60).max(43200).optional(), maxPages: z.number().int().min(1).max(25).optional() }).parse(a);
      repo.updateSource(p.id, p);
      changed("sources");
      return repo.getSource(p.id);
    },
    "companies.list": () => repo.listCompanies(),
    "companies.upsert": (a) => {
      const p = z.object({ id: z.string().optional(), name: z.string().min(1).max(160), website: z.string().max(300).nullable().optional(), atsKind: z.enum(["greenhouse", "lever", "ashby"]).nullable().optional(), atsSlug: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).nullable().optional(), watch: z.boolean().default(true), notes: z.string().max(2000).optional() }).parse(a);
      const cid = repo.upsertCompany(p);
      changed("companies");
      return { id: cid };
    },
    "companies.delete": (a) => {
      repo.deleteCompany(id.parse(a?.id));
      changed("companies");
      return { ok: true };
    },
    "companies.test": async (a) => {
      const p = z.object({ atsKind: z.enum(["greenhouse", "lever", "ashby"]), atsSlug: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), name: z.string().max(160).default("") }).parse(a);
      const url = atsBoardUrl(p.atsKind, p.atsSlug)!;
      try {
        const r = await httpGet(url, { excluded: repo.excludedHosts(), timeoutMs: 20000, retries: 0 });
        if (r.status === 404) return { ok: false, message: msg("Доска не найдена (HTTP 404) — проверьте slug", "Board not found (HTTP 404) — check the slug") };
        if (r.status !== 200) return { ok: false, message: msg(`HTTP ${r.status}`, `HTTP ${r.status}`) };
        const data = JSON.parse(r.text);
        const items = p.atsKind === "greenhouse" ? parseGreenhouse(data, p.name, p.atsSlug) : p.atsKind === "lever" ? parseLever(data, p.name, p.atsSlug) : parseAshby(data, p.name, p.atsSlug);
        return { ok: true, count: items.length, message: msg(`Доступно: ${items.length} открытых позиций`, `Available: ${items.length} open positions`) };
      } catch (e) {
        return { ok: false, message: msg(`Ошибка: ${(e as Error).message}`, `Error: ${(e as Error).message}`) };
      }
    },
    "excluded.list": () => repo.listExcludedHosts(),
    "excluded.add": (a) => {
      const p = z.object({ host: z.string().regex(/^[a-z0-9.-]{3,120}$/i), reason: z.string().max(200).default("") }).parse(a);
      repo.addExcludedHost(p.host, p.reason || "Исключено пользователем / excluded by user");
      changed("excluded");
      return { ok: true };
    },
    "excluded.remove": (a) => {
      const ok = repo.removeExcludedHost(z.string().max(120).parse(a?.host));
      if (!ok) throw new ApiError(msg("Встроенное правило нельзя удалить", "A built-in rule cannot be removed"));
      changed("excluded");
      return { ok };
    },

    // ---------- расписание ----------
    "schedule.get": () => {
      const s = schedule();
      const st = repo.getMeta<ScheduleState>("schedule_state", { lastHandledSlot: null, lastRunId: null });
      return { settings: s, state: st, next: s.enabled && !s.paused ? nextSlot(s, new Date()).toISOString() : null, events: repo.listScheduleEvents(20) };
    },
    "schedule.update": (a) => {
      const p = z.object({ enabled: z.boolean(), paused: z.boolean(), cadence: z.enum(["daily", "weekly"]), time: hhmm, weekday: z.number().int().min(1).max(7), runInBackground: z.boolean() }).parse(a);
      const prev = schedule();
      repo.setMeta("schedule", p);
      if (prev.enabled !== p.enabled) repo.addScheduleEvent(p.enabled ? "enabled" : "disabled", null);
      if (prev.paused !== p.paused) repo.addScheduleEvent(p.paused ? "paused" : "resumed", null);
      if (!prev.enabled && p.enabled) repo.setMeta("schedule_state", { lastHandledSlot: null, lastRunId: null });
      platform.onScheduleChanged();
      changed("schedule");
      return { ok: true };
    },

    // ---------- AI ----------
    "ai.get": () => ({ settings: aiSettings(), encryptionAvailable: platform.encryptionAvailable(), usage: repo.aiMonthSpend(), recent: repo.aiRecentCalls(15) }),
    "ai.update": (a) => {
      const p = z.object({
        provider: z.enum(["none", "anthropic", "openai_compatible"]), model: z.string().min(1).max(120), baseUrl: z.string().max(300),
        monthlyBudgetUsd: z.number().min(0).max(10000), pricing: z.record(z.string(), z.object({ inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0) })).optional(),
      }).parse(a);
      if (p.provider === "openai_compatible" && !/^https?:\/\//i.test(p.baseUrl)) throw new ApiError(msg("Адрес API должен начинаться с http:// или https://", "API URL must start with http:// or https://"));
      const cur = repo.getMeta<Partial<AiSettings>>("ai_settings", {});
      repo.setMeta("ai_settings", { ...cur, ...p, lastTest: null });
      changed("ai");
      return { ok: true };
    },
    "ai.setKey": (a) => {
      const key = z.string().min(8).max(500).parse(a?.key).trim();
      if (!platform.encryptionAvailable()) throw new ApiError(msg("Системное хранилище ключей недоступно — ключ не сохранён", "The OS key storage is unavailable — key not saved"));
      repo.setMeta("ai_key_enc", platform.encrypt(key));
      repo.log("info", "ai", "API key updated (value not logged)");
      changed("ai");
      return { ok: true };
    },
    "ai.clearKey": () => {
      repo.setMeta("ai_key_enc", null);
      changed("ai");
      return { ok: true };
    },
    "ai.test": async () => {
      let res: { ok: boolean; message: Msg };
      try {
        const t = transport();
        if (!t) res = { ok: false, message: msg("AI выключен", "AI is off") };
        else res = await t.test();
      } catch (e) {
        res = { ok: false, message: e instanceof AiError ? e.userMessage : msg(String(e), String(e)) };
      }
      const cur = repo.getMeta<Partial<AiSettings>>("ai_settings", {});
      repo.setMeta("ai_settings", { ...cur, lastTest: { at: new Date().toISOString(), ok: res.ok, message: res.message } });
      changed("ai");
      return res;
    },
    "ai.extract": async (a) => {
      const p = z.object({ vacancyId: id }).parse(a);
      const v = repo.getVacancy(p.vacancyId);
      if (!v) throw new ApiError(msg("Вакансия не найдена", "Job not found"));
      try {
        const r = await ai.extractRequirements(v);
        repo.updateFacts(v.id, r.facts);
        repo.addFactEvidence(v.id, r.facts, v.canonicalUrl, new Date().toISOString(), r.facts.extractorVersion);
        repo.setMeta(`ai_summary:${v.id}:${v.contentHash}`, r.summary);
        assessAll(repo, { vacancyIds: [v.id] });
        changed("vacancies");
        return { cached: r.cached, costUsd: r.costUsd, dropped: r.dropped, model: r.model, summary: r.summary };
      } catch (e) {
        if (e instanceof AiError) throw new ApiError(e.userMessage, e.code);
        throw e;
      }
    },

    // ---------- локальные модели ----------
    "models.state": async () => {
      const [status, catalog, engine] = await Promise.all([ollama.status(), ollama.catalog(), ollama.engineInfo()]);
      const s = aiSettings();
      return { status, catalog, engine, active: s.provider === "openai_compatible" && s.baseUrl.includes("11434") ? s.model : null, platform: platform.platform };
    },
    "models.installEngine": () => {
      background("engine", () => ollama.installEngine().then(() => changed("models")));
      return { started: true };
    },
    "models.startEngine": async () => {
      const st = await ollama.startEngine();
      changed("models");
      return st;
    },
    "models.pull": (a) => {
      const model = z.string().parse(a?.model);
      if (!CATALOG.some((c) => c.model === model)) throw new ApiError(msg("Эта модель не из списка поддержанных", "This model is not in the supported list"));
      background(model, async () => {
        await ollama.pull(model);
        platform.emit("models-progress", { job: model, phase: "verify" });
        const v = await ollama.verify(model);
        platform.emit("models-progress", { job: model, phase: v.ok ? "done" : "error", message: v.ok ? msg(`Проверено за ${v.seconds} с`, `Verified in ${v.seconds} s`) : msg(`Проверка не прошла: ${v.error}`, `Check failed: ${v.error}`), verified: v });
        if (v.ok) useLocalModel(model);
        changed("models");
      });
      return { started: true };
    },
    "models.cancel": (a) => ({ cancelled: ollama.cancel(z.string().parse(a?.job)) }),
    "models.remove": async (a) => {
      const model = z.string().parse(a?.model);
      await ollama.remove(model);
      const s = aiSettings();
      if (s.provider === "openai_compatible" && s.model === model) {
        const cur = repo.getMeta<Partial<AiSettings>>("ai_settings", {});
        repo.setMeta("ai_settings", { ...cur, provider: "none" });
      }
      changed("models");
      return { ok: true };
    },
    "models.use": async (a) => {
      const model = z.string().parse(a?.model);
      const v = await ollama.verify(model);
      if (!v.ok) throw new ApiError(msg(`Модель не прошла проверку: ${v.error}`, `The model failed the check: ${v.error}`));
      useLocalModel(model);
      return v;
    },

    // ---------- данные ----------
    "data.exportBackup": async () => {
      const target = await platform.saveFile({ title: "Backup", defaultPath: `job-search-backup-${timestampSlug()}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!target) return { cancelled: true };
      fs.writeFileSync(target, JSON.stringify(exportBackup(repo), null, 1), "utf8");
      return { path: target };
    },
    "data.backupNow": () => ({ path: backupTo(repo.db, path.join(platform.backupDir, `manual-${timestampSlug()}.sqlite`)) }),
    "data.previewBackup": async () => {
      const file = await platform.openFile({ title: "Backup", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!file) return { cancelled: true };
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { token: putPending("backup", data, path.basename(file)), file: path.basename(file), preview: previewBackup(repo, data) };
    },
    "data.applyBackup": (a) => {
      const pnd = takePending(z.string().parse(a?.token), "backup");
      const r = applyBackup(repo, pnd.data, platform.backupDir);
      assessAll(repo);
      changed("all");
      return r;
    },
    "data.previewVacancies": async () => {
      const file = await platform.openFile({ title: lang() === "ru" ? "Файл вакансий (CSV/JSON)" : "Jobs file (CSV/JSON)", filters: [{ name: "CSV / JSON", extensions: ["csv", "json"] }] });
      if (!file) return { cancelled: true };
      const rows = readVacancyFile(fs.readFileSync(file, "utf8"), file);
      const label = path.basename(file).replace(/\.[^.]+$/, "");
      return { token: putPending("vacancies", rows, label), file: path.basename(file), preview: previewVacancyImport(repo, rows, label) };
    },
    "data.applyVacancies": (a) => {
      const pnd = takePending(z.string().parse(a?.token), "vacancies");
      const r = applyVacancyImport(repo, pnd.data, pnd.label, platform.backupDir);
      changed("all");
      return r;
    },
    "data.previewProfile": async () => {
      const file = await platform.openFile({ title: "Profile JSON", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!file) return { cancelled: true };
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return { token: putPending("profile", data, path.basename(file)), file: path.basename(file), preview: previewProfileImport(repo, data) };
    },
    "data.applyProfile": (a) => {
      const pnd = takePending(z.string().parse(a?.token), "profile");
      const r = applyProfileImport(repo, pnd.data, platform.backupDir, (p) => fs.existsSync(p));
      changed("all");
      return r;
    },
    "data.exportCsv": async (a) => {
      const cid = id.parse(a?.candidateId);
      const target = await platform.saveFile({ title: "CSV", defaultPath: `jobs-${timestampSlug()}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!target) return { cancelled: true };
      const L = lang();
      const rows = repo.listVacanciesForCandidate(cid).map((v) => ({
        title: v.title, company: v.company, location: v.location, url: v.canonicalUrl, fit: v.fit ?? "", relevance: v.relevance ?? "", track: v.trackName ?? "",
        lifecycle: v.lifecycle, stage: v.stage ?? "", next_step: v.nextStep ? v.nextStep[L] : "", salary_min: v.salary.min ?? "", salary_max: v.salary.max ?? "",
        currency: v.salary.currency ?? "", period: v.salary.period ?? "", salary_kind: v.salary.kind, published: v.publishedAt ?? "", first_seen: v.firstSeenAt, last_checked: v.lastCheckedAt ?? "",
      }));
      fs.writeFileSync(target, toCsv(rows), "utf8");
      return { path: target, rows: rows.length };
    },
    "data.openFolder": async () => ({ error: await platform.openPath(platform.dataDir) }),
    "data.imports": () => repo.listImportBatches(),
    "demo.load": () => {
      const r = loadDemo(repo, lang());
      repo.setMeta("active_candidate", "cand-demo");
      changed("all");
      return r;
    },
    "notifications.list": (a) => repo.listNotifications(a?.candidateId ?? null, 50),
    "logs.list": () => ({ logs: repo.recentLogs(150), schedule: repo.listScheduleEvents(30) }),
  };

  return async function call(method: string, args: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: Msg; code: string }> {
    const h = handlers[method];
    if (!h) return { ok: false, error: msg(`Неизвестный метод ${method}`, `Unknown method ${method}`), code: "unknown_method" };
    try {
      return { ok: true, data: await h(args) };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, error: e.userMessage, code: e.code };
      if (e instanceof z.ZodError) {
        const detail = e.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        return { ok: false, error: msg(`Некорректные данные: ${detail}`, `Invalid input: ${detail}`), code: "validation" };
      }
      if (e instanceof AiError) return { ok: false, error: e.userMessage, code: e.code };
      const m = String((e as Error)?.message ?? e).slice(0, 500);
      repo.log("error", "api", `${method}: ${m}`);
      return { ok: false, error: msg(`Ошибка: ${m}`, `Error: ${m}`), code: "internal" };
    }
  };
}

export type ApiCall = ReturnType<typeof createApi>;
