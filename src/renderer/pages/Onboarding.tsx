import { useEffect, useState } from "react";
import type { SearchRules, SkillEvidence } from "../../shared/types";
import { useI18n } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { RulesEditor, RulesSummary, type Section } from "../components/RulesEditor";
import { useBusy, useToast } from "../components/ui";

const STEPS: Array<{ key: string; sections: Section[] }> = [
  { key: "name", sections: [] },
  { key: "goals", sections: ["goals"] },
  { key: "experience", sections: ["experience"] },
  { key: "place", sections: ["place"] },
  { key: "format", sections: ["format"] },
  { key: "hours", sections: ["hours"] },
  { key: "languages", sections: ["languages"] },
  { key: "pay", sections: ["pay"] },
  { key: "limits", sections: ["limits"] },
  { key: "review", sections: [] },
];

interface DraftSkill { skill: string; kind: SkillEvidence["kind"]; evidence: string; url: string | null }

export function Onboarding() {
  const { t, lang, setLang } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const [step, setStep] = useState(-1);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rules, setRules] = useState<SearchRules | null>(null);
  const [skills, setSkills] = useState<DraftSkill[]>([]);
  const [sk, setSk] = useState<DraftSkill>({ skill: "", kind: "self_reported", evidence: "", url: null });

  useEffect(() => {
    void call<{ rules: SearchRules; excludedTopics: string[] }>("app.defaults").then((d) => setRules({ ...d.rules, excludedKeywords: d.excludedTopics }));
  }, []);

  if (!rules) return null;
  const hasCandidates = app.candidates.length > 0;

  if (step === -1) {
    return (
      <div className="onb">
        <div className="card onb-card onb-hero">
          <div className="row" style={{ marginBottom: 18 }}>
            <div className="brand-mark" aria-hidden>J</div>
            <strong>{t("app.name")}</strong>
            <span style={{ flex: 1 }} />
            <label className="label" htmlFor="ob-lang">{t("ob.lang")}</label>
            <select id="ob-lang" className="select" value={lang} onChange={(e) => setLang(e.target.value as "ru" | "en")}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>
          <h1>{hasCandidates ? t("nav.addCandidate") : t("ob.welcome")}</h1>
          <p className="subtle" style={{ fontSize: 15, marginBottom: 8 }}>{t("app.tagline")}.</p>
          <p className="subtle" style={{ marginBottom: 24 }}>{t("ob.intro")}</p>
          <div className="row-wrap">
            <button className="btn btn-primary btn-lg" onClick={() => setStep(0)}>{t("ob.start")}</button>
            {!hasCandidates && (
              <button className="btn btn-lg" disabled={busy === "demo"} onClick={() => run("demo", async () => {
                await call("demo.load");
                await app.reload();
                app.go("today");
              })}>{t("ob.demo")}</button>
            )}
            {hasCandidates && <button className="btn btn-lg btn-ghost" onClick={() => app.go("today")}>{t("common.cancel")}</button>}
          </div>
        </div>
      </div>
    );
  }

  const cur = STEPS[step];
  const last = step === STEPS.length - 1;
  const finish = () =>
    run("finish", async () => {
      await call("candidates.create", { name: name.trim(), notes, rules, skills });
      push(t("common.saved"));
      await app.reload();
      app.go("today");
    });

  return (
    <div className="onb">
      <div className="card onb-card">
        <div className="card-body" style={{ padding: "26px 30px" }}>
          <div className="row">
            <span className="muted small">{step + 1} / {STEPS.length}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={() => (hasCandidates ? app.go("today") : setStep(-1))}>{t("common.cancel")}</button>
          </div>
          <div className="onb-steps" aria-hidden>{STEPS.map((_, i) => <span key={i} className={i <= step ? "on" : ""} />)}</div>
          <h1 style={{ marginBottom: 6 }}>{t(`ob.step.${cur.key}` as any)}</h1>
          {cur.key !== "name" && cur.key !== "review" && <p className="help" style={{ marginBottom: 16 }}>{t("ob.unknownOk")}</p>}

          {cur.key === "name" && (
            <div className="stack" style={{ marginTop: 16 }}>
              <div className="field"><label htmlFor="ob-name">{t("ob.name.label")}</label><input id="ob-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
              <div className="field"><label htmlFor="ob-notes">{t("prof.notes")}</label><textarea id="ob-notes" className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
          )}

          {cur.key === "experience" && (
            <div className="stack" style={{ marginBottom: 18 }}>
              <p className="help">{t("ob.exp.help")}</p>
              {skills.map((s, i) => (
                <div key={i} className="order-item">
                  <span className={`badge ${s.kind === "proven" ? "b-ok" : s.kind === "self_reported" ? "b-warn" : "b-neutral"}`}>{t(s.kind === "proven" ? "prof.proven" : s.kind === "self_reported" ? "prof.self" : "prof.needs")}</span>
                  <strong>{s.skill}</strong>
                  <span className="muted small" style={{ flex: 1 }}>{s.evidence}</span>
                  <button className="btn btn-ghost btn-sm btn-danger" onClick={() => setSkills(skills.filter((_, k) => k !== i))}>{t("common.delete")}</button>
                </div>
              ))}
              <div className="row-wrap">
                <input className="input" style={{ width: 180 }} placeholder={t("prof.skill")} value={sk.skill} onChange={(e) => setSk({ ...sk, skill: e.target.value })} aria-label={t("prof.skill")} />
                <select className="select" value={sk.kind} onChange={(e) => setSk({ ...sk, kind: e.target.value as DraftSkill["kind"] })} aria-label={t("prof.kind")}>
                  <option value="proven">{t("prof.proven")}</option>
                  <option value="self_reported">{t("prof.self")}</option>
                  <option value="needs_example">{t("prof.needs")}</option>
                </select>
                <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={t("prof.evidence")} value={sk.evidence} onChange={(e) => setSk({ ...sk, evidence: e.target.value })} aria-label={t("prof.evidence")} />
                <button className="btn" disabled={!sk.skill.trim()} onClick={() => { setSkills([...skills, { ...sk, skill: sk.skill.trim() }]); setSk({ skill: "", kind: "self_reported", evidence: "", url: null }); }}>{t("common.add")}</button>
              </div>
            </div>
          )}

          {cur.sections.length > 0 && <RulesEditor rules={rules} onChange={setRules} sections={cur.sections} />}

          {cur.key === "review" && (
            <div className="stack" style={{ marginTop: 10 }}>
              <p className="help">{t("ob.review.help")}</p>
              <h2>{name || "—"}</h2>
              <RulesSummary rules={rules} />
              <p className="small muted">{t("prof.facts")}: {skills.length}</p>
            </div>
          )}

          <hr className="divider" style={{ margin: "22px 0 14px" }} />
          <div className="row">
            <button className="btn" onClick={() => setStep(step - 1)}>{t("common.back")}</button>
            <span style={{ flex: 1 }} />
            {!last && cur.key !== "name" && <button className="btn btn-ghost" onClick={() => setStep(step + 1)}>{t("common.skip")}</button>}
            {!last ? (
              <button className="btn btn-primary" disabled={cur.key === "name" && !name.trim()} onClick={() => setStep(step + 1)}>{t("common.next")}</button>
            ) : (
              <button className="btn btn-primary" disabled={!name.trim() || busy === "finish"} onClick={finish}>{t("ob.finish")}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
