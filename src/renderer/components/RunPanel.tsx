// Панель поиска: что запущено, какие сайты читаются сейчас, что уже найдено.
// Каждый сайт — отдельная «дорожка»; ошибка сайта видна сразу и не выдаётся за «вакансий нет».
import { useEffect, useState } from "react";
import type { SearchRun, SourceAttempt, SourceInfo } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { call } from "../api";
import { useApp, type Lane } from "../state";
import { Icon, Spinner } from "./ui";

export function RunPanel({ lastRun, compact }: { lastRun: (SearchRun & { attempts: SourceAttempt[] }) | null; compact?: boolean }) {
  const { t, date } = useI18n();
  const app = useApp();
  const [sources, setSources] = useState<SourceInfo[]>([]);
  useEffect(() => {
    void call<SourceInfo[]>("sources.list").then(setSources);
  }, [app.version]);

  // Во время поиска — живые дорожки; после — итог последнего запуска по тем же дорожкам.
  const lanes: Lane[] = app.run.running && app.lanes.length
    ? app.lanes
    : lastRun
      ? lastRun.attempts.map((a) => ({
          id: a.sourceId,
          label: sources.find((s) => s.id === a.sourceId)?.label ?? a.sourceId,
          state: a.status === "success" || a.status === "partial" ? "done" : a.status === "failed" || a.status === "blocked" ? "fail" : "skip",
          status: a.status,
          items: a.items,
        }))
      : sources.filter((s) => s.enabled).map((s) => ({ id: s.id, label: s.label, state: "wait" as const }));
  const width = (l: Lane) => (l.state === "done" || l.state === "fail" ? "100%" : l.state === "skip" ? "100%" : "0%");
  const stateText = (l: Lane) => {
    if (l.state === "active") return t("run.lane.active");
    if (l.state === "done") return t("run.lane.done", { n: l.items ?? 0 });
    if (l.state === "fail") return t("run.lane.fail");
    if (l.state === "skip") return l.status === "not_due" ? t("run.lane.notdue") : l.status ? t(`att.${l.status}` as TKey) : t("run.lane.skip");
    return t("run.lane.wait");
  };
  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <section className="card run-panel" aria-live="polite" aria-labelledby="run-title">
      <div className="run-head">
        <h2 id="run-title">
          {app.run.running ? `${t("run.title.running")} — ${enabledCount}` : t("run.title.idle")}
        </h2>
        {app.run.running ? (
          <button className="btn" onClick={() => void app.cancelRun()}>{t("today.cancel")}</button>
        ) : (
          <button className="btn btn-primary btn-lg" data-tour="run" onClick={() => void app.startRun()}>
            <Icon.search className="nav-icon" />{t("today.runNow")}
          </button>
        )}
      </div>
      {!app.run.running && lastRun && (
        <p className="small subtle" style={{ marginTop: 6 }}>
          {t("today.lastRun")}: {date(lastRun.finishedAt ?? lastRun.startedAt, true)} — {t(`run.status.${lastRun.status}` as TKey)}.{" "}
          {t("run.finished", { new: lastRun.stats.newVacancies, changed: lastRun.stats.changedVacancies })}
        </p>
      )}
      {!compact || app.run.running || lastRun ? (
        <div className="lanes">
          {lanes.map((l) => (
            <div key={l.id} className={`lane ${l.state === "skip" ? "wait" : l.state}`}>
              <span className="row" style={{ gap: 6 }}>{l.state === "active" && <Spinner />}{l.label}</span>
              <div className="track" aria-hidden><span style={{ width: l.state === "active" ? undefined : width(l), opacity: l.state === "skip" ? 0.25 : 1 }} /></div>
              <span className="state">{stateText(l)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
