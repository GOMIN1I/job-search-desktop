import { useEffect, useState } from "react";
import type { Candidate, MaterialVersion, SearchProfileVersion, SearchRules, SkillEvidence } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { RulesEditor, RulesSummary } from "../components/RulesEditor";
import { DemoBadge, Icon, Modal, useBusy, useToast } from "../components/ui";

interface ProfileData { candidate: Candidate; profile: SearchProfileVersion; history: Array<{ version: number; createdAt: string; note: string }>; skills: SkillEvidence[]; materials: MaterialVersion[] }

export function Profile() {
  const { t, date, lang } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const cid = app.candidate!.id;
  const [p, setP] = useState<ProfileData | null>(null);
  const [editRules, setEditRules] = useState<SearchRules | null>(null);
  const [note, setNote] = useState("");
  const [skillEdit, setSkillEdit] = useState<Partial<SkillEvidence> | null>(null);
  const [docEdit, setDocEdit] = useState<MaterialVersion | null>(null);
  const [docText, setDocText] = useState("");
  const [diff, setDiff] = useState<Array<{ op: string; text: string }> | null>(null);
  const [nameEdit, setNameEdit] = useState<{ name: string; notes: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const load = () => call<ProfileData>("profile.get", { candidateId: cid }).then(setP);
  useEffect(() => {
    void load();
  }, [cid, app.version]);
  if (!p) return <div className="page"><p className="muted">{t("common.loading")}</p></div>;

  const groups: Array<[SkillEvidence["kind"], TKey, string]> = [["proven", "prof.proven", "b-ok"], ["self_reported", "prof.self", "b-warn"], ["needs_example", "prof.needs", "b-neutral"]];
  const byMaterial = new Map<string, MaterialVersion[]>();
  for (const m of p.materials) byMaterial.set(m.materialId, [...(byMaterial.get(m.materialId) ?? []), m]);

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <h1>{p.candidate.name}</h1>
          {p.candidate.isDemo && <DemoBadge />}
          <button className="btn btn-sm btn-ghost" onClick={() => setNameEdit({ name: p.candidate.name, notes: p.candidate.notes })}>{t("common.edit")}</button>
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmDelete(true)}>{t("prof.deleteCandidate")}</button>
        </div>
        {p.candidate.notes && <p className="subtle" style={{ marginBottom: 14, whiteSpace: "pre-wrap" }}>{p.candidate.notes}</p>}

        <section className="card" aria-labelledby="rules">
          <div className="card-header"><h2 id="rules">{t("prof.rules")}</h2><span className="badge b-outline">v{p.profile.version}</span><span style={{ flex: 1 }} /><button className="btn btn-sm" onClick={() => { setEditRules(JSON.parse(JSON.stringify(p.profile.rules))); setNote(""); }}>{t("prof.editRules")}</button></div>
          <div className="card-body">
            <RulesSummary rules={p.profile.rules} />
            <details style={{ marginTop: 12 }}>
              <summary className="small subtle" style={{ cursor: "pointer" }}>{t("prof.versions")}, {p.history.length}</summary>
              <table className="table"><tbody>{p.history.map((h) => <tr key={h.version}><td>v{h.version}{h.version === p.profile.version ? ` · ${t("prof.current")}` : ""}</td><td className="small">{date(h.createdAt, true)}</td><td className="small">{h.note}</td></tr>)}</tbody></table>
            </details>
          </div>
        </section>

        <section className="card" style={{ marginTop: 14 }} aria-labelledby="skills">
          <div className="card-header"><h2 id="skills">{t("prof.facts")}</h2><span style={{ flex: 1 }} /><button className="btn btn-sm" onClick={() => setSkillEdit({ kind: "proven", skill: "", evidence: "", url: null })}>+ {t("prof.addSkill")}</button></div>
          <div className="card-body">
            <p className="help" style={{ marginBottom: 10 }}>{t("ob.exp.help")}</p>
            <div className="grid-3">
              {groups.map(([k, label, cls]) => (
                <div key={k} className="stack">
                  <span className={`badge ${cls}`} style={{ alignSelf: "flex-start" }}>{t(label)}, {p.skills.filter((s) => s.kind === k).length}</span>
                  {p.skills.filter((s) => s.kind === k).map((s) => (
                    <button key={s.id} className="app-card" onClick={() => setSkillEdit(s)}>
                      <strong>{s.skill}</strong>
                      {s.evidence && <div className="small subtle">{s.evidence}</div>}
                      {s.url && <div className="small muted" style={{ overflowWrap: "anywhere" }}>{s.url}</div>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card" style={{ marginTop: 14 }} aria-labelledby="docs">
          <div className="card-header">
            <h2 id="docs">{t("prof.materials")}</h2>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => run("check", async () => { const r = await call<{ missing: number }>("materials.checkFiles", { candidateId: cid }); push(`${t("prof.fileMissing")}: ${r.missing}`); })}>{t("prof.checkFiles")}</button>
            <button className="btn btn-sm" onClick={() => run("cv", async () => { await call("materials.createDraft", { candidateId: cid, kind: "cv", lang, mode: "template" }); })}>{t("prof.newCv")}</button>
            <button className="btn btn-sm btn-primary" onClick={() => run("import", async () => { await call("materials.importFile", { candidateId: cid, kind: "cv" }); })}>{t("prof.importFile")}</button>
          </div>
          <div className="card-body">
            {!p.materials.length && <p className="muted">—</p>}
            {[...byMaterial.values()].map((versions) => (
              <div key={versions[0].materialId} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                {versions.map((m, idx) => (
                  <div key={m.id} className="row-wrap" style={{ padding: "4px 0", opacity: idx === 0 ? 1 : 0.75 }}>
                    <Icon.doc className="nav-icon" />
                    <strong style={{ fontWeight: idx === 0 ? 600 : 400 }}>{m.title}</strong>
                    <span className="badge b-outline">v{m.version}</span>
                    <span className={`badge ${m.status === "human_reviewed" ? "b-ok" : m.status === "stale" ? "b-warn" : "b-neutral"}`}>{t(`prof.status.${m.status}` as TKey)}</span>
                    <span className="badge b-outline">{t(`prof.origin.${m.origin}` as TKey)}</span>
                    {m.filePath ? <span className={`badge ${m.fileAvailable ? "b-ok" : "b-bad"}`}>{m.fileAvailable ? t("prof.fileOk") : t("prof.fileMissing")}</span> : m.origin === "imported" ? <span className="badge b-warn">{t("prof.noFile")}</span> : null}
                    {m.aiModel && <span className="small muted">{m.aiModel}, {m.promptVersion}</span>}
                    {m.usedFacts.length > 0 && <span className="small muted">{t("prof.usedFacts", { n: m.usedFacts.length })}</span>}
                    <span className="small muted">{date(m.updatedAt)}</span>
                    <span style={{ flex: 1 }} />
                    {m.filePath && <button className="btn btn-sm btn-ghost" onClick={() => run("open", () => call("materials.openFile", { candidateId: cid, id: m.id }))}>{t("common.open")}</button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => { setDocEdit(m); setDocText(m.content); }}>{t("prof.editDoc")}</button>
                    {versions[idx + 1] && <button className="btn btn-sm btn-ghost" onClick={() => run("diff", async () => setDiff(await call("materials.diff", { candidateId: cid, a: versions[idx + 1].id, b: m.id })))}>{t("prof.compare")}</button>}
                    {m.status !== "human_reviewed" && <button className="btn btn-sm btn-ghost" onClick={() => run("rev", () => call("materials.setStatus", { candidateId: cid, id: m.id, status: "human_reviewed" }))}>{t("prof.markReviewed")}</button>}
                    <select className="select" style={{ height: 26, fontSize: 12 }} value="" aria-label={t("prof.export")} onChange={(e) => { const f = e.target.value; if (f) void run("exp", async () => { const r = await call<{ path?: string }>("materials.export", { candidateId: cid, id: m.id, format: f }); if (r.path) push(r.path); }); }}>
                      <option value="">{t("prof.export")}…</option>
                      <option value="pdf">PDF</option><option value="html">HTML</option><option value="md">Markdown</option><option value="txt">TXT</option>
                    </select>
                    <button className="btn btn-sm btn-ghost btn-danger" onClick={() => run("del", () => call("materials.delete", { candidateId: cid, id: m.id }))} aria-label={t("common.delete")}>✕</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>

      {editRules && (
        <Modal wide title={t("prof.editRules")} onClose={() => setEditRules(null)} footer={<>
          <input className="input" style={{ flex: 1 }} placeholder={t("prof.versionNote")} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t("prof.versionNote")} />
          <button className="btn" onClick={() => setEditRules(null)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={busy === "rules"} onClick={() => run("rules", async () => { const r = await call<{ version: number; reassessed: number }>("profile.saveRules", { candidateId: cid, rules: editRules, note }); push(`v${r.version} · ${r.reassessed}`); setEditRules(null); })}>{t("prof.saveRules")}</button>
        </>}>
          <RulesEditor rules={editRules} onChange={setEditRules} sections={["goals", "experience", "place", "format", "hours", "languages", "pay", "limits"]} />
        </Modal>
      )}

      {skillEdit && (
        <Modal title={skillEdit.id ? t("common.edit") : t("prof.addSkill")} onClose={() => setSkillEdit(null)} footer={<>
          {skillEdit.id && <button className="btn btn-danger" onClick={() => run("sdel", async () => { await call("skills.delete", { candidateId: cid, id: skillEdit.id }); setSkillEdit(null); })}>{t("common.delete")}</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSkillEdit(null)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={!skillEdit.skill?.trim()} onClick={() => run("sk", async () => { await call("skills.upsert", { ...skillEdit, candidateId: cid, skill: skillEdit.skill!.trim() }); setSkillEdit(null); })}>{t("common.save")}</button>
        </>}>
          <div className="stack">
            <div className="field"><label htmlFor="sk-n">{t("prof.skill")}</label><input id="sk-n" className="input" value={skillEdit.skill ?? ""} onChange={(e) => setSkillEdit({ ...skillEdit, skill: e.target.value })} /></div>
            <div className="field"><label htmlFor="sk-k">{t("prof.kind")}</label>
              <select id="sk-k" className="select" value={skillEdit.kind} onChange={(e) => setSkillEdit({ ...skillEdit, kind: e.target.value as SkillEvidence["kind"] })}>
                <option value="proven">{t("prof.proven")}</option><option value="self_reported">{t("prof.self")}</option><option value="needs_example">{t("prof.needs")}</option>
              </select>
            </div>
            <div className="field"><label htmlFor="sk-e">{t("prof.evidence")}</label><textarea id="sk-e" className="textarea" rows={3} value={skillEdit.evidence ?? ""} onChange={(e) => setSkillEdit({ ...skillEdit, evidence: e.target.value })} /></div>
            <div className="field"><label htmlFor="sk-u">{t("prof.url")}</label><input id="sk-u" className="input" value={skillEdit.url ?? ""} onChange={(e) => setSkillEdit({ ...skillEdit, url: e.target.value || null })} /></div>
          </div>
        </Modal>
      )}

      {docEdit && (
        <Modal wide title={`${docEdit.title} · v${docEdit.version}`} onClose={() => setDocEdit(null)} footer={<>
          <button className="btn" onClick={() => setDocEdit(null)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={docText === docEdit.content} onClick={() => run("ver", async () => { await call("materials.saveVersion", { candidateId: cid, fromId: docEdit.id, content: docText }); setDocEdit(null); })}>{t("prof.saveVersion")}</button>
        </>}>
          <textarea className="textarea" style={{ width: "100%", minHeight: 380, fontFamily: "var(--font)" }} value={docText} onChange={(e) => setDocText(e.target.value)} aria-label={docEdit.title} />
        </Modal>
      )}

      {diff && (
        <Modal wide title={t("prof.compare")} onClose={() => setDiff(null)}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 0" }}>
            {diff.map((l, i) => <div key={i} className={`diff-line ${l.op === "add" ? "diff-add" : l.op === "del" ? "diff-del" : ""}`}>{l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}{l.text}</div>)}
          </div>
        </Modal>
      )}

      {nameEdit && (
        <Modal title={t("common.edit")} onClose={() => setNameEdit(null)} footer={<>
          <button className="btn" onClick={() => setNameEdit(null)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={!nameEdit.name.trim()} onClick={() => run("nm", async () => { await call("candidates.update", { id: cid, ...nameEdit }); setNameEdit(null); })}>{t("common.save")}</button>
        </>}>
          <div className="stack">
            <div className="field"><label htmlFor="nm">{t("ob.name.label")}</label><input id="nm" className="input" value={nameEdit.name} onChange={(e) => setNameEdit({ ...nameEdit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="nt">{t("prof.notes")}</label><textarea id="nt" className="textarea" rows={4} value={nameEdit.notes} onChange={(e) => setNameEdit({ ...nameEdit, notes: e.target.value })} /></div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={t("prof.deleteCandidate")} onClose={() => setConfirmDelete(false)} footer={<>
          <button className="btn" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={() => run("delc", async () => { await call("candidates.delete", { id: cid }); setConfirmDelete(false); await app.reload(); })}>{t("common.delete")}</button>
        </>}>
          <p>{t("prof.deleteConfirm")}</p>
        </Modal>
      )}
    </div>
  );
}
