// Редактор условий поиска. Каждое условие: обязательно / желательно / не задано.
import { useEffect, useState } from "react";
import type { Cefr, LanguageSkill, SearchRules, Track } from "../../shared/types";
import { useI18n } from "../i18n";
import { call } from "../api";
import { ConstraintPicker, Icon, splitList } from "./ui";

export interface RoleTemplateView { id: string; group: string; groupEn: string; name: string; nameEn: string; titleKeywords: string[]; bodyKeywords: string[]; excludeKeywords: string[]; noCalls?: boolean }
export type Section = "goals" | "place" | "format" | "hours" | "languages" | "pay" | "limits" | "experience";

const CEFRS: Cefr[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LANGS = ["en", "ru", "de", "fr", "es", "it", "pt", "zh", "uk", "kk", "hy", "tr"];
const LANG_LABEL: Record<string, [string, string]> = {
  en: ["Английский", "English"], ru: ["Русский", "Russian"], de: ["Немецкий", "German"], fr: ["Французский", "French"], es: ["Испанский", "Spanish"],
  it: ["Итальянский", "Italian"], pt: ["Португальский", "Portuguese"], zh: ["Китайский", "Chinese"], uk: ["Украинский", "Ukrainian"], kk: ["Казахский", "Kazakh"],
  hy: ["Армянский", "Armenian"], tr: ["Турецкий", "Turkish"],
};
const TIMEZONES = (() => {
  try {
    return (Intl as any).supportedValuesOf("timeZone") as string[];
  } catch {
    return ["UTC", "Europe/Moscow", "Europe/Samara", "Europe/London", "Europe/Berlin", "America/New_York", "Asia/Almaty", "Asia/Yerevan"];
  }
})();

export function useTemplates() {
  const [tpls, setTpls] = useState<RoleTemplateView[]>([]);
  const [countries, setCountries] = useState<Array<{ code: string; ru: string; en: string }>>([]);
  useEffect(() => {
    void call<RoleTemplateView[]>("app.templates").then(setTpls);
    void call<Array<{ code: string; ru: string; en: string }>>("app.countries").then(setCountries);
  }, []);
  return { tpls, countries };
}

export function RulesEditor({ rules, onChange, sections }: { rules: SearchRules; onChange: (r: SearchRules) => void; sections: Section[] }) {
  const { t, lang } = useI18n();
  const { tpls, countries } = useTemplates();
  const set = <K extends keyof SearchRules>(k: K, v: SearchRules[K]) => onChange({ ...rules, [k]: v });
  const [customTitle, setCustomTitle] = useState("");
  const [customName, setCustomName] = useState("");

  const toggleTpl = (tp: RoleTemplateView) => {
    const idx = rules.tracks.findIndex((tr) => tr.templateId === tp.id);
    if (idx >= 0) set("tracks", rules.tracks.filter((_, i) => i !== idx));
    else
      set("tracks", [
        ...rules.tracks,
        { id: `trk-${tp.id}`, name: lang === "en" ? tp.nameEn : tp.name, enabled: true, titleKeywords: [...tp.titleKeywords], bodyKeywords: [...tp.bodyKeywords], excludeKeywords: [...tp.excludeKeywords], noCalls: !!tp.noCalls, templateId: tp.id },
      ]);
  };
  const move = (i: number, d: -1 | 1) => {
    const arr = [...rules.tracks];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("tracks", arr);
  };
  const updTrack = (i: number, patch: Partial<Track>) => set("tracks", rules.tracks.map((tr, k) => (k === i ? { ...tr, ...patch } : tr)));

  return (
    <div className="stack-lg">
      {sections.includes("goals") && (
        <div className="stack">
          <p className="help">{t("ob.goals.help")}</p>
          {(["AI", "Письменная работа", "Аналитика", "Инженерия", "Другое"] as const).map((g) => {
            const list = tpls.filter((x) => x.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="stack">
                <div className="section-title" style={{ margin: "8px 0 0" }}>{lang === "en" ? list[0].groupEn : g}</div>
                <div className="tpl-grid">
                  {list.map((tp) => {
                    const on = rules.tracks.some((tr) => tr.templateId === tp.id);
                    return (
                      <label key={tp.id} className={`tpl ${on ? "on" : ""}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleTpl(tp)} />
                        <span>{lang === "en" ? tp.nameEn : tp.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="section-title" style={{ margin: "8px 0 0" }}>{t("ob.goals.custom")}</div>
          <div className="row-wrap">
            <input className="input" style={{ width: 200 }} placeholder={t("prof.tracks")} value={customName} onChange={(e) => setCustomName(e.target.value)} aria-label={t("ob.goals.custom")} />
            <input className="input" style={{ flex: 1, minWidth: 220 }} placeholder={t("ob.goals.customTitle")} value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} aria-label={t("ob.goals.customTitle")} />
            <button
              className="btn"
              disabled={!customName.trim() || !splitList(customTitle).length}
              onClick={() => {
                set("tracks", [...rules.tracks, { id: `trk-custom-${Date.now()}`, name: customName.trim(), enabled: true, titleKeywords: splitList(customTitle), bodyKeywords: [], excludeKeywords: ["senior", "lead", "head of"], noCalls: false, templateId: null }]);
                setCustomName("");
                setCustomTitle("");
              }}
            >
              {t("common.add")}
            </button>
          </div>
          {rules.tracks.length > 0 && (
            <>
              <div className="section-title" style={{ margin: "8px 0 0" }}>{t("prof.tracks")}, {rules.tracks.length}</div>
              <div className="order-list">
                {rules.tracks.map((tr, i) => (
                  <details key={tr.id} className="order-item" style={{ display: "block" }}>
                    <summary className="row" style={{ cursor: "pointer" }}>
                      <span className="muted small" style={{ width: 18 }}>{i + 1}.</span>
                      <input type="checkbox" checked={tr.enabled} onChange={(e) => updTrack(i, { enabled: e.target.checked })} aria-label={tr.name} onClick={(e) => e.stopPropagation()} />
                      <span style={{ flex: 1 }}>{tr.name}</span>
                      {tr.noCalls && <span className="badge b-outline">{lang === "ru" ? "без звонков" : "no calls"}</span>}
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.preventDefault(); move(i, -1); }} aria-label="up"><Icon.up className="nav-icon" /></button>
                      <button className="btn btn-ghost btn-sm" onClick={(e) => { e.preventDefault(); move(i, 1); }} aria-label="down"><Icon.down className="nav-icon" /></button>
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={(e) => { e.preventDefault(); set("tracks", rules.tracks.filter((_, k) => k !== i)); }}>{t("common.delete")}</button>
                    </summary>
                    <div className="stack" style={{ padding: "8px 0 4px 26px" }}>
                      <div className="field"><label>{lang === "ru" ? "Слова в названии" : "Title keywords"}</label><input className="input" value={tr.titleKeywords.join(", ")} onChange={(e) => updTrack(i, { titleKeywords: splitList(e.target.value) })} /></div>
                      <div className="field"><label>{lang === "ru" ? "Сигналы задач в тексте" : "Task signals in text"}</label><input className="input" value={tr.bodyKeywords.join(", ")} onChange={(e) => updTrack(i, { bodyKeywords: splitList(e.target.value) })} /></div>
                      <div className="field"><label>{lang === "ru" ? "Исключить, если встречается" : "Exclude if present"}</label><input className="input" value={tr.excludeKeywords.join(", ")} onChange={(e) => updTrack(i, { excludeKeywords: splitList(e.target.value) })} /></div>
                      <label className="check"><input type="checkbox" checked={tr.noCalls} onChange={(e) => updTrack(i, { noCalls: e.target.checked })} />{lang === "ru" ? "В этом треке звонки исключены" : "No calls in this track"}</label>
                    </div>
                  </details>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {sections.includes("experience") && (
        <div className="stack">
          <div className="row-wrap"><span className="label">{t("ob.step.experience")}</span><ConstraintPicker label={t("ob.step.experience")} value={rules.experience.mode} onChange={(m) => set("experience", { ...rules.experience, mode: m })} /></div>
          <div className="row-wrap">
            <div className="field" style={{ width: 300 }}><label htmlFor="maxy">{t("ob.exp.maxYears")}</label><input id="maxy" className="input" type="number" min={0} max={30} value={rules.experience.maxYearsRequired} onChange={(e) => set("experience", { ...rules.experience, maxYearsRequired: Math.max(0, Number(e.target.value) || 0) })} /></div>
            <label className="check" style={{ marginTop: 20 }}><input type="checkbox" checked={rules.experience.allowSenior} onChange={(e) => set("experience", { ...rules.experience, allowSenior: e.target.checked })} />{t("ob.exp.allowSenior")}</label>
          </div>
        </div>
      )}

      {sections.includes("place") && (
        <div className="stack">
          <p className="help">{t("ob.place.help")}</p>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="country">{t("ob.place.country")}</label>
              <select id="country" className="select" value={rules.location.country ?? ""} onChange={(e) => set("location", { ...rules.location, country: e.target.value || null })}>
                <option value="">—</option>
                {countries.slice().sort((a, b) => (lang === "ru" ? a.ru.localeCompare(b.ru, "ru") : a.en.localeCompare(b.en))).map((c) => (
                  <option key={c.code} value={c.code}>{lang === "ru" ? c.ru : c.en}</option>
                ))}
              </select>
            </div>
            <div className="field"><label htmlFor="city">{t("ob.place.city")}</label><input id="city" className="input" value={rules.location.city ?? ""} onChange={(e) => set("location", { ...rules.location, city: e.target.value || null })} /></div>
            <div className="field">
              <label htmlFor="tz">{t("ob.place.tz")}</label>
              <select id="tz" className="select" value={rules.location.timezone} onChange={(e) => set("location", { ...rules.location, timezone: e.target.value })}>
                {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
          </div>
          <div className="row-wrap"><span className="label">{t("ob.place.countryRule")}</span><ConstraintPicker label={t("ob.place.countryRule")} value={rules.countryEligibility.mode} onChange={(m) => set("countryEligibility", { mode: m })} /></div>
        </div>
      )}

      {sections.includes("format") && (
        <div className="stack">
          <div className="row-wrap"><span className="label">{t("ob.step.format")}</span><ConstraintPicker label={t("ob.step.format")} value={rules.workFormat.mode} onChange={(m) => set("workFormat", { ...rules.workFormat, mode: m })} /></div>
          <div className="row-wrap">
            {(["remote", "hybrid", "office"] as const).map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={rules.workFormat[k]} onChange={(e) => set("workFormat", { ...rules.workFormat, [k]: e.target.checked })} />{t(`ob.format.${k}`)}</label>
            ))}
          </div>
          {rules.workFormat.hybrid && (
            <div className="field"><label htmlFor="hc">{t("ob.format.cities")}</label><input id="hc" className="input" value={rules.workFormat.hybridCities.join(", ")} onChange={(e) => set("workFormat", { ...rules.workFormat, hybridCities: splitList(e.target.value) })} /></div>
          )}
        </div>
      )}

      {sections.includes("hours") && (
        <div className="stack">
          <div className="row-wrap"><span className="label">{t("ob.step.hours")}</span><ConstraintPicker label={t("ob.step.hours")} value={rules.hours.mode} onChange={(m) => set("hours", { ...rules.hours, mode: m })} /></div>
          <div className="row-wrap">
            <span className="label">{t("ob.hours.window")}</span>
            <input className="input" type="time" value={rules.hours.earliestLocal} onChange={(e) => set("hours", { ...rules.hours, earliestLocal: e.target.value })} aria-label="from" />
            <span>—</span>
            <input className="input" type="time" value={rules.hours.latestLocal} onChange={(e) => set("hours", { ...rules.hours, latestLocal: e.target.value })} aria-label="to" />
          </div>
          <div className="field" style={{ width: 240 }}><label htmlFor="wh">{t("ob.hours.weekly")}</label><input id="wh" className="input" type="number" min={1} max={80} value={rules.hours.maxWeeklyHours ?? ""} onChange={(e) => set("hours", { ...rules.hours, maxWeeklyHours: e.target.value ? Number(e.target.value) : null })} /></div>
        </div>
      )}

      {sections.includes("languages") && (
        <div className="stack">
          <p className="help">{t("ob.lang.help")}</p>
          <div className="row-wrap"><span className="label">{t("ob.step.languages")}</span><ConstraintPicker label={t("ob.step.languages")} value={rules.languages.mode} onChange={(m) => set("languages", { ...rules.languages, mode: m })} /></div>
          <table className="table">
            <thead><tr><th></th><th>{t("ob.lang.written")}</th><th>{t("ob.lang.spoken")}</th><th>{t("ob.lang.basis")}</th><th></th></tr></thead>
            <tbody>
              {rules.languages.items.map((l, i) => {
                const upd = (p: Partial<LanguageSkill>) => set("languages", { ...rules.languages, items: rules.languages.items.map((x, k) => (k === i ? { ...x, ...p } : x)) });
                return (
                  <tr key={i}>
                    <td>
                      <select className="select" value={l.lang} onChange={(e) => upd({ lang: e.target.value })} aria-label="language">
                        {LANGS.map((c) => <option key={c} value={c}>{LANG_LABEL[c]?.[lang === "ru" ? 0 : 1] ?? c}</option>)}
                      </select>
                    </td>
                    <td><select className="select" value={l.written ?? ""} onChange={(e) => upd({ written: (e.target.value || null) as Cefr | null })} aria-label={t("ob.lang.written")}><option value="">—</option>{CEFRS.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><select className="select" value={l.spoken ?? ""} onChange={(e) => upd({ spoken: (e.target.value || null) as Cefr | null })} aria-label={t("ob.lang.spoken")}><option value="">—</option>{CEFRS.map((c) => <option key={c}>{c}</option>)}</select></td>
                    <td><select className="select" value={l.basis} onChange={(e) => upd({ basis: e.target.value as LanguageSkill["basis"] })} aria-label={t("ob.lang.basis")}><option value="self_reported">{t("ob.lang.self")}</option><option value="certified">{t("ob.lang.cert")}</option></select></td>
                    <td><button className="btn btn-ghost btn-sm btn-danger" onClick={() => set("languages", { ...rules.languages, items: rules.languages.items.filter((_, k) => k !== i) })}>{t("common.delete")}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div><button className="btn btn-sm" onClick={() => set("languages", { ...rules.languages, items: [...rules.languages.items, { lang: rules.languages.items.some((x) => x.lang === "en") ? "ru" : "en", written: null, spoken: null, basis: "self_reported" }] })}>+ {t("ob.lang.add")}</button></div>
        </div>
      )}

      {sections.includes("pay") && (
        <div className="stack">
          <p className="help">{t("ob.pay.help")}</p>
          <div className="row-wrap"><span className="label">{t("ob.step.pay")}</span><ConstraintPicker label={t("ob.step.pay")} value={rules.pay.mode} onChange={(m) => set("pay", { ...rules.pay, mode: m })} /></div>
          {rules.pay.minimums.map((m, i) => (
            <div key={i} className="row">
              <select className="select" value={m.currency} onChange={(e) => set("pay", { ...rules.pay, minimums: rules.pay.minimums.map((x, k) => (k === i ? { ...x, currency: e.target.value } : x)) })} aria-label={t("ob.pay.currency")}>
                {["RUB", "USD", "EUR", "GBP", "KZT", "AMD", "UAH", "TRY", "GEL", "BYN", "UZS"].map((c) => <option key={c}>{c}</option>)}
              </select>
              <input className="input" type="number" min={1} value={m.amountMonthly} onChange={(e) => set("pay", { ...rules.pay, minimums: rules.pay.minimums.map((x, k) => (k === i ? { ...x, amountMonthly: Number(e.target.value) || 0 } : x)) })} aria-label={t("ob.pay.amount")} />
              <span className="muted small">{t("period.month")}</span>
              <button className="btn btn-ghost btn-sm btn-danger" onClick={() => set("pay", { ...rules.pay, minimums: rules.pay.minimums.filter((_, k) => k !== i) })}>{t("common.delete")}</button>
            </div>
          ))}
          <div><button className="btn btn-sm" onClick={() => set("pay", { ...rules.pay, minimums: [...rules.pay.minimums, { currency: rules.pay.minimums.some((x) => x.currency === "USD") ? "EUR" : "USD", amountMonthly: 500 }] })}>+ {t("ob.pay.currency")}</button></div>
        </div>
      )}

      {sections.includes("limits") && (
        <div className="stack">
          <div className="row-wrap"><span className="label">{t("vac.calls")}</span><ConstraintPicker label={t("vac.calls")} value={rules.voice.mode} onChange={(m) => set("voice", { ...rules.voice, mode: m })} /></div>
          <label className="check"><input type="checkbox" checked={rules.voice.noPhoneWork} onChange={(e) => set("voice", { ...rules.voice, noPhoneWork: e.target.checked })} />{t("ob.limits.noPhone")}</label>
          <label className="check"><input type="checkbox" checked={rules.voice.noVoiceScreening} onChange={(e) => set("voice", { ...rules.voice, noVoiceScreening: e.target.checked })} />{t("ob.limits.noVoice")}</label>
          <div className="field"><label htmlFor="topics">{t("ob.limits.topics")}</label><textarea id="topics" className="textarea" rows={2} value={rules.excludedKeywords.join(", ")} onChange={(e) => set("excludedKeywords", splitList(e.target.value))} /></div>
          <div className="field" style={{ width: 200 }}><label htmlFor="fresh">{t("ob.limits.fresh")}</label><input id="fresh" className="input" type="number" min={1} max={365} value={rules.freshnessDays} onChange={(e) => set("freshnessDays", Math.max(1, Number(e.target.value) || 30))} /></div>
        </div>
      )}
    </div>
  );
}

export function RulesSummary({ rules }: { rules: SearchRules }) {
  const { t, lang } = useI18n();
  const { countries } = useTemplates();
  const c = countries.find((x) => x.code === rules.location.country);
  const mode = (m: string) => t(`constraint.${m}` as any);
  return (
    <dl className="kv">
      <dt>{t("prof.tracks")}</dt><dd>{rules.tracks.filter((x) => x.enabled).map((x) => x.name).join(" → ") || "—"}</dd>
      <dt>{t("ob.place.country")}</dt><dd>{c ? (lang === "ru" ? c.ru : c.en) : "—"}{rules.location.city ? `, ${rules.location.city}` : ""}, {rules.location.timezone}, <span className="muted">{mode(rules.countryEligibility.mode)}</span></dd>
      <dt>{t("ob.step.format")}</dt><dd>{(["remote", "hybrid", "office"] as const).filter((k) => rules.workFormat[k]).map((k) => t(`ob.format.${k}`)).join(", ") || "—"}{rules.workFormat.hybrid && rules.workFormat.hybridCities.length ? ` (${rules.workFormat.hybridCities.join(", ")})` : ""}, <span className="muted">{mode(rules.workFormat.mode)}</span></dd>
      <dt>{t("ob.step.pay")}</dt><dd>{rules.pay.minimums.map((m) => `${m.amountMonthly.toLocaleString()} ${m.currency}`).join(lang === "ru" ? " или " : " or ") || "—"}, <span className="muted">{mode(rules.pay.mode)}</span></dd>
      <dt>{t("ob.step.hours")}</dt><dd>{rules.hours.earliestLocal}–{rules.hours.latestLocal}{rules.hours.maxWeeklyHours ? `, ≤ ${rules.hours.maxWeeklyHours} h/wk` : ""}, <span className="muted">{mode(rules.hours.mode)}</span></dd>
      <dt>{t("ob.step.languages")}</dt><dd>{rules.languages.items.map((l) => `${l.lang.toUpperCase()} ${l.written ?? "—"}/${l.spoken ?? "—"}${l.basis === "self_reported" ? ` (${t("ob.lang.self").toLowerCase()})` : ""}`).join(", ") || "—"}, <span className="muted">{mode(rules.languages.mode)}</span></dd>
      <dt>{t("vac.calls")}</dt><dd>{rules.voice.noPhoneWork ? t("ob.limits.noPhone") : "—"}, <span className="muted">{mode(rules.voice.mode)}</span></dd>
      <dt>{t("ob.step.experience")}</dt><dd>≤ {rules.experience.maxYearsRequired}, {rules.experience.allowSenior ? "senior ok" : "no senior"}, <span className="muted">{mode(rules.experience.mode)}</span></dd>
      <dt>{t("ob.limits.topics")}</dt><dd>{rules.excludedKeywords.join(", ") || "—"}</dd>
    </dl>
  );
}
