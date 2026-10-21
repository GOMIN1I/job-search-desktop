import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/db";
import { Repo } from "../src/db/repo";
import { CredentialStore } from "../src/main/credentials";

// Обратимое «шифрование» для теста: проверяем, что в базе нет открытого секрета
const sec = { encryptionAvailable: () => true, encrypt: (s: string) => Buffer.from(`enc:${s}`).toString("base64"), decrypt: (b: string) => Buffer.from(b, "base64").toString().replace(/^enc:/, "") };

function setup(hh: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-cred-"));
  const { db } = openDatabase(path.join(dir, "app.sqlite"));
  const repo = new Repo(db);
  repo.seedDefaults();
  const calls: Array<{ url: string; body?: string; auth?: string }> = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? String(init.body) : undefined, auth: new Headers(init?.headers ?? {}).get("authorization") ?? undefined });
    return hh(url, init);
  };
  return { repo, store: new CredentialStore(repo, sec, fetcher as any), calls, db, dir };
}

describe("доступ к hh.ru", () => {
  it("вход через аккаунт: браузер → локальный возврат → токен → проверочный поиск", async () => {
    const { repo, store, calls } = setup((url) => {
      if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "user-at", refresh_token: "user-rt", expires_in: 1209600 }), { status: 200 });
      if (url.includes("/vacancies")) return new Response(JSON.stringify({ found: 42, items: [] }), { status: 200 });
      return new Response("", { status: 404 });
    });
    store.saveHhClient({ clientId: "CID123", clientSecret: "SECRET", redirectUri: "http://127.0.0.1:47399/hh/callback" });
    // «Браузер»: hh.ru возвращает пользователя на локальный адрес с кодом и тем же state
    await store.connectHhUser(async (authUrl) => {
      const u = new URL(authUrl);
      expect(u.origin + u.pathname).toBe("https://hh.ru/oauth/authorize");
      expect(u.searchParams.get("client_id")).toBe("CID123");
      setTimeout(() => void fetch(`http://127.0.0.1:47399/hh/callback?code=THE_CODE&state=${u.searchParams.get("state")}`), 20);
    }, 5000);
    const tokenCall = calls.find((c) => c.url.endsWith("/token"))!;
    expect(tokenCall.body).toContain("grant_type=authorization_code");
    expect(tokenCall.body).toContain("code=THE_CODE");
    const check = await store.testHh();
    expect(check.ok).toBe(true);
    expect(calls.at(-1)!.auth).toBe("Bearer user-at");
    const st = store.state();
    expect(st.hh).toMatchObject({ connected: true, kind: "user", hasClientSecret: true });
    // В базе нет открытых секретов
    const dump = JSON.stringify(repo.db.prepare("SELECT value FROM meta").all());
    expect(dump).not.toContain("SECRET");
    expect(dump).not.toContain("user-at");
  });

  it("чужой state отклоняется", async () => {
    const { store } = setup(() => new Response("{}", { status: 200 }));
    store.saveHhClient({ clientId: "CID123", clientSecret: "S", redirectUri: "http://127.0.0.1:47398/hh/callback" });
    await expect(store.connectHhUser(async () => {
      setTimeout(() => void fetch("http://127.0.0.1:47398/hh/callback?code=X&state=forged"), 20);
    }, 5000)).rejects.toThrow();
    expect(store.state().hh.connected).toBe(false);
  });

  it("токен приложения; отказ hh.ru в поиске не считается рабочим доступом", async () => {
    const { store } = setup((url) => url.endsWith("/token") ? new Response(JSON.stringify({ access_token: "app-at" }), { status: 200 }) : new Response('{"errors":[{"type":"forbidden"}]}', { status: 403 }));
    store.saveHhClient({ clientId: "CID", clientSecret: "S" });
    await store.connectHhApp();
    expect(store.state().hh.kind).toBe("app");
    const check = await store.testHh();
    expect(check.ok).toBe(false);
    expect(check.message.ru).toMatch(/HTTP 403/);
  });

  it("истекающий пользовательский токен обновляется перед поиском", async () => {
    const { store, calls } = setup((url, init) => {
      if (url.endsWith("/token") && String(init?.body).includes("refresh_token")) return new Response(JSON.stringify({ access_token: "fresh", refresh_token: "rt2", expires_in: 1209600 }), { status: 200 });
      if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "old", refresh_token: "rt1", expires_in: 60 }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    store.saveHhClient({ clientId: "CID", clientSecret: "S", redirectUri: "http://127.0.0.1:47397/hh/callback" });
    await store.connectHhUser(async (u) => {
      setTimeout(() => void fetch(`http://127.0.0.1:47397/hh/callback?code=C&state=${new URL(u).searchParams.get("state")}`), 20);
    }, 5000);
    expect((await store.forRun()).hhToken).toBe("fresh");
    expect(calls.some((c) => c.body?.includes("grant_type=refresh_token"))).toBe(true);
  });

  it("Adzuna: ключ шифруется, проверка поиска, очистка", async () => {
    const { store } = setup((url) => new Response("{}", { status: url.includes("app_key=good") ? 200 : 401 }));
    store.saveAdzuna({ appId: "app1", appKey: "bad" });
    expect((await store.testAdzuna()).ok).toBe(false);
    store.saveAdzuna({ appId: "app1", appKey: "good" });
    expect((await store.testAdzuna()).ok).toBe(true);
    expect((await store.forRun()).adzuna).toEqual({ appId: "app1", appKey: "good" });
    store.clearAdzuna();
    expect((await store.forRun()).adzuna).toBeNull();
  });
});
