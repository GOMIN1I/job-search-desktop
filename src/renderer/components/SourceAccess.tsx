// Подключение источников, которым нужен вход или ключ: hh.ru (OAuth) и Adzuna.
// Источник показан рабочим только после успешного проверочного поиска.
import { useEffect, useState } from "react";
import { call } from "../api";
import { useI18n } from "../i18n";
import { useApp } from "../state";
import { useBusy, useToast } from "./ui";
import type { Msg } from "../../shared/types";

interface Check { ok: boolean; at: string; message: Msg }
interface State {
  encryptionAvailable: boolean;
  hh: { clientId: string; redirectUri: string; hasClientSecret: boolean; connected: boolean; kind: "user" | "app" | "manual" | null; expiresAt: string | null; check: Check | null };
  adzuna: { appId: string; hasKey: boolean; check: Check | null };
}

export function SourceAccess() {
  const { m, date, lang } = useI18n();
  const L = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const [st, setSt] = useState<State | null>(null);
  const [hh, setHh] = useState({ clientId: "", clientSecret: "", redirectUri: "" });
  const [token, setToken] = useState("");
  const [adz, setAdz] = useState({ appId: "", appKey: "" });
  const load = () => call<State>("credentials.get").then((s) => {
    setSt(s);
    setHh((x) => ({ ...x, clientId: x.clientId || s.hh.clientId, redirectUri: x.redirectUri || s.hh.redirectUri }));
    setAdz((x) => ({ ...x, appId: x.appId || s.adzuna.appId }));
  });
  useEffect(() => {
    void load();
  }, [app.version]);
  if (!st) return null;

  const result = (r: { check: Check }) => {
    push(m(r.check.message), !r.check.ok);
    void load();
  };
  const status = (c: Check | null, connected: boolean) =>
    c?.ok ? <span className="verdict v-yes"><span className="glyph">✓</span>{L("Поиск работает", "Search works")}, {date(c.at, true)}</span>
    : c ? <span className="verdict v-no"><span className="glyph">✕</span>{m(c.message)}</span>
    : connected ? <span className="verdict v-ask"><span className="glyph">?</span>{L("Подключено, ещё не проверено", "Connected, not checked yet")}</span>
    : <span className="verdict v-none">{L("Не подключено", "Not connected")}</span>;

  return (
    <div className="card" id="source-access">
      <div className="card-header"><h2>{L("Доступ к источникам", "Source access")}</h2></div>
      <div className="card-body stack-lg">
        {!st.encryptionAvailable && <div className="banner banner-warn">{L("Системное хранилище ключей недоступно: доступы не могут быть сохранены.", "The OS key storage is unavailable: access cannot be saved.")}</div>}

        <section className="stack" aria-labelledby="acc-hh">
          <div className="row-between"><h3 id="acc-hh">hh.ru</h3>{status(st.hh.check, st.hh.connected)}</div>
          <p className="help">{L(
            "С апреля 2026 hh.ru отдаёт поиск вакансий только с OAuth-токеном. Нужно приложение, зарегистрированное на dev.hh.ru: его Client ID и Client Secret. Затем войдите через свой аккаунт hh.ru или получите токен приложения. Адрес возврата в настройках приложения на dev.hh.ru должен совпадать с указанным ниже.",
            "Since April 2026 hh.ru serves vacancy search only with an OAuth token. You need an application registered at dev.hh.ru: its Client ID and Client Secret. Then sign in with your hh.ru account or get an application token. The redirect URI in the dev.hh.ru app settings must match the one below.",
          )}</p>
          <div className="row-wrap">
            <input className="input" placeholder="Client ID" value={hh.clientId} onChange={(e) => setHh({ ...hh, clientId: e.target.value })} aria-label="hh.ru Client ID" />
            <input className="input" type="password" placeholder={st.hh.hasClientSecret ? L("Client Secret сохранён", "Client Secret saved") : "Client Secret"} value={hh.clientSecret} onChange={(e) => setHh({ ...hh, clientSecret: e.target.value })} aria-label="hh.ru Client Secret" autoComplete="off" />
            <input className="input" style={{ minWidth: 280 }} value={hh.redirectUri} onChange={(e) => setHh({ ...hh, redirectUri: e.target.value })} aria-label={L("Адрес возврата", "Redirect URI")} />
            <button className="btn" disabled={!hh.clientId || busy === "hhsave"} onClick={() => run("hhsave", async () => { await call("credentials.hh.saveClient", { clientId: hh.clientId, clientSecret: hh.clientSecret || undefined, redirectUri: hh.redirectUri || undefined }); setHh({ ...hh, clientSecret: "" }); push(L("Сохранено", "Saved")); await load(); })}>{L("Сохранить", "Save")}</button>
          </div>
          <div className="row-wrap">
            <button className="btn btn-primary" disabled={!st.hh.clientId || !st.hh.hasClientSecret || busy === "hhuser"} onClick={() => run("hhuser", async () => result(await call("credentials.hh.connectUser")))}>{busy === "hhuser" ? L("Ждём вход в браузере…", "Waiting for browser sign-in…") : L("Войти через hh.ru", "Sign in with hh.ru")}</button>
            <button className="btn" disabled={!st.hh.clientId || !st.hh.hasClientSecret || busy === "hhapp"} onClick={() => run("hhapp", async () => result(await call("credentials.hh.connectApp")))}>{L("Получить токен приложения", "Get application token")}</button>
            {st.hh.connected && <button className="btn" disabled={busy === "hhtest"} onClick={() => run("hhtest", async () => result(await call("credentials.hh.test")))}>{L("Проверить поиск", "Test search")}</button>}
            {st.hh.connected && <button className="btn btn-ghost btn-danger" onClick={() => run("hhoff", async () => { await call("credentials.hh.disconnect"); await load(); })}>{L("Отключить", "Disconnect")}</button>}
          </div>
          <details className="more">
            <summary>{L("У меня уже есть токен", "I already have a token")}</summary>
            <div className="row-wrap" style={{ marginTop: 8 }}>
              <input className="input" type="password" style={{ minWidth: 320 }} placeholder="access_token" value={token} onChange={(e) => setToken(e.target.value)} aria-label={L("Токен hh.ru", "hh.ru token")} autoComplete="off" />
              <button className="btn" disabled={token.length < 10 || busy === "hhtok"} onClick={() => run("hhtok", async () => { result(await call("credentials.hh.setToken", { token })); setToken(""); })}>{L("Сохранить и проверить", "Save and test")}</button>
            </div>
          </details>
        </section>

        <section className="stack" aria-labelledby="acc-adz">
          <div className="row-between"><h3 id="acc-adz">Adzuna</h3>{status(st.adzuna.check, st.adzuna.hasKey)}</div>
          <p className="help">{L(
            "Поиск по 19 странам (Европа, США, Канада, Австралия, Индия и другие). Бесплатный ключ выдаётся на developer.adzuna.com: app_id и app_key.",
            "Search in 19 countries (Europe, US, Canada, Australia, India and more). A free key is issued at developer.adzuna.com: app_id and app_key.",
          )}</p>
          <div className="row-wrap">
            <input className="input" placeholder="app_id" value={adz.appId} onChange={(e) => setAdz({ ...adz, appId: e.target.value })} aria-label="Adzuna app_id" />
            <input className="input" type="password" placeholder={st.adzuna.hasKey ? L("app_key сохранён", "app_key saved") : "app_key"} value={adz.appKey} onChange={(e) => setAdz({ ...adz, appKey: e.target.value })} aria-label="Adzuna app_key" autoComplete="off" />
            <button className="btn btn-primary" disabled={!adz.appId || (!adz.appKey && !st.adzuna.hasKey) || busy === "adz"} onClick={() => run("adz", async () => { result(await call("credentials.adzuna.save", { appId: adz.appId, appKey: adz.appKey || undefined })); setAdz({ ...adz, appKey: "" }); })}>{L("Сохранить и проверить", "Save and test")}</button>
            {st.adzuna.hasKey && <button className="btn btn-ghost btn-danger" onClick={() => run("adzoff", async () => { await call("credentials.adzuna.clear"); await load(); })}>{L("Удалить ключ", "Remove key")}</button>}
          </div>
        </section>
        <p className="help">{L("Ключи и токены хранятся зашифрованными в системном хранилище и не попадают в журнал и экспорт. Включите источник в таблице выше после успешной проверки.", "Keys and tokens are stored encrypted in the OS key storage and never reach the log or exports. Turn the source on in the table above once the test succeeds.")}</p>
      </div>
    </div>
  );
}
