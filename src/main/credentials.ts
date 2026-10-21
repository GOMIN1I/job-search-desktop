// Доступы к источникам, которым нужен вход или ключ: hh.ru (OAuth) и Adzuna (ключ разработчика).
// Секреты хранятся только шифротекстом (системное хранилище ключей), в интерфейс уходит лишь состояние.
// Источник считается рабочим только после настоящего тестового поиска.

import http from "node:http";
import crypto from "node:crypto";
import type { Repo } from "../db/repo";
import { msg, type Msg } from "../shared/types";

export interface Crypto {
  encryptionAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(b64: string): string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const HH_API = "https://api.hh.ru";
export const HH_AUTHORIZE = "https://hh.ru/oauth/authorize";
const HH_UA = "JobSearchDesktop/1.0 (https://github.com/GOMIN1I/job-search-desktop)";

interface HhToken {
  kind: "user" | "app" | "manual";
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export interface CredentialCheck {
  ok: boolean;
  at: string;
  message: Msg;
}

export interface CredentialsState {
  encryptionAvailable: boolean;
  hh: {
    clientId: string;
    redirectUri: string;
    hasClientSecret: boolean;
    connected: boolean;
    kind: HhToken["kind"] | null;
    expiresAt: string | null;
    check: CredentialCheck | null;
  };
  adzuna: { appId: string; hasKey: boolean; check: CredentialCheck | null };
}

export const DEFAULT_HH_REDIRECT = "http://127.0.0.1:47321/hh/callback";

export class CredentialStore {
  constructor(private repo: Repo, private sec: Crypto, private fetcher: Fetch = fetch, private builtIn: { hhClientId?: string; hhClientSecret?: string } = {}) {}

  private readSecret<T>(key: string): T | null {
    const enc = this.repo.getMeta<string | null>(key, null);
    if (!enc) return null;
    try {
      return JSON.parse(this.sec.decrypt(enc)) as T;
    } catch {
      return null;
    }
  }
  private writeSecret(key: string, value: unknown) {
    if (!this.sec.encryptionAvailable()) throw new Error("Системное хранилище ключей недоступно / OS key storage unavailable");
    this.repo.setMeta(key, this.sec.encrypt(JSON.stringify(value)));
  }

  state(): CredentialsState {
    const hhCfg = this.repo.getMeta<{ clientId?: string; redirectUri?: string }>("hh_client", {});
    const tok = this.readSecret<HhToken>("hh_token_enc");
    const adz = this.repo.getMeta<{ appId?: string }>("adzuna_cfg", {});
    return {
      encryptionAvailable: this.sec.encryptionAvailable(),
      hh: {
        clientId: hhCfg.clientId || this.builtIn.hhClientId || "",
        redirectUri: hhCfg.redirectUri || DEFAULT_HH_REDIRECT,
        hasClientSecret: !!this.readSecret<string>("hh_client_secret_enc") || !!this.builtIn.hhClientSecret,
        connected: !!tok,
        kind: tok?.kind ?? null,
        expiresAt: tok?.expiresAt ?? null,
        check: this.repo.getMeta<CredentialCheck | null>("hh_check", null),
      },
      adzuna: { appId: adz.appId || "", hasKey: !!this.readSecret<string>("adzuna_key_enc"), check: this.repo.getMeta<CredentialCheck | null>("adzuna_check", null) },
    };
  }

  // ---------- hh.ru ----------

  saveHhClient(p: { clientId: string; clientSecret?: string; redirectUri?: string }) {
    this.repo.setMeta("hh_client", { clientId: p.clientId.trim(), redirectUri: (p.redirectUri || DEFAULT_HH_REDIRECT).trim() });
    if (p.clientSecret) this.writeSecret("hh_client_secret_enc", p.clientSecret.trim());
  }

  private client(): { clientId: string; clientSecret: string; redirectUri: string } {
    const st = this.state().hh;
    const secret = this.readSecret<string>("hh_client_secret_enc") || this.builtIn.hhClientSecret || "";
    if (!st.clientId || !secret) throw new Error("Нужны Client ID и Client Secret приложения hh.ru / hh.ru app Client ID and Secret are required");
    return { clientId: st.clientId, clientSecret: secret, redirectUri: st.redirectUri };
  }

  private async tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
    const r = await this.fetcher(`${HH_API}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "HH-User-Agent": HH_UA, "User-Agent": HH_UA }, body: new URLSearchParams(body).toString() });
    const text = await r.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* не JSON */
    }
    if (!r.ok || !data?.access_token) {
      const reason = data?.error_description || data?.error || `HTTP ${r.status}`;
      throw new Error(`hh.ru отклонил запрос токена: ${reason} / hh.ru rejected the token request: ${reason}`);
    }
    return data;
  }

  private storeToken(kind: HhToken["kind"], t: { access_token: string; refresh_token?: string; expires_in?: number }) {
    const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
    this.writeSecret("hh_token_enc", { kind, accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt } satisfies HhToken);
    this.repo.setMeta("hh_check", null);
  }

  /** Вход через аккаунт hh.ru: браузер ОС → hh.ru → возврат на локальный адрес приложения → обмен кода на токен. */
  async connectHhUser(openExternal: (url: string) => Promise<void>, timeoutMs = 5 * 60_000): Promise<void> {
    const c = this.client();
    const redirect = new URL(c.redirectUri);
    if (redirect.hostname !== "127.0.0.1" && redirect.hostname !== "localhost") throw new Error("Адрес возврата должен быть локальным (http://127.0.0.1:порт/...) / redirect must be a local address");
    const state = crypto.randomBytes(16).toString("hex");
    const code = await new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const u = new URL(req.url ?? "/", c.redirectUri);
        if (u.pathname !== redirect.pathname) {
          res.writeHead(404).end();
          return;
        }
        const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ok ? "<p>Готово. Вернитесь в Job Search Desktop. / Done. Return to Job Search Desktop.</p>" : "<p>Вход не выполнен. / Sign-in failed.</p>");
        clearTimeout(timer);
        server.close();
        if (ok) resolve(u.searchParams.get("code")!);
        else reject(new Error(u.searchParams.get("error_description") || u.searchParams.get("error") || "Вход отменён / sign-in cancelled"));
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Время входа истекло / sign-in timed out"));
      }, timeoutMs);
      server.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      server.listen(Number(redirect.port || 80), redirect.hostname, () => {
        const url = `${HH_AUTHORIZE}?response_type=code&client_id=${encodeURIComponent(c.clientId)}&state=${state}&redirect_uri=${encodeURIComponent(c.redirectUri)}`;
        void openExternal(url).catch(reject);
      });
    });
    const t = await this.tokenRequest({ grant_type: "authorization_code", client_id: c.clientId, client_secret: c.clientSecret, code, redirect_uri: c.redirectUri });
    this.storeToken("user", t);
  }

  /** Токен приложения (client_credentials) — для зарегистрированного приложения hh.ru. */
  async connectHhApp(): Promise<void> {
    const c = this.client();
    const t = await this.tokenRequest({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret });
    this.storeToken("app", t);
  }

  setHhManualToken(token: string) {
    this.storeToken("manual", { access_token: token.trim() });
  }

  disconnectHh() {
    this.repo.setMeta("hh_token_enc", null);
    this.repo.setMeta("hh_check", null);
  }

  /** Действующий токен для поиска; пользовательский токен обновляется заранее. */
  async hhAccessToken(): Promise<string | null> {
    const tok = this.readSecret<HhToken>("hh_token_enc");
    if (!tok) return null;
    if (tok.kind === "user" && tok.refreshToken && tok.expiresAt && Date.parse(tok.expiresAt) - Date.now() < 10 * 60_000) {
      try {
        const t = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: tok.refreshToken });
        this.storeToken("user", t);
        return t.access_token;
      } catch (e) {
        this.repo.log("warn", "hh", `Не удалось обновить токен hh.ru: ${(e as Error).message}`);
      }
    }
    return tok.accessToken;
  }

  /** Настоящий тестовый поиск: только успешный ответ делает источник рабочим. */
  async testHh(): Promise<CredentialCheck> {
    const token = await this.hhAccessToken();
    const at = new Date().toISOString();
    let check: CredentialCheck;
    if (!token) check = { ok: false, at, message: msg("Доступ к hh.ru не подключён", "hh.ru access is not connected") };
    else {
      try {
        const r = await this.fetcher(`${HH_API}/vacancies?text=${encodeURIComponent("аналитик")}&per_page=1`, { headers: { Authorization: `Bearer ${token}`, "HH-User-Agent": HH_UA, "User-Agent": HH_UA } });
        const body = await r.text();
        if (r.ok) {
          const found = (() => {
            try {
              return JSON.parse(body).found as number;
            } catch {
              return null;
            }
          })();
          check = { ok: true, at, message: msg(`Поиск работает: hh.ru ответил, найдено ${found ?? "?"} по тестовому запросу`, `Search works: hh.ru answered, ${found ?? "?"} found for the test query`) };
        } else check = { ok: false, at, message: msg(`hh.ru отказал в поиске (HTTP ${r.status}). Нужен действующий токен с доступом к поиску вакансий.`, `hh.ru refused the search (HTTP ${r.status}). A valid token with vacancy-search access is required.`) };
      } catch (e) {
        check = { ok: false, at, message: msg(`Нет связи с hh.ru: ${(e as Error).message}`, `Cannot reach hh.ru: ${(e as Error).message}`) };
      }
    }
    this.repo.setMeta("hh_check", check);
    return check;
  }

  // ---------- Adzuna ----------

  saveAdzuna(p: { appId: string; appKey?: string }) {
    this.repo.setMeta("adzuna_cfg", { appId: p.appId.trim() });
    if (p.appKey) this.writeSecret("adzuna_key_enc", p.appKey.trim());
    this.repo.setMeta("adzuna_check", null);
  }
  clearAdzuna() {
    this.repo.setMeta("adzuna_cfg", {});
    this.repo.setMeta("adzuna_key_enc", null);
    this.repo.setMeta("adzuna_check", null);
  }
  adzunaKey(): { appId: string; appKey: string } | null {
    const appId = this.repo.getMeta<{ appId?: string }>("adzuna_cfg", {}).appId;
    const appKey = this.readSecret<string>("adzuna_key_enc");
    return appId && appKey ? { appId, appKey } : null;
  }
  async testAdzuna(): Promise<CredentialCheck> {
    const k = this.adzunaKey();
    const at = new Date().toISOString();
    let check: CredentialCheck;
    if (!k) check = { ok: false, at, message: msg("Ключ Adzuna не задан", "Adzuna key is not set") };
    else {
      try {
        const r = await this.fetcher(`https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${encodeURIComponent(k.appId)}&app_key=${encodeURIComponent(k.appKey)}&results_per_page=1&what=data&content-type=application/json`);
        check = r.ok
          ? { ok: true, at, message: msg("Поиск Adzuna работает", "Adzuna search works") }
          : { ok: false, at, message: msg(`Adzuna отказал (HTTP ${r.status}): проверьте app_id и app_key`, `Adzuna refused (HTTP ${r.status}): check app_id and app_key`) };
      } catch (e) {
        check = { ok: false, at, message: msg(`Нет связи с Adzuna: ${(e as Error).message}`, `Cannot reach Adzuna: ${(e as Error).message}`) };
      }
    }
    this.repo.setMeta("adzuna_check", check);
    return check;
  }

  /** Доступы для одного прогона поиска (передаются в фоновый поток сбора). */
  async forRun(): Promise<{ hhToken: string | null; adzuna: { appId: string; appKey: string } | null }> {
    return { hhToken: await this.hhAccessToken(), adzuna: this.adzunaKey() };
  }
}
