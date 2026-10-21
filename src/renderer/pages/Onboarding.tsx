// Первый запуск: от открытия до первого полезного результата простыми словами.
// Знакомство → о вас → что ищете → где искать → помощник (локальная модель) → первый поиск и объяснение.
// Заполненное сохраняется автоматически; шаги можно пройти назад и пропустить необязательные.
import { useEffect, useMemo, useRef, useState } from "react";
import type { AiInstructions, Candidate, Cefr, SearchRules, SourceInfo } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { RulesEditor, useTemplates } from "../components/RulesEditor";
import { AiInstructionsEditor } from "../components/AiInstructions";
import { BrandMark, FitBadge, Icon, useBusy, useToast } from "../components/ui";
import { LocalModels } from "../components/LocalModels";
import { RunPanel } from "../components/RunPanel";
import type { ListItem } from "./Vacancies";

const STEPS = ["intro", "about", "wishes", "sources", "ai", "search"] as const;
type Step = (typeof STEPS)[number];
const DRAFT_KEY = "jsd-onboarding-draft-v2";

interface Draft {
  step: Step;
  candidateId: string | null;
  name: string;
  notes: string;
  country: string;
  city: string;
  langs: Array<{ lang: string; written: Cefr | null; spoken: Cefr | null }>;
  skills: Array<{ skill: string; proven: boolean; evidence: string }>;
  templates: string[];
  remote: boolean;
  hybrid: boolean;
  office: boolean;
  payCurrency: string;
  payAmount: string;
  payCurrency2: string;
  payAmount2: string;
  noCalls: boolean;
  entryOnly: boolean;
  advanced: SearchRules | null;
  instructions?: AiInstructions;
  instrOpen?: number;
}

const emptyDraft = (lang: "ru" | "en"): Draft => ({
  step: "intro", candidateId: null, name: "", notes: "", country: "", city: "",
  langs: lang === "ru" ? [{ lang: "ru", written: "C2", spoken: "C2" }, { lang: "en", written: null, spoken: null }] : [{ lang: "en", written: null, spoken: null }],
  skills: [], templates: [], remote: true, hybrid: false, office: false,
  payCurrency: lang === "ru" ? "RUB" : "USD", payAmount: "", payCurrency2: "USD", payAmount2: "", noCalls: false, entryOnly: true, advanced: null,
});

function loadDraft(lang: "ru" | "en"): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyDraft(lang), ...JSON.parse(raw) };
  } catch {
    /* хранилище недоступно — начнём с чистого листа */
  }
  return emptyDraft(lang);
}

const CEFRS: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LANG_NAMES: Record<string, [string, string]> = { ru: ["Русский", "Russian"], en: ["Английский", "English"], de: ["Немецкий", "German"], es: ["Испанский", "Spanish"], fr: ["Французский", "French"], uk: ["Украинский", "Ukrainian"], kk: ["Казахский", "Kazakh"], hy: ["Армянский", "Armenian"], tr: ["Турецкий", "Turkish"], zh: ["Китайский", "Chinese"] };

export function Onboarding() {
  const { t, lang, setLang, m } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const { tpls, countries } = useTemplates();
  const [d, setD] = useState<Draft>(() => loadDraft(lang));
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [defaults, setDefaults] = useState<{ rules: SearchRules; excludedTopics: string[] } | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [results, setResults] = useState<ListItem[] | null>(null);
  const [skill, setSkill] = useState({ skill: "", proven: false, evidence: "" });
  const wasRunning = useRef(false);
  const hasOthers = app.candidates.filter((c) => c.id !== d.candidateId).length > 0;

  useEffect(() => {
    void call<{ rules: SearchRules; excludedTopics: string[] }>("app.defaults").then(setDefaults);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    } catch {
      /* не критично */
    }
  }, [d]);
  useEffect(() => {
    if (d.step === "sources") void call<SourceInfo[]>("sources.list").then(setSources);
  }, [d.step, app.version]);
  // После первого поиска — показать результат и объяснить его.
  useEffect(() => {
    if (d.step !== "search" || !d.candidateId) return;
    if (app.run.running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      void call<ListItem[]>("vacancies.list", { candidateId: d.candidateId }).then(setResults);
    }
  }, [app.run.running, d.step]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const idx = STEPS.indexOf(d.step);
  const go = (s: Step) => {
    setDir(STEPS.indexOf(s) < idx ? "back" : "fwd");
    set({ step: s });
  };

  const rules = useMemo((): SearchRules | null => {
    if (!defaults) return null;
    const base: SearchRules = d.advanced ?? { ...defaults.rules, excludedKeywords: defaults.excludedTopics };
    const allFormats = d.remote && d.hybrid && d.office;
    const minimums = [
      { currency: d.payCurrency, amountMonthly: Number(d.payAmount) || 0 },
      { currency: d.payCurrency2, amountMonthly: Number(d.payAmount2) || 0 },
    ].filter((x, i, a) => x.amountMonthly > 0 && a.findIndex((y) => y.currency === x.currency) === i);
    const tracks = d.templates
      .map((id) => tpls.find((x) => x.id === id))
      .filter(Boolean)
      .map((tp) => ({ id: `trk-${tp!.id}`, name: lang === "en" ? tp!.nameEn : tp!.name, enabled: true, titleKeywords: [...tp!.titleKeywords], bodyKeywords: [...tp!.bodyKeywords], excludeKeywords: [...tp!.excludeKeywords], noCalls: !!tp!.noCalls, templateId: tp!.id }));
    const langs = d.langs.filter((l) => l.written || l.spoken).map((l) => ({ ...l, basis: "self_reported" as const }));
    return {
      ...base,
      tracks,
      location: { country: d.country || null, city: d.city || null, timezone: base.location.timezone },
      countryEligibility: { mode: d.country ? "hard" : "unset" },
      workFormat: { mode: allFormats ? "unset" : "hard", remote: d.remote, hybrid: d.hybrid, office: d.office, hybridCities: d.hybrid && d.city ? [d.city] : [] },
      pay: { mode: minimums.length ? "hard" : "unset", minimums },
      languages: { mode: langs.length ? "hard" : "unset", items: langs },
      voice: { mode: d.noCalls ? "hard" : "unset", noPhoneWork: d.noCalls, noVoiceScreening: false },
      experience: { mode: d.entryOnly ? "hard" : "unset", maxYearsRequired: 1, allowSenior: false },
      aiInstructions: d.instructions,
    };
  }, [d, defaults, tpls, lang]);

  const saveCandidate = () =>
    run("save", async () => {
      if (!rules) return;
      if (d.candidateId && app.candidates.some((c) => c.id === d.candidateId)) {
        await call("candidates.update", { id: d.candidateId, name: d.name.trim(), notes: d.notes });
        await call("profile.saveRules", { candidateId: d.candidateId, rules, note: "onboarding" });
      } else {
        const c = await call<Candidate>("candidates.create", {
          name: d.name.trim(), notes: d.notes, rules,
          skills: d.skills.map((s) => ({ skill: s.skill, kind: s.proven ? "proven" : "self_reported", evidence: s.evidence, url: null })),
        });
        set({ candidateId: c.id });
        app.setCandidate(c.id);
      }
      go("sources");
    });

  const finish = async (openResults: boolean) => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    await app.reload();
    app.go(openResults ? "vacancies" : "today");
    app.openGuide();
  };

  const stepTitle = (s: Step) => t(`ob2.step.${s}` as TKey);
  const canNext = d.step === "about" ? d.name.trim().length > 0 : true;
  const countryList = countries.slice().sort((a, b) => (lang === "ru" ? a.ru.localeCompare(b.ru, "ru") : a.en.localeCompare(b.en)));
  const groups = ["AI", "Письменная работа", "Аналитика", "Инженерия", "Другое"];

  return (
    <div className="onb">
      <div className="onb-top">
        <div className="brand"><BrandMark /><span>{t("app.name")}</span></div>
        <span style={{ flex: 1 }} />
        <select className="select" value={lang} onChange={(e) => setLang(e.target.value as "ru" | "en")} aria-label={t("ob.lang")}>
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
        {hasOthers && <button className="btn btn-ghost" onClick={() => app.go("today")}>{t("common.cancel")}</button>}
      </div>
      <div className="onb-wrap">
        <div className="onb-card">
          <nav className="onb-steps" aria-label="steps">
            {STEPS.map((s, i) => (
              <button key={s} className={i < idx ? "done" : i === idx ? "on" : ""} disabled={i > idx || (i > 2 && !d.candidateId)} onClick={() => go(s)} aria-current={i === idx ? "step" : undefined}>
                {stepTitle(s)}
              </button>
            ))}
          </nav>

          <div key={d.step} className={`onb-step${dir === "back" ? " back" : ""}`}>
            {d.step === "intro" && (
              <>
                <h1>{t("ob2.intro.h")}</h1>
                <p className="lead">{t("ob2.intro.lead")}</p>
                <div className="intro-demo" aria-label="example">
                  <div><span className="mark mark-wipe" style={{ animationDelay: "120ms" }}>{t("ob2.intro.demo.a")}</span><span className="note">✓ {t("ob2.intro.demo.an")}</span></div>
                  <div><span className="mark mark-ask mark-wipe" style={{ animationDelay: "480ms" }}>{t("ob2.intro.demo.b")}</span><span className="note">? {t("ob2.intro.demo.bn")}</span></div>
                  <div><span className="mark mark-no mark-wipe" style={{ animationDelay: "840ms" }}>{t("ob2.intro.demo.c")}</span><span className="note">✕ {t("ob2.intro.demo.cn")}</span></div>
                </div>
                <div className="intro-points">
                  {(["p1", "p2", "p3"] as const).map((p) => (
                    <div key={p}><strong>{t(`ob2.intro.${p}.t` as TKey)}</strong>{t(`ob2.intro.${p}.d` as TKey)}</div>
                  ))}
                </div>
              </>
            )}

            {d.step === "about" && (
              <div className="stack-lg">
                <div><h1>{t("ob2.about.h")}</h1><p className="lead">{t("ob2.about.lead")}</p></div>
                <div className="field" style={{ maxWidth: 420 }}>
                  <label htmlFor="ob-name">{t("ob2.about.name")}</label>
                  <input id="ob-name" className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
                </div>
                <div className="field" style={{ maxWidth: 420 }}>
                  <label htmlFor="ob-country">{t("ob2.about.country")}</label>
                  <select id="ob-country" className="select" value={d.country} onChange={(e) => set({ country: e.target.value })}>
                    <option value="">—</option>
                    {countryList.map((c) => <option key={c.code} value={c.code}>{lang === "ru" ? c.ru : c.en}</option>)}
                  </select>
                  <p className="why">{t("ob2.about.countryWhy")}</p>
                </div>
                <div className="field">
                  <label>{t("ob2.about.langs")}</label>
                  <div className="stack">
                    {d.langs.map((l, i) => (
                      <div key={i} className="row-wrap">
                        <select className="select" value={l.lang} onChange={(e) => set({ langs: d.langs.map((x, k) => (k === i ? { ...x, lang: e.target.value } : x)) })} aria-label={t("ob2.about.langs")}>
                          {Object.entries(LANG_NAMES).map(([code, n]) => <option key={code} value={code}>{lang === "ru" ? n[0] : n[1]}</option>)}
                        </select>
                        <select className="select" value={l.written ?? ""} onChange={(e) => set({ langs: d.langs.map((x, k) => (k === i ? { ...x, written: (e.target.value || null) as Cefr | null } : x)) })} aria-label={t("ob.lang.written")}>
                          <option value="">{t("ob.lang.written")}: —</option>{CEFRS.map((c) => <option key={c} value={c}>{t("ob.lang.written")}: {c}</option>)}
                        </select>
                        <select className="select" value={l.spoken ?? ""} onChange={(e) => set({ langs: d.langs.map((x, k) => (k === i ? { ...x, spoken: (e.target.value || null) as Cefr | null } : x)) })} aria-label={t("ob.lang.spoken")}>
                          <option value="">{t("ob.lang.spoken")}: —</option>{CEFRS.map((c) => <option key={c} value={c}>{t("ob.lang.spoken")}: {c}</option>)}
                        </select>
                        <button className="btn btn-ghost btn-sm" onClick={() => set({ langs: d.langs.filter((_, k) => k !== i) })}>{t("common.delete")}</button>
                      </div>
                    ))}
                    <div><button className="btn btn-sm" onClick={() => set({ langs: [...d.langs, { lang: "en", written: null, spoken: null }] })}>+ {t("ob.lang.add")}</button></div>
                  </div>
                  <p className="why">{t("ob2.about.langsWhy")}</p>
                </div>
                <div className="field">
                  <label>{t("ob2.about.skills")}</label>
                  {d.skills.map((s, i) => (
                    <div key={i} className="order-item">
                      <span className={`verdict ${s.proven ? "v-yes" : "v-ask"}`}>{s.proven ? t("prof.proven") : t("prof.self")}</span>
                      <strong>{s.skill}</strong><span className="small subtle" style={{ flex: 1 }}>{s.evidence}</span>
                      <button className="btn btn-ghost btn-sm" onClick={() => set({ skills: d.skills.filter((_, k) => k !== i) })}>{t("common.delete")}</button>
                    </div>
                  ))}
                  <div className="row-wrap">
                    <input className="input" placeholder={t("prof.skill")} value={skill.skill} onChange={(e) => setSkill({ ...skill, skill: e.target.value })} aria-label={t("prof.skill")} />
                    <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={t("prof.evidence")} value={skill.evidence} onChange={(e) => setSkill({ ...skill, evidence: e.target.value })} aria-label={t("prof.evidence")} />
                    <label className="check"><input type="checkbox" checked={skill.proven} onChange={(e) => setSkill({ ...skill, proven: e.target.checked })} />{t("ob2.about.hasExample")}</label>
                    <button className="btn" disabled={!skill.skill.trim()} onClick={() => { set({ skills: [...d.skills, { ...skill, skill: skill.skill.trim() }] }); setSkill({ skill: "", proven: false, evidence: "" }); }}>{t("common.add")}</button>
                  </div>
                  <p className="why">{t("ob2.about.skillsWhy")}</p>
                </div>
              </div>
            )}

            {d.step === "wishes" && (
              <div className="stack-lg">
                <div><h1>{t("ob2.wishes.h")}</h1><p className="lead">{t("ob2.wishes.lead")}</p></div>
                {groups.map((g) => {
                  const list = tpls.filter((x) => x.group === g);
                  if (!list.length) return null;
                  return (
                    <div key={g} className="stack">
                      <h3 className="subtle">{lang === "en" ? list[0].groupEn : g}</h3>
                      <div className="tpl-grid">
                        {list.map((tp) => {
                          const onT = d.templates.includes(tp.id);
                          return (
                            <label key={tp.id} className={`tpl ${onT ? "on" : ""}`}>
                              <input type="checkbox" checked={onT} onChange={() => set({ templates: onT ? d.templates.filter((x) => x !== tp.id) : [...d.templates, tp.id] })} />
                              <span>{lang === "en" ? tp.nameEn : tp.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="field">
                  <label>{t("ob2.wishes.format")}</label>
                  <div className="row-wrap">
                    {(["remote", "hybrid", "office"] as const).map((k) => (
                      <label key={k} className="check"><input type="checkbox" checked={d[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<Draft>)} />{t(`ob.format.${k}` as TKey)}</label>
                    ))}
                    {(d.hybrid || d.office) && <input className="input" placeholder={t("ob.place.city")} value={d.city} onChange={(e) => set({ city: e.target.value })} aria-label={t("ob.place.city")} />}
                  </div>
                </div>
                <div className="field">
                  <label>{t("ob2.wishes.pay")}</label>
                  <div className="row-wrap">
                    <input className="input" type="number" min={0} style={{ width: 160 }} value={d.payAmount} onChange={(e) => set({ payAmount: e.target.value })} aria-label={t("ob2.wishes.pay")} />
                    <select className="select" value={d.payCurrency} onChange={(e) => set({ payCurrency: e.target.value })} aria-label={t("ob.pay.currency")}>{["RUB", "USD", "EUR", "KZT", "UAH", "GBP", "AMD", "TRY", "BYN", "UZS", "GEL"].map((c) => <option key={c}>{c}</option>)}</select>
                    <span className="subtle">{lang === "ru" ? "или" : "or"}</span>
                    <input className="input" type="number" min={0} style={{ width: 140 }} value={d.payAmount2} onChange={(e) => set({ payAmount2: e.target.value })} aria-label={`${t("ob2.wishes.pay")} 2`} />
                    <select className="select" value={d.payCurrency2} onChange={(e) => set({ payCurrency2: e.target.value })} aria-label={`${t("ob.pay.currency")} 2`}>{["USD", "EUR", "RUB", "KZT", "GBP"].map((c) => <option key={c}>{c}</option>)}</select>
                  </div>
                  <p className="why">{t("ob2.wishes.payWhy")}</p>
                </div>
                <div className="stack">
                  <label className="check"><input type="checkbox" checked={d.noCalls} onChange={(e) => set({ noCalls: e.target.checked })} />{t("ob2.wishes.noCalls")}</label>
                  <label className="check"><input type="checkbox" checked={d.entryOnly} onChange={(e) => set({ entryOnly: e.target.checked })} />{t("ob2.wishes.experience")}</label>
                </div>
                <div className="field">
                  <label>{lang === "ru" ? "Дополнительные инструкции для ИИ (по желанию)" : "Additional instructions for AI (optional)"}</label>
                  <p className="why">{lang === "ru" ? "Своими словами: какие площадки не использовать, какие страны и языки рассматривать, чего избегать. Применяется в каждом поиске." : "In your own words: which sites not to use, which countries and languages to consider, what to avoid. Applied on every search."}</p>
                  {rules && <AiInstructionsEditor rules={rules} value={d.instructions} aiConnected={false} onChange={(v, o) => set({ instructions: v, instrOpen: o })} />}
                </div>
                <details className="more">
                  <summary>{t("ob2.wishes.more")}</summary>
                  <div>{rules && <RulesEditor rules={rules} onChange={(r) => set({ advanced: r })} sections={["hours", "languages", "limits"]} />}</div>
                </details>
                <p className="help">{t("ob2.wishes.required")}</p>
              </div>
            )}

            {d.step === "sources" && (
              <div className="stack-lg">
                <div><h1>{t("ob2.sources.h")}</h1><p className="lead">{t("ob2.sources.lead")}</p></div>
                <div className="card"><div className="card-body stack" style={{ gap: 0 }}>
                  {sources.filter((s) => s.kind !== "ats").map((s) => (
                    <label key={s.id} className="row" style={{ padding: "11px 0", borderBottom: "1px solid var(--line)", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                      <input type="checkbox" className="check" checked={s.enabled} onChange={(e) => void call("sources.update", { id: s.id, enabled: e.target.checked })} style={{ marginTop: 3, width: 17, height: 17, accentColor: "var(--pine)" }} />
                      <span className="stack" style={{ gap: 2 }}><strong>{s.label}</strong><span className="small subtle">{m(s.coverageNote)}</span></span>
                    </label>
                  ))}
                </div></div>
                <p className="help">{t("ob2.sources.note")} {t("ob2.sources.companies")}</p>
              </div>
            )}

            {d.step === "ai" && (
              <div className="stack-lg">
                <div><h1>{t("ob2.ai.h")}</h1><p className="lead">{t("ob2.ai.lead")}</p></div>
                <LocalModels onReady={(model) => push(`${t("ai.model.inUse")}: ${model}`)} />
                <p className="help">{t("ob2.ai.skip")}</p>
              </div>
            )}

            {d.step === "search" && (
              <div className="stack-lg">
                <div><h1>{results ? t("ob2.search.done.h") : t("ob2.search.h")}</h1>{!results && <p className="lead">{t("ob2.search.lead")}</p>}</div>
                {!results && <RunPanel lastRun={null} compact />}
                {results && (() => {
                  const posts = results.filter((r) => r.postingKind === "job_posting");
                  const yes = posts.filter((r) => r.fit === "suitable").length;
                  const ask = posts.filter((r) => r.fit === "needs_check").length;
                  return (
                    <div className="stack-lg">
                      <p className="lead">{t("ob2.search.done.lead", { total: posts.length, yes, ask })}</p>
                      <div className="card"><div className="card-body stack">
                        <div className="row"><FitBadge fit="suitable" wipe /><span className="subtle">{t("guide.legend.yes")}</span></div>
                        <div className="row"><FitBadge fit="needs_check" wipe /><span className="subtle">{t("guide.legend.ask")}</span></div>
                        <div className="row"><FitBadge fit="unsuitable" wipe /><span className="subtle">{t("guide.legend.no")}</span></div>
                      </div></div>
                      {yes === 0 && <div className="banner banner-info">{t("ob2.search.zero")}</div>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          <div className="onb-foot">
            {idx > 0 && <button className="btn" onClick={() => go(STEPS[idx - 1])}>{t("ob2.back")}</button>}
            {d.step === "intro" && !hasOthers && (
              <button className="btn btn-ghost" disabled={busy === "demo"} onClick={() => run("demo", async () => { await call("demo.load"); await finish(false); })}>{t("ob2.demo")}</button>
            )}
            <span className="spacer" />
            {d.step !== "intro" && d.step !== "search" && <span className="small muted" style={{ maxWidth: 260 }}>{t("ob2.saved")}</span>}
            {(d.step === "sources" || d.step === "ai") && <button className="btn btn-ghost" onClick={() => go(STEPS[idx + 1])}>{t("ob2.skip")}</button>}
            {d.step === "intro" && <button className="btn btn-primary btn-lg" onClick={() => go("about")}>{t("ob.start")}</button>}
            {d.step === "about" && <button className="btn btn-primary" disabled={!canNext} onClick={() => go("wishes")}>{t("ob2.next")}</button>}
            {d.step === "wishes" && <button className="btn btn-primary" disabled={!d.name.trim() || busy === "save" || (d.instrOpen ?? 0) > 0} onClick={saveCandidate}>{t("ob2.create")}</button>}
            {(d.step === "sources" || d.step === "ai") && <button className="btn btn-primary" onClick={() => go(STEPS[idx + 1])}>{t("ob2.next")}</button>}
            {d.step === "search" && !results && <button className="btn btn-ghost" onClick={() => void finish(false)}>{t("ob2.search.skip")}</button>}
            {d.step === "search" && results && <button className="btn btn-primary btn-lg" onClick={() => void finish(true)}><Icon.list className="nav-icon" />{t("ob2.search.open")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
