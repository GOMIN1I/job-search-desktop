// Сервер поиска: ищет вакансии по расписанию, когда компьютер человека выключен или спит.
// Тот же код ядра, что в приложении (источники, правила, инструкции, расписание в часовом поясе человека).
// Приложение отправляет профиль и расписание, а при возвращении забирает собранное и само оценивает и уведомляет.
//
// Запуск: DATA_DIR=./data SERVER_SECRET=<32+ символа> PORT=8787 node server/dist/server.js

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../src/db/db";
import { Repo } from "../../src/db/repo";
import { runSearch } from "../../src/pipeline/run";
import { planSchedule, nextSlot } from "../../src/core/schedule";
import type { RawJob } from "../../src/sources/adapters";
import type { ScheduleSettings, SearchRules } from "../../src/shared/types";

export interface ServerOptions {
  dataDir: string;
  secret: string;
  port?: number;
  /** Подмена сети и времени — для тестов. */
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  pauseMs?: number;
  tickMs?: number;
  maxAccounts?: number;
}

const OUTBOX_DAYS = 30;
const MAX_BODY = 2_000_000;

export function createSearchServer(o: ServerOptions) {
  fs.mkdirSync(path.join(o.dataDir, "accounts"), { recursive: true });
  const reg = new DatabaseSync(path.join(o.dataDir, "registry.sqlite"));
  reg.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, schedule_json TEXT NOT NULL DEFAULT '{}',
  last_slot TEXT, last_run_at TEXT, last_status TEXT, credentials_enc TEXT, synced_at TEXT
);`);
  const now = o.now ?? (() => new Date());
  const key = crypto.createHash("sha256").update(o.secret).digest();
  const running = new Set<string>();

  const enc = (plain: string) => {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
  };
  const dec = (b64: string) => {
    const b = Buffer.from(b64, "base64");
    const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  };
  const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

  const repos = new Map<string, Repo>();
  function accountRepo(id: string): Repo {
    let r = repos.get(id);
    if (!r) {
      const { db } = openDatabase(path.join(o.dataDir, "accounts", `${id}.sqlite`));
      db.exec("CREATE TABLE IF NOT EXISTS outbox (cursor INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, raw_json TEXT NOT NULL, at TEXT NOT NULL, run_id TEXT)");
      r = new Repo(db);
      r.seedDefaults();
      repos.set(id, r);
    }
    return r;
  }

  const account = (req: http.IncomingMessage) => {
    const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? "");
    if (!m) return null;
    const row = reg.prepare("SELECT * FROM accounts WHERE token_hash=?").get(hashToken(m[1])) as any;
    return row ?? null;
  };
  const scheduleOf = (row: any): ScheduleSettings => ({ enabled: false, paused: false, cadence: "daily", time: "09:00", weekday: 1, runInBackground: false, timezone: "UTC", ...JSON.parse(row.schedule_json || "{}") });

  /** Один поиск для аккаунта: собранное складывается в outbox для приложения. */
  async function runFor(id: string, trigger: "scheduled" | "catchup" | "manual") {
    if (running.has(id)) return { skipped: true };
    running.add(id);
    try {
      const repo = accountRepo(id);
      const row = reg.prepare("SELECT credentials_enc FROM accounts WHERE id=?").get(id) as any;
      const credentials = row?.credentials_enc ? JSON.parse(dec(row.credentials_enc)) : undefined;
      let runId: string | null = null;
      const ins = repo.db.prepare("INSERT INTO outbox(source_id, raw_json, at, run_id) VALUES(?,?,?,?)");
      const r = await runSearch(repo, trigger, {
        fetcher: o.fetcher as any, now, pauseMs: o.pauseMs, credentials,
        onProgress: (p) => { runId = p.runId; },
        onRawItems: (sourceId: string, items: RawJob[]) => {
          const at = now().toISOString();
          for (const it of items) ins.run(sourceId, JSON.stringify(it), at, runId);
        },
      });
      repo.db.prepare("DELETE FROM outbox WHERE at < ?").run(new Date(now().getTime() - OUTBOX_DAYS * 86400_000).toISOString());
      reg.prepare("UPDATE accounts SET last_run_at=?, last_status=? WHERE id=?").run(now().toISOString(), r.status, id);
      return { runId: r.runId, status: r.status, stats: r.stats };
    } finally {
      running.delete(id);
    }
  }

  /** Раз в минуту: кому по расписанию (в его часовом поясе) пора искать. */
  async function tick() {
    const rows = reg.prepare("SELECT id, schedule_json, last_slot FROM accounts").all() as any[];
    for (const row of rows) {
      const s = scheduleOf(row);
      const plan = planSchedule(s, row.last_slot ?? null, now());
      if (plan.action === "none" && plan.slot && !row.last_slot) {
        reg.prepare("UPDATE accounts SET last_slot=? WHERE id=?").run(plan.slot, row.id);
        continue;
      }
      if (plan.action !== "run" && plan.action !== "catchup") continue;
      reg.prepare("UPDATE accounts SET last_slot=? WHERE id=?").run(plan.slot, row.id);
      try {
        await runFor(row.id, plan.action === "run" ? "scheduled" : "catchup");
      } catch (e) {
        reg.prepare("UPDATE accounts SET last_status=? WHERE id=?").run(`error: ${(e as Error).message}`.slice(0, 300), row.id);
      }
    }
  }

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: http.IncomingMessage) =>
    new Promise<any>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
        } catch {
          reject(new Error("bad json"));
        }
      });
      req.on("error", reject);
    });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
      if (req.method === "POST" && url.pathname === "/v1/accounts") {
        const count = (reg.prepare("SELECT COUNT(*) AS n FROM accounts").get() as any).n;
        if (o.maxAccounts && count >= o.maxAccounts) return send(res, 503, { error: "server is full" });
        const id = crypto.randomBytes(9).toString("base64url");
        const token = crypto.randomBytes(32).toString("base64url");
        reg.prepare("INSERT INTO accounts(id, token_hash, created_at) VALUES(?,?,?)").run(id, hashToken(token), now().toISOString());
        return send(res, 201, { id, token });
      }
      const acc = account(req);
      if (!acc) return send(res, 401, { error: "unauthorized" });
      const repo = accountRepo(acc.id);

      if (req.method === "PUT" && url.pathname === "/v1/sync") {
        const b = await readBody(req);
        // Профили: те же правила и инструкции, что в приложении
        const seen = new Set<string>();
        for (const c of Array.isArray(b.candidates) ? b.candidates.slice(0, 20) : []) {
          if (typeof c?.id !== "string" || typeof c?.name !== "string" || !c.rules) continue;
          seen.add(c.id);
          const rules = c.rules as SearchRules;
          if (repo.getCandidate(c.id)) {
            const cur = repo.currentProfile(c.id).rules;
            if (JSON.stringify(cur) !== JSON.stringify(rules)) repo.saveRules(c.id, rules, "sync");
            repo.updateCandidate(c.id, { name: c.name });
          } else repo.createCandidate({ id: c.id, name: c.name, rules, notes: "", note: "sync" });
        }
        for (const c of repo.listCandidates()) if (!seen.has(c.id)) repo.deleteCandidate(c.id);
        for (const s of Array.isArray(b.sources) ? b.sources : []) if (typeof s?.id === "string") repo.updateSource(s.id, { enabled: !!s.enabled });
        if (Array.isArray(b.excludedHosts)) {
          for (const h of repo.listExcludedHosts()) repo.removeExcludedHost(h.host);
          for (const h of b.excludedHosts.slice(0, 200)) if (typeof h?.host === "string") repo.addExcludedHost(h.host, String(h.reason ?? ""));
        }
        if (b.schedule) {
          const prev = scheduleOf(acc);
          const s: ScheduleSettings = { ...prev, ...b.schedule, runInBackground: false };
          const restarted = !prev.enabled && s.enabled;
          reg.prepare("UPDATE accounts SET schedule_json=?, last_slot=CASE WHEN ? THEN NULL ELSE last_slot END WHERE id=?").run(JSON.stringify(s), restarted ? 1 : 0, acc.id);
        }
        if ("credentials" in b) reg.prepare("UPDATE accounts SET credentials_enc=? WHERE id=?").run(b.credentials ? enc(JSON.stringify(b.credentials)) : null, acc.id);
        reg.prepare("UPDATE accounts SET synced_at=? WHERE id=?").run(now().toISOString(), acc.id);
        return send(res, 200, { ok: true, candidates: seen.size });
      }
      if (req.method === "GET" && url.pathname === "/v1/results") {
        const after = Number(url.searchParams.get("after") ?? 0) || 0;
        const limit = Math.min(2000, Number(url.searchParams.get("limit") ?? 1000) || 1000);
        const rows = repo.db.prepare("SELECT cursor, source_id, raw_json, at FROM outbox WHERE cursor > ? ORDER BY cursor LIMIT ?").all(after, limit) as any[];
        const items = rows.map((r) => ({ cursor: r.cursor, sourceId: r.source_id, at: r.at, raw: JSON.parse(r.raw_json) }));
        return send(res, 200, { items, nextCursor: items.length ? items[items.length - 1].cursor : after, more: items.length === limit });
      }
      if (req.method === "GET" && url.pathname === "/v1/status") {
        const s = scheduleOf(acc);
        const runs = repo.listRuns(10).map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, stats: r.stats }));
        return send(res, 200, { schedule: s, next: s.enabled && !s.paused ? nextSlot(s, now()).toISOString() : null, lastRunAt: acc.last_run_at, lastStatus: acc.last_status, runs, running: running.has(acc.id), hasCredentials: !!acc.credentials_enc, syncedAt: acc.synced_at });
      }
      if (req.method === "POST" && url.pathname === "/v1/run-now") {
        if (running.has(acc.id)) return send(res, 409, { error: "already running" });
        const p = runFor(acc.id, "manual");
        if (url.searchParams.get("wait") === "1") return send(res, 200, await p);
        void p.catch(() => {});
        return send(res, 202, { started: true });
      }
      if (req.method === "DELETE" && url.pathname === "/v1/accounts") {
        repos.get(acc.id)?.db.close();
        repos.delete(acc.id);
        for (const f of fs.readdirSync(path.join(o.dataDir, "accounts")).filter((f) => f.startsWith(`${acc.id}.sqlite`))) fs.rmSync(path.join(o.dataDir, "accounts", f), { force: true });
        reg.prepare("DELETE FROM accounts WHERE id=?").run(acc.id);
        return send(res, 200, { deleted: true });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 400, { error: (e as Error).message });
    }
  });

  let timer: NodeJS.Timeout | null = null;
  return {
    server,
    tick,
    runFor,
    listen(port = o.port ?? 8787) {
      return new Promise<number>((resolve) => {
        server.listen(port, () => {
          timer = setInterval(() => void tick(), o.tickMs ?? 60_000);
          resolve((server.address() as any).port);
        });
      });
    },
    close() {
      if (timer) clearInterval(timer);
      server.close();
      for (const r of repos.values()) r.db.close();
      reg.close();
    },
  };
}

// Запуск как самостоятельного процесса
if (require.main === module) {
  const secret = process.env.SERVER_SECRET ?? "";
  if (secret.length < 32) {
    console.error("SERVER_SECRET must be at least 32 characters");
    process.exit(1);
  }
  const s = createSearchServer({ dataDir: process.env.DATA_DIR ?? path.resolve("data"), secret, maxAccounts: Number(process.env.MAX_ACCOUNTS ?? 0) || undefined });
  void s.listen(Number(process.env.PORT ?? 8787)).then((port) => console.log(`Job Search Desktop search server on :${port}`));
}
