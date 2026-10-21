// Связь приложения с сервером поиска: отправка профилей, источников и расписания; забор собранного при возвращении.
// Токен аккаунта хранится шифротекстом. Доступы к hh.ru/Adzuna уходят на сервер только по отдельному согласию.

import type { Repo } from "../db/repo";
import { msg, type Msg, type ScheduleSettings } from "../shared/types";
import { importExternalItems } from "../pipeline/run";
import type { Crypto } from "./credentials";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudState {
  connected: boolean;
  url: string;
  accountId: string | null;
  shareCredentials: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastPull: { inserted: number; suitable: number; notifications: number } | null;
  lastError: Msg | null;
  remote: { next: string | null; lastRunAt: string | null; lastStatus: string | null; running: boolean } | null;
}

interface Cfg {
  url: string;
  accountId: string;
  cursor: number;
  shareCredentials: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastPull: CloudState["lastPull"];
  lastError: Msg | null;
  remote: CloudState["remote"];
}

export class CloudClient {
  constructor(
    private repo: Repo,
    private sec: Crypto,
    private credentials: () => Promise<{ hhToken: string | null; adzuna: { appId: string; appKey: string } | null }>,
    private schedule: () => ScheduleSettings,
    private fetcher: Fetch = fetch,
  ) {}

  private cfg(): Cfg | null {
    return this.repo.getMeta<Cfg | null>("cloud_cfg", null);
  }
  private save(c: Cfg | null) {
    this.repo.setMeta("cloud_cfg", c);
  }
  private token(): string | null {
    const enc = this.repo.getMeta<string | null>("cloud_token_enc", null);
    if (!enc) return null;
    try {
      return this.sec.decrypt(enc);
    } catch {
      return null;
    }
  }

  state(): CloudState {
    const c = this.cfg();
    return {
      connected: !!c && !!this.token(),
      url: c?.url ?? "",
      accountId: c?.accountId ?? null,
      shareCredentials: c?.shareCredentials ?? false,
      lastPushAt: c?.lastPushAt ?? null,
      lastPullAt: c?.lastPullAt ?? null,
      lastPull: c?.lastPull ?? null,
      lastError: c?.lastError ?? null,
      remote: c?.remote ?? null,
    };
  }

  private async req(path: string, init: RequestInit = {}): Promise<any> {
    const c = this.cfg();
    const t = this.token();
    if (!c || !t) throw new Error("Сервер поиска не подключён / search server is not connected");
    const r = await this.fetcher(`${c.url}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}`, "Content-Type": "application/json" } });
    const text = await r.text();
    const data = text ? JSON.parse(text) : {};
    if (!r.ok) throw new Error(`${data?.error ?? "error"} (HTTP ${r.status})`);
    return data;
  }

  private fail(e: unknown): never {
    const c = this.cfg();
    const m = (e as Error).message;
    if (c) this.save({ ...c, lastError: msg(`Сервер поиска: ${m}`, `Search server: ${m}`) });
    throw e;
  }

  async connect(rawUrl: string, shareCredentials: boolean): Promise<CloudState> {
    const url = rawUrl.trim().replace(/\/+$/, "");
    const u = new URL(url);
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    if (u.protocol !== "https:" && !local) throw new Error("Нужен адрес https:// (кроме локального сервера) / an https:// address is required (except a local server)");
    const health = await this.fetcher(`${url}/health`).then((r) => r.ok).catch(() => false);
    if (!health) throw new Error("Сервер не отвечает / the server does not respond");
    const r = await this.fetcher(`${url}/v1/accounts`, { method: "POST" });
    if (!r.ok) throw new Error(`Сервер не создал аккаунт (HTTP ${r.status}) / the server did not create an account`);
    const { id, token } = (await r.json()) as { id: string; token: string };
    if (!this.sec.encryptionAvailable()) throw new Error("Системное хранилище ключей недоступно / OS key storage unavailable");
    this.repo.setMeta("cloud_token_enc", this.sec.encrypt(token));
    this.save({ url, accountId: id, cursor: 0, shareCredentials, lastPushAt: null, lastPullAt: null, lastPull: null, lastError: null, remote: null });
    await this.push();
    return this.state();
  }

  setShareCredentials(v: boolean) {
    const c = this.cfg();
    if (c) this.save({ ...c, shareCredentials: v });
  }

  /** Отправить на сервер всё, что нужно для поиска без приложения. */
  async push(): Promise<void> {
    const c = this.cfg();
    if (!c) return;
    try {
      const candidates = this.repo.listCandidates().filter((x) => !x.isDemo).map((x) => ({ id: x.id, name: x.name, rules: this.repo.currentProfile(x.id).rules }));
      const sources = this.repo.listSources().map((s) => ({ id: s.id, enabled: s.enabled }));
      const s = this.schedule();
      const body: Record<string, unknown> = {
        candidates, sources, excludedHosts: this.repo.listExcludedHosts().map((h) => ({ host: h.host, reason: h.reason })),
        schedule: { enabled: s.enabled, paused: s.paused, cadence: s.cadence, time: s.time, weekday: s.weekday, timezone: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone },
        credentials: c.shareCredentials ? await this.credentials() : null,
      };
      await this.req("/v1/sync", { method: "PUT", body: JSON.stringify(body) });
      this.save({ ...this.cfg()!, lastPushAt: new Date().toISOString(), lastError: null });
    } catch (e) {
      this.fail(e);
    }
  }

  /** Забрать собранное сервером, пока приложение было закрыто: дедупликация, оценка и уведомления — локально. */
  async pull(): Promise<CloudState["lastPull"]> {
    const c = this.cfg();
    if (!c) return null;
    try {
      let cursor = c.cursor;
      const total = { inserted: 0, suitable: 0, notifications: 0 };
      for (let i = 0; i < 20; i++) {
        const r = await this.req(`/v1/results?after=${cursor}&limit=1000`);
        if (r.items.length) {
          const res = importExternalItems(this.repo, r.items.map((x: any) => ({ raw: x.raw, at: x.at })), { provenance: "cloud" });
          total.inserted += res.inserted;
          total.suitable += res.suitable;
          total.notifications += res.notifications;
        }
        cursor = r.nextCursor;
        // Курсор сохраняется после каждой пачки: обрыв связи не приведёт к повторному импорту
        this.save({ ...this.cfg()!, cursor });
        if (!r.more) break;
      }
      const st = await this.req("/v1/status");
      this.save({ ...this.cfg()!, cursor, lastPullAt: new Date().toISOString(), lastPull: total, lastError: null, remote: { next: st.next, lastRunAt: st.lastRunAt, lastStatus: st.lastStatus, running: st.running } });
      return total;
    } catch (e) {
      this.fail(e);
    }
  }

  async runNow(): Promise<void> {
    await this.push();
    await this.req("/v1/run-now", { method: "POST" });
  }

  async disconnect(deleteRemote: boolean): Promise<void> {
    if (deleteRemote) await this.req("/v1/accounts", { method: "DELETE" }).catch(() => {});
    this.repo.setMeta("cloud_token_enc", null);
    this.save(null);
  }
}
