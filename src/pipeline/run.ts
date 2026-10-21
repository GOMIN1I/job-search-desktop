// Оркестрация поиска: попытки по источникам, нормализация, дедупликация, наблюдения, оценка всех кандидатов, уведомления.
// Сбой источника фиксируется отдельно и не превращается в «0 вакансий»; итог прогона — partial, а не success.

import type { RunStats, RunStatus, RunTrigger, SearchRules, SourceAttemptStatus, Vacancy } from "../shared/types";
import { activeDirectives, notesHash, sourcesExcludedByEveryone } from "../core/instructions";
import { msg } from "../shared/types";
import type { Repo } from "../db/repo";
import { EMPTY_STATS } from "../db/repo";
import { SOURCE_DEFINITIONS, collect, type RawJob } from "../sources/adapters";
import { buildQueries } from "../sources/search";
import { HttpError, PolicyBlockedError, httpGet, type Fetcher } from "../sources/http";
import { decideDedupe, type VacRef } from "../core/dedupe";
import { assess, RULES_VERSION } from "../core/assess";
import { interpretCheck } from "../core/lifecycle";
import { htmlToText, nowIso } from "../core/text";
import { blockedReason } from "../core/policy";
import { normalizeRaw } from "./normalize";
import { extractFacts, EXTRACTOR_VERSION } from "../core/facts";
import { classifyPosting } from "../core/classify";

export class AlreadyRunningError extends Error {
  constructor(public readonly runId: string) {
    super("Поиск уже выполняется / a search is already running");
  }
}

export interface RunDeps {
  fetcher?: Fetcher;
  now?: () => Date;
  signal?: AbortSignal;
  onProgress?: (p: { runId: string; sourceId?: string; status?: SourceAttemptStatus; items?: number; stats: RunStats; phase: string; sources?: Array<{ id: string; label: string; enabled: boolean }> }) => void;
  pauseMs?: number;
  sourceIds?: string[];
  /** Собранные записи источника (сервер поиска складывает их для приложения). */
  onRawItems?: (sourceId: string, items: RawJob[]) => void;
  /** Доступы к источникам (расшифровываются в главном процессе и передаются только в сбор). */
  credentials?: { hhToken?: string | null; adzuna?: { appId: string; appKey: string } | null };
}

export interface IngestOutcome {
  vacancyId: string | null;
  change: "new" | "changed" | "unchanged" | "merged" | "policy" | "invalid";
}

/** Сохранение одной сырой записи с дедупликацией. Используется сбором, импортом и демо. */
export function ingestRaw(repo: Repo, raw: RawJob, ctx: { runId: string | null; now: Date; isDemo?: boolean; provenance?: string; externalKey?: string | null }): IngestOutcome {
  const norm = normalizeRaw(raw, repo.excludedHosts(), ctx.now, { isDemo: ctx.isDemo, provenance: ctx.provenance });
  if (!norm.ok) return { vacancyId: null, change: norm.reason };
  const v = norm.vacancy;
  const at = ctx.now.toISOString();
  if (ctx.externalKey) {
    const existing = repo.vacancyByExternalKey(ctx.externalKey);
    if (existing) return updateExisting(repo, existing.id, v, raw, ctx.runId, at);
  }
  const ref: VacRef = { id: v.id, sourceId: v.sourceId, sourceJobId: v.sourceJobId, canonicalUrl: v.canonicalUrl, requisitionId: v.requisitionId, company: v.company, title: v.title, location: v.location, description: v.description };
  const d = decideDedupe(ref, repo.dedupeIndex());
  if (d.kind === "same_source_id" || d.kind === "same_url" || d.kind === "same_requisition") {
    const out = updateExisting(repo, d.target.id, v, raw, ctx.runId, at);
    if (d.kind !== "same_source_id" && d.target.sourceId !== v.sourceId) repo.recordMerge(d.target.id, d.target.id, d.kind, `${d.reason}: ${v.sourceId} → ${d.target.sourceId}`);
    return out;
  }
  if (d.kind === "fallback") {
    v.mergedIntoId = d.target.id;
    repo.insertVacancy(v, ctx.externalKey ?? null);
    repo.addLink(v.id, v.sourceId, v.sourceJobId, v.canonicalUrl, at);
    repo.addObservation({ vacancyId: v.id, runId: ctx.runId, sourceId: v.sourceId, at, changeKind: "new", contentHash: v.contentHash, snapshot: snapshotOf(v) });
    repo.recordMerge(d.target.id, v.id, "fallback", d.reason);
    return { vacancyId: d.target.id, change: "merged" };
  }
  repo.insertVacancy(v, ctx.externalKey ?? null);
  repo.addLink(v.id, v.sourceId, v.sourceJobId, v.canonicalUrl, at);
  repo.addObservation({ vacancyId: v.id, runId: ctx.runId, sourceId: v.sourceId, at, changeKind: ctx.provenance?.startsWith("import") ? "imported" : "new", contentHash: v.contentHash, snapshot: snapshotOf(v) });
  repo.addFactEvidence(v.id, v.facts, v.canonicalUrl, at);
  return { vacancyId: v.id, change: "new" };
}

function snapshotOf(v: Vacancy) {
  return { title: v.title, company: v.company, location: v.location, salary: v.facts.salary, publishedAt: v.publishedAt, url: v.canonicalUrl, descriptionLength: v.description.length };
}

function updateExisting(repo: Repo, id: string, incoming: Vacancy, raw: RawJob, runId: string | null, at: string): IngestOutcome {
  const cur = repo.getVacancy(id)!;
  repo.addLink(id, incoming.sourceId, incoming.sourceJobId, incoming.canonicalUrl, at);
  // Обновляем содержимое только из того же источника: другая лента может содержать урезанный текст.
  if (cur.contentHash !== incoming.contentHash && cur.sourceId === incoming.sourceId) {
    repo.updateVacancyContent(id, { ...incoming, applyUrl: raw.applyUrl }, at);
    repo.addObservation({ vacancyId: id, runId, sourceId: incoming.sourceId, at, changeKind: "changed", contentHash: incoming.contentHash, snapshot: { before: snapshotOf(cur), after: snapshotOf(incoming) } });
    repo.addFactEvidence(id, incoming.facts, incoming.canonicalUrl, at);
    if (incoming.lifecycle === "closed") repo.setLifecycle(id, "closed", incoming.lifecycleEvidence[0], false);
    return { vacancyId: id, change: "changed" };
  }
  repo.touchVacancy(id, at);
  if (raw.isEmployerAts && cur.lifecycle !== "closed") repo.setLifecycle(id, "open", incoming.lifecycleEvidence[0], false);
  return { vacancyId: id, change: "unchanged" };
}

/**
 * При обновлении правил извлечения факты сохранённых вакансий пересчитываются из их текста.
 * Структурированная оплата из источника сохраняется; история фактов пополняется новой записью.
 */
export function refreshFacts(repo: Repo): number {
  let n = 0;
  repo.transaction(() => {
    for (const v of repo.allActiveVacancies()) {
      if (v.facts?.extractorVersion?.startsWith(EXTRACTOR_VERSION)) continue;
      const f = extractFacts({ title: v.title, company: v.company, location: v.location, description: v.description, levelText: v.levelText, employmentType: v.employmentType, tags: v.tags, remoteBySource: v.facts?.format?.status === "structured" });
      if (v.facts?.salary?.origin === "structured") f.salary = v.facts.salary;
      repo.updateFacts(v.id, f);
      const pk = classifyPosting({ title: v.title, company: v.company, url: v.canonicalUrl, description: v.description });
      repo.db.prepare("UPDATE vacancies SET posting_kind=?, posting_kind_reason=? WHERE id=?").run(pk.kind, JSON.stringify(pk.reason), v.id);
      repo.addFactEvidence(v.id, f, v.canonicalUrl, new Date().toISOString());
      n++;
    }
  });
  return n;
}

/** Пересчёт оценок. Новая оценка записывается только при изменении входных данных; история сохраняется. */
export function assessAll(repo: Repo, opts: { candidateIds?: string[]; vacancyIds?: string[]; now?: Date } = {}) {
  const candidates = repo.listCandidates().filter((c) => !opts.candidateIds || opts.candidateIds.includes(c.id));
  const vacancies = opts.vacancyIds ? opts.vacancyIds.map((id) => repo.getVacancy(id)).filter((v): v is Vacancy => !!v && !v.mergedIntoId) : repo.allActiveVacancies();
  const changed: Array<{ candidateId: string; vacancyId: string; fit: string; previousFit: string | null }> = [];
  for (const c of candidates) {
    const profile = repo.currentProfile(c.id);
    const skills = repo.listSkills(c.id);
    const nh = notesHash(activeDirectives(profile.rules));
    repo.transaction(() => {
      for (const v of vacancies) {
        // Демо-вакансии оцениваются только для демо-кандидатов и наоборот, чтобы не смешивать данные.
        if (v.isDemo !== c.isDemo) continue;
        const instructionNote = nh ? repo.instructionCheck(c.id, v.id, nh) : null;
        const a = assess({ rules: profile.rules, profileVersion: profile.version, skills, vacancy: v, candidateId: c.id, now: opts.now, instructionNote });
        const r = repo.saveAssessment(a);
        if (r.changed) changed.push({ candidateId: c.id, vacancyId: v.id, fit: a.fit, previousFit: r.previous?.fit ?? null });
      }
    });
  }
  return changed;
}

function attemptStatusFromError(e: unknown): { status: SourceAttemptStatus; httpStatus: number | null; message: string } {
  const err = e as Error & { httpStatus?: number; notConfigured?: boolean };
  if (err instanceof PolicyBlockedError) return { status: "blocked", httpStatus: null, message: err.message };
  if (err?.notConfigured) return { status: "not_configured", httpStatus: null, message: err.message && err.message !== "not_configured" ? err.message : "Нет компаний для опроса / no companies configured" };
  const hs = err instanceof HttpError ? err.status : err?.httpStatus ?? null;
  if (hs === 401 || hs === 403 || hs === 429) return { status: "blocked", httpStatus: hs, message: /HTTP \d{3}/.test(String(err?.message)) && err?.message.length > 12 ? err.message : `HTTP ${hs}: доступ ограничен или лимит / access restricted or rate-limited` };
  if (/Отменено|aborted/i.test(String(err?.message))) return { status: "cancelled", httpStatus: null, message: "Отменено / cancelled" };
  return { status: "failed", httpStatus: hs, message: String(err?.message || err) };
}

/** Что искать: фразы направлений и страны всех настоящих профилей (демо — только если других нет). */
export function searchPlan(repo: Repo): { queries: string[]; countries: string[]; rules: SearchRules[] } {
  const all = repo.listCandidates();
  const real = all.filter((c) => !c.isDemo);
  const people = real.length ? real : all;
  const tracks: Array<{ enabled: boolean; titleKeywords: string[] }> = [];
  const countries = new Set<string>();
  const rulesList: SearchRules[] = [];
  for (const c of people) {
    let rules;
    try {
      rules = repo.currentProfile(c.id).rules;
    } catch {
      continue;
    }
    rulesList.push(rules);
    tracks.push(...rules.tracks);
    if (rules.location.country) countries.add(rules.location.country.toUpperCase());
  }
  return { queries: buildQueries(tracks), countries: [...countries], rules: rulesList };
}

/** Уведомления только о новых/изменившихся подходящих или требующих уточнения, без повторов. */
function notifyMatches(repo: Repo, changed: Array<{ candidateId: string; vacancyId: string; fit: string; previousFit: string | null }>, newOrChanged: Set<string>): number {
  let n = 0;
  for (const ch of changed) {
    if (!newOrChanged.has(ch.vacancyId)) continue;
    if (ch.fit !== "suitable" && ch.fit !== "needs_check") continue;
    const v = repo.getVacancy(ch.vacancyId);
    const app = repo.getApplication(ch.candidateId, ch.vacancyId);
    if (!v || app?.stage === "archived") continue;
    const ok = repo.addNotification({
      candidateId: ch.candidateId,
      kind: ch.previousFit ? "changed_match" : "new_match",
      dedupeKey: `${ch.candidateId}:${ch.vacancyId}:${ch.fit}:${v.contentHash}`,
      title: ch.fit === "suitable" ? msg("Подходящая вакансия", "Matching job") : msg("Вакансия требует уточнения", "Job needs clarification"),
      body: msg(`${v.title} — ${v.company}`, `${v.title} — ${v.company}`),
      vacancyId: v.id,
    });
    if (ok) n++;
  }
  return n;
}

/** Принять записи, собранные вне этого компьютера (сервер поиска): те же дедупликация, оценка и уведомления. */
export function importExternalItems(repo: Repo, items: Array<{ raw: RawJob; at: string }>, opts: { provenance: string; now?: Date }): { inserted: number; changed: number; notifications: number; suitable: number } {
  const now = opts.now ?? new Date();
  const touched = new Set<string>();
  const newOrChanged = new Set<string>();
  let inserted = 0;
  let changedCount = 0;
  repo.transaction(() => {
    for (const it of items) {
      const out = ingestRaw(repo, it.raw, { runId: null, now: new Date(it.at || now), provenance: opts.provenance });
      if (!out.vacancyId) continue;
      touched.add(out.vacancyId);
      if (out.change === "new") {
        inserted++;
        newOrChanged.add(out.vacancyId);
      } else if (out.change === "changed") {
        changedCount++;
        newOrChanged.add(out.vacancyId);
      }
    }
  });
  const changed = touched.size ? assessAll(repo, { vacancyIds: [...touched], now }) : [];
  const notifications = notifyMatches(repo, changed, newOrChanged);
  const suitable = changed.filter((c) => newOrChanged.has(c.vacancyId) && c.fit === "suitable").length;
  return { inserted, changed: changedCount, notifications, suitable };
}

export async function runSearch(repo: Repo, trigger: RunTrigger, deps: RunDeps = {}): Promise<{ runId: string; status: RunStatus; stats: RunStats }> {
  const nowFn = deps.now ?? (() => new Date());
  repo.closeStaleRuns();
  const running = repo.runningRun();
  if (running) throw new AlreadyRunningError(running.id);
  refreshFacts(repo);
  const runId = repo.createRun(trigger, RULES_VERSION);
  const stats: RunStats = { ...EMPTY_STATS };
  const touched = new Set<string>();
  const newOrChanged = new Set<string>();
  let cancelled = false;
  const progress = (phase: string, sourceId?: string, status?: SourceAttemptStatus, items?: number) => {
    repo.heartbeat(runId, stats);
    deps.onProgress?.({
      runId, sourceId, status, items, stats: { ...stats }, phase,
      sources: phase === "start" ? repo.listSources().map((x) => ({ id: x.id, label: x.label, enabled: x.enabled })) : undefined,
    });
  };
  try {
    const sources = repo.listSources().filter((s) => !deps.sourceIds || deps.sourceIds.includes(s.id));
    const plan = searchPlan(repo);
    const excludedForAll = sourcesExcludedByEveryone(plan.rules);
    stats.sourcesTotal = sources.length;
    progress("start");
    for (const s of sources) {
      const at = nowFn().toISOString();
      if (cancelled || deps.signal?.aborted) {
        cancelled = true;
        const id = repo.addAttempt(runId, s.id, "cancelled", at);
        repo.finishAttempt(id, { status: "cancelled" });
        continue;
      }
      if (excludedForAll.has(s.id)) {
        // Все настоящие профили исключили эту площадку в своих инструкциях — её не опрашиваем
        const id = repo.addAttempt(runId, s.id, "excluded", at);
        repo.finishAttempt(id, { status: "excluded", error: "Исключено вашими инструкциями для ИИ / excluded by your AI instructions" });
        stats.sourcesDisabled++;
        progress("source", s.id, "excluded");
        continue;
      }
      if (!s.enabled) {
        const id = repo.addAttempt(runId, s.id, "disabled", at);
        repo.finishAttempt(id, { status: "disabled" });
        stats.sourcesDisabled++;
        continue;
      }
      if (s.nextAllowedAt && new Date(s.nextAllowedAt).getTime() > nowFn().getTime()) {
        const id = repo.addAttempt(runId, s.id, "not_due", at);
        repo.finishAttempt(id, { status: "not_due", error: `Следующий разрешённый опрос / next allowed poll: ${s.nextAllowedAt}` });
        stats.sourcesNotDue++;
        progress("source", s.id, "not_due");
        continue;
      }
      const def = SOURCE_DEFINITIONS.find((d) => d.id === s.id);
      if (!def) {
        const id = repo.addAttempt(runId, s.id, "not_configured", at);
        repo.finishAttempt(id, { status: "not_configured", error: "Нет адаптера / no adapter" });
        stats.sourcesNotConfigured++;
        continue;
      }
      const attemptId = repo.addAttempt(runId, s.id, "failed", at);
      progress("source", s.id);
      try {
        const res = await collect(def, {
          fetchOpts: { excluded: repo.excludedHosts(), signal: deps.signal, timeoutMs: 30_000, retries: 2, retryBaseMs: deps.pauseMs === 0 ? 0 : 1000 },
          fetcher: deps.fetcher,
          maxPages: s.maxPages,
          companies: s.kind === "ats" ? repo.watchedAtsCompanies() : undefined,
          pauseMs: deps.pauseMs,
          queries: plan.queries,
          countries: plan.countries,
          credentials: deps.credentials,
        });
        stats.rawItems += res.items.length;
        deps.onRawItems?.(s.id, res.items);
        const now = nowFn();
        repo.transaction(() => {
          for (const raw of res.items) {
            const out = ingestRaw(repo, raw, { runId, now });
            if (out.change === "policy") stats.policyBlocked++;
            else if (out.change === "invalid") continue;
            else {
              if (out.vacancyId) touched.add(out.vacancyId);
              if (out.change === "new") {
                stats.newVacancies++;
                newOrChanged.add(out.vacancyId!);
              } else if (out.change === "changed") {
                stats.changedVacancies++;
                newOrChanged.add(out.vacancyId!);
              } else if (out.change === "merged") stats.mergedFallback++;
              else stats.unchangedVacancies++;
            }
          }
        });
        const status: SourceAttemptStatus = res.partialError ? "partial" : "success";
        repo.finishAttempt(attemptId, { status, httpStatus: res.httpStatus, error: res.partialError, items: res.items.length, coverage: res.coverage });
        repo.markSourceResult(s.id, status, at, res.partialError, status === "success" || res.items.length > 0);
        if (status === "partial") stats.sourcesFailed++;
        else stats.sourcesSucceeded++;
        progress("source", s.id, status, res.items.length);
      } catch (e) {
        const st = attemptStatusFromError(e);
        repo.finishAttempt(attemptId, { status: st.status, httpStatus: st.httpStatus, error: st.message });
        if (st.status === "cancelled") {
          cancelled = true;
        } else {
          repo.markSourceResult(s.id, st.status, at, st.message, false);
          if (st.status === "not_configured") stats.sourcesNotConfigured++;
          else if (st.status === "blocked") stats.sourcesBlocked++;
          else stats.sourcesFailed++;
          repo.log("warn", "source", `${s.id}: ${st.message}`);
        }
        progress("source", s.id, st.status);
      }
    }

    const nonPost = [...touched].map((id) => repo.getVacancy(id)).filter((v) => v && v.postingKind !== "job_posting").length;
    stats.nonPostings = nonPost;
    progress("assess");
    const changed = assessAll(repo, { now: nowFn() });
    stats.assessed = changed.length;
    for (const c of repo.listCandidates()) {
      for (const it of repo.listVacanciesForCandidate(c.id)) {
        if (!touched.has(it.id)) continue;
        if (it.fit === "suitable") stats.suitable++;
        else if (it.fit === "needs_check") stats.needsCheck++;
        else if (it.fit === "unsuitable") stats.unsuitable++;
      }
    }
    stats.notifications += notifyMatches(repo, changed, newOrChanged);
    const attempted = stats.sourcesSucceeded + stats.sourcesFailed + stats.sourcesBlocked;
    let status: RunStatus;
    if (cancelled) status = "cancelled";
    else if (attempted > 0 && stats.sourcesSucceeded === 0) status = "failed";
    else if (stats.sourcesFailed > 0 || stats.sourcesBlocked > 0) status = "partial";
    else status = "succeeded";
    if (status === "failed") {
      repo.addNotification({ candidateId: null, kind: "run_failed", dedupeKey: `run_failed:${runId}`, title: msg("Поиск не выполнен", "Search failed"), body: msg("Ни один источник не ответил. Проверьте сеть.", "No source responded. Check the network."), vacancyId: null });
    }
    repo.finishRun(runId, status, stats);
    progress("done");
    return { runId, status, stats };
  } catch (e) {
    repo.finishRun(runId, "failed", stats);
    repo.log("error", "run", `Запуск ${runId} прерван: ${(e as Error).message}`);
    throw e;
  }
}

const AGGREGATOR_HOSTS = ["jobicy.com", "remotive.com", "remoteok.com", "himalayas.app", "workingnomads.com", "weworkremotely.com"];

/** Повторная проверка первичной карточки выбранной вакансии. */
export async function recheckVacancy(repo: Repo, vacancyId: string, deps: { fetcher?: Fetcher; signal?: AbortSignal; now?: Date } = {}) {
  const v = repo.getVacancy(vacancyId);
  if (!v) throw new Error("Вакансия не найдена");
  const url = v.applyUrl && !blockedReason(v.applyUrl, repo.excludedHosts()) ? v.applyUrl : v.canonicalUrl;
  const at = (deps.now ?? new Date()).toISOString();
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  const isEmployerPage = !AGGREGATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  let result;
  try {
    const r = await httpGet(url, { excluded: repo.excludedHosts(), signal: deps.signal, timeoutMs: 25_000, retries: 1, accept: "text/html,application/xhtml+xml" }, deps.fetcher);
    result = interpretCheck({ url, finalUrl: r.finalUrl, httpStatus: r.status, bodyText: /<html|<body|<div/i.test(r.text) ? `${htmlToText(r.text)}\n${/<noscript/i.test(r.text) ? "<noscript" : ""}` : r.text, error: null, policyBlocked: null, isEmployerPage }, v.title, v.lifecycle, at);
  } catch (e) {
    if (e instanceof PolicyBlockedError) result = interpretCheck({ url, finalUrl: null, httpStatus: null, bodyText: "", error: null, policyBlocked: e.reason, isEmployerPage }, v.title, v.lifecycle, at);
    else result = interpretCheck({ url, finalUrl: null, httpStatus: null, bodyText: "", error: (e as Error).message, policyBlocked: null, isEmployerPage }, v.title, v.lifecycle, at);
  }
  const checked = !["network_error", "http_blocked", "http_error", "policy_blocked"].includes(result.evidence.type);
  repo.setLifecycle(v.id, result.lifecycle, result.evidence, checked);
  repo.addObservation({ vacancyId: v.id, runId: null, sourceId: "recheck", at, changeKind: "recheck", contentHash: v.contentHash, snapshot: { evidence: result.evidence } });
  assessAll(repo, { vacancyIds: [v.id] });
  return { lifecycle: result.lifecycle, evidence: result.evidence, nowIso: nowIso() };
}
