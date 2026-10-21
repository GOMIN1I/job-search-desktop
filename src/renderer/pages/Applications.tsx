import { useEffect, useState } from "react";
import type { Application, ApplicationStage, MaterialVersion } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { DemoBadge, Empty, FitBadge, Icon, LifeBadge, Modal, StageBadge, useBusy, useToast } from "../components/ui";
import type { ListItem } from "./Vacancies";

type AppRow = Application & { vacancy: ListItem | null };

const COLUMNS: Array<{ key: string; stages: ApplicationStage[] }> = [
  { key: "saved", stages: ["saved"] },
  { key: "preparing", stages: ["preparing"] },
  { key: "submitted", stages: ["submitted", "response", "interview"] },
  { key: "result", stages: ["offer", "rejected", "archived"] },
];

const CHECKS = ["requirements", "unknowns", "docs", "aiPolicy", "submitted"] as const;

export function Applications() {
  const { t, lang, date } = useI18n();
  const app = useApp();
  const cid = app.candidate!.id;
  const [rows, setRows] = useState<AppRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    void call<AppRow[]>("applications.list", { candidateId: cid }).then((r) => {
      setRows(r);
      if (app.focusApplication) {
        const hit = r.find((x) => x.vacancyId === app.focusApplication);
        if (hit) setOpenId(hit.id);
      }
    });
  }, [cid, app.version, app.focusApplication]);
  const open = rows.find((r) => r.id === openId) ?? null;
  const colTitle = (k: string) => (k === "submitted" ? (lang === "ru" ? "Отправлено · в процессе" : "Applied · in progress") : k === "result" ? (lang === "ru" ? "Итог и архив" : "Outcome & archive") : t(`stage.${k}` as TKey));

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t("app.title")}</h1>
        {app.candidate!.isDemo && <DemoBadge />}
      </div>
      {!rows.length ? (
        <div className="card"><Empty title={t("app.empty")}><button className="btn" onClick={() => app.go("vacancies")}>{t("today.openVacancies")}</button></Empty></div>
      ) : (
        <div className="board">
          {COLUMNS.map((c) => {
            const list = rows.filter((r) => c.stages.includes(r.stage));
            return (
              <section key={c.key} className="column" aria-label={colTitle(c.key)}>
                <div className="column-head"><span>{colTitle(c.key)}</span><span className="muted small">{list.length}</span></div>
                {list.map((r) => (
                  <button key={r.id} className="app-card" aria-selected={openId === r.id} onClick={() => setOpenId(r.id)}>
                    <div style={{ fontWeight: 600 }}>{r.vacancy?.title ?? "—"}</div>
                    <div className="small subtle">{r.vacancy?.company ?? ""}</div>
                    <div className="row-wrap" style={{ marginTop: 6 }}>
                      <StageBadge stage={r.stage} />
                      {r.vacancy && <FitBadge fit={r.vacancy.fit} />}
                      {r.followUpAt && <span className="badge b-outline"><Icon.clock />{date(r.followUpAt)}</span>}
                    </div>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {open && <ApplicationDetail row={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ApplicationDetail({ row, onClose }: { row: AppRow; onClose: () => void }) {
  const { t, date, lang } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const cid = app.candidate!.id;
  const [notes, setNotes] = useState(row.notes);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(new Date().toISOString().slice(0, 10));
  const [materials, setMaterials] = useState<MaterialVersion[]>([]);
  const [attach, setAttach] = useState("");
  useEffect(() => {
    void call<{ materials: MaterialVersion[] }>("profile.get", { candidateId: cid }).then((p) => setMaterials(p.materials));
  }, [cid, app.version]);
  useEffect(() => setNotes(row.notes), [row.id]);
  const upd = (patch: Record<string, unknown>) => run("upd", () => call("applications.update", { id: row.id, ...patch }));
  const setStage = (stage: ApplicationStage, extra: Record<string, unknown> = {}) => run("stage", () => call("applications.setStage", { candidateId: cid, vacancyId: row.vacancyId, stage, ...extra }));
  const attached = materials.filter((m) => row.materialVersionIds.includes(m.id));
  const forThis = materials.filter((m) => !row.materialVersionIds.includes(m.id));
  const v = row.vacancy;

  return (
    <Modal wide title={v?.title ?? "—"} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t("common.close")}</button>}>
      <div className="stack-lg">
        <div className="row-wrap">
          <span className="subtle">{v?.company}</span>
          <StageBadge stage={row.stage} />
          {v && <FitBadge fit={v.fit} />}
          {v && <LifeBadge life={v.lifecycle} />}
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => { onClose(); app.go("vacancies", { vacancyId: row.vacancyId }); }}>{t("app.openVacancy")}</button>
          {v && <button className="btn btn-sm" onClick={() => run("open", () => call("vacancies.openExternal", { url: v.canonicalUrl }))}><Icon.external className="nav-icon" />{t("vac.openOriginal")}</button>}
        </div>

        <div className="stack">
          <span className="label">{t("app.moveTo")}</span>
          <div className="row-wrap">
            {(["saved", "preparing", "response", "interview", "offer", "rejected", "archived"] as ApplicationStage[]).map((s) => (
              <button key={s} className="btn btn-sm" aria-pressed={row.stage === s} disabled={row.stage === s || !!busy} onClick={() => setStage(s)}>{t(`stage.${s}` as TKey)}</button>
            ))}
            <button className="btn btn-sm btn-primary" disabled={row.stage === "submitted"} onClick={() => setConfirmSubmit(true)}><Icon.check className="nav-icon" />{t("app.markSubmitted")}</button>
          </div>
          {row.submittedAt && <span className="small subtle">{t("app.submittedAt")}: {date(row.submittedAt)}</span>}
        </div>

        <div className="grid-2">
          <div className="stack">
            <span className="label">{t("app.checklist")}</span>
            {CHECKS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!!row.checklist[k]} onChange={(e) => upd({ checklist: { ...row.checklist, [k]: e.target.checked } })} />
                {t(`app.check.${k}` as TKey)}
              </label>
            ))}
          </div>
          <div className="stack">
            <div className="field">
              <label htmlFor="fu">{t("app.followUp")}</label>
              <input id="fu" className="input" type="date" value={row.followUpAt?.slice(0, 10) ?? ""} onChange={(e) => upd({ followUpAt: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null })} />
            </div>
            <div className="field">
              <label htmlFor="notes">{t("app.notes")}</label>
              <textarea id="notes" className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== row.notes && upd({ notes })} />
            </div>
          </div>
        </div>

        <div className="stack">
          <span className="label">{t("app.docs")}</span>
          {attached.length ? attached.map((m) => (
            <div key={m.id} className="order-item">
              <Icon.doc className="nav-icon" />
              <span style={{ flex: 1 }}>{m.title} · v{m.version}</span>
              <span className={`badge ${m.status === "human_reviewed" ? "b-ok" : m.status === "stale" ? "b-warn" : "b-neutral"}`}>{t(`prof.status.${m.status}` as TKey)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => upd({ materialVersionIds: row.materialVersionIds.filter((x) => x !== m.id) })}>{t("common.delete")}</button>
            </div>
          )) : <span className="muted small">—</span>}
          <div className="row-wrap">
            <select className="select" value={attach} onChange={(e) => setAttach(e.target.value)} aria-label={t("app.attach")}>
              <option value="">{t("app.attach")}…</option>
              {forThis.map((m) => <option key={m.id} value={m.id}>{m.title} · v{m.version} · {t(`prof.status.${m.status}` as TKey)}</option>)}
            </select>
            <button className="btn btn-sm" disabled={!attach} onClick={() => { void upd({ materialVersionIds: [...row.materialVersionIds, attach] }); setAttach(""); }}>{t("common.add")}</button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("tpl", async () => {
              const r = await call<{ material: MaterialVersion }>("materials.createDraft", { candidateId: cid, vacancyId: row.vacancyId, kind: "letter", lang, mode: "template" });
              await call("applications.update", { id: row.id, materialVersionIds: [...row.materialVersionIds, r.material.id] });
              push(t("prof.origin.template"));
            })}>{t("prof.newLetter")} · {t("prof.origin.template")}</button>
            <button className="btn btn-sm" disabled={!!busy} onClick={() => run("ai", async () => {
              const r = await call<{ material: MaterialVersion; costUsd: number }>("materials.createDraft", { candidateId: cid, vacancyId: row.vacancyId, kind: "letter", lang, mode: "ai" });
              await call("applications.update", { id: row.id, materialVersionIds: [...row.materialVersionIds, r.material.id] });
              push(`${t("prof.origin.ai")} · $${r.costUsd.toFixed(4)}`);
            })}><Icon.sparkle className="nav-icon" />{t("prof.newLetter")} · AI</button>
          </div>
          <span className="help">{lang === "ru" ? "Черновики создаются только из фактов профиля и видны в «Профиль → Документы». Перед отправкой проверьте и отметьте «проверено мной»." : "Drafts are built only from profile facts and appear in Profile → Documents. Review and mark them as reviewed before sending."}</span>
        </div>

        <div className="stack">
          <span className="label">{t("app.history")}</span>
          <table className="table"><tbody>{[...row.history].reverse().map((h, i) => <tr key={i}><td className="small nowrap">{date(h.at, true)}</td><td><StageBadge stage={h.stage} /></td><td className="small">{h.note}</td></tr>)}</tbody></table>
        </div>
      </div>
      {confirmSubmit && (
        <Modal title={t("app.markSubmitted")} onClose={() => setConfirmSubmit(false)} footer={<>
          <button className="btn" onClick={() => setConfirmSubmit(false)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" onClick={async () => { setConfirmSubmit(false); await setStage("submitted", { submittedAt: new Date(`${submittedAt}T12:00:00`).toISOString(), note: "manual" }); }}>{t("common.confirm")}</button>
        </>}>
          <div className="stack">
            <p>{t("app.submittedConfirm")}</p>
            <div className="field" style={{ width: 200 }}><label htmlFor="sa">{t("app.submittedAt")}</label><input id="sa" className="input" type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} /></div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
