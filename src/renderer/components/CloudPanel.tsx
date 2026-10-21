// Сервер поиска: ищет по расписанию, когда компьютер выключен; приложение забирает результаты при возвращении.
import { useEffect, useState } from "react";
import { call } from "../api";
import { useI18n } from "../i18n";
import { useApp } from "../state";
import { useBusy, useToast } from "./ui";
import type { Msg } from "../../shared/types";

interface CloudState {
  connected: boolean; url: string; accountId: string | null; shareCredentials: boolean;
  lastPushAt: string | null; lastPullAt: string | null; lastPull: { inserted: number; suitable: number; notifications: number } | null;
  lastError: Msg | null; remote: { next: string | null; lastRunAt: string | null; lastStatus: string | null; running: boolean } | null;
}

export function CloudPanel() {
  const { m, date, lang } = useI18n();
  const L = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const [st, setSt] = useState<CloudState | null>(null);
  const [url, setUrl] = useState("");
  const [share, setShare] = useState(false);
  const load = () => call<CloudState | null>("cloud.get").then(setSt);
  useEffect(() => {
    void load();
  }, [app.version]);
  if (!st) return null;
  return (
    <div className="card" id="cloud">
      <div className="card-header"><h2>{L("Поиск, когда компьютер выключен", "Search while the computer is off")}</h2></div>
      <div className="card-body stack">
        <p className="help">{L(
          "Сервер поиска выполняет то же расписание в вашем часовом поясе, даже если компьютер выключен. Когда вы откроете приложение, оно заберёт найденное, оценит по вашим правилам и пришлёт уведомления. На сервер уходят ваши профили поиска (направления, условия, инструкции для ИИ), выбранные источники и расписание.",
          "A search server runs the same schedule in your time zone, even when the computer is off. When you open the app, it fetches what was found, assesses it by your rules and notifies you. The server receives your search profiles (job areas, conditions, AI instructions), chosen sources and schedule.",
        )}</p>
        {!st.connected ? (
          <>
            <div className="row-wrap">
              <input className="input" style={{ minWidth: 320 }} placeholder="https://search.example.com" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={L("Адрес сервера поиска", "Search server address")} />
              <button className="btn btn-primary" disabled={!url || busy === "cc"} onClick={() => run("cc", async () => { await call("cloud.connect", { url, shareCredentials: share }); push(L("Сервер подключён, профили отправлены", "Server connected, profiles sent")); await load(); })}>{L("Подключить", "Connect")}</button>
            </div>
            <label className="check"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />{L("Передать серверу доступы к hh.ru и Adzuna (хранятся зашифрованными), чтобы искать и там", "Give the server access to hh.ru and Adzuna (stored encrypted) so it can search there too")}</label>
            <p className="help">{L("Сервер можно развернуть по инструкции в репозитории (папка server/). Адрес должен начинаться с https://.", "You can deploy the server by following the guide in the repository (server/ folder). The address must start with https://.")}</p>
          </>
        ) : (
          <>
            <div className="row-wrap">
              <span className="verdict v-yes"><span className="glyph">✓</span>{L("Подключено", "Connected")}: {st.url}</span>
              {st.remote?.next && <span className="small">{L("Следующий поиск на сервере", "Next server search")}: <strong>{date(st.remote.next, true)}</strong></span>}
            </div>
            <div className="small subtle">
              {st.remote?.lastRunAt ? `${L("Последний поиск на сервере", "Last server search")}: ${date(st.remote.lastRunAt, true)} (${st.remote.lastStatus})` : L("Сервер ещё не искал", "The server has not searched yet")}
              {st.lastPullAt && <>. {L("Забрано", "Fetched")} {date(st.lastPullAt, true)}{st.lastPull ? `: ${L("новых", "new")} ${st.lastPull.inserted}, ${L("подходящих", "matching")} ${st.lastPull.suitable}` : ""}</>}
            </div>
            {st.lastError && <div className="banner banner-warn">{m(st.lastError)}</div>}
            <label className="check"><input type="checkbox" checked={st.shareCredentials} onChange={(e) => run("cs", async () => { setSt(await call("cloud.setShare", { shareCredentials: e.target.checked })); })} />{L("Передавать серверу доступы к hh.ru и Adzuna", "Share hh.ru and Adzuna access with the server")}</label>
            <div className="row-wrap">
              <button className="btn" disabled={busy === "cp"} onClick={() => run("cp", async () => { const r = await call<{ result: CloudState["lastPull"]; state: CloudState }>("cloud.pull"); setSt(r.state); push(L(`Забрано: новых ${r.result?.inserted ?? 0}, подходящих ${r.result?.suitable ?? 0}`, `Fetched: ${r.result?.inserted ?? 0} new, ${r.result?.suitable ?? 0} matching`)); })}>{L("Забрать результаты", "Fetch results")}</button>
              <button className="btn" disabled={busy === "cr"} onClick={() => run("cr", async () => { setSt(await call("cloud.runNow")); push(L("Сервер начал поиск", "The server started a search")); })}>{L("Искать на сервере сейчас", "Search on the server now")}</button>
              <button className="btn btn-ghost btn-danger" onClick={() => run("cd", async () => { setSt(await call("cloud.disconnect", { deleteRemote: true })); push(L("Отключено, данные на сервере удалены", "Disconnected, server data deleted")); })}>{L("Отключить и удалить данные с сервера", "Disconnect and delete server data")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
