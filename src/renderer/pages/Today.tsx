import { useEffect, useState } from "react";
import type { Application, NotificationEvent, ScheduleSettings, SearchRun, SourceAttempt } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp } from "../state";
import { DemoBadge, Empty, FitBadge, Icon, LifeBadge, useBusy } from "../components/ui";

interface Item { id: string; title: string; company: string; fit: any; relevance: number | null; nextStep: any; lifecycle: any; firstSeenAt: string; isDemo: boolean; lastChangedAt: string | null }
interface Summary {
  ack: string;
  fresh: Item[];
  changed: Item[];
  counts: { total: number; suitable: number; needsCheck: number; unsuitable: number; nonPostings: number; saved: number; preparing: number; submitted: number };
  followUps: Array<{ application: Application; vacancy: Item | null }>;
  deadlines: Array<{ vacancy: Item; deadline: string }>;
  search: { schedule: ScheduleSettings; nextRun: string | null; running: { running: boolean }; lastRun: (SearchRun & { attempts: SourceAttempt[] }) | null };
  notifications: NotificationEvent[];
}

export function Today() {
  const { t, m, date } = useI18n();
  const app = useApp();
  const { busy, run } = useBusy();
  const [s, setS] = useState<Summary | null>(null);
  const cid = app.candidate!.id;
  useEffect(() => {
    void call<Summary>("today.summary", { candidateId: cid }).then(setS).catch(() => setS(null));
  }, [cid, app.version, app.run.running]);
  if (!s) return <div className="page"><p className="muted">{t("common.loading")}</p></div>;

  const lr = s.search.lastRun;
  const att = lr?.attempts ?? [];
  const ok = att.filter((a) => a.status === "success").length;
  const partial = att.filter((a) => a.status === "partial").length;
  const failed = att.filter((a) => a.status === "failed" || a.status === "blocked").length;
  const notDue = att.filter((a) => a.status === "not_due").length;
  const considered = att.filter((a) => a.status !== "disabled").length;
  const sched = s.search.schedule;
  const statusBadge = (st: string) => (st === "succeeded" ? "b-ok" : st === "partial" ? "b-warn" : st === "failed" ? "b-bad" : "b-neutral");
  const nothing = s.fresh.length === 0 && s.changed.length === 0;

  return (
    <div className="page">
      <div className="page-narrow">
        <div className="page-header">
          <h1>{t("today.title")}</h1>
          {app.candidate!.isDemo && <DemoBadge />}
          <span className="spacer" />
          <span className="muted small">{t("today.sinceAck")} {date(s.ack, true)}</span>
          <button className="btn" onClick={() => run("ack", async () => { await call("today.ack", { candidateId: cid }); })}>{t("today.ack")}</button>
        </div>
        {app.candidate!.isDemo && <div className="banner banner-demo" style={{ marginBottom: 14 }}>{t("demo.note")}</div>}

        <section className="card" aria-labelledby="st">
          <div className="card-body status-card">
            <div className="stack">
              <h2 id="st">{t("today.status")}</h2>
              {app.run.running ? (
                <div className="stack">
                  <div className="row"><Icon.refresh className="nav-icon" /><span>{t("today.running")} {app.run.progress?.sourceId ?? ""}</span></div>
                  <div className="progress indeterminate" style={{ width: 280 }}><div /></div>
                </div>
              ) : lr ? (
                <div className="stack" style={{ gap: 4 }}>
                  <div className="row-wrap">
                    <span className="subtle">{t("today.lastRun")}:</span>
                    <strong>{date(lr.finishedAt ?? lr.startedAt, true)}</strong>
                    <span className={`badge ${statusBadge(lr.status)}`}>{t(`run.status.${lr.status}` as TKey)}</span>
                    <span className="muted small">{t(`run.trigger.${lr.trigger}` as TKey)}</span>
                  </div>
                  <span className="small subtle">{t("run.summary", { new: lr.stats.newVacancies, changed: lr.stats.changedVacancies, unchanged: lr.stats.unchangedVacancies, merged: lr.stats.mergedFallback, policy: lr.stats.policyBlocked })}</span>
                </div>
              ) : (
                <span className="subtle">{t("today.noRuns")}</span>
              )}
              <div className="row-wrap small">
                <span className="subtle">{t("today.schedule")}:</span>
                {sched.enabled ? (
                  sched.paused ? <span className="badge b-warn">{t("today.schedulePaused")}</span> : <span>{t(sched.cadence === "daily" ? "set.sched.daily" : "set.sched.weekly")} {sched.time}{s.search.nextRun ? ` · ${t("today.nextRun")}: ${date(s.search.nextRun, true)}` : ""}</span>
                ) : (
                  <span className="muted">{t("today.scheduleOff")}</span>
                )}
                <button className="btn-link small" onClick={() => app.go("settings")}>{t("nav.settings")}</button>
              </div>
              {sched.enabled && <span className="help">{t("today.localNote")}</span>}
              {att.length > 0 && (
                <div className="src-pills" aria-label={t("today.coverage")}>
                  {att.map((a) => (
                    <span key={a.id} className={`badge ${a.status === "success" ? "b-ok" : a.status === "partial" || a.status === "not_due" ? "b-warn" : a.status === "failed" || a.status === "blocked" ? "b-bad" : "b-neutral"}`} title={a.error ?? ""}>
                      {a.sourceId} · {t(`att.${a.status}` as TKey)}{a.items ? ` · ${a.items}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="stack" style={{ alignItems: "flex-end" }}>
              {app.run.running ? (
                <button className="btn" onClick={() => void app.cancelRun()}>{t("today.cancel")}</button>
              ) : (
                <button className="btn btn-primary btn-lg" onClick={() => void app.startRun()}><Icon.search className="nav-icon" />{t("today.runNow")}</button>
              )}
            </div>
          </div>
        </section>

        <div className="grid-3" style={{ marginTop: 14 }}>
          <button className="metric" style={{ border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => app.go("vacancies")}><span className="v">{s.counts.suitable}</span><span className="l">{t("fit.suitable")}</span></button>
          <button className="metric" style={{ border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => app.go("vacancies")}><span className="v">{s.counts.needsCheck}</span><span className="l">{t("fit.needs_check")}</span></button>
          <button className="metric" style={{ border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => app.go("applications")}><span className="v">{s.counts.saved + s.counts.preparing + s.counts.submitted}</span><span className="l">{t("nav.applications")}</span></button>
        </div>

        <div className="grid-2" style={{ marginTop: 14 }}>
          <section className="card" aria-labelledby="new">
            <div className="card-header"><h2 id="new">{t("today.new")}</h2><span className="muted small">{s.fresh.length}</span></div>
            <div className="card-body">
              {s.counts.total === 0 ? (
                <Empty title={t("today.empty")}>
                  <div className="row-wrap" style={{ justifyContent: "center" }}>
                    <button className="btn btn-primary" onClick={() => void app.startRun()} disabled={app.run.running}>{t("today.runNow")}</button>
                  </div>
                </Empty>
              ) : nothing ? (
                <div className="stack">
                  <strong>{t("today.zero")}</strong>
                  <span className="small subtle">{t("today.zeroDetail", { ok: ok + partial, total: considered || "—", failed, notDue, check: s.counts.needsCheck })}</span>
                  <div><button className="btn btn-sm" onClick={() => app.go("vacancies")}>{t("today.openVacancies")}</button></div>
                </div>
              ) : (
                <div className="mini-list">
                  {s.fresh.slice(0, 8).map((v) => <MiniItem key={v.id} v={v} onOpen={() => app.go("vacancies", { vacancyId: v.id })} />)}
                </div>
              )}
            </div>
          </section>

          <section className="card" aria-labelledby="todo">
            <div className="card-header"><h2 id="todo">{t("today.actions")}</h2></div>
            <div className="card-body stack">
              {s.followUps.length > 0 && (
                <div>
                  <div className="section-title" style={{ marginTop: 0 }}>{t("today.followups")}</div>
                  {s.followUps.map((f) => (
                    <button key={f.application.id} className="mini-item" onClick={() => app.go("applications", { applicationVacancyId: f.application.vacancyId })}>
                      <span><span className="t">{f.vacancy?.title ?? "—"}</span><br /><span className="s">{f.vacancy?.company} · {t(`stage.${f.application.stage}` as TKey)}</span></span>
                      <span className="badge b-warn"><Icon.clock />{date(f.application.followUpAt)}</span>
                    </button>
                  ))}
                </div>
              )}
              {s.deadlines.length > 0 && (
                <div>
                  <div className="section-title" style={{ marginTop: 0 }}>{t("today.deadlines")}</div>
                  {s.deadlines.map((d) => (
                    <button key={d.vacancy.id} className="mini-item" onClick={() => app.go("vacancies", { vacancyId: d.vacancy.id })}>
                      <span><span className="t">{d.vacancy.title}</span><br /><span className="s">{d.vacancy.company}</span></span>
                      <span className="badge b-warn">{d.deadline}</span>
                    </button>
                  ))}
                </div>
              )}
              {s.fresh.filter((v) => v.fit === "needs_check").slice(0, 4).map((v) => (
                <button key={v.id} className="mini-item" onClick={() => app.go("vacancies", { vacancyId: v.id })}>
                  <span><span className="t">{v.title}</span><br /><span className="s">{m(v.nextStep)}</span></span>
                  <FitBadge fit={v.fit} />
                </button>
              ))}
              {s.changed.length > 0 && (
                <div>
                  <div className="section-title" style={{ marginTop: 0 }}>{t("today.changed")}</div>
                  {s.changed.slice(0, 6).map((v) => <MiniItem key={v.id} v={v} onOpen={() => app.go("vacancies", { vacancyId: v.id })} />)}
                </div>
              )}
              {!s.followUps.length && !s.deadlines.length && !s.changed.length && !s.fresh.some((v) => v.fit === "needs_check") && <span className="muted">—</span>}
            </div>
          </section>
        </div>
        {busy && null}
      </div>
    </div>
  );
}

function MiniItem({ v, onOpen }: { v: Item; onOpen: () => void }) {
  const { m } = useI18n();
  return (
    <button className="mini-item" onClick={onOpen}>
      <span style={{ minWidth: 0 }}>
        <span className="t">{v.title}</span>
        <br />
        <span className="s">{v.company} · {m(v.nextStep)}</span>
      </span>
      <span className="row"><LifeBadge life={v.lifecycle} /><FitBadge fit={v.fit} /></span>
    </button>
  );
}
