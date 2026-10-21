// «Как это работает»: короткое объяснение и экскурсия по экрану с подсветкой нужных элементов.
// Открывается из боковой панели в любой момент; после первого запуска показывается автоматически один раз.
import { useEffect, useLayoutEffect, useState } from "react";
import { useI18n, type TKey } from "../i18n";
import { useApp, type Page } from "../state";
import { FitBadge, Icon, Modal } from "./ui";

const STEPS: Array<{ icon: keyof typeof Icon; t: TKey; d: TKey }> = [
  { icon: "search", t: "guide.s1.t", d: "guide.s1.d" },
  { icon: "refresh", t: "guide.s2.t", d: "guide.s2.d" },
  { icon: "list", t: "guide.s3.t", d: "guide.s3.d" },
  { icon: "send", t: "guide.s4.t", d: "guide.s4.d" },
];

const TOUR: Array<{ target: string; page: Page; t: TKey; d: TKey }> = [
  { target: "run", page: "today", t: "tour.run.t", d: "tour.run.d" },
  { target: "nav-vacancies", page: "today", t: "tour.nav.vac.t", d: "tour.nav.vac.d" },
  { target: "nav-applications", page: "today", t: "tour.nav.app.t", d: "tour.nav.app.d" },
  { target: "nav-profile", page: "today", t: "tour.nav.prof.t", d: "tour.nav.prof.d" },
  { target: "help", page: "today", t: "tour.help.t", d: "tour.help.d" },
];

export function Guide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const app = useApp();
  const [touring, setTouring] = useState(false);
  if (touring) return <Tour onClose={onClose} />;
  return (
    <Modal
      wide
      title={t("guide.title")}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => { onClose(); app.go("onboarding"); }}>{t("guide.restart")}</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => { app.go("today"); setTouring(true); }}>{t("guide.tour")}</button>
          <button className="btn btn-primary" onClick={onClose}>{t("guide.done")}</button>
        </>
      }
    >
      <div className="stack-lg" style={{ paddingBottom: 8 }}>
        {STEPS.map((s, i) => {
          const I = Icon[s.icon];
          return (
            <div key={s.t} className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <span className="help-fab" aria-hidden style={{ flex: "none", cursor: "default" }}>{i + 1}</span>
              <div className="stack" style={{ gap: 4 }}>
                <h3 className="row" style={{ fontSize: 15 }}><I className="nav-icon" />{t(s.t)}</h3>
                <p className="subtle">{t(s.d)}</p>
                {i === 2 && (
                  <div className="stack" style={{ marginTop: 8, gap: 8 }}>
                    <div className="row"><FitBadge fit="suitable" /><span className="small subtle">{t("guide.legend.yes")}</span></div>
                    <div className="row"><FitBadge fit="needs_check" /><span className="small subtle">{t("guide.legend.ask")}</span></div>
                    <div className="row"><FitBadge fit="unsuitable" /><span className="small subtle">{t("guide.legend.no")}</span></div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function Tour({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const app = useApp();
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = TOUR[i];
  useEffect(() => {
    if (app.page !== step.page) app.go(step.page);
  }, [i]);
  useLayoutEffect(() => {
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    find();
    const timer = setInterval(find, 250);
    window.addEventListener("resize", find);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", find);
    };
  }, [i, app.page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const next = () => (i < TOUR.length - 1 ? setI(i + 1) : onClose());
  const pad = 6;
  const popTop = rect ? Math.min(window.innerHeight - 200, rect.bottom + 14) : window.innerHeight / 2 - 80;
  const popLeft = rect ? Math.max(16, Math.min(window.innerWidth - 356, rect.left)) : window.innerWidth / 2 - 170;
  const sideways = rect && rect.left < 260 && rect.width < 260;
  return (
    <>
      {rect && <div className="tour-ring" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />}
      <div className="tour-pop" role="dialog" aria-label={t(step.t)} style={sideways ? { top: Math.max(16, rect!.top - 10), left: rect!.right + 18 } : { top: popTop, left: popLeft }}>
        <h3>{t(step.t)}</h3>
        <p>{t(step.d)}</p>
        <div className="row">
          <span className="small" style={{ opacity: 0.7 }}>{i + 1} / {TOUR.length}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={onClose}>{t("common.close")}</button>
          <button className="btn btn-sm btn-primary" onClick={next} autoFocus>{i < TOUR.length - 1 ? t("guide.next") : t("guide.done")}</button>
        </div>
      </div>
    </>
  );
}
