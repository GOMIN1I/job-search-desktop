// Открытие базы, миграции и резервные копии. Используется встроенный node:sqlite (без нативных модулей).

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DB = DatabaseSync;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
  active_profile_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE search_profiles (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, created_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', rules_json TEXT NOT NULL,
  UNIQUE(candidate_id, version)
);
CREATE TABLE skill_evidence (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  skill TEXT NOT NULL, kind TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '', url TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  homepage TEXT NOT NULL DEFAULT '', min_interval_minutes INTEGER NOT NULL DEFAULT 720, max_pages INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT, last_success_at TEXT, next_allowed_at TEXT, last_status TEXT, last_error TEXT,
  coverage_note TEXT NOT NULL DEFAULT '', terms_note TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE excluded_hosts (host TEXT PRIMARY KEY, reason TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0);

CREATE TABLE companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, website TEXT,
  ats_kind TEXT, ats_slug TEXT, watch INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);

CREATE TABLE vacancies (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, company TEXT NOT NULL, company_id TEXT,
  canonical_url TEXT NOT NULL, source_url TEXT NOT NULL, apply_url TEXT,
  source_id TEXT NOT NULL, source_job_id TEXT, requisition_id TEXT, fallback_key TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '', employment_type TEXT, level_text TEXT, description TEXT NOT NULL DEFAULT '',
  published_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_checked_at TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'unchecked', lifecycle_evidence_json TEXT NOT NULL DEFAULT '[]',
  posting_kind TEXT NOT NULL DEFAULT 'job_posting', posting_kind_reason TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL, facts_json TEXT NOT NULL, merged_into_id TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0, tags_json TEXT NOT NULL DEFAULT '[]', provenance TEXT NOT NULL DEFAULT '',
  external_key TEXT UNIQUE
);
CREATE INDEX vac_url ON vacancies(canonical_url);
CREATE INDEX vac_src ON vacancies(source_id, source_job_id);
CREATE INDEX vac_req ON vacancies(requisition_id);
CREATE INDEX vac_fb ON vacancies(fallback_key);
CREATE INDEX vac_merged ON vacancies(merged_into_id);

CREATE TABLE vacancy_links (
  id TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL, source_job_id TEXT, url TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  UNIQUE(source_id, url)
);
CREATE INDEX link_job ON vacancy_links(source_id, source_job_id);

CREATE TABLE observations (
  id TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE, run_id TEXT,
  source_id TEXT NOT NULL, observed_at TEXT NOT NULL, change_kind TEXT NOT NULL, content_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL
);
CREATE INDEX obs_vac ON observations(vacancy_id);

CREATE TABLE fact_evidence (
  id TEXT PRIMARY KEY, vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE, fact_key TEXT NOT NULL,
  status TEXT NOT NULL, value_json TEXT NOT NULL, quote TEXT, source_url TEXT NOT NULL, observed_at TEXT NOT NULL, extractor TEXT NOT NULL
);
CREATE INDEX fe_vac ON fact_evidence(vacancy_id);

CREATE TABLE vacancy_merges (
  id TEXT PRIMARY KEY, kept_id TEXT NOT NULL, merged_id TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL,
  created_at TEXT NOT NULL, reverted_at TEXT
);

CREATE TABLE assessments (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE, profile_version INTEGER NOT NULL,
  rules_version TEXT NOT NULL, created_at TEXT NOT NULL, fit TEXT NOT NULL, track_id TEXT, track_name TEXT,
  relevance INTEGER NOT NULL, dimensions_json TEXT NOT NULL, unknowns_json TEXT NOT NULL, gaps_json TEXT NOT NULL,
  next_step TEXT NOT NULL, input_hash TEXT NOT NULL, superseded_at TEXT
);
CREATE INDEX as_cur ON assessments(candidate_id, superseded_at);
CREATE INDEX as_vac ON assessments(vacancy_id, candidate_id);

CREATE TABLE applications (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE, stage TEXT NOT NULL, history_json TEXT NOT NULL,
  dismiss_reason TEXT, submitted_at TEXT, follow_up_at TEXT, notes TEXT NOT NULL DEFAULT '', checklist_json TEXT NOT NULL DEFAULT '{}',
  material_version_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(candidate_id, vacancy_id)
);

CREATE TABLE materials (
  id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE material_versions (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, vacancy_id TEXT,
  version INTEGER NOT NULL, status TEXT NOT NULL, origin TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  file_path TEXT, file_hash TEXT, file_available INTEGER, ai_model TEXT, prompt_version TEXT, profile_version INTEGER,
  vacancy_hash TEXT, used_facts_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE search_runs (
  id TEXT PRIMARY KEY, trigger TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}', rules_version TEXT NOT NULL, heartbeat_at TEXT
);
CREATE TABLE source_attempts (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES search_runs(id) ON DELETE CASCADE, source_id TEXT NOT NULL,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, http_status INTEGER, error TEXT,
  items INTEGER NOT NULL DEFAULT 0, coverage_json TEXT
);
CREATE INDEX att_run ON source_attempts(run_id);

CREATE TABLE notification_events (
  id TEXT PRIMARY KEY, candidate_id TEXT, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  body TEXT NOT NULL, vacancy_id TEXT, created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE schedule_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, slot TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);

CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY, purpose TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL, status TEXT NOT NULL, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0, error TEXT, response_json TEXT, vacancy_id TEXT, candidate_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX ai_hash ON ai_calls(input_hash, status);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
  stats_json TEXT NOT NULL DEFAULT '{}', backup_path TEXT
);
CREATE TABLE app_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, area TEXT NOT NULL, message TEXT NOT NULL);
`,
  },
  {
    version: 2,
    name: "instruction checks, cloud sync",
    sql: `
CREATE TABLE instruction_checks (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
  notes_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  reason_json TEXT NOT NULL,
  quote TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, vacancy_id, notes_hash)
);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function currentVersion(db: DB): number {
  const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
  if (!has) return 0;
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

export function backupTo(db: DB, file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

export function timestampSlug(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export interface OpenResult {
  db: DB;
  migratedFrom: number;
  backupPath: string | null;
}

/** Открывает базу, создаёт резервную копию перед миграцией существующей базы и применяет миграции в транзакции. */
export function openDatabase(file: string, opts: { backupDir?: string; migrations?: Migration[] } = {}): OpenResult {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;");
  const migrations = opts.migrations ?? MIGRATIONS;
  const from = currentVersion(db);
  const pending = migrations.filter((m) => m.version > from);
  let backupPath: string | null = null;
  if (pending.length && from > 0 && file !== ":memory:") {
    const dir = opts.backupDir ?? path.join(path.dirname(file), "backups");
    backupPath = backupTo(db, path.join(dir, `pre-migration-v${from}-${timestampSlug()}.sqlite`));
  }
  for (const m of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(m.version));
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      db.close();
      throw new Error(`Миграция ${m.version} (${m.name}) не применена: ${(e as Error).message}`);
    }
  }
  return { db, migratedFrom: from, backupPath };
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
