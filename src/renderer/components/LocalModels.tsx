// Выбор и установка локальной модели прямо в приложении: движок Ollama, модели Gemma,
// размер и требования до скачивания, рекомендация для этого компьютера, прогресс, продолжение, удаление, проверка.
import { useEffect, useRef, useState } from "react";
import type { Msg } from "../../shared/types";
import { useI18n } from "../i18n";
import { call, on } from "../api";
import { useApp } from "../state";
import { Icon, Modal, Spinner, useBusy } from "./ui";

interface CatalogModel { id: "light" | "quality" | "installed"; model: string; title: string; minRamGb: number | null; sizeBytes: number | null; licenseUrl: string; runtime?: "ollama" | "mlx" }
interface State {
  status: { state: "running" | "stopped" | "missing"; version: string | null; models: Array<{ name: string; size: number }> };
  catalog: { models: CatalogModel[]; ramGb: number; diskFree: number | null; recommended: "light" | "quality" };
  engine: { size: number; version: string; name: string } | null;
  active: string | null;
  platform: string;
  arch: string;
}
interface Progress { job: string; phase: string; completed?: number; total?: number; message?: Msg; verified?: { ok: boolean; seconds: number; error: string | null }; rate?: number }

export function LocalModels({ onReady }: { onReady?: (model: string) => void }) {
  const { t, m, lang } = useI18n();
  const app = useApp();
  const { busy, run } = useBusy();
  const [st, setSt] = useState<State | null>(null);
  const [prog, setProg] = useState<Record<string, Progress>>({});
  const [confirm, setConfirm] = useState<CatalogModel | null>(null);
  const samples = useRef<Record<string, { t: number; bytes: number }>>({});
  const load = () => call<State>("models.state").then(setSt).catch(() => setSt(null));
  useEffect(() => {
    void load();
  }, [app.version]);
  useEffect(
    () =>
      on("models-progress", (p: Progress) => {
        // Скорость загрузки: сглаженная по последним событиям (байт/с)
        setProg((x) => {
          const prev = x[p.job];
          const now = Date.now();
          let rate = prev?.rate;
          const last = samples.current[p.job];
          if (p.completed != null && last && p.phase === prev?.phase && now - last.t >= 400) {
            const inst = Math.max(0, (p.completed - last.bytes) / ((now - last.t) / 1000));
            rate = rate == null ? inst : rate * 0.7 + inst * 0.3;
          }
          if (p.completed != null && (!last || now - last.t >= 400 || p.phase !== prev?.phase)) samples.current[p.job] = { t: now, bytes: p.completed };
          return { ...x, [p.job]: { ...p, rate: p.phase === prev?.phase ? rate : undefined } };
        });
        if (p.phase === "done" && p.verified?.ok) onReady?.(p.job);
        if (["done", "error", "cancelled"].includes(p.phase)) void load();
      }),
    [],
  );
  const gb = (n: number | null | undefined) => {
    if (!n) return "?";
    const v = n / 1e9;
    return v >= 1 ? `${v.toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 1 })} ${lang === "ru" ? "ГБ" : "GB"}` : `${Math.round(n / 1e6)} ${lang === "ru" ? "МБ" : "MB"}`;
  };
  if (!st) return <div className="row subtle"><Spinner />{t("common.loading")}</div>;

  const engineProg = prog.engine;
  const engineBusy = engineProg && !["done", "error", "cancelled"].includes(engineProg.phase);
  const speed = (p?: Progress) => {
    if (!p?.rate || p.rate < 1e4) return "";
    const left = p.total && p.completed != null ? (p.total - p.completed) / p.rate : null;
    const eta = left != null && left > 60 ? `, ${t("ai.model.eta", { min: Math.ceil(left / 60) })}` : "";
    return `, ${t("ai.model.speed", { speed: gb(p.rate) })}${eta}`;
  };
  const pct = (p?: Progress) => (p?.total ? Math.min(100, Math.round(((p.completed ?? 0) / p.total) * 100)) : 0);
  const installed = (model: string) => st.status.models.some((x) => x.name === model || x.name === `${model}:latest`);

  return (
    <div className="stack-lg">
      <p className="help">{t("ai.local.privacy")}</p>

      <div className="engine-box">
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 240 }}>
          <strong>{st.status.state === "running" ? `✓ ${t("ai.engine.running")}` : st.status.state === "stopped" ? t("ai.engine.stopped") : t("ai.engine.missing")}{st.status.version ? ` (${st.status.version})` : ""}</strong>
          <span className="small subtle">{t("ai.engine.what")}</span>
          {engineBusy && (
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              <div className={`progress${engineProg.phase !== "download" ? " indeterminate" : ""}`}><div style={{ width: `${pct(engineProg)}%` }} /></div>
              <span className="small subtle">{engineProg.phase === "download" ? t("ai.model.progress", { done: gb(engineProg.completed), total: gb(engineProg.total) }) + speed(engineProg) : t("ai.engine.installing")}</span>
            </div>
          )}
          {engineProg?.phase === "error" && <span className="small" style={{ color: "var(--danger)" }}>{m(engineProg.message)}</span>}
          {st.platform === "win32" && st.status.state === "missing" && <span className="small subtle">{t("ai.engine.winNote")}</span>}
        </div>
        {st.status.state === "missing" && !engineBusy && (
          <button className="btn btn-primary" disabled={!st.engine} onClick={() => run("eng", () => call("models.installEngine"))}>{t("ai.engine.install", { size: gb(st.engine?.size) })}</button>
        )}
        {engineBusy && <button className="btn" onClick={() => void call("models.cancel", { job: "engine" })}>{t("ai.model.cancel")}</button>}
        {st.status.state === "stopped" && !engineBusy && (
          <button className="btn btn-primary" disabled={busy === "start"} onClick={() => run("start", () => call("models.startEngine"))}>{busy === "start" ? <Spinner /> : null}{t("ai.engine.start")}</button>
        )}
      </div>

      <div className="models">
        {st.catalog.models.map((cm) => {
          const p = prog[cm.model];
          const working = p && !["done", "error", "cancelled"].includes(p.phase);
          const isInstalled = installed(cm.model);
          const recommended = st.catalog.recommended === cm.id;
          const heavy = cm.minRamGb !== null && st.catalog.ramGb < cm.minRamGb;
          const compatible = cm.runtime !== "mlx" || (st.platform === "darwin" && st.arch === "arm64");
          const noDisk = cm.sizeBytes && st.catalog.diskFree !== null && st.catalog.diskFree < cm.sizeBytes * 1.15;
          return (
            <div key={cm.model} className={`model${recommended ? " recommended" : ""}`}>
              <div className="model-heading"><h3>{cm.title}</h3><span className="badge b-neutral">{cm.runtime === "mlx" ? "Apple Silicon · MLX" : "macOS · Windows · Linux"}</span></div>
              <p className="small subtle">{cm.id === "installed" ? t(cm.runtime === "mlx" ? "ai.model.mlx.d" : "ai.model.local.d") : cm.id === "light" ? t("ai.model.light.d") : t("ai.model.quality.d")}</p>
              <div className="facts">
                <span className="badge">{isInstalled ? `${t("ai.model.installed")} · ${gb(cm.sizeBytes)}` : t("ai.model.download", { size: gb(cm.sizeBytes) })}</span>
                {cm.minRamGb !== null && <span className="badge">{t("ai.model.needRam", { ram: cm.minRamGb })}</span>}
                <span className="badge b-neutral">{t("ai.model.yourRam", { ram: st.catalog.ramGb })}</span>
              </div>
              {recommended && !heavy && <span className="verdict v-yes" style={{ alignSelf: "flex-start" }}><Icon.check />{t("ai.model.recommended")}</span>}
              {!compatible && <span className="small subtle">{t("ai.model.mlx.only")}</span>}
              {heavy && <span className="verdict v-ask" style={{ alignSelf: "flex-start" }}><Icon.question />{t("ai.model.tooHeavy")}</span>}
              {noDisk && !isInstalled && <span className="small" style={{ color: "var(--danger)" }}>{t("ai.model.noDisk", { need: gb((cm.sizeBytes ?? 0) * 1.15), free: gb(st.catalog.diskFree) })}</span>}
              {working && (
                <div className="stack" style={{ gap: 4 }}>
                  <div className={`progress${p.phase === "verify" || !p.total ? " indeterminate" : ""}`}><div style={{ width: `${pct(p)}%` }} /></div>
                  <span className="small subtle">{p.phase === "verify" ? t("ai.model.verifying") : t("ai.model.progress", { done: gb(p.completed), total: gb(p.total) }) + speed(p)}</span>
                </div>
              )}
              {p?.phase === "done" && p.verified?.ok && <span className="small" style={{ color: "var(--pine)" }}>{t("ai.model.verified", { sec: p.verified.seconds })}</span>}
              {p?.phase === "error" && <span className="small" style={{ color: "var(--danger)" }}>{m(p.message)}</span>}
              <div className="actions-row">
                {!isInstalled && cm.id !== "installed" && !working && (
                  <button className="btn btn-primary" disabled={st.status.state !== "running" || !!noDisk} onClick={() => setConfirm(cm)}>
                    {p?.phase === "error" || p?.phase === "cancelled" ? t("ai.model.resume") : t("ai.model.install")}
                  </button>
                )}
                {working && p.phase !== "verify" && <button className="btn" onClick={() => void call("models.cancel", { job: cm.model })}>{t("ai.model.cancel")}</button>}
                {isInstalled && st.active === cm.model && <span className="verdict v-yes"><Icon.check />{t("ai.model.inUse")}</span>}
                {isInstalled && compatible && st.active !== cm.model && !working && (
                  <button className="btn btn-primary" disabled={busy === `use-${cm.model}`} onClick={() => run(`use-${cm.model}`, async () => { await call("models.use", { model: cm.model }); onReady?.(cm.model); })}>
                    {busy === `use-${cm.model}` ? <><Spinner />{t("ai.model.verifying")}</> : t("ai.model.use")}
                  </button>
                )}
                {isInstalled && !working && <button className="btn btn-ghost" onClick={() => run(`rm-${cm.model}`, () => call("models.remove", { model: cm.model }))}>{t("ai.model.remove")}</button>}
                <span style={{ flex: 1 }} />
                <button className="btn-link small" onClick={() => void call("vacancies.openExternal", { url: cm.licenseUrl })}>{t("ai.model.license")}</button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="small muted">{t("ai.model.disk", { free: gb(st.catalog.diskFree) })}</p>

      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)} footer={<>
          <button className="btn" onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" onClick={() => { const c = confirm; setConfirm(null); void run("pull", () => call("models.pull", { model: c.model })); }}>{t("ai.model.install")}</button>
        </>}>
          <p>{t("ai.model.confirm", { size: gb(confirm.sizeBytes) })}</p>
          <p className="help" style={{ marginTop: 10 }}>{t("ai.local.privacy")}</p>
        </Modal>
      )}
    </div>
  );
}
