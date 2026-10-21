// Репозиторий: все чтения/записи базы. Оценки и версии профиля не перезаписываются — старые помечаются superseded.

import type { DB } from "./db";
import { tx } from "./db";
import type {
  Application, ApplicationStage, Assessment, Candidate, Coverage, Lifecycle, LifecycleEvidence, MaterialKind, MaterialStatus,
  MaterialVersion, Msg, NotificationEvent, RunStats, RunStatus, RunTrigger, SearchProfileVersion, SearchRules, SearchRun,
  SkillEvidence, SourceAttempt, SourceAttemptStatus, SourceInfo, SourceKind, Vacancy, VacancyFacts,
} from "../shared/types";
import { msg } from "../shared/types";
import { DEFAULT_EXCLUDED_HOSTS, type ExcludedHost } from "../core/policy";
import { SOURCE_DEFINITIONS } from "../sources/adapters";
import type { DedupeIndex, VacRef } from "../core/dedupe";
import { fallbackKey } from "../core/dedupe";
import { nowIso, uid } from "../core/text";

type Row = Record<string, any>;

const j = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === "") return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};
const msgOf = (v: unknown): Msg => {
  const parsed = j<Msg | string>(v, "");
  if (typeof parsed === "string") return msg(parsed || String(v ?? ""), parsed || String(v ?? ""));
  return parsed;
};

export const EMPTY_STATS: RunStats = {
  sourcesTotal: 0, sourcesSucceeded: 0, sourcesFailed: 0, sourcesNotDue: 0, sourcesBlocked: 0, sourcesNotConfigured: 0, sourcesDisabled: 0,
  rawItems: 0, policyBlocked: 0, nonPostings: 0, newVacancies: 0, changedVacancies: 0, unchangedVacancies: 0, mergedFallback: 0,
  assessed: 0, suitable: 0, needsCheck: 0, unsuitable: 0, notifications: 0,
};

export interface VacancyListItem {
  id: string;
  title: string;
  company: string;
  location: string;
  sourceId: string;
  canonicalUrl: string;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lifecycle: Lifecycle;
  postingKind: string;
  isDemo: boolean;
  salary: VacancyFacts["salary"];
  format: string;
  fit: Assessment["fit"] | null;
  relevance: number | null;
  trackName: string | null;
  nextStep: Msg | null;
  stage: ApplicationStage | null;
  dismissReason: string | null;
  sourceCount: number;
}

export class Repo {
  constructor(public readonly db: DB) {}

  private stmtCache = new Map<string, ReturnType<DB["prepare"]>>();
  private q(sql: string) {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }
  private all(sql: string, ...p: any[]): Row[] {
    return this.q(sql).all(...p) as Row[];
  }
  private get(sql: string, ...p: any[]): Row | undefined {
    return this.q(sql).get(...p) as Row | undefined;
  }
  private run(sql: string, ...p: any[]) {
    return this.q(sql).run(...p);
  }

  private depth = 0;
  /** Транзакция; вложенные вызовы используют SAVEPOINT, чтобы ошибка откатывала только свою часть. */
  transaction<T>(fn: () => T): T {
    if (this.depth === 0) {
      this.depth++;
      try {
        return tx(this.db, fn);
      } finally {
        this.depth--;
      }
    }
    const sp = `sp_${this.depth}`;
    this.db.exec(`SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const r = fn();
      this.db.exec(`RELEASE ${sp}`);
      return r;
    } catch (e) {
      this.db.exec(`ROLLBACK TO ${sp}`);
      this.db.exec(`RELEASE ${sp}`);
      throw e;
    } finally {
      this.depth--;
    }
  }

  // ---------- meta / журнал ----------
  getMeta<T>(key: string, fallback: T): T {
    const r = this.get("SELECT value FROM meta WHERE key=?", key);
    return r ? j<T>(r.value, fallback) : fallback;
  }
  setMeta(key: string, value: unknown) {
    this.run("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value));
  }
  log(level: "info" | "warn" | "error", area: string, message: string) {
    // Секреты в журнал не пишутся: вызывающий код передаёт только описания.
    this.run("INSERT INTO app_log(at, level, area, message) VALUES(?,?,?,?)", nowIso(), level, area, message.slice(0, 2000));
    this.run("DELETE FROM app_log WHERE id < (SELECT MAX(id) - 5000 FROM app_log)");
  }
  recentLogs(limit = 200) {
    return this.all("SELECT * FROM app_log ORDER BY id DESC LIMIT ?", limit);
  }

  // ---------- начальные данные ----------
  seedDefaults() {
    this.transaction(() => {
      for (const d of SOURCE_DEFINITIONS) {
        const exists = this.get("SELECT id FROM sources WHERE id=?", d.id);
        if (!exists) {
          this.run(
            "INSERT INTO sources(id, kind, label, enabled, homepage, min_interval_minutes, max_pages, coverage_note, terms_note, attribution) VALUES(?,?,?,?,?,?,?,?,?,?)",
            d.id, d.kind, d.label, d.enabledByDefault ? 1 : 0, d.homepage, d.minIntervalMinutes, d.maxPages, JSON.stringify(d.coverageNote), JSON.stringify(d.termsNote), d.attribution,
          );
        } else {
          // Описания условий обновляются с версией приложения; пользовательские настройки (enabled, интервал) сохраняются.
          this.run("UPDATE sources SET label=?, homepage=?, coverage_note=?, terms_note=?, attribution=? WHERE id=?", d.label, d.homepage, JSON.stringify(d.coverageNote), JSON.stringify(d.termsNote), d.attribution, d.id);
          // Минимальный интервал не может быть ниже официального.
          this.run("UPDATE sources SET min_interval_minutes=? WHERE id=? AND min_interval_minutes < ?", d.minIntervalMinutes, d.id, d.minIntervalMinutes);
          // Глубина прохода растёт вместе с адаптером (поиск по запросам, пагинация).
          this.run("UPDATE sources SET max_pages=? WHERE id=? AND max_pages < ?", d.maxPages, d.id, d.maxPages);
        }
      }
      // Раньше часть исключений поставлялась встроенной; теперь исключает только сам пользователь.
      this.run("DELETE FROM excluded_hosts WHERE builtin=1");
      for (const h of DEFAULT_EXCLUDED_HOSTS) {
        this.run("INSERT INTO excluded_hosts(host, reason, builtin) VALUES(?,?,1) ON CONFLICT(host) DO NOTHING", h.host, h.reason);
      }
    });
  }

  excludedHosts(): ExcludedHost[] {
    return this.all("SELECT host, reason FROM excluded_hosts ORDER BY builtin DESC, host").map((r) => ({ host: r.host, reason: r.reason }));
  }
  listExcludedHosts() {
    return this.all("SELECT host, reason, builtin FROM excluded_hosts ORDER BY builtin DESC, host").map((r) => ({ host: r.host as string, reason: r.reason as string, builtin: !!r.builtin }));
  }
  addExcludedHost(host: string, reason: string) {
    this.run("INSERT INTO excluded_hosts(host, reason, builtin) VALUES(?,?,0) ON CONFLICT(host) DO UPDATE SET reason=excluded.reason", host.toLowerCase().trim(), reason);
  }
  removeExcludedHost(host: string): boolean {
    const r = this.run("DELETE FROM excluded_hosts WHERE host=? AND builtin=0", host);
    return Number(r.changes) > 0;
  }

  // ---------- кандидаты и профили ----------
  private rowToCandidate(r: Row): Candidate {
    return { id: r.id, name: r.name, isDemo: !!r.is_demo, notes: r.notes, activeProfileVersion: r.active_profile_version, createdAt: r.created_at, updatedAt: r.updated_at };
  }
  listCandidates(): Candidate[] {
    return this.all("SELECT * FROM candidates ORDER BY is_demo, created_at").map((r) => this.rowToCandidate(r));
  }
  getCandidate(id: string): Candidate | null {
    const r = this.get("SELECT * FROM candidates WHERE id=?", id);
    return r ? this.rowToCandidate(r) : null;
  }
  createCandidate(input: { id?: string; name: string; rules: SearchRules; isDemo?: boolean; notes?: string; note?: string }): Candidate {
    const id = input.id ?? uid("cand-");
    const at = nowIso();
    this.transaction(() => {
      this.run("INSERT INTO candidates(id, name, is_demo, notes, active_profile_version, created_at, updated_at) VALUES(?,?,?,?,1,?,?)", id, input.name, input.isDemo ? 1 : 0, input.notes ?? "", at, at);
      this.run("INSERT INTO search_profiles(id, candidate_id, version, created_at, note, rules_json) VALUES(?,?,?,?,?,?)", uid("prof-"), id, 1, at, input.note ?? "", JSON.stringify(input.rules));
    });
    return this.getCandidate(id)!;
  }
  updateCandidate(id: string, patch: { name?: string; notes?: string }) {
    const c = this.getCandidate(id);
    if (!c) throw new Error("Кандидат не найден");
    this.run("UPDATE candidates SET name=?, notes=?, updated_at=? WHERE id=?", patch.name ?? c.name, patch.notes ?? c.notes, nowIso(), id);
  }
  deleteCandidate(id: string) {
    this.run("DELETE FROM candidates WHERE id=?", id);
  }
  currentProfile(candidateId: string): SearchProfileVersion {
    const r = this.get(
      "SELECT p.* FROM search_profiles p JOIN candidates c ON c.id=p.candidate_id AND c.active_profile_version=p.version WHERE p.candidate_id=?",
      candidateId,
    );
    if (!r) throw new Error("Профиль кандидата не найден");
    return { id: r.id, candidateId: r.candidate_id, version: r.version, createdAt: r.created_at, note: r.note, rules: j<SearchRules>(r.rules_json, null as any) };
  }
  /** Новая неизменяемая версия правил. Старые оценки сохраняются в истории. */
  saveRules(candidateId: string, rules: SearchRules, note: string): number {
    return this.transaction(() => {
      const max = (this.get("SELECT MAX(version) AS v FROM search_profiles WHERE candidate_id=?", candidateId)?.v as number) ?? 0;
      const next = max + 1;
      this.run("INSERT INTO search_profiles(id, candidate_id, version, created_at, note, rules_json) VALUES(?,?,?,?,?,?)", uid("prof-"), candidateId, next, nowIso(), note, JSON.stringify(rules));
      this.run("UPDATE candidates SET active_profile_version=?, updated_at=? WHERE id=?", next, nowIso(), candidateId);
      this.run(
        "UPDATE material_versions SET status='stale', updated_at=? WHERE candidate_id=? AND origin IN ('ai','template') AND status!='stale' AND profile_version IS NOT NULL AND profile_version < ?",
        nowIso(), candidateId, next,
      );
      return next;
    });
  }
  profileHistory(candidateId: string) {
    return this.all("SELECT version, created_at, note FROM search_profiles WHERE candidate_id=? ORDER BY version DESC", candidateId).map((r) => ({ version: r.version as number, createdAt: r.created_at as string, note: r.note as string }));
  }

  // ---------- проверки свободной части инструкций (ИИ) ----------
  saveInstructionCheck(c: { candidateId: string; vacancyId: string; notesHash: string; status: string; reason: Msg; quote: string | null }) {
    this.run(
      "INSERT INTO instruction_checks(candidate_id, vacancy_id, notes_hash, status, reason_json, quote, created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(candidate_id, vacancy_id, notes_hash) DO UPDATE SET status=excluded.status, reason_json=excluded.reason_json, quote=excluded.quote, created_at=excluded.created_at",
      c.candidateId, c.vacancyId, c.notesHash, c.status, JSON.stringify(c.reason), c.quote, nowIso(),
    );
  }
  instructionCheck(candidateId: string, vacancyId: string, notesHash: string): { status: "pass" | "fail" | "unknown"; reason: Msg; quote: string | null } | null {
    const r = this.get("SELECT status, reason_json, quote FROM instruction_checks WHERE candidate_id=? AND vacancy_id=? AND notes_hash=?", candidateId, vacancyId, notesHash);
    return r ? { status: r.status, reason: j<Msg>(r.reason_json, { ru: "", en: "" }), quote: r.quote } : null;
  }

  // ---------- навыки ----------
  listSkills(candidateId: string): SkillEvidence[] {
    return this.all("SELECT * FROM skill_evidence WHERE candidate_id=? ORDER BY kind, skill", candidateId).map((r) => ({
      id: r.id, candidateId: r.candidate_id, skill: r.skill, kind: r.kind, evidence: r.evidence, url: r.url, createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  }
  upsertSkill(s: { id?: string; candidateId: string; skill: string; kind: SkillEvidence["kind"]; evidence: string; url: string | null }): string {
    const at = nowIso();
    if (s.id && this.get("SELECT id FROM skill_evidence WHERE id=? AND candidate_id=?", s.id, s.candidateId)) {
      this.run("UPDATE skill_evidence SET skill=?, kind=?, evidence=?, url=?, updated_at=? WHERE id=?", s.skill, s.kind, s.evidence, s.url, at, s.id);
      return s.id;
    }
    const id = s.id ?? uid("skill-");
    this.run("INSERT INTO skill_evidence(id, candidate_id, skill, kind, evidence, url, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)", id, s.candidateId, s.skill, s.kind, s.evidence, s.url, at, at);
    return id;
  }
  deleteSkill(candidateId: string, id: string) {
    this.run("DELETE FROM skill_evidence WHERE id=? AND candidate_id=?", id, candidateId);
  }

  // ---------- источники ----------
  private rowToSource(r: Row): SourceInfo {
    return {
      id: r.id, kind: r.kind as SourceKind, label: r.label, enabled: !!r.enabled, homepage: r.homepage, minIntervalMinutes: r.min_interval_minutes,
      lastAttemptAt: r.last_attempt_at, lastSuccessAt: r.last_success_at, nextAllowedAt: r.next_allowed_at, lastStatus: r.last_status, lastError: r.last_error,
      coverageNote: msgOf(r.coverage_note), termsNote: msgOf(r.terms_note), attribution: r.attribution, maxPages: r.max_pages,
    };
  }
  listSources(): SourceInfo[] {
    return this.all("SELECT * FROM sources ORDER BY rowid").map((r) => this.rowToSource(r));
  }
  getSource(id: string): SourceInfo | null {
    const r = this.get("SELECT * FROM sources WHERE id=?", id);
    return r ? this.rowToSource(r) : null;
  }
  updateSource(id: string, patch: { enabled?: boolean; minIntervalMinutes?: number; maxPages?: number }) {
    const s = this.getSource(id);
    if (!s) throw new Error("Источник не найден");
    const def = SOURCE_DEFINITIONS.find((d) => d.id === id);
    const minAllowed = def?.minIntervalMinutes ?? 60;
    const interval = Math.max(minAllowed, patch.minIntervalMinutes ?? s.minIntervalMinutes);
    const pages = Math.max(1, Math.min(def?.maxPages ?? 1, patch.maxPages ?? s.maxPages));
    this.run("UPDATE sources SET enabled=?, min_interval_minutes=?, max_pages=? WHERE id=?", (patch.enabled ?? s.enabled) ? 1 : 0, interval, pages, id);
  }
  markSourceResult(id: string, status: SourceAttemptStatus, at: string, error: string | null, success: boolean) {
    const s = this.getSource(id);
    if (!s) return;
    const next = success ? new Date(new Date(at).getTime() + s.minIntervalMinutes * 60000).toISOString() : s.nextAllowedAt;
    // После сбоя следующий опрос не раньше чем через 30 минут (backoff), чтобы не долбить источник.
    const failNext = !success && (status === "failed" || status === "partial") ? new Date(new Date(at).getTime() + 30 * 60000).toISOString() : next;
    this.run(
      "UPDATE sources SET last_attempt_at=?, last_status=?, last_error=?, last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END, next_allowed_at=? WHERE id=?",
      at, status, error, success ? 1 : 0, at, success ? next : failNext, id,
    );
  }

  // ---------- компании (ATS) ----------
  listCompanies() {
    return this.all("SELECT * FROM companies ORDER BY watch DESC, name").map((r) => ({
      id: r.id as string, name: r.name as string, website: r.website as string | null, atsKind: r.ats_kind as string | null, atsSlug: r.ats_slug as string | null, watch: !!r.watch, notes: r.notes as string,
    }));
  }
  upsertCompany(c: { id?: string; name: string; website?: string | null; atsKind?: string | null; atsSlug?: string | null; watch?: boolean; notes?: string }): string {
    const norm = c.name.toLocaleLowerCase("ru-RU").replace(/\s+/g, " ").trim();
    const existing = (c.id ? this.get("SELECT id FROM companies WHERE id=?", c.id) : null) ?? this.get("SELECT id FROM companies WHERE normalized_name=?", norm);
    if (existing) {
      this.run(
        "UPDATE companies SET name=?, normalized_name=?, website=COALESCE(?, website), ats_kind=?, ats_slug=?, watch=?, notes=COALESCE(?, notes) WHERE id=?",
        c.name, norm, c.website ?? null, c.atsKind ?? null, c.atsSlug ?? null, c.watch ? 1 : 0, c.notes ?? null, existing.id,
      );
      return existing.id;
    }
    const id = c.id ?? uid("co-");
    this.run("INSERT INTO companies(id, name, normalized_name, website, ats_kind, ats_slug, watch, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?)", id, c.name, norm, c.website ?? null, c.atsKind ?? null, c.atsSlug ?? null, c.watch ? 1 : 0, c.notes ?? "", nowIso());
    return id;
  }
  deleteCompany(id: string) {
    this.run("DELETE FROM companies WHERE id=?", id);
  }
  watchedAtsCompanies() {
    return this.all("SELECT name, ats_kind, ats_slug FROM companies WHERE watch=1 AND ats_kind IS NOT NULL AND ats_slug IS NOT NULL AND ats_slug != '' ORDER BY name").map((r) => ({
      name: r.name as string, atsKind: r.ats_kind as string, atsSlug: r.ats_slug as string,
    }));
  }

  // ---------- вакансии ----------
  rowToVacancy(r: Row): Vacancy {
    return {
      id: r.id, title: r.title, company: r.company, companyId: r.company_id, canonicalUrl: r.canonical_url, sourceUrl: r.source_url, applyUrl: r.apply_url,
      sourceId: r.source_id, sourceJobId: r.source_job_id, requisitionId: r.requisition_id, location: r.location, employmentType: r.employment_type,
      levelText: r.level_text, description: r.description, publishedAt: r.published_at, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at,
      lastCheckedAt: r.last_checked_at, lifecycle: r.lifecycle, lifecycleEvidence: j<LifecycleEvidence[]>(r.lifecycle_evidence_json, []),
      postingKind: r.posting_kind, postingKindReason: msgOf(r.posting_kind_reason), contentHash: r.content_hash, facts: j<VacancyFacts>(r.facts_json, null as any),
      mergedIntoId: r.merged_into_id, isDemo: !!r.is_demo, tags: j<string[]>(r.tags_json, []), provenance: r.provenance,
    };
  }
  getVacancy(id: string): Vacancy | null {
    const r = this.get("SELECT * FROM vacancies WHERE id=?", id);
    return r ? this.rowToVacancy(r) : null;
  }
  allActiveVacancies(): Vacancy[] {
    return this.all("SELECT * FROM vacancies WHERE merged_into_id IS NULL").map((r) => this.rowToVacancy(r));
  }
  vacancyByExternalKey(key: string): Vacancy | null {
    const r = this.get("SELECT * FROM vacancies WHERE external_key=?", key);
    return r ? this.rowToVacancy(r) : null;
  }
  insertVacancy(v: Vacancy, externalKey: string | null = null) {
    this.run(
      `INSERT INTO vacancies(id, title, company, company_id, canonical_url, source_url, apply_url, source_id, source_job_id, requisition_id, fallback_key,
        location, employment_type, level_text, description, published_at, first_seen_at, last_seen_at, last_checked_at, lifecycle, lifecycle_evidence_json,
        posting_kind, posting_kind_reason, content_hash, facts_json, merged_into_id, is_demo, tags_json, provenance, external_key)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      v.id, v.title, v.company, v.companyId, v.canonicalUrl, v.sourceUrl, v.applyUrl, v.sourceId, v.sourceJobId, v.requisitionId, fallbackKey(v.company, v.title),
      v.location, v.employmentType, v.levelText, v.description, v.publishedAt, v.firstSeenAt, v.lastSeenAt, v.lastCheckedAt, v.lifecycle, JSON.stringify(v.lifecycleEvidence),
      v.postingKind, JSON.stringify(v.postingKindReason), v.contentHash, JSON.stringify(v.facts), v.mergedIntoId, v.isDemo ? 1 : 0, JSON.stringify(v.tags), v.provenance, externalKey,
    );
  }
  /** Обновление содержимого после изменения объявления (история — в observations и fact_evidence). */
  updateVacancyContent(id: string, v: Pick<Vacancy, "title" | "company" | "location" | "description" | "employmentType" | "levelText" | "publishedAt" | "contentHash" | "facts" | "postingKind" | "postingKindReason" | "tags" | "applyUrl">, at: string) {
    this.run(
      `UPDATE vacancies SET title=?, company=?, fallback_key=?, location=?, description=?, employment_type=?, level_text=?, published_at=COALESCE(?, published_at),
        content_hash=?, facts_json=?, posting_kind=?, posting_kind_reason=?, tags_json=?, apply_url=COALESCE(?, apply_url), last_seen_at=? WHERE id=?`,
      v.title, v.company, fallbackKey(v.company, v.title), v.location, v.description, v.employmentType, v.levelText, v.publishedAt, v.contentHash,
      JSON.stringify(v.facts), v.postingKind, JSON.stringify(v.postingKindReason), JSON.stringify(v.tags), v.applyUrl, at, id,
    );
    this.run("UPDATE material_versions SET status='stale', updated_at=? WHERE vacancy_id=? AND status!='stale' AND vacancy_hash IS NOT NULL AND vacancy_hash != ?", at, id, v.contentHash);
  }
  updateFacts(id: string, facts: VacancyFacts) {
    this.run("UPDATE vacancies SET facts_json=? WHERE id=?", JSON.stringify(facts), id);
  }
  touchVacancy(id: string, at: string) {
    this.run("UPDATE vacancies SET last_seen_at=? WHERE id=?", at, id);
  }
  setLifecycle(id: string, lifecycle: Lifecycle, evidence: LifecycleEvidence, checked: boolean) {
    const v = this.getVacancy(id);
    if (!v) return;
    const list = [...v.lifecycleEvidence, evidence].slice(-20);
    this.run("UPDATE vacancies SET lifecycle=?, lifecycle_evidence_json=?, last_checked_at=CASE WHEN ? THEN ? ELSE last_checked_at END WHERE id=?", lifecycle, JSON.stringify(list), checked ? 1 : 0, evidence.at, id);
  }

  dedupeIndex(): DedupeIndex {
    const toRef = (r: Row | undefined): VacRef | null =>
      r
        ? { id: r.id, sourceId: r.source_id, sourceJobId: r.source_job_id, canonicalUrl: r.canonical_url, requisitionId: r.requisition_id, company: r.company, title: r.title, location: r.location, description: r.description }
        : null;
    const resolve = (r: Row | undefined): Row | undefined => {
      // Ссылка на объединённую запись ведёт к основной.
      let cur = r;
      for (let i = 0; cur && cur.merged_into_id && i < 5; i++) cur = this.get("SELECT * FROM vacancies WHERE id=?", cur.merged_into_id);
      return cur;
    };
    return {
      bySourceJob: (sourceId, sourceJobId) => {
        const link = this.get("SELECT vacancy_id FROM vacancy_links WHERE source_id=? AND source_job_id=? LIMIT 1", sourceId, sourceJobId);
        const r = link ? this.get("SELECT * FROM vacancies WHERE id=?", link.vacancy_id) : this.get("SELECT * FROM vacancies WHERE source_id=? AND source_job_id=? LIMIT 1", sourceId, sourceJobId);
        return toRef(resolve(r));
      },
      byCanonicalUrl: (url) => {
        const r = this.get("SELECT * FROM vacancies WHERE canonical_url=? LIMIT 1", url) ?? (() => {
          const l = this.get("SELECT vacancy_id FROM vacancy_links WHERE url=? LIMIT 1", url);
          return l ? this.get("SELECT * FROM vacancies WHERE id=?", l.vacancy_id) : undefined;
        })();
        return toRef(resolve(r));
      },
      byRequisition: (req) => toRef(resolve(this.get("SELECT * FROM vacancies WHERE requisition_id=? LIMIT 1", req))),
      byFallbackKey: (key) => this.all("SELECT * FROM vacancies WHERE fallback_key=? AND merged_into_id IS NULL LIMIT 20", key).map((r) => toRef(r)!),
    };
  }

  addLink(vacancyId: string, sourceId: string, sourceJobId: string | null, url: string, at: string) {
    this.run(
      "INSERT INTO vacancy_links(id, vacancy_id, source_id, source_job_id, url, first_seen_at, last_seen_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id, url) DO UPDATE SET last_seen_at=excluded.last_seen_at",
      uid("lnk-"), vacancyId, sourceId, sourceJobId, url, at, at,
    );
  }
  linksFor(vacancyId: string) {
    return this.all(
      "SELECT l.*, s.label FROM vacancy_links l LEFT JOIN sources s ON s.id=l.source_id WHERE l.vacancy_id=? OR l.vacancy_id IN (SELECT id FROM vacancies WHERE merged_into_id=?) ORDER BY first_seen_at",
      vacancyId, vacancyId,
    ).map((r) => ({ sourceId: r.source_id as string, label: (r.label as string) ?? r.source_id, url: r.url as string, firstSeenAt: r.first_seen_at as string, lastSeenAt: r.last_seen_at as string }));
  }
  addObservation(o: { vacancyId: string; runId: string | null; sourceId: string; at: string; changeKind: "new" | "changed" | "unchanged" | "imported" | "recheck"; contentHash: string; snapshot: unknown }) {
    this.run("INSERT INTO observations(id, vacancy_id, run_id, source_id, observed_at, change_kind, content_hash, snapshot_json) VALUES(?,?,?,?,?,?,?,?)",
      uid("obs-"), o.vacancyId, o.runId, o.sourceId, o.at, o.changeKind, o.contentHash, JSON.stringify(o.snapshot));
  }
  observationsFor(vacancyId: string) {
    return this.all("SELECT id, run_id, source_id, observed_at, change_kind, content_hash FROM observations WHERE vacancy_id=? ORDER BY observed_at DESC LIMIT 50", vacancyId);
  }
  addFactEvidence(vacancyId: string, facts: VacancyFacts, sourceUrl: string, at: string, extractor = facts.extractorVersion) {
    const keys = ["salary", "format", "geography", "languages", "voice", "experience", "skills", "schedule", "aiPolicy", "deadline", "contract", "safety", "closureText"] as const;
    for (const k of keys) {
      const f: any = (facts as any)[k];
      const status = k === "salary" ? (f.origin === "structured" ? "structured" : f.origin === "text" ? "stated" : "unknown") : f.status;
      const value = k === "salary" ? f : f.value;
      const quote = f.quote ?? null;
      this.run("INSERT INTO fact_evidence(id, vacancy_id, fact_key, status, value_json, quote, source_url, observed_at, extractor) VALUES(?,?,?,?,?,?,?,?,?)",
        uid("fe-"), vacancyId, k, status, JSON.stringify(value), quote, sourceUrl, at, extractor);
    }
  }
  factHistory(vacancyId: string) {
    return this.all("SELECT fact_key, status, quote, observed_at, extractor FROM fact_evidence WHERE vacancy_id=? ORDER BY observed_at DESC LIMIT 200", vacancyId);
  }
  recordMerge(keptId: string, mergedId: string, kind: string, reason: string) {
    this.run("INSERT INTO vacancy_merges(id, kept_id, merged_id, kind, reason, created_at) VALUES(?,?,?,?,?,?)", uid("mrg-"), keptId, mergedId, kind, reason, nowIso());
  }
  mergesFor(vacancyId: string) {
    return this.all("SELECT * FROM vacancy_merges WHERE kept_id=? OR merged_id=? ORDER BY created_at DESC", vacancyId, vacancyId);
  }
  /** Отмена fallback-слияния: объединённая запись снова становится самостоятельной. */
  revertMerge(mergeId: string): string | null {
    const m = this.get("SELECT * FROM vacancy_merges WHERE id=? AND reverted_at IS NULL", mergeId);
    if (!m) return null;
    this.transaction(() => {
      this.run("UPDATE vacancies SET merged_into_id=NULL WHERE id=? AND merged_into_id=?", m.merged_id, m.kept_id);
      this.run("UPDATE vacancy_merges SET reverted_at=? WHERE id=?", nowIso(), mergeId);
    });
    return m.merged_id as string;
  }

  // ---------- оценки ----------
  private rowToAssessment(r: Row): Assessment {
    return {
      id: r.id, candidateId: r.candidate_id, vacancyId: r.vacancy_id, profileVersion: r.profile_version, rulesVersion: r.rules_version, createdAt: r.created_at,
      fit: r.fit, trackId: r.track_id, trackName: r.track_name, relevance: r.relevance, dimensions: j(r.dimensions_json, []), unknowns: j(r.unknowns_json, []),
      gaps: j(r.gaps_json, []), nextStep: msgOf(r.next_step), inputHash: r.input_hash, supersededAt: r.superseded_at,
    };
  }
  currentAssessment(candidateId: string, vacancyId: string): Assessment | null {
    const r = this.get("SELECT * FROM assessments WHERE candidate_id=? AND vacancy_id=? AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1", candidateId, vacancyId);
    return r ? this.rowToAssessment(r) : null;
  }
  assessmentHistory(candidateId: string, vacancyId: string): Assessment[] {
    return this.all("SELECT * FROM assessments WHERE candidate_id=? AND vacancy_id=? ORDER BY created_at DESC LIMIT 20", candidateId, vacancyId).map((r) => this.rowToAssessment(r));
  }
  /** Сохраняет оценку, если входные данные изменились. Предыдущая остаётся в истории (superseded). */
  saveAssessment(a: Omit<Assessment, "id" | "createdAt" | "supersededAt">): { changed: boolean; previous: Assessment | null; current: Assessment } {
    const prev = this.currentAssessment(a.candidateId, a.vacancyId);
    if (prev && prev.inputHash === a.inputHash) return { changed: false, previous: prev, current: prev };
    const at = nowIso();
    const id = uid("as-");
    if (prev) this.run("UPDATE assessments SET superseded_at=? WHERE id=?", at, prev.id);
    this.run(
      "INSERT INTO assessments(id, candidate_id, vacancy_id, profile_version, rules_version, created_at, fit, track_id, track_name, relevance, dimensions_json, unknowns_json, gaps_json, next_step, input_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, a.candidateId, a.vacancyId, a.profileVersion, a.rulesVersion, at, a.fit, a.trackId, a.trackName, a.relevance, JSON.stringify(a.dimensions),
      JSON.stringify(a.unknowns), JSON.stringify(a.gaps), JSON.stringify(a.nextStep), a.inputHash,
    );
    return { changed: true, previous: prev, current: { ...a, id, createdAt: at, supersededAt: null } };
  }

  listVacanciesForCandidate(candidateId: string): VacancyListItem[] {
    const rows = this.all(
      `SELECT v.id, v.title, v.company, v.location, v.source_id, v.canonical_url, v.published_at, v.first_seen_at, v.last_seen_at, v.last_checked_at,
              v.lifecycle, v.posting_kind, v.is_demo, v.facts_json,
              a.fit, a.relevance, a.track_name, a.next_step,
              ap.stage, ap.dismiss_reason,
              (SELECT MAX(observed_at) FROM observations o WHERE o.vacancy_id=v.id AND o.change_kind='changed') AS last_changed,
              (SELECT COUNT(DISTINCT source_id) FROM vacancy_links l WHERE l.vacancy_id=v.id OR l.vacancy_id IN (SELECT id FROM vacancies m WHERE m.merged_into_id=v.id)) AS src_count
         FROM vacancies v
         LEFT JOIN assessments a ON a.vacancy_id=v.id AND a.candidate_id=? AND a.superseded_at IS NULL
         LEFT JOIN applications ap ON ap.vacancy_id=v.id AND ap.candidate_id=?
        WHERE v.merged_into_id IS NULL AND v.is_demo = (SELECT is_demo FROM candidates WHERE id=?)`,
      candidateId, candidateId, candidateId,
    );
    return rows.map((r) => {
      const facts = j<VacancyFacts | null>(r.facts_json, null);
      return {
        id: r.id, title: r.title, company: r.company, location: r.location, sourceId: r.source_id, canonicalUrl: r.canonical_url,
        publishedAt: r.published_at, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, lastCheckedAt: r.last_checked_at, lastChangedAt: r.last_changed,
        lifecycle: r.lifecycle, postingKind: r.posting_kind, isDemo: !!r.is_demo,
        salary: facts?.salary ?? { kind: "unknown", min: null, max: null, currency: null, period: null, guaranteedHoursPerWeek: null, origin: "none", quote: null },
        format: facts?.format.value ?? "unknown",
        fit: r.fit ?? null, relevance: r.relevance ?? null, trackName: r.track_name ?? null, nextStep: r.next_step ? msgOf(r.next_step) : null,
        stage: r.stage ?? null, dismissReason: r.dismiss_reason ?? null, sourceCount: Number(r.src_count) || 1,
      };
    });
  }

  // ---------- отклики ----------
  private rowToApplication(r: Row): Application {
    return {
      id: r.id, candidateId: r.candidate_id, vacancyId: r.vacancy_id, stage: r.stage, history: j(r.history_json, []), dismissReason: r.dismiss_reason,
      submittedAt: r.submitted_at, followUpAt: r.follow_up_at, notes: r.notes, checklist: j(r.checklist_json, {}), materialVersionIds: j(r.material_version_ids_json, []),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  getApplication(candidateId: string, vacancyId: string): Application | null {
    const r = this.get("SELECT * FROM applications WHERE candidate_id=? AND vacancy_id=?", candidateId, vacancyId);
    return r ? this.rowToApplication(r) : null;
  }
  getApplicationById(id: string): Application | null {
    const r = this.get("SELECT * FROM applications WHERE id=?", id);
    return r ? this.rowToApplication(r) : null;
  }
  listApplications(candidateId: string): Application[] {
    return this.all("SELECT * FROM applications WHERE candidate_id=? ORDER BY updated_at DESC", candidateId).map((r) => this.rowToApplication(r));
  }
  setStage(candidateId: string, vacancyId: string, stage: ApplicationStage, note = "", extra: { dismissReason?: string | null; submittedAt?: string | null } = {}): Application {
    const at = nowIso();
    const cur = this.getApplication(candidateId, vacancyId);
    if (!cur) {
      const id = uid("app-");
      const history = [{ stage, at, note }];
      this.run(
        "INSERT INTO applications(id, candidate_id, vacancy_id, stage, history_json, dismiss_reason, submitted_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        id, candidateId, vacancyId, stage, JSON.stringify(history), extra.dismissReason ?? null, stage === "submitted" ? extra.submittedAt ?? at : null, at, at,
      );
      return this.getApplication(candidateId, vacancyId)!;
    }
    const history = [...cur.history, { stage, at, note }];
    const submittedAt = stage === "submitted" ? extra.submittedAt ?? cur.submittedAt ?? at : cur.submittedAt;
    const dismiss = stage === "archived" ? extra.dismissReason ?? cur.dismissReason : stage === "saved" ? null : cur.dismissReason;
    this.run("UPDATE applications SET stage=?, history_json=?, dismiss_reason=?, submitted_at=?, updated_at=? WHERE id=?", stage, JSON.stringify(history), dismiss, submittedAt, at, cur.id);
    return this.getApplication(candidateId, vacancyId)!;
  }
  updateApplication(id: string, patch: { followUpAt?: string | null; notes?: string; checklist?: Record<string, boolean>; materialVersionIds?: string[] }) {
    const a = this.getApplicationById(id);
    if (!a) throw new Error("Отклик не найден");
    if (patch.materialVersionIds) {
      // Документы другого кандидата прикрепить нельзя.
      for (const mv of patch.materialVersionIds) {
        const r = this.get("SELECT candidate_id FROM material_versions WHERE id=?", mv);
        if (!r || r.candidate_id !== a.candidateId) throw new Error("Документ принадлежит другому кандидату / document belongs to another candidate");
      }
    }
    this.run(
      "UPDATE applications SET follow_up_at=?, notes=?, checklist_json=?, material_version_ids_json=?, updated_at=? WHERE id=?",
      patch.followUpAt !== undefined ? patch.followUpAt : a.followUpAt, patch.notes ?? a.notes, JSON.stringify(patch.checklist ?? a.checklist),
      JSON.stringify(patch.materialVersionIds ?? a.materialVersionIds), nowIso(), id,
    );
  }
  dueFollowUps(candidateId: string, untilIso: string) {
    return this.all("SELECT * FROM applications WHERE candidate_id=? AND follow_up_at IS NOT NULL AND follow_up_at <= ? AND stage IN ('submitted','response','interview') ORDER BY follow_up_at", candidateId, untilIso).map((r) => this.rowToApplication(r));
  }

  // ---------- материалы ----------
  private rowToMaterial(r: Row): MaterialVersion {
    return {
      id: r.id, materialId: r.material_id, candidateId: r.candidate_id, vacancyId: r.vacancy_id, kind: r.kind, title: r.title, version: r.version, status: r.status,
      origin: r.origin, content: r.content, filePath: r.file_path, fileHash: r.file_hash, fileAvailable: r.file_available === null ? null : !!r.file_available,
      aiModel: r.ai_model, promptVersion: r.prompt_version, profileVersion: r.profile_version, vacancyHash: r.vacancy_hash, usedFacts: j(r.used_facts_json, []),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  listMaterialVersions(candidateId: string): MaterialVersion[] {
    return this.all("SELECT mv.*, m.kind, m.title FROM material_versions mv JOIN materials m ON m.id=mv.material_id WHERE mv.candidate_id=? ORDER BY m.title, mv.version DESC", candidateId).map((r) => this.rowToMaterial(r));
  }
  getMaterialVersion(id: string): MaterialVersion | null {
    const r = this.get("SELECT mv.*, m.kind, m.title FROM material_versions mv JOIN materials m ON m.id=mv.material_id WHERE mv.id=?", id);
    return r ? this.rowToMaterial(r) : null;
  }
  createMaterialVersion(input: {
    materialId?: string | null; candidateId: string; kind: MaterialKind; title: string; vacancyId?: string | null; status: MaterialStatus; origin: MaterialVersion["origin"];
    content: string; filePath?: string | null; fileHash?: string | null; fileAvailable?: boolean | null; aiModel?: string | null; promptVersion?: string | null;
    profileVersion?: number | null; vacancyHash?: string | null; usedFacts?: string[];
  }): MaterialVersion {
    return this.transaction(() => {
      let materialId = input.materialId ?? null;
      if (materialId) {
        const m = this.get("SELECT candidate_id FROM materials WHERE id=?", materialId);
        if (!m || m.candidate_id !== input.candidateId) throw new Error("Документ принадлежит другому кандидату / document belongs to another candidate");
      } else {
        materialId = uid("mat-");
        this.run("INSERT INTO materials(id, candidate_id, kind, title, created_at) VALUES(?,?,?,?,?)", materialId, input.candidateId, input.kind, input.title, nowIso());
      }
      const v = ((this.get("SELECT MAX(version) AS v FROM material_versions WHERE material_id=?", materialId)?.v as number) ?? 0) + 1;
      const id = uid("mv-");
      const at = nowIso();
      this.run(
        `INSERT INTO material_versions(id, material_id, candidate_id, vacancy_id, version, status, origin, content, file_path, file_hash, file_available, ai_model,
          prompt_version, profile_version, vacancy_hash, used_facts_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, materialId, input.candidateId, input.vacancyId ?? null, v, input.status, input.origin, input.content, input.filePath ?? null, input.fileHash ?? null,
        input.fileAvailable === undefined || input.fileAvailable === null ? null : input.fileAvailable ? 1 : 0, input.aiModel ?? null, input.promptVersion ?? null,
        input.profileVersion ?? null, input.vacancyHash ?? null, JSON.stringify(input.usedFacts ?? []), at, at,
      );
      return this.getMaterialVersion(id)!;
    });
  }
  updateMaterialVersion(id: string, patch: { status?: MaterialStatus; content?: string; fileAvailable?: boolean | null }) {
    const m = this.getMaterialVersion(id);
    if (!m) throw new Error("Версия документа не найдена");
    this.run("UPDATE material_versions SET status=?, content=?, file_available=?, updated_at=? WHERE id=?", patch.status ?? m.status, patch.content ?? m.content,
      patch.fileAvailable === undefined ? (m.fileAvailable === null ? null : m.fileAvailable ? 1 : 0) : patch.fileAvailable === null ? null : patch.fileAvailable ? 1 : 0, nowIso(), id);
  }
  deleteMaterialVersion(candidateId: string, id: string) {
    this.run("DELETE FROM material_versions WHERE id=? AND candidate_id=?", id, candidateId);
    this.run("DELETE FROM materials WHERE candidate_id=? AND id NOT IN (SELECT material_id FROM material_versions)", candidateId);
  }

  // ---------- запуски ----------
  createRun(trigger: RunTrigger, rulesVersion: string): string {
    const id = uid("run-");
    const at = nowIso();
    this.run("INSERT INTO search_runs(id, trigger, started_at, status, stats_json, rules_version, heartbeat_at) VALUES(?,?,?,?,?,?,?)", id, trigger, at, "running", JSON.stringify(EMPTY_STATS), rulesVersion, at);
    return id;
  }
  heartbeat(runId: string, stats: RunStats) {
    this.run("UPDATE search_runs SET heartbeat_at=?, stats_json=? WHERE id=?", nowIso(), JSON.stringify(stats), runId);
  }
  finishRun(runId: string, status: RunStatus, stats: RunStats) {
    this.run("UPDATE search_runs SET finished_at=?, status=?, stats_json=? WHERE id=?", nowIso(), status, JSON.stringify(stats), runId);
  }
  /** Запуск, оставшийся «running» после аварийного выхода, помечается как прерванный. */
  closeStaleRuns(olderThanMinutes = 30): number {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60000).toISOString();
    const r = this.run("UPDATE search_runs SET status='failed', finished_at=? WHERE status='running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)", nowIso(), cutoff);
    return Number(r.changes);
  }
  runningRun(): SearchRun | null {
    const r = this.get("SELECT * FROM search_runs WHERE status='running' ORDER BY started_at DESC LIMIT 1");
    return r ? this.rowToRun(r) : null;
  }
  private rowToRun(r: Row): SearchRun {
    return { id: r.id, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, stats: { ...EMPTY_STATS, ...j(r.stats_json, {}) }, rulesVersion: r.rules_version };
  }
  listRuns(limit = 30): SearchRun[] {
    return this.all("SELECT * FROM search_runs ORDER BY started_at DESC LIMIT ?", limit).map((r) => this.rowToRun(r));
  }
  getRun(id: string): SearchRun | null {
    const r = this.get("SELECT * FROM search_runs WHERE id=?", id);
    return r ? this.rowToRun(r) : null;
  }
  addAttempt(runId: string, sourceId: string, status: SourceAttemptStatus, at: string): string {
    const id = uid("att-");
    this.run("INSERT INTO source_attempts(id, run_id, source_id, status, started_at) VALUES(?,?,?,?,?)", id, runId, sourceId, status, at);
    return id;
  }
  finishAttempt(id: string, p: { status: SourceAttemptStatus; httpStatus?: number | null; error?: string | null; items?: number; coverage?: Coverage | null }) {
    this.run("UPDATE source_attempts SET status=?, finished_at=?, http_status=?, error=?, items=?, coverage_json=? WHERE id=?", p.status, nowIso(), p.httpStatus ?? null, p.error ?? null, p.items ?? 0, p.coverage ? JSON.stringify(p.coverage) : null, id);
  }
  attemptsForRun(runId: string): SourceAttempt[] {
    return this.all("SELECT * FROM source_attempts WHERE run_id=? ORDER BY started_at", runId).map((r) => ({
      id: r.id, runId: r.run_id, sourceId: r.source_id, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, httpStatus: r.http_status, error: r.error, items: r.items, coverage: j(r.coverage_json, null),
    }));
  }

  // ---------- уведомления ----------
  /** false — такое уведомление уже было (дедупликация по ключу). */
  addNotification(n: Omit<NotificationEvent, "id" | "createdAt" | "readAt">): boolean {
    const r = this.run(
      "INSERT INTO notification_events(id, candidate_id, kind, dedupe_key, title, body, vacancy_id, created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING",
      uid("ntf-"), n.candidateId, n.kind, n.dedupeKey, JSON.stringify(n.title), JSON.stringify(n.body), n.vacancyId, nowIso(),
    );
    return Number(r.changes) > 0;
  }
  listNotifications(candidateId: string | null, limit = 50): NotificationEvent[] {
    return this.all("SELECT * FROM notification_events WHERE candidate_id IS ? OR candidate_id=? OR candidate_id IS NULL ORDER BY created_at DESC LIMIT ?", candidateId, candidateId, limit).map((r) => ({
      id: r.id, candidateId: r.candidate_id, kind: r.kind, dedupeKey: r.dedupe_key, title: msgOf(r.title), body: msgOf(r.body), vacancyId: r.vacancy_id, createdAt: r.created_at, readAt: r.read_at,
    }));
  }
  markNotificationsRead(candidateId: string | null) {
    this.run("UPDATE notification_events SET read_at=? WHERE read_at IS NULL AND (candidate_id=? OR candidate_id IS NULL)", nowIso(), candidateId);
  }

  // ---------- расписание ----------
  addScheduleEvent(kind: "ran" | "missed" | "catchup" | "skipped_running" | "paused" | "resumed" | "enabled" | "disabled", slot: string | null, note = "") {
    this.run("INSERT INTO schedule_events(id, kind, slot, note, created_at) VALUES(?,?,?,?,?)", uid("sch-"), kind, slot, note, nowIso());
  }
  listScheduleEvents(limit = 30) {
    return this.all("SELECT * FROM schedule_events ORDER BY created_at DESC LIMIT ?", limit).map((r) => ({ kind: r.kind as string, slot: r.slot as string | null, note: r.note as string, createdAt: r.created_at as string }));
  }

  // ---------- AI ----------
  aiCacheGet(inputHash: string): Row | undefined {
    return this.get("SELECT * FROM ai_calls WHERE input_hash=? AND status='ok' ORDER BY created_at DESC LIMIT 1", inputHash);
  }
  aiRecord(c: { purpose: string; provider: string; model: string; promptVersion: string; inputHash: string; status: string; tokensIn?: number; tokensOut?: number; costUsd?: number; error?: string | null; response?: unknown; vacancyId?: string | null; candidateId?: string | null }) {
    this.run(
      "INSERT INTO ai_calls(id, purpose, provider, model, prompt_version, input_hash, status, tokens_in, tokens_out, cost_usd, error, response_json, vacancy_id, candidate_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      uid("ai-"), c.purpose, c.provider, c.model, c.promptVersion, c.inputHash, c.status, c.tokensIn ?? 0, c.tokensOut ?? 0, c.costUsd ?? 0, c.error ?? null,
      c.response === undefined ? null : JSON.stringify(c.response), c.vacancyId ?? null, c.candidateId ?? null, nowIso(),
    );
  }
  aiMonthSpend(now = new Date()): { usd: number; calls: number } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const r = this.get("SELECT COALESCE(SUM(cost_usd),0) AS usd, COUNT(*) AS n FROM ai_calls WHERE created_at >= ? AND status IN ('ok','invalid')", start);
    return { usd: Number(r?.usd ?? 0), calls: Number(r?.n ?? 0) };
  }
  aiRecentCalls(limit = 30) {
    return this.all("SELECT purpose, provider, model, prompt_version, status, tokens_in, tokens_out, cost_usd, error, created_at FROM ai_calls ORDER BY created_at DESC LIMIT ?", limit);
  }

  // ---------- импорт ----------
  addImportBatch(kind: string, label: string, status: string, stats: unknown, backupPath: string | null): string {
    const id = uid("imp-");
    this.run("INSERT INTO import_batches(id, kind, label, created_at, status, stats_json, backup_path) VALUES(?,?,?,?,?,?,?)", id, kind, label, nowIso(), status, JSON.stringify(stats), backupPath);
    return id;
  }
  listImportBatches() {
    return this.all("SELECT * FROM import_batches ORDER BY created_at DESC LIMIT 30").map((r) => ({ ...r, stats: j(r.stats_json, {}) }));
  }

  counts() {
    const one = (sql: string) => Number(this.get(sql)?.n ?? 0);
    return {
      candidates: one("SELECT COUNT(*) n FROM candidates"),
      vacancies: one("SELECT COUNT(*) n FROM vacancies WHERE merged_into_id IS NULL"),
      applications: one("SELECT COUNT(*) n FROM applications"),
      materials: one("SELECT COUNT(*) n FROM material_versions"),
      runs: one("SELECT COUNT(*) n FROM search_runs"),
    };
  }
}
