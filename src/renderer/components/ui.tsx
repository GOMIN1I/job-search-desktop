import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ConstraintMode, DimensionStatus, Fit, Lifecycle, SalaryFact, ApplicationStage } from "../../shared/types";
import { useI18n, type TKey } from "../i18n";
import { ApiFailure } from "../api";

// ---------- Иконки (inline SVG, без внешних ресурсов) ----------
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const Icon = {
  today: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M8 3v3M16 3v3M3.5 9.5h17" /><circle cx="12" cy="15" r="1.6" fill="currentColor" /></svg>,
  list: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>,
  send: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M4 12l16-8-6 16-2.5-6.5L4 12z" /></svg>,
  user: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4" /></svg>,
  gear: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></svg>,
  search: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>,
  check: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.2} className={p.className} aria-hidden><path d="M5 12.5l4.2 4.2L19 7" /></svg>,
  cross: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} strokeWidth={2.2} className={p.className} aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>,
  question: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} strokeWidth={2} className={p.className} aria-hidden><path d="M9.2 9a3 3 0 115 2.2c-1 .7-2.2 1.3-2.2 2.8" /><circle cx="12" cy="17.5" r=".9" fill="currentColor" /></svg>,
  dash: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} strokeWidth={2} className={p.className} aria-hidden><path d="M7 12h10" /></svg>,
  external: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>,
  refresh: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" /></svg>,
  bookmark: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M6 4h12v17l-6-4-6 4z" /></svg>,
  sparkle: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>,
  clock: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  up: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M6 15l6-6 6 6" /></svg>,
  down: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M6 9l6 6 6-6" /></svg>,
  doc: (p: { className?: string }) => <svg viewBox="0 0 24 24" {...P} className={p.className} aria-hidden><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></svg>,
};

export function DimIcon({ status }: { status: DimensionStatus }) {
  const c = `dim-icon ic-${status}`;
  if (status === "pass") return <Icon.check className={c} />;
  if (status === "fail") return <Icon.cross className={c} />;
  if (status === "unknown") return <Icon.question className={c} />;
  return <Icon.dash className={c} />;
}

// ---------- Значки ----------
const VGlyph = { yes: Icon.check, ask: Icon.question, no: Icon.cross };

/** Вердикт = маркер + значок + слово. wipe — маркер «проводится», когда вывод появляется. */
export function FitBadge({ fit, large, wipe }: { fit: Fit | null; large?: boolean; wipe?: boolean }) {
  const { t } = useI18n();
  if (!fit) return <span className="verdict v-none">{t("fit.none")}</span>;
  const k = fit === "suitable" ? "yes" : fit === "needs_check" ? "ask" : "no";
  const G = VGlyph[k];
  return (
    <span className={`verdict v-${k}${large ? " verdict-lg" : ""}${wipe ? " mark-wipe" : ""}`}>
      <G />
      {t(`fit.${fit}` as TKey)}
    </span>
  );
}

export function DimVerdict({ status }: { status: DimensionStatus }) {
  const { t } = useI18n();
  if (status === "na") return <span className="badge b-neutral">{t("dim.na")}</span>;
  const k = status === "pass" ? "yes" : status === "unknown" ? "ask" : "no";
  const G = VGlyph[k];
  return <span className={`verdict v-${k}`}><G />{t(`dim.${status}` as TKey)}</span>;
}

/** Фирменный знак: лист вакансии с маркерной полосой. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#0B5D4B" />
      <g transform="rotate(-8 32 32)">
        <rect x="17" y="12" width="30" height="40" rx="5" fill="#fff" />
        <rect x="13" y="26" width="38" height="12" rx="3" fill="#D8F04A" />
        <path d="M21 32 l4 4 l8 -8" fill="none" stroke="#0B5D4B" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function LifeBadge({ life }: { life: Lifecycle }) {
  const { t } = useI18n();
  const cls = life === "open" ? "b-ok" : life === "closed" ? "b-bad" : life === "unconfirmed" ? "b-warn" : "b-neutral";
  return <span className={`badge ${cls}`} title={t(`life.${life}` as TKey)}>{t(`life.${life}` as TKey)}</span>;
}

export function StageBadge({ stage }: { stage: ApplicationStage | null }) {
  const { t } = useI18n();
  if (!stage) return null;
  const cls = stage === "offer" ? "b-ok" : stage === "rejected" || stage === "archived" ? "b-neutral" : stage === "interview" || stage === "response" ? "b-info" : "b-accent";
  return <span className={`badge ${cls}`}>{t(`stage.${stage}` as TKey)}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function DemoBadge() {
  const { t } = useI18n();
  return <span className="badge b-demo" title={t("demo.note")}>{t("demo.badge")}</span>;
}

export function SalaryText({ s }: { s: SalaryFact }) {
  const { t, lang } = useI18n();
  if (s.kind === "unknown" || (!s.min && !s.max)) return <span className="muted">{t("salary.unknown")}</span>;
  const f = (n: number | null) => (n === null ? "" : Math.round(n).toLocaleString(lang === "ru" ? "ru-RU" : "en-US"));
  const amount = s.min && s.max && s.min !== s.max ? `${f(s.min)}–${f(s.max)}` : s.kind === "up_to" ? `≤ ${f(s.max)}` : s.kind === "from" ? `≥ ${f(s.min)}` : f(s.min ?? s.max);
  const warn = s.kind === "up_to" || s.kind === "platform_estimate" || (s.kind === "hourly" && !s.guaranteedHoursPerWeek);
  return (
    <span>
      {amount} {s.currency ?? ""} {s.period ? t(`period.${s.period}` as TKey) : ""}
      <span className={`badge ${warn ? "b-warn" : "b-outline"}`} style={{ marginLeft: 6 }}>{t(`salary.${s.kind}` as TKey)}</span>
    </span>
  );
}

// ---------- Переключатель жёсткости условия ----------
export function ConstraintPicker({ value, onChange, label }: { value: ConstraintMode; onChange: (m: ConstraintMode) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="btn-group" role="group" aria-label={label} title={t("constraint.help")}>
      {(["hard", "soft", "unset"] as ConstraintMode[]).map((m) => (
        <button key={m} type="button" className="btn btn-sm" aria-pressed={value === m} onClick={() => onChange(m)}>
          {t(`constraint.${m}` as TKey)}
        </button>
      ))}
    </div>
  );
}

// ---------- Модальное окно (Esc, фокус, подпись) ----------
export function Modal({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
        if (!els.length) return;
        const a = els[0];
        const z = els[els.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          z.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === z) {
          a.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2 style={{ flex: 1 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close"><Icon.cross className="nav-icon" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Тосты ----------
interface Toast { id: number; text: string; err?: boolean }
const ToastCtx = createContext<{ push: (text: string, err?: boolean) => void; fail: (e: unknown) => void }>(null as any);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const { m } = useI18n();
  const push = useCallback((text: string, err = false) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, err }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), err ? 9000 : 4000);
  }, []);
  const fail = useCallback((e: unknown) => push(e instanceof ApiFailure ? m(e.msgObj) : String((e as Error)?.message ?? e), true), [push, m]);
  return (
    <ToastCtx.Provider value={{ push, fail }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.err ? "err" : ""}`}>{i.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const { fail } = useToast();
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(key);
      try {
        return await fn();
      } catch (e) {
        fail(e);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [fail],
  );
  return { busy, run };
}

export const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
