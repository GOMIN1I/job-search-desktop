// Импорт и экспорт: предпросмотр → подтверждение → резервная копия → транзакция (откат при ошибке).
// Повторный импорт идемпотентен. URL из импортируемых файлов не открываются и не запрашиваются.

import path from "node:path";
import type { Repo } from "../db/repo";
import { backupTo, SCHEMA_VERSION, timestampSlug } from "../db/db";
import type { MaterialKind, SearchRules, SkillEvidence } from "../shared/types";
import { blockedReason, canonicalizeUrl } from "../core/policy";
import { emptyRules } from "../core/templates";
import { oneLine, sha } from "../core/text";
import type { RawJob } from "../sources/adapters";
import { csvToObjects } from "./csv";
import { assessAll, ingestRaw } from "../pipeline/run";

// ---------- Полная резервная копия (JSON) ----------

const BACKUP_TABLES = [
  "candidates", "search_profiles", "skill_evidence", "companies", "vacancies", "vacancy_links", "observations", "fact_evidence", "vacancy_merges",
  "assessments", "applications", "materials", "material_versions", "search_runs", "source_attempts", "notification_events", "schedule_events", "excluded_hosts",
] as const;

export const BACKUP_FORMAT = "job-search-desktop-backup";

export function exportBackup(repo: Repo) {
  const tables: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) tables[t] = repo.db.prepare(`SELECT * FROM ${t}`).all();
  // Секреты (ключи AI) не экспортируются: они хранятся отдельно средствами ОС.
  return { format: BACKUP_FORMAT, version: 1, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
}

export interface BackupPreview {
  valid: boolean;
  errors: string[];
  tables: Record<string, { total: number; new: number; existing: number }>;
}

export function previewBackup(repo: Repo, data: any): BackupPreview {
  const errors: string[] = [];
  if (!data || data.format !== BACKUP_FORMAT) errors.push("Неизвестный формат файла / unknown file format");
  if (data?.schemaVersion > SCHEMA_VERSION) errors.push(`Файл из более новой версии приложения (схема ${data.schemaVersion}) / file is from a newer app version`);
  const tables: BackupPreview["tables"] = {};
  if (!errors.length) {
    for (const t of BACKUP_TABLES) {
      const rows: any[] = Array.isArray(data.tables?.[t]) ? data.tables[t] : [];
      const key = t === "excluded_hosts" ? "host" : "id";
      let existing = 0;
      const stmt = repo.db.prepare(`SELECT 1 FROM ${t} WHERE ${key}=?`);
      for (const r of rows) if (r?.[key] !== undefined && stmt.get(r[key])) existing++;
      tables[t] = { total: rows.length, new: rows.length - existing, existing };
    }
  }
  return { valid: !errors.length, errors, tables };
}

/** Добавляет новые записи; существующие (тот же id) не перезаписываются. Перед импортом — копия базы. */
export function applyBackup(repo: Repo, data: any, backupDir: string) {
  const pv = previewBackup(repo, data);
  if (!pv.valid) throw new Error(pv.errors.join("; "));
  const backupPath = backupTo(repo.db, path.join(backupDir, `pre-import-${timestampSlug()}.sqlite`));
  let inserted = 0;
  repo.transaction(() => {
    for (const t of BACKUP_TABLES) {
      const rows: any[] = Array.isArray(data.tables?.[t]) ? data.tables[t] : [];
      if (!rows.length) continue;
      const cols = (repo.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
      const key = t === "excluded_hosts" ? "host" : "id";
      const exists = repo.db.prepare(`SELECT 1 FROM ${t} WHERE ${key}=?`);
      for (const r of rows) {
        const use = cols.filter((c) => c in r);
        if (!use.length || r[key] === undefined) continue;
        if (exists.get(r[key])) continue; // существующая запись не перезаписывается
        // Обычный INSERT: нарушение ограничений прерывает и откатывает весь импорт.
        const res = repo.db.prepare(`INSERT INTO ${t}(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`).run(...use.map((c) => r[c] as any));
        inserted += Number(res.changes);
      }
    }
  });
  repo.addImportBatch("backup", "JSON backup", "applied", { inserted, tables: pv.tables }, backupPath);
  return { inserted, backupPath };
}

// ---------- Импорт вакансий из CSV/JSON (Notion/Excel-экспорт, собственные списки) ----------

const COLS = {
  title: ["title", "вакансия", "position", "job title", "название", "role", "name"],
  company: ["company", "компания", "employer", "работодатель", "company_name"],
  url: ["canonical url", "url", "ссылка", "link", "job url", "careers url", "apply url"],
  description: ["description", "описание", "почему подходит", "заметки", "notes", "text"],
  location: ["location", "локация", "география", "страна найма", "формат"],
  salary: ["salary", "зарплата", "compensation", "pay"],
  published: ["published", "дата публикации", "date:дата публикации:start", "published_at", "posted"],
  checked: ["checked", "дата проверки", "date:дата проверки:start", "last checked"],
  id: ["id", "job id", "dedupe id", "external id"],
};

function pick(row: Record<string, unknown>, keys: string[]): string {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase().trim(), k]));
  for (const k of keys) {
    const real = lower.get(k);
    if (real && row[real] !== null && row[real] !== undefined && String(row[real]).trim() !== "") return String(row[real]).trim();
  }
  return "";
}

export type ImportRowStatus = "ok" | "exists" | "duplicate_in_file" | "blocked" | "invalid" | "stale";

export interface VacancyImportPreview {
  label: string;
  total: number;
  counts: Record<ImportRowStatus, number>;
  rows: Array<{ index: number; status: ImportRowStatus; title: string; company: string; url: string; note: string; checkedAt: string | null }>;
}

export function readVacancyFile(text: string, fileName: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (/\.json$/i.test(fileName) || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const data = JSON.parse(trimmed);
    const arr = Array.isArray(data) ? data : Array.isArray(data?.vacancies) ? data.vacancies : Array.isArray(data?.results) ? data.results : null;
    if (!arr) throw new Error("JSON должен быть массивом или содержать vacancies[] / JSON must be an array or contain vacancies[]");
    return arr;
  }
  return csvToObjects(text);
}

function rowKey(row: Record<string, unknown>, url: string, title: string, company: string): string {
  return pick(row, COLS.id) || url || `${company}|${title}`;
}

export function previewVacancyImport(repo: Repo, rows: Record<string, unknown>[], label: string, now = new Date()): VacancyImportPreview {
  const excluded = repo.excludedHosts();
  const seen = new Set<string>();
  const counts: Record<ImportRowStatus, number> = { ok: 0, exists: 0, duplicate_in_file: 0, blocked: 0, invalid: 0, stale: 0 };
  const out: VacancyImportPreview["rows"] = [];
  const idx = repo.dedupeIndex();
  rows.forEach((row, index) => {
    const title = oneLine(pick(row, COLS.title));
    const company = oneLine(pick(row, COLS.company));
    const rawUrl = pick(row, COLS.url);
    const url = canonicalizeUrl(rawUrl) ?? "";
    const checkedAt = pick(row, COLS.checked) || pick(row, COLS.published) || null;
    let status: ImportRowStatus = "ok";
    let note = "";
    const blocked = blockedReason(rawUrl, excluded) ?? blockedReason(JSON.stringify(row).slice(0, 20000), excluded);
    if (blocked) {
      status = "blocked";
      note = blocked;
    } else if (!title || !url) {
      status = "invalid";
      note = !title ? "Нет названия / no title" : "Нет корректного URL / no valid URL";
    } else {
      const key = `import:${label}:${rowKey(row, url, title, company)}`;
      if (seen.has(url)) {
        status = "duplicate_in_file";
        note = "Повтор в файле / duplicate in file";
      } else if (repo.vacancyByExternalKey(key) || idx.byCanonicalUrl(url)) {
        status = "exists";
        note = "Уже есть в базе — будет обновлено без дублей / already in the database";
      } else if (checkedAt && !Number.isNaN(Date.parse(checkedAt)) && now.getTime() - Date.parse(checkedAt) > 30 * 86400000) {
        status = "stale";
        note = `Старая дата проверки ${checkedAt.slice(0, 10)} — импортируется как «не проверено» / old check date`;
      }
      seen.add(url);
    }
    counts[status]++;
    out.push({ index, status, title, company, url, note, checkedAt });
  });
  return { label, total: rows.length, counts, rows: out };
}

export function applyVacancyImport(repo: Repo, rows: Record<string, unknown>[], label: string, backupDir: string, now = new Date()) {
  const pv = previewVacancyImport(repo, rows, label, now);
  const backupPath = backupTo(repo.db, path.join(backupDir, `pre-import-${timestampSlug()}.sqlite`));
  const result = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  const touched: string[] = [];
  repo.transaction(() => {
    pv.rows.forEach((r) => {
      if (r.status === "blocked" || r.status === "invalid" || r.status === "duplicate_in_file") {
        result.skipped++;
        return;
      }
      const row = rows[r.index];
      const raw: RawJob = {
        sourceId: "import",
        sourceJobId: `${label}:${rowKey(row, r.url, r.title, r.company)}`,
        title: r.title,
        company: r.company,
        url: r.url,
        applyUrl: null,
        description: [pick(row, COLS.description), ...Object.entries(row).filter(([k, v]) => v && /риск|ограничен|причина|payroll|оплата|договор|язык|часовой/i.test(k)).map(([k, v]) => `${k}: ${String(v)}`)].filter(Boolean).join("\n"),
        location: pick(row, COLS.location),
        employmentType: null,
        levelText: null,
        publishedAt: pick(row, COLS.published) || null,
        salary: pick(row, COLS.salary) ? { text: pick(row, COLS.salary) } : null,
        tags: [],
        remoteBySource: false,
        isEmployerAts: false,
      };
      const out = ingestRaw(repo, raw, { runId: null, now, provenance: `import:${label}`, externalKey: `import:${label}:${rowKey(row, r.url, r.title, r.company)}` });
      if (out.vacancyId) touched.push(out.vacancyId);
      if (out.change === "new") result.inserted++;
      else if (out.change === "changed") result.updated++;
      else if (out.change === "unchanged" || out.change === "merged") result.unchanged++;
      else result.skipped++;
    });
  });
  assessAll(repo, { vacancyIds: touched });
  repo.addImportBatch("vacancies", label, "applied", { ...result, counts: pv.counts }, backupPath);
  return { ...result, backupPath, counts: pv.counts };
}

// ---------- Импорт профилей кандидатов ----------

export const PROFILE_FORMAT = "job-search-desktop-profile" as const;

export interface ProfileFile {
  format: typeof PROFILE_FORMAT;
  version: 1;
  candidates: Array<{
    id?: string;
    name: string;
    notes?: string;
    note?: string;
    rules: Partial<SearchRules>;
    skills?: Array<{ skill: string; kind: SkillEvidence["kind"]; evidence?: string; url?: string | null }>;
    materials?: Array<{ kind: MaterialKind; title: string; content?: string; filePath?: string | null; status?: "draft" | "human_reviewed" }>;
  }>;
}

export function previewProfileImport(repo: Repo, data: any) {
  if (!data || data.format !== PROFILE_FORMAT || !Array.isArray(data.candidates)) return { valid: false, errors: ["Неизвестный формат профиля / unknown profile format"], candidates: [] as Array<{ name: string; exists: boolean; skills: number; materials: number }> };
  return {
    valid: true,
    errors: [] as string[],
    candidates: (data as ProfileFile).candidates.map((c) => ({
      name: c.name,
      exists: !!(c.id && repo.getCandidate(c.id)),
      skills: c.skills?.length ?? 0,
      materials: c.materials?.length ?? 0,
    })),
  };
}

export function applyProfileImport(repo: Repo, data: ProfileFile, backupDir: string, fileExists: (p: string) => boolean = () => false) {
  const pv = previewProfileImport(repo, data);
  if (!pv.valid) throw new Error(pv.errors.join("; "));
  const backupPath = backupTo(repo.db, path.join(backupDir, `pre-import-${timestampSlug()}.sqlite`));
  const created: string[] = [];
  let updated = 0;
  repo.transaction(() => {
    for (const c of data.candidates) {
      const rules: SearchRules = { ...emptyRules(), ...c.rules } as SearchRules;
      const id = c.id ?? `cand-${sha(c.name, 12)}`;
      const existing = repo.getCandidate(id);
      if (existing) {
        const cur = repo.currentProfile(id);
        if (JSON.stringify(cur.rules) !== JSON.stringify(rules)) {
          repo.saveRules(id, rules, c.note ?? "Импорт профиля / profile import");
          updated++;
        }
      } else {
        repo.createCandidate({ id, name: c.name, rules, notes: c.notes ?? "", note: c.note ?? "Импорт профиля / profile import" });
        created.push(id);
      }
      const have = repo.listSkills(id);
      for (const s of c.skills ?? []) {
        if (have.some((h) => h.skill.toLowerCase() === s.skill.toLowerCase())) continue;
        repo.upsertSkill({ candidateId: id, skill: s.skill, kind: s.kind, evidence: s.evidence ?? "", url: s.url ?? null });
      }
      const mats = repo.listMaterialVersions(id);
      for (const m of c.materials ?? []) {
        if (mats.some((x) => x.title === m.title)) continue;
        repo.createMaterialVersion({
          candidateId: id, kind: m.kind, title: m.title, status: m.status ?? "draft", origin: "imported", content: m.content ?? "",
          filePath: m.filePath ?? null, fileAvailable: m.filePath ? fileExists(m.filePath) : null,
        });
      }
    }
  });
  assessAll(repo, { candidateIds: [...created, ...data.candidates.map((c) => c.id ?? `cand-${sha(c.name, 12)}`)] });
  repo.addImportBatch("profile", `${data.candidates.length} profiles`, "applied", { created: created.length, updated }, backupPath);
  return { created: created.length, updated, backupPath };
}
