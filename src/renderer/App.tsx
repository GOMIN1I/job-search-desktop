import { useCallback, useEffect, useMemo, useState } from "react";
import type { Candidate, UiLang } from "../shared/types";
import { I18nContext, makeI18n, translate, useI18n } from "./i18n";
import { call, on } from "./api";
import { AppContext, useApp, type AppInfo, type Lane, type Page, type RunState } from "./state";
import { BrandMark, Icon, ToastProvider, DemoBadge, useToast } from "./components/ui";
import { Guide } from "./components/Guide";
import { Onboarding } from "./pages/Onboarding";
import { Today } from "./pages/Today";
import { Vacancies } from "./pages/Vacancies";
import { Applications } from "./pages/Applications";
import { Profile } from "./pages/Profile";
import { Settings } from "./pages/Settings";

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [lang, setLangState] = useState<UiLang>(navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en");
  const i18n = useMemo(
    () =>
      makeI18n(lang, (l) => {
        setLangState(l);
        void call("app.setLang", { lang: l });
      }),
    [lang],
  );
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = translate(lang, "app.name");
  }, [lang]);
  return (
    <I18nContext.Provider value={i18n}>
      <ToastProvider>
        <Shell info={info} setInfo={setInfo} setLang={setLangState} />
      </ToastProvider>
    </I18nContext.Provider>
  );
}

function Shell({ info, setInfo, setLang }: { info: AppInfo | null; setInfo: (i: AppInfo) => void; setLang: (l: UiLang) => void }) {
  const { fail, push } = useToast();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [page, setPage] = useState<Page>("today");
  const [focusVacancy, setFocusVacancy] = useState<string | null>(null);
  const [focusApplication, setFocusApplication] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [run, setRun] = useState<RunState>({ running: false, runId: null, progress: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [guide, setGuide] = useState(false);

  const reload = useCallback(async () => {
    try {
      const i = await call<AppInfo>("app.info");
      setInfo(i);
      setLang(i.lang);
      const c = await call<Candidate[]>("candidates.list");
      setCandidates(c);
      setActiveId((prev) => (prev && c.some((x) => x.id === prev) ? prev : i.activeCandidate));
      if (!i.onboarded) setPage("onboarding");
      setRun(await call<RunState>("run.state"));
    } catch (e) {
      fail(e);
    }
  }, [fail, setInfo, setLang]);

  useEffect(() => {
    void reload();
    const offs = [
      on("data-changed", () => {
        setVersion((v) => v + 1);
        void call<Candidate[]>("candidates.list").then(setCandidates);
      }),
      on("run-progress", (p) => {
        setRun(p);
        const pr = p?.progress;
        if (!pr) return;
        setLanes((prev) => {
          let next = prev;
          if (pr.phase === "start" && pr.sources) {
            next = pr.sources.map((s: { id: string; label: string; enabled: boolean }) => ({ id: s.id, label: s.label, state: s.enabled ? "wait" : "skip" }) as Lane);
          }
          if (pr.sourceId) {
            next = next.map((l) => {
              if (l.id !== pr.sourceId) return l;
              if (!pr.status) return { ...l, state: "active" };
              const st = pr.status as string;
              const state: Lane["state"] = st === "success" || st === "partial" ? "done" : st === "not_due" || st === "disabled" || st === "excluded" || st === "not_configured" ? "skip" : st === "cancelled" ? "wait" : "fail";
              return { ...l, state, status: st, items: pr.items ?? l.items };
            });
          }
          return next;
        });
      }),
      on("run-finished", (p) => {
        setRun({ running: false, runId: p?.runId ?? null, progress: null });
        setVersion((v) => v + 1);
        if (p?.error && !/уже выполняется|already running/i.test(p.error)) push(p.error, true);
      }),
      on("navigate", (p) => p?.page && setPage(p.page)),
    ];
    return () => offs.forEach((o) => o());
  }, [reload, push]);

  const candidate = candidates.find((c) => c.id === activeId) ?? candidates[0] ?? null;

  const ctx = useMemo(
    () => ({
      info: info!,
      candidates,
      candidate,
      setCandidate: (id: string) => {
        setActiveId(id);
        void call("candidates.setActive", { id });
        setVersion((v) => v + 1);
      },
      page,
      go: (p: Page, opts?: { vacancyId?: string | null; applicationVacancyId?: string | null }) => {
        if (opts?.vacancyId !== undefined) setFocusVacancy(opts.vacancyId);
        if (opts?.applicationVacancyId !== undefined) setFocusApplication(opts.applicationVacancyId);
        setPage(p);
      },
      focusVacancy,
      focusApplication,
      version,
      run,
      lanes,
      openGuide: () => setGuide(true),
      startRun: async () => {
        try {
          const r = await call<{ runId: string | null; error: string | null; alreadyRunning?: boolean }>("run.start");
          if (r.error) push(r.error, !r.alreadyRunning);
        } catch (e) {
          fail(e);
        }
      },
      cancelRun: async () => {
        await call("run.cancel");
      },
      reload,
    }),
    [info, candidates, candidate, page, focusVacancy, focusApplication, version, run, lanes, reload, push, fail],
  );

  if (!info) return <div className="empty" style={{ height: "100%", justifyContent: "center" }}>…</div>;

  return (
    <AppContext.Provider value={ctx}>
      {page === "onboarding" || !candidate ? (
        <Onboarding />
      ) : (
        <div className="app">
          <Sidebar />
          <main className="main" id="main">
            {page === "today" && <Today />}
            {page === "vacancies" && <Vacancies />}
            {page === "applications" && <Applications />}
            {page === "profile" && <Profile />}
            {page === "settings" && <Settings />}
          </main>
        </div>
      )}
      {guide && <Guide onClose={() => setGuide(false)} />}
    </AppContext.Provider>
  );
}

function Sidebar() {
  const { t } = useI18n();
  const app = useApp();
  const items: Array<{ page: Page; label: string; icon: (p: { className?: string }) => React.ReactElement; key: string }> = [
    { page: "today", label: t("nav.today"), icon: Icon.today, key: "1" },
    { page: "vacancies", label: t("nav.vacancies"), icon: Icon.list, key: "2" },
    { page: "applications", label: t("nav.applications"), icon: Icon.send, key: "3" },
    { page: "profile", label: t("nav.profile"), icon: Icon.user, key: "4" },
  ];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const it = items.find((i) => i.key === e.key);
      if (it) {
        app.go(it.page);
        e.preventDefault();
      } else if (e.key === ",") {
        app.go("settings");
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <nav className="sidebar" aria-label="main">
      <div className="brand"><BrandMark /><span>{t("app.name")}</span></div>
      <div className="nav">
        {items.map((i) => (
          <button key={i.page} data-tour={`nav-${i.page}`} aria-label={i.label} aria-current={app.page === i.page ? "page" : undefined} onClick={() => app.go(i.page)} title={`${i.label} (⌘/Ctrl+${i.key})`}>
            <i.icon className="nav-icon" />
            <span className="label-text">{i.label}</span>
          </button>
        ))}
      </div>
      <div className="sidebar-spacer" />
      <div className="status-mini" aria-live="polite">
        {app.run.running ? (
          <>
            <div className="row"><Icon.refresh className="nav-icon" /><span className="txt">{t("today.running")} {app.run.progress?.sourceId ?? ""}</span></div>
            <div className="progress indeterminate"><div /></div>
          </>
        ) : null}
      </div>
      <div className="nav">
        <button data-tour="help" aria-label={t("guide.open")} onClick={() => app.openGuide()} title={t("guide.open")}>
          <Icon.question className="nav-icon" />
          <span className="label-text">{t("guide.open")}</span>
        </button>
        <button aria-label={t("nav.settings")} aria-current={app.page === "settings" ? "page" : undefined} onClick={() => app.go("settings")} title={`${t("nav.settings")} (⌘/Ctrl+,)`}>
          <Icon.gear className="nav-icon" />
          <span className="label-text">{t("nav.settings")}</span>
        </button>
      </div>
      <div className="cand-switch">
        <label htmlFor="cand-select">{t("nav.candidate")}</label>
        <select id="cand-select" className="select" value={app.candidate?.id ?? ""} onChange={(e) => (e.target.value === "__new" ? app.go("onboarding") : app.setCandidate(e.target.value))}>
          {app.candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.isDemo ? " · DEMO" : ""}</option>
          ))}
          <option value="__new">+ {t("nav.addCandidate")}</option>
        </select>
        {app.candidate?.isDemo && <span style={{ alignSelf: "flex-start" }}><DemoBadge /></span>}
      </div>
    </nav>
  );
}
