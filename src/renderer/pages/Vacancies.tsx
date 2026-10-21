import { useEffect, useMemo, useRef, useState } from "react";
import type { Application, Assessment, Lifecycle, Msg, SalaryFact, Vacancy, MaterialVersion } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { DemoBadge, DimVerdict, Empty, FitBadge, Icon, LifeBadge, Modal, SalaryText, StageBadge, useBusy, useToast } from "../components/ui";

export interface ListItem {
  id: string; title: string; company: string; location: string; sourceId: string; canonicalUrl: string; publishedAt: string | null; firstSeenAt: string;
  lastSeenAt: string; lastCheckedAt: string | null; lastChangedAt: string | null; lifecycle: Lifecycle; postingKind: string; isDemo: boolean; salary: SalaryFact;
  format: string; fit: Assessment["fit"] | null; relevance: number | null; trackName: string | null; nextStep: Msg | null; stage: Application["stage"] | null;
  dismissReason: string | null; sourceCount: number;
}

interface Detail {
  vacancy: Vacancy;
  assessment: Assessment | null;
  history: Array<{ id: string; createdAt: string; fit: string; profileVersion: number; rulesVersion: string; supersededAt: string | null }>;
  application: Application | null;
  links: Array<{ sourceId: string; label: string; url: string; firstSeenAt: string; lastSeenAt: string }>;
  merges: Array<{ id: string; kept_id: string; merged_id: string; kind: string; reason: string; created_at: string; reverted_at: string | null }>;
  materials: MaterialVersion[];
  aiSummary: Msg | null;
  sourceAttribution: string;
}

const salaryMonthly = (s: SalaryFact) => {
  const v = s.min ?? s.max ?? 0;
  return s.period === "year" ? v / 12 : s.period === "hour" ? v * 160 : s.period === "week" ? v * 4.33 : v;
};

export function Vacancies() {
  const { t, lang } = useI18n();
  const app = useApp();
  const cid = app.candidate!.id;
  const [items, setItems] = useState<ListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<string | null>(app.focusVacancy);
  const [q, setQ] = useState("");
  const [fit, setFit] = useState("active");
  const [stage, setStage] = useState("any");
  const [src, setSrc] = useState("any");
  const [life, setLife] = useState("any");
  const [kind, setKind] = useState("job_posting");
  const [sort, setSort] = useState("relevance");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void call<ListItem[]>("vacancies.list", { candidateId: cid }).then((x) => {
      setItems(x);
      setLoaded(true);
    });
  }, [cid, app.version]);
  useEffect(() => {
    if (app.focusVacancy) {
      setSel(app.focusVacancy);
      setFit("all");
      setKind("all");
    }
  }, [app.focusVacancy]);

  const sources = useMemo(() => [...new Set(items.map((i) => i.sourceId))].sort(), [items]);
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    let r = items.filter((i) => {
      if (text && !`${i.title} ${i.company} ${i.location}`.toLowerCase().includes(text)) return false;
      if (fit === "active" && (i.fit === "unsuitable" || i.stage === "archived")) return false;
      if (fit !== "all" && fit !== "active" && i.fit !== fit) return false;
      if (stage === "none" && i.stage) return false;
      if (stage !== "any" && stage !== "none" && i.stage !== stage) return false;
      if (src !== "any" && i.sourceId !== src) return false;
      if (life !== "any" && i.lifecycle !== life) return false;
      if (kind === "job_posting" && i.postingKind !== "job_posting") return false;
      if (kind === "other" && i.postingKind === "job_posting") return false;
      return true;
    });
    const fitRank = (f: string | null) => (f === "suitable" ? 0 : f === "needs_check" ? 1 : f === "unsuitable" ? 2 : 3);
    r = [...r].sort((a, b) => {
      if (sort === "new") return b.firstSeenAt.localeCompare(a.firstSeenAt);
      if (sort === "checked") return (b.lastCheckedAt ?? "").localeCompare(a.lastCheckedAt ?? "");
      if (sort === "salary") return salaryMonthly(b.salary) - salaryMonthly(a.salary);
      return fitRank(a.fit) - fitRank(b.fit) || (b.relevance ?? 0) - (a.relevance ?? 0) || b.firstSeenAt.localeCompare(a.firstSeenAt);
    });
    return r;
  }, [items, q, fit, stage, src, life, kind, sort]);

  useEffect(() => {
    if (!sel && filtered[0]) setSel(filtered[0].id);
  }, [filtered, sel]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const idx = filtered.findIndex((i) => i.id === sel);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      setSel(next.id);
      listRef.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <div className="split">
      <section className="list-pane" aria-label={t("vac.title")}>
        <div className="list-toolbar">
          <div className="row">
            <h1 style={{ fontSize: 18 }}>{t("vac.title")}</h1>
            {app.candidate!.isDemo && <DemoBadge />}
          </div>
          <div className="search-input">
            <Icon.search />
            <input className="input" placeholder={t("vac.search")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("common.search")} />
          </div>
          <div className="filters">
            <select className="select" value={fit} onChange={(e) => setFit(e.target.value)} aria-label={t("vac.filter.fit")}>
              <option value="active">{t("fit.suitable")} + {t("fit.needs_check")}</option>
              <option value="all">{t("vac.filter.fit")}: {t("common.all")}</option>
              <option value="suitable">{t("fit.suitable")}</option>
              <option value="needs_check">{t("fit.needs_check")}</option>
              <option value="unsuitable">{t("fit.unsuitable")}</option>
            </select>
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t("vac.filter.stage")}>
              <option value="any">{t("vac.filter.stage")}: {t("common.all")}</option>
              <option value="none">{t("stage.found")}</option>
              {(["saved", "preparing", "submitted", "response", "interview", "offer", "rejected", "archived"] as const).map((s) => <option key={s} value={s}>{t(`stage.${s}` as TKey)}</option>)}
            </select>
            <select className="select" value={src} onChange={(e) => setSrc(e.target.value)} aria-label={t("vac.filter.source")}>
              <option value="any">{t("vac.filter.source")}: {t("common.all")}</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="select" value={life} onChange={(e) => setLife(e.target.value)} aria-label={t("vac.filter.life")}>
              <option value="any">{t("vac.filter.life")}: {t("common.all")}</option>
              {(["open", "unchecked", "unconfirmed", "closed"] as const).map((l) => <option key={l} value={l}>{t(`life.${l}` as TKey)}</option>)}
            </select>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("vac.filter.kind")}>
              <option value="job_posting">{t("kind.job_posting")}</option>
              <option value="other">{lang === "ru" ? "Навигация, пулы, сигналы" : "Navigation, pools, signals"}</option>
              <option value="all">{t("vac.filter.kind")}: {t("common.all")}</option>
            </select>
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("vac.sort")}>
              <option value="relevance">{t("vac.sort")}: {t("vac.sort.relevance")}</option>
              <option value="new">{t("vac.sort.new")}</option>
              <option value="checked">{t("vac.sort.checked")}</option>
              <option value="salary">{t("vac.sort.salary")}</option>
            </select>
          </div>
        </div>
        <div className="list" role="listbox" aria-label={t("vac.title")} tabIndex={0} onKeyDown={onListKey} ref={listRef}>
          {loaded && !filtered.length && <Empty title={t("vac.noResults")}><button className="btn btn-sm" onClick={() => { setFit("all"); setKind("all"); setStage("any"); setSrc("any"); setLife("any"); setQ(""); }}>{t("common.all")}</button></Empty>}
          {filtered.map((i) => (
            <button key={i.id} data-id={i.id} role="option" aria-selected={sel === i.id} className={`list-item ${i.stage === "archived" || i.fit === "unsuitable" ? "dim" : ""}`} onClick={() => setSel(i.id)} tabIndex={-1}>
              <div className="title">{i.title}</div>
              <div className="meta">{i.company || "—"}, {i.location || "—"}</div>
              <div className="chips">
                <FitBadge fit={i.fit} />
                <LifeBadge life={i.lifecycle} />
                {i.stage && <StageBadge stage={i.stage} />}
                {i.postingKind !== "job_posting" && <span className="badge b-neutral">{t(`kind.${i.postingKind}` as TKey)}</span>}
                {i.isDemo && <DemoBadge />}
                <span className="muted small" style={{ marginLeft: "auto" }} title={t("vac.relevanceHelp")}>{i.relevance ?? "—"}, {i.sourceId}{i.sourceCount > 1 ? ` +${i.sourceCount - 1}` : ""}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="list-footer">{t("vac.count", { n: filtered.length, total: items.length })}</div>
      </section>
      <section className="detail-pane" aria-label="detail">
        {sel ? <VacancyDetail key={sel} vacancyId={sel} /> : <Empty title={t("vac.select")} />}
      </section>
    </div>
  );
}

export function VacancyDetail({ vacancyId }: { vacancyId: string }) {
  const { t, m, date, lang } = useI18n();
  const app = useApp();
  const { push } = useToast();
  const { busy, run } = useBusy();
  const cid = app.candidate!.id;
  const [d, setD] = useState<Detail | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const load = () => call<Detail>("vacancies.get", { candidateId: cid, vacancyId }).then(setD).catch(() => setD(null));
  useEffect(() => {
    void load();
  }, [vacancyId, cid, app.version]);
  if (!d) return <div className="detail"><p className="muted">{t("common.loading")}</p></div>;
  const v = d.vacancy;
  const a = d.assessment;
  const f = v.facts;
  const stage = d.application?.stage ?? null;
  const reasons = t("vac.dismissReasons").split("|");
  const setStage = (s: string, extra: Record<string, unknown> = {}) => run(`stage-${s}`, async () => {
    await call("applications.setStage", { candidateId: cid, vacancyId: v.id, stage: s, ...extra });
    await load();
  });
  const factStatus = (st: string) => <span className="badge b-outline" style={{ marginLeft: 6 }}>{t(`fact.${st}` as TKey)}</span>;

  return (
    <article className="detail">
      <div className="detail-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{v.title}</h1>
          <div className="subtle" style={{ marginTop: 4 }}>{v.company || "—"}, {v.location || "—"}</div>
          <div className="verdict-line">
            <FitBadge fit={a?.fit ?? null} large wipe />
            {a && (
              <span>
                {a.fit === "suitable"
                  ? t("vac.sum.yes")
                  : a.fit === "needs_check"
                    ? t("vac.sum.ask", { n: a.dimensions.filter((x) => x.constraint === "hard" && x.status === "unknown").length })
                    : t("vac.sum.no", { reason: m(a.dimensions.find((x) => x.constraint === "hard" && x.status === "fail")?.reason) })}
              </span>
            )}
          </div>
          <div className="row-wrap" style={{ marginTop: 12 }}>
            <LifeBadge life={v.lifecycle} />
            {stage && <StageBadge stage={stage} />}
            {v.isDemo && <DemoBadge />}
            {v.postingKind !== "job_posting" && <span className="badge b-neutral">{t(`kind.${v.postingKind}` as TKey)}</span>}
            {v.tags.includes("intermediary_platform") && <span className="badge b-warn">{t("vac.intermediary")}</span>}
            {a && <span className="badge b-outline" title={t("vac.relevanceHelp")}>{t("vac.relevance")} {a.relevance}/100</span>}
          </div>
        </div>
      </div>

      <div className="actions">
        {stage !== "saved" && !["preparing", "submitted", "response", "interview", "offer"].includes(stage ?? "") && (
          <button className="btn" onClick={() => setStage("saved")} disabled={!!busy}><Icon.bookmark className="nav-icon" />{t("vac.save")}</button>
        )}
        {stage !== "archived" ? (
          <button className="btn" onClick={() => { setReason(reasons[0]); setDismissing(true); }}><Icon.cross className="nav-icon" />{t("vac.dismiss")}</button>
        ) : (
          <button className="btn" onClick={() => setStage("saved")}>{t("vac.restore")}</button>
        )}
        <button className="btn" onClick={() => run("prep", async () => { await call("applications.setStage", { candidateId: cid, vacancyId: v.id, stage: "preparing" }); app.go("applications", { applicationVacancyId: v.id }); })} disabled={!!busy}>
          <Icon.send className="nav-icon" />{t("vac.toApplication")}
        </button>
        <button className="btn" title={t("vac.openNote")} onClick={() => run("open", async () => { await call("vacancies.openExternal", { url: v.applyUrl || v.canonicalUrl }); push(t("vac.openNote")); })}>
          <Icon.external className="nav-icon" />{t("vac.openOriginal")}
        </button>
        <button className="btn" disabled={busy === "recheck"} onClick={() => run("recheck", async () => { const r = await call<{ lifecycle: Lifecycle; evidence: { detail: Msg } }>("vacancies.recheck", { vacancyId: v.id }); push(`${t(`life.${r.lifecycle}` as TKey)}: ${m(r.evidence.detail)}`); await load(); })}>
          <Icon.refresh className="nav-icon" />{busy === "recheck" ? "…" : t("vac.recheck")}
        </button>
        <button className="btn" disabled={busy === "ai"} onClick={() => run("ai", async () => { const r = await call<{ cached: boolean; costUsd: number; dropped: string[] }>("ai.extract", { vacancyId: v.id }); push(`AI: ${r.cached ? "cache" : `$${r.costUsd.toFixed(4)}`}${r.dropped.length ? ` · ${lang === "ru" ? "отброшено без цитаты" : "dropped without quote"}: ${r.dropped.length}` : ""}`); await load(); })}>
          <Icon.sparkle className="nav-icon" />{busy === "ai" ? "…" : t("vac.aiAnalyze")}
        </button>
      </div>
      <p className="help">{t("vac.openNote")}</p>

      {a && (
        <div className="next-step" role="note">
          <Icon.send className="nav-icon" />
          <div><strong>{t("vac.nextStep")}:</strong> {m(a.nextStep)}</div>
        </div>
      )}
      {f.aiPolicy.value.prohibitsAi && <div className="banner banner-warn" style={{ marginTop: 10 }}>{t("vac.aiPolicyYes")}: «{f.aiPolicy.quote}»</div>}
      {d.aiSummary && <div className="banner banner-info" style={{ marginTop: 10 }}><strong>{t("vac.aiSummary")}:</strong>&nbsp;{m(d.aiSummary)}</div>}

      <div className="section-title">{t("vac.assessment")}</div>
      {a ? (
        <div className="card"><div className="card-body dims">
          {a.dimensions.map((dm, i) => (
            <div className="dim-row" key={i}>
              <div className="dim-label">{m(dm.label)}<div className="small muted">{t(`constraint.${dm.constraint}` as TKey)}</div></div>
              <div className="dim-reason">
                {m(dm.reason)}
                {dm.howToResolve && dm.status !== "pass" && <div className="dim-how">{m(dm.howToResolve)}</div>}
                {dm.evidence?.quote && (
                  <div className="dim-quote">
                    <span className={`mark mark-soft ${dm.status === "fail" ? "mark-no" : dm.status === "unknown" ? "mark-ask" : ""}`}><q>{dm.evidence.quote}</q></span> {factStatus(dm.evidence.status)}
                  </div>
                )}
              </div>
              <DimVerdict status={dm.status} />
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 8 }}>{t("vac.rules", { r: a.rulesVersion, e: f.extractorVersion })}, {t("vac.profileVer", { v: a.profileVersion })}, {date(a.createdAt, true)}</p>
        </div></div>
      ) : <p className="muted">{t("fit.none")}</p>}

      <div className="section-title">{t("vac.facts")}</div>
      <div className="card"><div className="card-body">
        <dl className="kv">
          <dt>{t("vac.salary")}</dt><dd><SalaryText s={f.salary} />{f.salary.guaranteedHoursPerWeek ? <span className="small muted"> · {f.salary.guaranteedHoursPerWeek} h/wk</span> : null}{f.salary.quote && <div className="dim-quote">«{f.salary.quote}»</div>}</dd>
          <dt>{t("vac.format")}</dt><dd>{t(`format.${f.format.value}` as TKey)}{factStatus(f.format.status)}</dd>
          <dt>{t("vac.location")}</dt><dd>{f.geography.value.scope === "unknown" ? <span className="muted">{t("common.unknown")}</span> : <>{f.geography.value.allowed.join(", ") || f.geography.value.scope}{f.geography.value.excluded.length ? ` · ✕ ${f.geography.value.excluded.join(", ")}` : ""}</>}{factStatus(f.geography.status)}{f.geography.quote && <div className="dim-quote">«{f.geography.quote}»</div>}</dd>
          <dt>{t("vac.schedule")}</dt><dd>{f.schedule.status === "unknown" ? <span className="muted">{t("common.unknown")}</span> : <>{f.schedule.value.start && f.schedule.value.end ? `${f.schedule.value.start}–${f.schedule.value.end} ${f.schedule.value.zone ?? ""}` : ""} {f.schedule.value.weeklyMin ? `${f.schedule.value.weeklyMin}${f.schedule.value.weeklyMax && f.schedule.value.weeklyMax !== f.schedule.value.weeklyMin ? `–${f.schedule.value.weeklyMax}` : ""} h/wk` : ""} {f.schedule.value.flexible ? "flexible" : ""}</>}{factStatus(f.schedule.status)}</dd>
          <dt>{t("vac.languages")}</dt><dd>{f.languages.value.length ? f.languages.value.map((l) => `${l.lang.toUpperCase()} ${l.level ?? "?"}${l.spoken ? " 🗣" : ""}${l.required ? "" : ` (${t("vac.preferred")})`}`).join(", ") : <span className="muted">{t("common.unknown")}</span>}{factStatus(f.languages.status)}</dd>
          <dt>{t("vac.calls")}</dt><dd>{t(`vac.calls.${f.voice.value.phoneWork}` as TKey)}{factStatus(f.voice.status)}</dd>
          <dt>{t("vac.skills")}</dt><dd>{f.skills.value.required.length ? <><strong>{t("vac.required")}:</strong> {f.skills.value.required.join(", ")} </> : null}{f.skills.value.preferred.length ? <><br /><strong>{t("vac.preferred")}:</strong> {f.skills.value.preferred.join(", ")}</> : null}{f.skills.value.mentioned.length ? <><br /><span className="muted">{t("vac.mentioned")}: {f.skills.value.mentioned.join(", ")}</span></> : null}{!f.skills.value.required.length && !f.skills.value.preferred.length && !f.skills.value.mentioned.length && <span className="muted">—</span>}</dd>
          <dt>{t("vac.contract")}</dt><dd>{f.contract.value === "unknown" ? <span className="muted">{t("common.unknown")}</span> : f.contract.value}</dd>
          <dt>{t("vac.deadline")}</dt><dd>{f.deadline.value ?? <span className="muted">—</span>}</dd>
          <dt>{t("vac.published")}</dt><dd>{date(v.publishedAt)}</dd>
          <dt>{t("vac.firstSeen")}</dt><dd>{date(v.firstSeenAt, true)}</dd>
          <dt>{t("vac.lastChecked")}</dt><dd>{v.lastCheckedAt ? date(v.lastCheckedAt, true) : <span className="muted">{t("vac.notChecked")}</span>}</dd>
        </dl>
      </div></div>

      <div className="section-title">{t("vac.description")}</div>
      <div className="desc">{v.description || "—"}</div>
      <p className="small muted" style={{ marginTop: 6 }}>{t("vac.attribution", { s: d.sourceAttribution })}, <button className="btn-link small" onClick={() => run("open2", () => call("vacancies.openExternal", { url: v.canonicalUrl }))}>{v.canonicalUrl}</button></p>

      <div className="section-title">{t("vac.sources")}</div>
      <div className="card"><div className="card-body stack">
        <div><strong className="small">{t("vac.seenIn")}</strong>
          <table className="table"><tbody>{d.links.map((l, i) => <tr key={i}><td>{l.label}</td><td className="small" style={{ overflowWrap: "anywhere" }}>{l.url}</td><td className="small nowrap">{date(l.firstSeenAt)} – {date(l.lastSeenAt)}</td></tr>)}</tbody></table>
        </div>
        <div><strong className="small">{t("vac.lifecycleEvidence")}</strong>
          <table className="table"><tbody>{[...v.lifecycleEvidence].reverse().map((e, i) => <tr key={i}><td className="nowrap small">{date(e.at, true)}</td><td className="small">{e.type}{e.httpStatus ? ` · ${e.httpStatus}` : ""}</td><td className="small">{m(e.detail)}</td></tr>)}</tbody></table>
        </div>
        {d.merges.length > 0 && (
          <div><strong className="small">{t("vac.merges")}</strong>
            <table className="table"><tbody>{d.merges.map((mg) => <tr key={mg.id}><td className="small">{mg.kind}</td><td className="small">{mg.reason}</td><td>{mg.kind === "fallback" && !mg.reverted_at ? <button className="btn btn-sm" onClick={() => run("unmerge", async () => { await call("vacancies.revertMerge", { mergeId: mg.id }); await load(); })}>{t("vac.unmerge")}</button> : mg.reverted_at ? <span className="muted small">↺ {date(mg.reverted_at)}</span> : null}</td></tr>)}</tbody></table>
          </div>
        )}
        <div><strong className="small">{t("vac.history")}</strong>
          <table className="table"><tbody>{d.history.map((h) => <tr key={h.id}><td className="small nowrap">{date(h.createdAt, true)}</td><td><FitBadge fit={h.fit as any} /></td><td className="small">{t("vac.profileVer", { v: h.profileVersion })}, {h.rulesVersion}</td><td className="small muted">{h.supersededAt ? "superseded" : t("prof.current")}</td></tr>)}</tbody></table>
        </div>
      </div></div>

      {dismissing && (
        <Modal title={t("vac.dismissReason")} onClose={() => setDismissing(false)} footer={<>
          <button className="btn" onClick={() => setDismissing(false)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" onClick={async () => { setDismissing(false); await setStage("archived", { dismissReason: reason, note: reason }); }}>{t("vac.dismiss")}</button>
        </>}>
          <div className="stack">
            {reasons.map((r) => <label key={r} className="check"><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{r}</label>)}
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("vac.dismissReason")} />
          </div>
        </Modal>
      )}
    </article>
  );
}
