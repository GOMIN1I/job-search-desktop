// «Дополнительные инструкции для ИИ»: свои слова человека → понятный разбор → применяется в каждом поиске.
// Разбор показывается сразу, противоречия с настройками человек решает сам.
import { useEffect, useRef, useState } from "react";
import { call } from "../api";
import { useI18n } from "../i18n";
import { countryLabel } from "./countries";
import type { AiInstructions, InstructionDirectives, Msg, SearchRules } from "../../shared/types";

interface Conflict { id: string; instruction: Msg; settings: Msg }
interface Preview { parsed: InstructionDirectives | null; parsedBy: "rules" | "rules+ai" | null; parsedFor?: string; parsedAt?: string; conflicts: Conflict[]; aiUsed: boolean; aiError: Msg | null }

const EXAMPLES_RU = ["Не используй hh.ru и связанные сервисы", "Рассматривай вакансии из Германии и Польши", "Только удалённая работа", "Вакансии на английском языке", "Без продаж и холодных звонков"];
const EXAMPLES_EN = ["Don't use LinkedIn", "Consider jobs in Germany and Poland", "Remote only", "Postings in English", "No sales, no cold calls"];

export function AiInstructionsEditor({ rules, value, onChange, aiConnected }: { rules: SearchRules; value: AiInstructions | undefined; onChange: (v: AiInstructions | undefined, conflictsOpen: number) => void; aiConnected: boolean }) {
  const { m, lang } = useI18n();
  const L = (ru: string, en: string) => (lang === "ru" ? ru : en);
  const [text, setText] = useState(value?.text ?? "");
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const resolutions = useRef<Record<string, "instruction" | "settings">>(value?.resolutions ?? {});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = (p: Preview | null, t: string) => {
    if (!t.trim()) return onChange(undefined, 0);
    const open = (p?.conflicts ?? []).filter((c) => !resolutions.current[c.id]).length;
    onChange({ text: t, parsed: p?.parsed ?? null, parsedBy: p?.parsedBy ?? null, parsedAt: p?.parsedAt ?? null, parsedFor: p?.parsedFor, resolutions: { ...resolutions.current } }, open);
  };
  const preview = async (t: string, useAi: boolean) => {
    if (!t.trim()) {
      setPv(null);
      emit(null, t);
      return;
    }
    setBusy(true);
    try {
      const p = await call<Preview>("instructions.preview", { rules: { ...rules, aiInstructions: undefined }, text: t, useAi });
      // Решения по противоречиям, которых больше нет, забываются
      for (const k of Object.keys(resolutions.current)) if (!p.conflicts.some((c) => c.id === k)) delete resolutions.current[k];
      setPv(p);
      emit(p, t);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (value?.text) void preview(value.text, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(rules.workFormat), JSON.stringify(rules.tracks.map((t) => t.titleKeywords)), JSON.stringify(rules.languages.items)]);

  const onText = (t: string) => {
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void preview(t, false), 500);
  };
  const d = pv?.parsed;
  const chip = (label: string, items: string[], cls = "") => items.length ? <div className="instr-row"><span className="instr-label">{label}</span><span className="instr-items">{items.map((x) => <span key={x} className={`mark mark-soft ${cls}`}>{x}</span>)}</span></div> : null;
  const sites = d ? [...new Set([...d.excludeSources.map((s) => (s === "hh" ? "hh.ru" : s)), ...d.excludeHosts.filter((h) => !(d.excludeSources.includes("hh") && /hh|headhunter|rabota\.by/.test(h)))])] : [];

  return (
    <div className="stack">
      <textarea
        className="textarea instr-text"
        rows={4}
        value={text}
        onChange={(e) => onText(e.target.value)}
        placeholder={L("Например: Не используй hh.ru и связанные сервисы. Рассматривай вакансии из Германии и Польши. Только удалённая работа, без продаж.", "For example: Don't use LinkedIn. Consider jobs in Germany and Poland. Remote only, no sales.")}
        aria-label={L("Дополнительные инструкции для ИИ", "Additional instructions for AI")}
        maxLength={4000}
      />
      {!text && <div className="row-wrap">{(lang === "ru" ? EXAMPLES_RU : EXAMPLES_EN).map((ex) => <button key={ex} type="button" className="chip" onClick={() => onText(text ? `${text.trim()}. ${ex}` : ex)}>{ex}</button>)}</div>}
      {text.trim() && (
        <div className="instr-parsed" aria-live="polite">
          <div className="row-between">
            <strong className="small">{L("Как приложение это поняло", "How the app understood it")}{busy ? "…" : ""}</strong>
            <span className="row">
              {aiConnected && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void preview(text, true)}>{L("Уточнить с помощью ИИ", "Refine with AI")}</button>}
              <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => { resolutions.current = {}; setText(""); setPv(null); emit(null, ""); }}>{L("Очистить", "Clear")}</button>
            </span>
          </div>
          {d && (
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {chip(L("Не использовать площадки", "Don't use sites"), sites, "mark-no")}
              {chip(L("Избегать", "Avoid"), d.excludeKeywords, "mark-no")}
              {chip(L("Обязательно", "Must mention"), d.requireKeywords)}
              {chip(L("Страны", "Countries"), d.countries.map((c) => countryLabel(c, lang)))}
              {chip(L("Исключить страны", "Exclude countries"), d.excludeCountries.map((c) => countryLabel(c, lang)), "mark-no")}
              {chip(L("Язык объявлений", "Posting language"), d.postingLanguages)}
              {chip(L("Формат", "Format"), d.workFormats.map((f) => (f === "remote" ? L("удалённо", "remote") : f === "hybrid" ? L("гибрид", "hybrid") : L("офис", "office"))))}
              {d.notes.length > 0 && (
                <div className="instr-row"><span className="instr-label">{L("Проверит ИИ", "Checked by AI")}</span><span className="instr-items">{d.notes.map((n) => <span key={n} className="mark mark-soft mark-ask">{n}</span>)}</span></div>
              )}
              {d.notes.length > 0 && !aiConnected && <p className="help">{L("Эту часть приложение не превратило в правило. Её будет проверять ИИ, когда вы подключите модель в «Настройках»; до этого она не влияет на результаты.", "The app did not turn this part into a rule. The AI will check it once you connect a model in Settings; until then it does not affect results.")}</p>}
              {pv?.aiError && <p className="help">{L("ИИ не помог: ", "AI did not help: ")}{m(pv.aiError)}</p>}
              {pv?.aiUsed && <p className="help">{L("Разбор уточнён моделью ИИ.", "Refined by the AI model.")}</p>}
            </div>
          )}
          {pv && pv.conflicts.length > 0 && (
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="banner banner-warn">{L("Инструкции противоречат настройкам профиля. Выберите, что главнее, — без выбора профиль не сохранится.", "Your instructions contradict the profile settings. Choose which one wins — the profile won't be saved without a choice.")}</div>
              {pv.conflicts.map((c) => (
                <fieldset key={c.id} className="instr-conflict">
                  <legend className="small">{m(c.instruction)}</legend>
                  <p className="small subtle">{m(c.settings)}</p>
                  <label className="check"><input type="radio" name={`cf-${c.id}`} checked={resolutions.current[c.id] === "instruction"} onChange={() => { resolutions.current[c.id] = "instruction"; emit(pv, text); setPv({ ...pv }); }} />{L("Главнее инструкция", "The instruction wins")}</label>
                  <label className="check"><input type="radio" name={`cf-${c.id}`} checked={resolutions.current[c.id] === "settings"} onChange={() => { resolutions.current[c.id] = "settings"; emit(pv, text); setPv({ ...pv }); }} />{L("Главнее настройки профиля", "The profile settings win")}</label>
                </fieldset>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
