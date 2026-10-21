import { useEffect, useState } from "react";
import type { AiSettings, Msg, ScheduleSettings, SearchRun, SourceAttempt, SourceInfo } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { Modal, useBusy, useToast } from "../components/ui";
import { LocalModels } from "../components/LocalModels";

type Tab = "search" | "sources" | "ai" | "data" | "privacy" | "log";

export function Settings() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("search");
  const tabs: Tab[] = ["search", "sources", "ai", "data", "privacy", "log"];
  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header"><h1>{t("set.title")}</h1></div>
        <div className="tabs" role="tablist">
          {tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{t(`set.tab.${x}` as TKey)}</button>)}
        </div>
        <div role="tabpanel">
          {tab === "search" && <SearchTab />}
          {tab === "sources" && <SourcesTab />}
          {tab === "ai" && <AiTab />}
          {tab === "data" && <DataTab />}
          {tab === "privacy" && <PrivacyTab />}
          {tab === "log" && <LogTab />}
        </div>
      </div>
    </div>
  );
}

function SearchTab() {
  const { t, lang, setLang, date } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { run } = useBusy();
  const [d, setD] = useState<{ settings: ScheduleSettings; next: string | null; events: Array<{ kind: string; slot: string | null; note: string; createdAt: string }> } | null>(null);
  useEffect(() => {
    void call("schedule.get").then(setD as any);
  }, [app.version]);
  if (!d) return null;
  const s = d.settings;
  const save = (patch: Partial<ScheduleSettings>) => {
    setD({ ...d, settings: { ...s, ...patch } }); // оптимистично; при ошибке перезагрузка вернёт состояние
    return run("sched", async () => {
    await call("schedule.update", { ...s, ...patch }).catch(async (e) => {
      setD(await call("schedule.get"));
      throw e;
    });
    push(t("common.saved"));
    });
  };
  const days = t("set.weekdays").split("|");
  return (
    <div className="stack-lg">
      <div className="card"><div className="card-body stack">
        <div className="field" style={{ width: 240 }}>
          <label htmlFor="lang">{t("set.lang")}</label>
          <select id="lang" className="select" value={lang} onChange={(e) => setLang(e.target.value as "ru" | "en")}><option value="ru">Русский</option><option value="en">English</option></select>
        </div>
      </div></div>
      <div className="card"><div className="card-body stack">
        <label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked })} /><strong>{t("set.sched.enabled")}</strong></label>
        <div className="row-wrap">
          <div className="field"><label htmlFor="cad">{t("set.sched.cadence")}</label><select id="cad" className="select" value={s.cadence} disabled={!s.enabled} onChange={(e) => save({ cadence: e.target.value as ScheduleSettings["cadence"] })}><option value="daily">{t("set.sched.daily")}</option><option value="weekly">{t("set.sched.weekly")}</option></select></div>
          {s.cadence === "weekly" && <div className="field"><label htmlFor="wd">{t("set.sched.weekday")}</label><select id="wd" className="select" value={s.weekday} disabled={!s.enabled} onChange={(e) => save({ weekday: Number(e.target.value) })}>{days.map((dd, i) => <option key={i} value={i + 1}>{dd}</option>)}</select></div>}
          <div className="field"><label htmlFor="tm">{t("set.sched.time")}</label><input id="tm" type="time" className="input" value={s.time} disabled={!s.enabled} onChange={(e) => e.target.value && save({ time: e.target.value })} /></div>
          <label className="check" style={{ marginTop: 20 }}><input type="checkbox" checked={s.paused} disabled={!s.enabled} onChange={(e) => save({ paused: e.target.checked })} />{t("set.sched.paused")}</label>
        </div>
        <label className="check"><input type="checkbox" checked={s.runInBackground} onChange={(e) => save({ runInBackground: e.target.checked })} />{t("set.sched.background")}</label>
        {s.enabled && <p className="small">{t("today.nextRun")}: <strong>{d.next ? date(d.next, true) : "—"}</strong></p>}
        <div className="banner banner-info">{t("set.sched.local")}</div>
      </div></div>
      <div className="card"><div className="card-header"><h2>{t("set.sched.events")}</h2></div><div className="card-body">
        {d.events.length ? <table className="table"><tbody>{d.events.map((e, i) => <tr key={i}><td className="small nowrap">{date(e.createdAt, true)}</td><td>{e.kind}</td><td className="small">{e.slot ? date(e.slot, true) : ""}</td><td className="small muted">{e.note}</td></tr>)}</tbody></table> : <p className="muted">—</p>}
      </div></div>
    </div>
  );
}

function SourcesTab() {
  const { t, m, date, lang } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; atsKind: string | null; atsSlug: string | null; watch: boolean }>>([]);
  const [hosts, setHosts] = useState<Array<{ host: string; reason: string; builtin: boolean }>>([]);
  const [co, setCo] = useState({ name: "", atsKind: "greenhouse", atsSlug: "" });
  const [host, setHost] = useState("");
  useEffect(() => {
    void call<SourceInfo[]>("sources.list").then(setSources);
    void call("companies.list").then(setCompanies as any);
    void call("excluded.list").then(setHosts as any);
  }, [app.version]);
  const upd = (id: string, patch: Record<string, unknown>) => run(`src-${id}`, () => call("sources.update", { id, ...patch }));
  return (
    <div className="stack-lg">
      <div className="card"><div className="card-body" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead><tr><th>{t("set.src.enabled")}</th><th></th><th>{t("set.src.status")}</th><th>{t("set.src.last")}</th><th>{t("set.src.next")}</th><th>{t("set.src.interval")}</th><th>{t("set.src.pages")}</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td><input type="checkbox" checked={s.enabled} onChange={(e) => upd(s.id, { enabled: e.target.checked })} aria-label={`${s.label} ${t("set.src.enabled")}`} /></td>
                <td style={{ minWidth: 240 }}>
                  <strong>{s.label}</strong>
                  <div className="small subtle">{m(s.coverageNote)}</div>
                  <div className="small muted">{t("set.src.terms")}: {m(s.termsNote)}</div>
                </td>
                <td>{s.lastStatus ? <span className={`badge ${s.lastStatus === "success" ? "b-ok" : s.lastStatus === "failed" || s.lastStatus === "blocked" ? "b-bad" : "b-warn"}`} title={s.lastError ?? ""}>{t(`att.${s.lastStatus}` as TKey)}</span> : <span className="muted small">{t("common.never")}</span>}{s.lastError && <div className="small muted" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>{s.lastError.slice(0, 160)}</div>}</td>
                <td className="small nowrap">{s.lastAttemptAt ? date(s.lastAttemptAt, true) : "—"}</td>
                <td className="small nowrap">{s.nextAllowedAt ? date(s.nextAllowedAt, true) : "—"}</td>
                <td><input className="input" style={{ width: 80 }} type="number" min={60} defaultValue={s.minIntervalMinutes} onBlur={(e) => Number(e.target.value) !== s.minIntervalMinutes && upd(s.id, { minIntervalMinutes: Number(e.target.value) })} aria-label={t("set.src.interval")} /></td>
                <td><input className="input" style={{ width: 60 }} type="number" min={1} max={25} defaultValue={s.maxPages} onBlur={(e) => Number(e.target.value) !== s.maxPages && upd(s.id, { maxPages: Number(e.target.value) })} aria-label={t("set.src.pages")} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help" style={{ marginTop: 8 }}>{lang === "ru" ? "Интервал не может быть ниже официального ограничения источника. hh.ru и его бренды не поддерживаются." : "The interval cannot go below the source's official limit. hh.ru and its brands are not supported."}</p>
      </div></div>

      <div className="card"><div className="card-header"><h2>{t("set.src.companies")}</h2></div><div className="card-body stack">
        <div className="row-wrap">
          <input className="input" placeholder={t("set.src.companyName")} value={co.name} onChange={(e) => setCo({ ...co, name: e.target.value })} aria-label={t("set.src.companyName")} />
          <select className="select" value={co.atsKind} onChange={(e) => setCo({ ...co, atsKind: e.target.value })} aria-label={t("set.src.ats")}><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option></select>
          <input className="input" placeholder={t("set.src.slug")} value={co.atsSlug} onChange={(e) => setCo({ ...co, atsSlug: e.target.value.trim() })} aria-label={t("set.src.slug")} />
          <button className="btn" disabled={!co.atsSlug || busy === "test"} onClick={() => run("test", async () => { const r = await call<{ ok: boolean; message: Msg }>("companies.test", co); push(m(r.message), !r.ok); })}>{t("set.src.test")}</button>
          <button className="btn btn-primary" disabled={!co.name || !co.atsSlug} onClick={() => run("addco", async () => { await call("companies.upsert", { ...co, watch: true }); setCo({ name: "", atsKind: "greenhouse", atsSlug: "" }); })}>{t("set.src.addCompany")}</button>
        </div>
        <p className="help">{lang === "ru" ? "Slug — часть адреса доски: boards.greenhouse.io/<slug>, jobs.lever.co/<slug>, jobs.ashbyhq.com/<slug>." : "The slug is part of the board URL: boards.greenhouse.io/<slug>, jobs.lever.co/<slug>, jobs.ashbyhq.com/<slug>."}</p>
        {companies.length > 0 && <table className="table"><tbody>{companies.map((c) => <tr key={c.id}><td>{c.name}</td><td className="small">{c.atsKind} / {c.atsSlug}</td><td><label className="check"><input type="checkbox" checked={c.watch} onChange={(e) => run("w", () => call("companies.upsert", { id: c.id, name: c.name, atsKind: c.atsKind, atsSlug: c.atsSlug, watch: e.target.checked }))} />{t("set.src.enabled")}</label></td><td><button className="btn btn-sm btn-ghost btn-danger" onClick={() => run("delco", () => call("companies.delete", { id: c.id }))}>{t("common.delete")}</button></td></tr>)}</tbody></table>}
      </div></div>

      <div className="card"><div className="card-header"><h2>{t("set.src.excluded")}</h2></div><div className="card-body stack">
        <p className="help">{t("set.src.excludedHelp")}</p>
        <table className="table"><tbody>{hosts.map((h) => <tr key={h.host}><td className="mono">{h.host}</td><td className="small">{h.reason}</td><td>{h.builtin ? <span className="badge b-neutral">{t("set.src.builtin")}</span> : <button className="btn btn-sm btn-ghost" onClick={() => run("rmh", () => call("excluded.remove", { host: h.host }))}>{t("common.delete")}</button>}</td></tr>)}</tbody></table>
        <div className="row"><input className="input" placeholder="example.com" value={host} onChange={(e) => setHost(e.target.value)} aria-label={t("set.src.addHost")} /><button className="btn" disabled={!host} onClick={() => run("addh", async () => { await call("excluded.add", { host }); setHost(""); })}>{t("set.src.addHost")}</button></div>
      </div></div>
    </div>
  );
}

function AiTab() {
  const { t, m, date } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const [d, setD] = useState<{ settings: AiSettings; encryptionAvailable: boolean; usage: { usd: number; calls: number }; recent: any[] } | null>(null);
  const [form, setForm] = useState<AiSettings | null>(null);
  const [key, setKey] = useState("");
  useEffect(() => {
    void call<any>("ai.get").then((x) => {
      setD(x);
      setForm(x.settings);
    });
  }, [app.version]);
  if (!d || !form) return null;
  const s = d.settings;
  const presets = form.provider === "anthropic" ? ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] : form.provider === "openai_compatible" ? ["gemma4:e4b", "gemma4:e2b", "gpt-5-mini", "llama3.2"] : [];
  return (
    <div className="stack-lg">
      <section className="card"><div className="card-body stack-lg">
        <h2>{t("ob2.ai.h")}</h2>
        <LocalModels />
      </div></section>
      <details className="more">
        <summary>{t("ai.cloud.title")}</summary>
        <div className="stack-lg">
      <div className="banner banner-info">{t("set.ai.help")} {t("ai.cloud.privacy")}</div>
      <div className="card"><div className="card-body stack">
        <div className="field"><label htmlFor="prov">{t("set.ai.provider")}</label>
          <select id="prov" className="select" value={form.provider} onChange={(e) => {
            const p = e.target.value as AiSettings["provider"];
            setForm({ ...form, provider: p, model: p === "anthropic" ? "claude-opus-5-5" : p === "openai_compatible" ? "gemma4:e4b" : form.model, baseUrl: p === "openai_compatible" && !form.baseUrl ? "http://localhost:11434/v1" : form.baseUrl });
          }}>
            <option value="none">{t("set.ai.none")}</option><option value="anthropic">{t("set.ai.anthropic")}</option><option value="openai_compatible">{t("set.ai.openai")}</option>
          </select>
        </div>
        {form.provider !== "none" && (
          <>
            <div className="row-wrap">
              <div className="field" style={{ flex: 1 }}><label htmlFor="model">{t("set.ai.model")}</label><input id="model" className="input" list="model-list" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /><datalist id="model-list">{presets.map((p) => <option key={p} value={p} />)}</datalist></div>
              {form.provider === "openai_compatible" && <div className="field" style={{ flex: 1 }}><label htmlFor="base">{t("set.ai.baseUrl")}</label><input id="base" className="input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>}
              <div className="field" style={{ width: 160 }}><label htmlFor="bud">{t("set.ai.budget")}</label><input id="bud" className="input" type="number" min={0} step={0.5} value={form.monthlyBudgetUsd} onChange={(e) => setForm({ ...form, monthlyBudgetUsd: Number(e.target.value) || 0 })} /></div>
            </div>
            {form.provider === "openai_compatible" && <p className="help">{t("set.ai.localHelp")}</p>}
            <div className="field" style={{ width: 360 }}>
              <label>{t("set.ai.pricing")} — {form.model}</label>
              <div className="row">
                <input className="input" type="number" min={0} step={0.01} value={form.pricing[form.model]?.inputPerMTok ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, [form.model]: { inputPerMTok: Number(e.target.value) || 0, outputPerMTok: form.pricing[form.model]?.outputPerMTok ?? 0 } } })} aria-label="input price" />
                <input className="input" type="number" min={0} step={0.01} value={form.pricing[form.model]?.outputPerMTok ?? 0} onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, [form.model]: { inputPerMTok: form.pricing[form.model]?.inputPerMTok ?? 0, outputPerMTok: Number(e.target.value) || 0 } } })} aria-label="output price" />
              </div>
            </div>
          </>
        )}
        <div><button className="btn btn-primary" onClick={() => run("save", async () => { await call("ai.update", { provider: form.provider, model: form.model, baseUrl: form.baseUrl, monthlyBudgetUsd: form.monthlyBudgetUsd, pricing: form.pricing }); push(t("common.saved")); })}>{t("common.save")}</button></div>
      </div></div>

      {form.provider !== "none" && (
        <div className="card"><div className="card-body stack">
          <span className="label">{t("set.ai.key")}</span>
          <p className="small">{s.keySet ? `✓ ${t("set.ai.keySet")}` : t("set.ai.keyNotSet")}</p>
          {!d.encryptionAvailable && <div className="banner banner-warn">OS key storage unavailable</div>}
          <div className="row-wrap">
            <input className="input" type="password" autoComplete="off" style={{ width: 360 }} value={key} onChange={(e) => setKey(e.target.value)} placeholder={form.provider === "anthropic" ? "sk-ant-…" : "sk-… (optional for local)"} aria-label={t("set.ai.key")} />
            <button className="btn" disabled={key.length < 8} onClick={() => run("key", async () => { await call("ai.setKey", { key }); setKey(""); push(t("common.saved")); })}>{t("set.ai.setKey")}</button>
            {s.keySet && <button className="btn btn-ghost btn-danger" onClick={() => run("ck", () => call("ai.clearKey"))}>{t("set.ai.clearKey")}</button>}
          </div>
          <div className="row-wrap">
            <button className="btn" disabled={busy === "test"} onClick={() => run("test", async () => { const r = await call<{ ok: boolean; message: Msg }>("ai.test"); push(m(r.message), !r.ok); })}>{busy === "test" ? "…" : t("set.ai.test")}</button>
            {s.lastTest && <span className={`badge ${s.lastTest.ok ? "b-ok" : "b-bad"}`}>{t("set.ai.lastTest")}: {date(s.lastTest.at, true)}, {m(s.lastTest.message)}</span>}
          </div>
        </div></div>
      )}

        </div>
      </details>

      <div className="card"><div className="card-header"><h2>{t("set.ai.recent")}</h2><span className="muted small">{t("set.ai.usage", { usd: d.usage.usd.toFixed(4), n: d.usage.calls })}</span></div><div className="card-body" style={{ overflowX: "auto" }}>
        {d.recent.length ? <table className="table"><thead><tr><th></th><th>purpose</th><th>model</th><th>status</th><th>tokens</th><th>$</th></tr></thead><tbody>{d.recent.map((r, i) => <tr key={i}><td className="small nowrap">{date(r.created_at, true)}</td><td className="small">{r.purpose}<div className="muted">{r.prompt_version}</div></td><td className="small">{r.provider} / {r.model}</td><td><span className={`badge ${r.status === "ok" ? "b-ok" : "b-bad"}`}>{r.status}</span>{r.error && <div className="small muted" style={{ maxWidth: 260 }}>{r.error}</div>}</td><td className="small">{r.tokens_in}/{r.tokens_out}</td><td className="small">{Number(r.cost_usd).toFixed(4)}</td></tr>)}</tbody></table> : <p className="muted">—</p>}
      </div></div>
    </div>
  );
}

function DataTab() {
  const { t, date } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const [preview, setPreview] = useState<{ kind: string; token: string; file: string; preview: any } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    void call<any[]>("data.imports").then(setHistory);
  }, [app.version]);
  const startPreview = (method: string, kind: string) => run(method, async () => {
    const r = await call<any>(method);
    if (r.cancelled) return;
    setPreview({ kind, token: r.token, file: r.file, preview: r.preview });
  });
  const apply = () => run("apply", async () => {
    const method = preview!.kind === "backup" ? "data.applyBackup" : preview!.kind === "vacancies" ? "data.applyVacancies" : "data.applyProfile";
    const r = await call<any>(method, { token: preview!.token });
    push(`${t("common.done")}: ${JSON.stringify({ ...r, backupPath: undefined })}`);
    setPreview(null);
    await app.reload();
  });
  return (
    <div className="stack-lg">
      <div className="card"><div className="card-body stack">
        <span className="label">{t("set.data.folder")}</span>
        <code className="mono" style={{ overflowWrap: "anywhere" }}>{app.info.dataDir}</code>
        <div className="row-wrap">
          <button className="btn" onClick={() => run("of", () => call("data.openFolder"))}>{t("set.data.openFolder")}</button>
          <button className="btn" onClick={() => run("bk", async () => { const r = await call<{ path: string }>("data.backupNow"); push(r.path); })}>{t("set.data.backupNow")}</button>
          <button className="btn" onClick={() => run("ex", async () => { const r = await call<{ path?: string }>("data.exportBackup"); if (r.path) push(r.path); })}>{t("set.data.exportJson")}</button>
          <button className="btn" onClick={() => run("csv", async () => { const r = await call<{ path?: string; rows?: number }>("data.exportCsv", { candidateId: app.candidate!.id }); if (r.path) push(`${r.path} · ${r.rows}`); })}>{t("set.data.exportCsv")}</button>
        </div>
      </div></div>
      <div className="card"><div className="card-body stack">
        <div className="row-wrap">
          <button className="btn" disabled={!!busy} onClick={() => startPreview("data.previewVacancies", "vacancies")}>{t("set.data.importVac")}</button>
          <button className="btn" disabled={!!busy} onClick={() => startPreview("data.previewProfile", "profile")}>{t("set.data.importProfile")}</button>
          <button className="btn" disabled={!!busy} onClick={() => startPreview("data.previewBackup", "backup")}>{t("set.data.importJson")}</button>
          <button className="btn" disabled={!!busy} onClick={() => run("demo", async () => { await call("demo.load"); await app.reload(); })}>{t("set.data.demo")}</button>
        </div>
        <p className="help">{t("set.data.backupNote")}</p>
        <p className="help">{t("set.data.notion")}</p>
      </div></div>
      <div className="card"><div className="card-header"><h2>{t("set.data.history")}</h2></div><div className="card-body">
        {history.length ? <table className="table"><tbody>{history.map((h) => <tr key={h.id}><td className="small nowrap">{date(h.created_at, true)}</td><td>{h.kind}</td><td className="small">{h.label}</td><td className="small mono">{JSON.stringify(h.stats).slice(0, 160)}</td></tr>)}</tbody></table> : <p className="muted">—</p>}
      </div></div>
      {preview && (
        <Modal wide title={`${t("set.data.preview")}: ${preview.file}`} onClose={() => setPreview(null)} footer={<>
          <button className="btn" onClick={() => setPreview(null)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={busy === "apply" || preview.preview.valid === false} onClick={apply}>{t("set.data.apply")}</button>
        </>}>
          <ImportPreview p={preview} />
        </Modal>
      )}
    </div>
  );
}

function ImportPreview({ p }: { p: { kind: string; preview: any } }) {
  const { t } = useI18n();
  if (p.kind === "vacancies") {
    const pv = p.preview;
    return (
      <div className="stack">
        <div className="row-wrap">{Object.entries(pv.counts).map(([k, v]) => <span key={k} className={`badge ${k === "ok" ? "b-ok" : k === "blocked" || k === "invalid" ? "b-bad" : "b-warn"}`}>{k}: {String(v)}</span>)}</div>
        <p className="help">{t("set.data.backupNote")}</p>
        <table className="table"><tbody>{pv.rows.slice(0, 200).map((r: any) => <tr key={r.index}><td className="small">{r.index + 1}</td><td><span className={`badge ${r.status === "ok" ? "b-ok" : r.status === "blocked" || r.status === "invalid" ? "b-bad" : "b-warn"}`}>{r.status}</span></td><td>{r.title}<div className="small muted">{r.company}</div></td><td className="small">{r.note}</td></tr>)}</tbody></table>
      </div>
    );
  }
  if (p.kind === "profile") {
    return <div className="stack">{p.preview.errors?.map((e: string) => <div key={e} className="banner banner-warn">{e}</div>)}<table className="table"><tbody>{p.preview.candidates.map((c: any) => <tr key={c.name}><td>{c.name}</td><td>{c.exists ? "update" : "new"}</td><td className="small">skills {c.skills} · docs {c.materials}</td></tr>)}</tbody></table></div>;
  }
  return <div className="stack">{p.preview.errors?.map((e: string) => <div key={e} className="banner banner-warn">{e}</div>)}<table className="table"><thead><tr><th></th><th>total</th><th>new</th><th>existing</th></tr></thead><tbody>{Object.entries(p.preview.tables ?? {}).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{v.total}</td><td>{v.new}</td><td>{v.existing}</td></tr>)}</tbody></table></div>;
}

function PrivacyTab() {
  const { t, lang } = useI18n();
  const hosts = ["jobicy.com", "remotive.com", "remoteok.com", "himalayas.app", "workingnomads.com", "weworkremotely.com", "career.habr.com", "boards-api.greenhouse.io", "api.lever.co", "api.ashbyhq.com", lang === "ru" ? "выбранный AI-провайдер (если включён)" : "your AI provider (if enabled)", lang === "ru" ? "страница вакансии — только по кнопке «Перепроверить»" : "a job page — only on \"Re-check\""];
  return (
    <div className="card"><div className="card-body stack">
      <p>{t("set.priv.text")}</p>
      <span className="label">{t("set.priv.network")}</span>
      <ul>{hosts.map((h) => <li key={h} className="mono">{h}</li>)}</ul>
    </div></div>
  );
}

function LogTab() {
  const { t, date } = useI18n();
  const app = useApp();
  const [runs, setRuns] = useState<Array<SearchRun & { attempts: SourceAttempt[] }>>([]);
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => {
    void call<any>("runs.list").then(setRuns);
    void call<any>("logs.list").then((x) => setLogs(x.logs));
  }, [app.version]);
  return (
    <div className="stack-lg">
      <div className="card"><div className="card-header"><h2>{t("set.log.runs")}</h2></div><div className="card-body">
        {runs.length ? runs.map((r) => (
          <details key={r.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
            <summary style={{ cursor: "pointer" }} className="row-wrap">
              <span className="small nowrap">{date(r.startedAt, true)}</span>
              <span className={`badge ${r.status === "succeeded" ? "b-ok" : r.status === "partial" ? "b-warn" : r.status === "failed" ? "b-bad" : "b-neutral"}`}>{t(`run.status.${r.status}` as TKey)}</span>
              <span className="small muted">{t(`run.trigger.${r.trigger}` as TKey)}</span>
              <span className="small">{t("run.summary", { new: r.stats.newVacancies, changed: r.stats.changedVacancies, unchanged: r.stats.unchangedVacancies, merged: r.stats.mergedFallback, policy: r.stats.policyBlocked })}</span>
            </summary>
            <table className="table"><tbody>{r.attempts.map((a) => <tr key={a.id}><td>{a.sourceId}</td><td><span className="badge b-outline">{t(`att.${a.status}` as TKey)}</span></td><td className="small">{a.items}{a.coverage ? ` · ${a.coverage.pagesFetched}/${a.coverage.pagesRequested} pages${a.coverage.perPageLimit ? ` × ${a.coverage.perPageLimit}` : ""}${a.coverage.exhausted ? " · full" : ""}` : ""}</td><td className="small muted" style={{ overflowWrap: "anywhere" }}>{a.error ?? ""}</td></tr>)}</tbody></table>
          </details>
        )) : <p className="muted">—</p>}
      </div></div>
      <div className="card"><div className="card-header"><h2>{t("set.log.app")}</h2></div><div className="card-body">
        {logs.length ? <table className="table"><tbody>{logs.map((l) => <tr key={l.id}><td className="small nowrap">{date(l.at, true)}</td><td><span className={`badge ${l.level === "error" ? "b-bad" : l.level === "warn" ? "b-warn" : "b-neutral"}`}>{l.level}</span></td><td className="small">{l.area}</td><td className="small" style={{ overflowWrap: "anywhere" }}>{l.message}</td></tr>)}</tbody></table> : <p className="muted">—</p>}
      </div></div>
    </div>
  );
}
