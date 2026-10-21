// Единственная функция решения «кандидат × вакансия».
// fit = unsuitable, если хоть одно ЖЁСТКОЕ условие не выполнено;
// fit = needs_check, если жёсткое условие неизвестно;
// fit = suitable — только когда все жёсткие условия подтверждены.
// Relevance — лексическое совпадение с профилем, НЕ вероятность оффера, и никогда не обходит reject/unknown.
// Все тексты сразу на русском и английском (Msg), чтобы смена языка не требовала пересчёта.

import type {
  Assessment, Cefr, ConstraintMode, Dimension, DimensionStatus, FactStatus, Fit, Msg, SearchRules, SkillEvidence, Track, Vacancy,
} from "../shared/types";
import { CEFR_ORDER, msg } from "../shared/types";
import { AMBIGUOUS_REGIONS, countryByCode, countryInRegion, countryName } from "./geo";
import { judgePay } from "./money";
import { normalizeText, phraseHit, sha } from "./text";
import { convertWindow, formatInZone, windowFits } from "./timezone";
import { isIntermediary } from "./classify";

export const RULES_VERSION = "decision-2026.10.21";

const LANG_NAMES: Record<string, Msg> = {
  en: msg("английский", "English"), ru: msg("русский", "Russian"), de: msg("немецкий", "German"), fr: msg("французский", "French"),
  es: msg("испанский", "Spanish"), it: msg("итальянский", "Italian"), pt: msg("португальский", "Portuguese"), zh: msg("китайский", "Chinese"),
};

const L = {
  role: msg("Направление", "Track"),
  format: msg("Формат", "Work format"),
  country: msg("Страна найма", "Hiring country"),
  pay: msg("Оплата", "Pay"),
  experience: msg("Опыт", "Experience"),
  language: msg("Язык", "Language"),
  voice: msg("Звонки", "Phone work"),
  hours: msg("Часы", "Hours"),
  safety: msg("Работодатель", "Employer"),
  postingType: msg("Тип объявления", "Posting type"),
  exclusions: msg("Исключённые темы", "Excluded topics"),
  skills: msg("Навыки", "Skills"),
  freshness: msg("Свежесть", "Freshness"),
};

const join = (parts: Msg[], sep = "; "): Msg => msg(parts.map((p) => p.ru).join(sep), parts.map((p) => p.en).join(sep));

export interface TrackMatch {
  track: Track;
  score: number;
  titleHits: string[];
  bodyHits: string[];
}

export function matchTracks(tracks: Track[], v: Pick<Vacancy, "title" | "description" | "tags">): TrackMatch[] {
  const title = normalizeText(v.title);
  const body = normalizeText(`${v.title} ${v.description.slice(0, 8000)} ${(v.tags || []).join(" ")}`);
  const out: TrackMatch[] = [];
  tracks.forEach((track) => {
    if (!track.enabled) return;
    if (track.excludeKeywords.some((k) => phraseHit(body, k))) return;
    const titleHits = track.titleKeywords.filter((k) => phraseHit(title, k));
    const bodyHits = track.bodyKeywords.filter((k) => phraseHit(body, k));
    let score = 0;
    if (titleHits.length) score = 55 + Math.min(10, (titleHits.length - 1) * 5);
    else if (bodyHits.length >= 3) score = 30;
    else return;
    score += Math.min(25, bodyHits.length * 5);
    out.push({ track, score: Math.min(90, score), titleHits: titleHits.slice(0, 4), bodyHits: bodyHits.slice(0, 6) });
  });
  const order = new Map(tracks.map((t, i) => [t.id, i]));
  return out.sort((a, b) => b.score - a.score || order.get(a.track.id)! - order.get(b.track.id)!);
}

function dim(key: Dimension["key"], label: Msg, status: DimensionStatus, constraint: ConstraintMode, reason: Msg, extra: Partial<Dimension> = {}): Dimension {
  return { key, label, status, constraint, reason, ...extra };
}

function cefrAtLeast(have: Cefr | null, need: Cefr | null): boolean | null {
  if (!need || !have) return null;
  return CEFR_ORDER.indexOf(have) >= CEFR_ORDER.indexOf(need);
}

export interface AssessInput {
  rules: SearchRules;
  profileVersion: number;
  skills: SkillEvidence[];
  vacancy: Vacancy;
  candidateId: string;
  now?: Date;
}

export function assessmentInputHash(input: AssessInput): string {
  return sha(
    JSON.stringify([
      RULES_VERSION,
      input.profileVersion,
      input.rules,
      input.skills.map((s) => [s.skill, s.kind]).sort(),
      input.vacancy.contentHash,
      input.vacancy.facts,
      input.vacancy.postingKind,
    ]),
  );
}

export function assess(input: AssessInput): Omit<Assessment, "id" | "createdAt" | "supersededAt"> {
  const { rules, vacancy: v } = input;
  const now = input.now ?? new Date();
  const f = v.facts;
  const dims: Dimension[] = [];
  const ev = (fact: { status: FactStatus; quote: string | null }) => ({ quote: fact.quote, source: v.canonicalUrl, status: fact.status });

  // 1. Направление
  const enabledTracks = rules.tracks.filter((t) => t.enabled);
  const matches = matchTracks(rules.tracks, v);
  const best = matches[0] ?? null;
  if (!enabledTracks.length) dims.push(dim("role", L.role, "na", "unset", msg("Направления не заданы — показываются все объявления", "No tracks set — all postings are shown")));
  else if (best) {
    const hits = [...new Set([...best.titleHits, ...best.bodyHits].map((h) => h.toLowerCase()))].slice(0, 5).join(", ");
    dims.push(dim("role", L.role, "pass", "hard", msg(`Трек «${best.track.name}»: ${hits}`, `Track "${best.track.name}": ${hits}`)));
  } else dims.push(dim("role", L.role, "fail", "hard", msg("Не совпадает ни с одним включённым направлением", "Does not match any enabled track")));

  // 2. Формат работы
  {
    const mode = rules.workFormat.mode;
    const fv = f.format.value;
    const wf = rules.workFormat;
    if (mode === "unset") dims.push(dim("format", L.format, "na", mode, msg("Ограничение формата не задано", "No work-format constraint")));
    else if (fv === "unknown")
      dims.push(dim("format", L.format, "unknown", mode, msg("Формат работы в объявлении не указан", "Work format is not stated"), { howToResolve: msg("Уточнить: удалённо, гибрид или офис", "Ask: remote, hybrid or office"), evidence: null }));
    else if (fv === "remote")
      dims.push(dim("format", L.format, wf.remote ? "pass" : "fail", mode, wf.remote ? msg("Удалённая работа", "Remote work") : msg("Удалёнка исключена профилем", "Remote is excluded by the profile"), { evidence: ev(f.format) }));
    else if (fv === "office")
      dims.push(dim("format", L.format, wf.office ? "pass" : "fail", mode, wf.office ? msg("Офис допустим", "Office is acceptable") : msg("Только офис — исключено профилем", "Office only — excluded by the profile"), { evidence: ev(f.format) }));
    else if (!wf.hybrid) dims.push(dim("format", L.format, "fail", mode, msg("Гибрид исключён профилем", "Hybrid is excluded by the profile"), { evidence: ev(f.format) }));
    else {
      const cities = wf.hybridCities.map((c) => normalizeText(c)).filter(Boolean);
      const hc = f.hybridCity.value ? normalizeText(f.hybridCity.value) : null;
      const locText = normalizeText(v.location);
      const cityOk = hc ? cities.includes(hc) : cities.some((c) => locText.includes(c));
      const where = f.hybridCity.value ?? v.location;
      if (cityOk) dims.push(dim("format", L.format, "pass", mode, msg("Гибрид в допустимом городе", "Hybrid in an acceptable city"), { evidence: ev(f.format) }));
      else if (!cities.length)
        dims.push(dim("format", L.format, "unknown", mode, msg("Гибрид: в профиле не указан город для посещений", "Hybrid: no commuting city in the profile"), { howToResolve: msg("Добавить город гибрида в профиль", "Add a hybrid city to the profile"), evidence: ev(f.format) }));
      else if (where) dims.push(dim("format", L.format, "fail", mode, msg(`Гибрид в другом городе (${where})`, `Hybrid in another city (${where})`), { evidence: ev(f.format) }));
      else dims.push(dim("format", L.format, "unknown", mode, msg("Гибрид, город офиса не указан", "Hybrid, office city not stated"), { howToResolve: msg("Уточнить город и частоту посещений", "Ask for the city and visit frequency"), evidence: ev(f.format) }));
    }
  }

  // 3. Страна найма
  {
    const mode = rules.countryEligibility.mode;
    const home = rules.location.country;
    const g = f.geography.value;
    const hr = countryName(home, "ru");
    const he = countryName(home, "en");
    const ask = msg(`Найти у работодателя явное подтверждение найма и выплаты в стране: ${hr}`, `Find explicit confirmation that the employer hires and pays in ${he}`);
    if (mode === "unset" || !home)
      dims.push(dim("country", L.country, "na", mode === "unset" ? "unset" : mode, home ? msg("Ограничение не задано", "No constraint") : msg("Страна кандидата не указана в профиле", "Candidate country is not set")));
    else if (g.excluded.includes(home) || g.excluded.some((r) => countryInRegion(home, r)))
      dims.push(dim("country", L.country, "fail", mode, msg(`Объявление исключает страну: ${hr}`, `The posting excludes ${he}`), { evidence: ev(f.geography) }));
    else if (g.allowed.includes(home)) dims.push(dim("country", L.country, "pass", mode, msg(`Явно указана страна: ${hr}`, `Country explicitly listed: ${he}`), { evidence: ev(f.geography) }));
    else if (g.allowed.some((r) => !AMBIGUOUS_REGIONS.has(r) && countryInRegion(home, r)))
      dims.push(dim("country", L.country, "pass", mode, msg(`Регион найма включает страну: ${hr}`, `Hiring region includes ${he}`), { evidence: ev(f.geography) }));
    else if (g.scope === "worldwide")
      dims.push(dim("country", L.country, "unknown", mode, msg(`«Worldwide» не доказывает найм из страны: ${hr}`, `"Worldwide" does not prove hiring from ${he}`), { howToResolve: ask, evidence: ev(f.geography) }));
    else if (g.allowed.includes("PARTIAL")) {
      const list = g.allowed.filter((x) => x !== "PARTIAL").join(", ");
      dims.push(dim("country", L.country, "unknown", mode, msg(`Перечень стран неполный (${list} и другие) — страна ${hr} не названа`, `The country list is incomplete (${list} and others) — ${he} is not named`), { howToResolve: ask, evidence: ev(f.geography) }));
    } else if (g.allowed.length) {
      const list = g.allowed.join(", ");
      const ambiguous = g.allowed.filter((r) => AMBIGUOUS_REGIONS.has(r) && countryByCode(home)?.regions.includes(r));
      if (ambiguous.length || g.allowed.every((r) => AMBIGUOUS_REGIONS.has(r)))
        dims.push(dim("country", L.country, "unknown", mode, msg(`Широкий регион (${list}) не доказывает найм из страны: ${hr}`, `A broad region (${list}) does not prove hiring from ${he}`), { howToResolve: ask, evidence: ev(f.geography) }));
      else dims.push(dim("country", L.country, "fail", mode, msg(`Найм только: ${list}`, `Hiring only in: ${list}`), { evidence: ev(f.geography) }));
    } else dims.push(dim("country", L.country, "unknown", mode, msg("Страна найма не указана", "Hiring country is not stated"), { howToResolve: ask }));
  }

  // 4. Оплата
  {
    const mode = rules.pay.mode;
    if (f.safety.value.unpaid) dims.push(dim("pay", L.pay, "fail", "hard", msg("Неоплачиваемая работа", "Unpaid work"), { evidence: ev(f.safety) }));
    else if (mode === "unset" || !rules.pay.minimums.length) dims.push(dim("pay", L.pay, "na", "unset", msg("Минимум оплаты не задан", "No pay minimum set")));
    else {
      const verdict = judgePay(f.salary, rules.pay.minimums);
      const q = f.salary.quote ?? (f.salary.origin === "structured" ? "Salary field from the source / поле зарплаты источника" : null);
      const intermediary = isIntermediary(v.company, v.canonicalUrl);
      const reason =
        intermediary && verdict.status !== "fail"
          ? join([verdict.reason, msg("Площадка-посредник: ставка не равна гарантированному доходу", "Intermediary platform: a rate is not guaranteed income")], ". ")
          : verdict.reason;
      dims.push(
        dim("pay", L.pay, verdict.status === "pass" && intermediary ? "unknown" : verdict.status, mode, reason, {
          howToResolve: verdict.status === "pass" && !intermediary ? undefined : msg("Уточнить оклад или гарантированные часы, валюту и способ выплаты", "Confirm salary or guaranteed hours, currency and payout method"),
          evidence: q ? { quote: q, source: v.canonicalUrl, status: f.salary.origin === "structured" ? "structured" : f.salary.origin === "text" ? "stated" : "unknown" } : null,
        }),
      );
    }
  }

  // 5. Опыт
  {
    const mode = rules.experience.mode;
    const e = f.experience.value;
    if (mode === "unset") dims.push(dim("experience", L.experience, "na", mode, msg("Ограничение опыта не задано", "No experience constraint")));
    else if ((e.seniority === "senior" || e.seniority === "lead") && !rules.experience.allowSenior)
      dims.push(dim("experience", L.experience, "fail", mode, e.seniority === "lead" ? msg("Уровень руководителя", "Lead/management level") : msg("Уровень senior", "Senior level"), { evidence: ev(f.experience) }));
    else if (e.yearsMin !== null && e.yearsMin > rules.experience.maxYearsRequired) {
      const jun = e.seniority === "junior" || e.seniority === "intern";
      dims.push(
        dim("experience", L.experience, "fail", mode, msg(`Требуется ${e.yearsMin}+ лет опыта${jun ? " (несмотря на junior/стажёр в названии)" : ""}`, `Requires ${e.yearsMin}+ years of experience${jun ? " (despite a junior/intern title)" : ""}`), { evidence: ev(f.experience) }),
      );
    } else if (e.yearsMin !== null)
      dims.push(dim("experience", L.experience, "pass", mode, msg(`Требуется ${e.yearsMin} г. — в пределах профиля`, `Requires ${e.yearsMin} yr — within the profile`), { evidence: ev(f.experience) }));
    else if (e.entrySignal || e.seniority === "intern" || e.seniority === "junior")
      dims.push(
        dim("experience", L.experience, "pass", mode, e.entrySignal ? msg("Явно указано: без опыта/обучение", "Explicitly entry-level / training provided") : msg("Начальный уровень по названию; лет опыта не указано", "Entry level by title; no years stated"), { evidence: ev(f.experience) }),
      );
    else dims.push(dim("experience", L.experience, "unknown", mode, msg("Требования к опыту не указаны", "Experience requirements are not stated"), { howToResolve: msg("Проверить требования к опыту в полной карточке", "Check experience requirements in the full posting") }));
  }

  // 6. Язык
  {
    const mode = rules.languages.mode;
    const reqs = f.languages.value.filter((l) => l.required);
    if (mode === "unset") dims.push(dim("language", L.language, "na", mode, msg("Ограничение языка не задано", "No language constraint")));
    else if (!reqs.length)
      dims.push(dim("language", L.language, "unknown", mode, msg("Требования к языку не найдены", "No language requirements found"), { howToResolve: msg("Проверить язык общения команды и уровень", "Check the team language and level") }));
    else {
      const fails: Msg[] = [];
      const unknowns: Msg[] = [];
      const passes: Msg[] = [];
      for (const r of reqs) {
        const mine = rules.languages.items.find((i) => i.lang === r.lang);
        const name = LANG_NAMES[r.lang] ?? msg(r.lang, r.lang);
        if (!mine || (!mine.written && !mine.spoken)) {
          fails.push(msg(`${name.ru}: не указан в профиле`, `${name.en}: not in the profile`));
          continue;
        }
        const need = r.level;
        const written = cefrAtLeast(mine.written, need);
        const spoken = r.spoken ? cefrAtLeast(mine.spoken, need) : true;
        const have = r.spoken ? mine.spoken ?? "—" : mine.written ?? "—";
        if (need === null) unknowns.push(msg(`${name.ru}: уровень не указан в объявлении`, `${name.en}: level not stated in the posting`));
        else if ((written === false || spoken === false) && r.approx && CEFR_ORDER.indexOf((r.spoken ? mine.spoken : mine.written) ?? "A1") === CEFR_ORDER.indexOf(need) - 1)
          unknowns.push(msg(`${name.ru}: требование сформулировано словами (≈${need}), в профиле ${have} — уточнить`, `${name.en}: requirement worded loosely (≈${need}), profile has ${have} — clarify`));
        else if (written === false || spoken === false)
          fails.push(msg(`${name.ru}: требуется ${need}${r.spoken ? " (устно)" : ""}, в профиле ${have}`, `${name.en}: requires ${need}${r.spoken ? " (spoken)" : ""}, profile has ${have}`));
        else if (written === null || spoken === null) unknowns.push(msg(`${name.ru}: уровень в профиле не указан`, `${name.en}: level not set in the profile`));
        else {
          const self = mine.basis === "self_reported";
          passes.push(msg(`${name.ru} ${need}${self ? " (уровень со слов)" : ""}`, `${name.en} ${need}${self ? " (self-reported)" : ""}`));
        }
      }
      if (fails.length) dims.push(dim("language", L.language, "fail", mode, join(fails), { evidence: ev(f.languages) }));
      else if (unknowns.length) dims.push(dim("language", L.language, "unknown", mode, join(unknowns), { howToResolve: msg("Уточнить требуемый уровень языка", "Confirm the required language level"), evidence: ev(f.languages) }));
      else dims.push(dim("language", L.language, "pass", mode, join(passes), { evidence: ev(f.languages) }));
    }
  }

  // 7. Звонки/голос
  {
    const trackNoCalls = !!best?.track.noCalls;
    const wantsNoCalls = rules.voice.noPhoneWork || trackNoCalls;
    const mode: ConstraintMode = trackNoCalls ? "hard" : rules.voice.mode;
    const vf = f.voice.value;
    if (!wantsNoCalls || mode === "unset") dims.push(dim("voice", L.voice, "na", "unset", msg("Ограничение звонков не задано", "No phone-work constraint")));
    else if (vf.phoneWork === "yes")
      dims.push(dim("voice", L.voice, "fail", mode, vf.coldCalls ? msg("Холодные звонки/телефонные продажи", "Cold calls / phone sales") : msg("Работа по телефону обязательна", "Phone work is required"), { evidence: ev(f.voice) }));
    else if (vf.phoneWork === "no") dims.push(dim("voice", L.voice, "pass", mode, msg("Письменная работа (чат/email)", "Written work (chat/email)"), { evidence: ev(f.voice) }));
    else dims.push(dim("voice", L.voice, "unknown", mode, msg("Не указано, есть ли обязательные звонки", "Not stated whether calls are required"), { howToResolve: msg("Уточнить долю звонков и голосовых созвонов", "Ask how much phone/voice work is involved") }));
  }

  // 8. Часы (пересчёт на текущую дату работодателя, с учётом DST)
  {
    const mode = rules.hours.mode;
    const s = f.schedule.value;
    const win = `${rules.hours.earliestLocal}–${rules.hours.latestLocal}`;
    if (mode === "unset") dims.push(dim("hours", L.hours, "na", mode, msg("Ограничение по часам не задано", "No hours constraint")));
    else if (rules.hours.maxWeeklyHours && s.weeklyMin && s.weeklyMin > rules.hours.maxWeeklyHours)
      dims.push(dim("hours", L.hours, "fail", mode, msg(`Требуется от ${s.weeklyMin} ч/нед, доступно до ${rules.hours.maxWeeklyHours}`, `Requires ${s.weeklyMin}+ h/week, available up to ${rules.hours.maxWeeklyHours}`), { evidence: ev(f.schedule) }));
    else if (s.start && s.end && s.zone) {
      const employerDate = formatInZone(now, s.zone).ymd;
      const w = convertWindow(s.start, s.end, s.zone, rules.location.timezone, employerDate);
      const ok = windowFits(w.startLocal, w.endLocal, w.crossesMidnight, rules.hours.earliestLocal, rules.hours.latestLocal);
      const base = msg(
        `${s.start}–${s.end} (${s.zone}) = ${w.startLocal}–${w.endLocal}${w.crossesMidnight ? " (+1 день)" : ""} у кандидата на ${employerDate}`,
        `${s.start}–${s.end} (${s.zone}) = ${w.startLocal}–${w.endLocal}${w.crossesMidnight ? " (+1 day)" : ""} for the candidate on ${employerDate}`,
      );
      const reason = ok ? base : s.flexible ? join([base, msg("указан гибкий график", "flexible schedule stated")]) : join([base, msg(`вне окна ${win}`, `outside the ${win} window`)], " — ");
      dims.push(dim("hours", L.hours, ok || s.flexible ? "pass" : "fail", mode, reason, { evidence: ev(f.schedule) }));
    } else if (s.flexible) dims.push(dim("hours", L.hours, "pass", mode, msg("Гибкий/асинхронный график", "Flexible/async schedule"), { evidence: ev(f.schedule) }));
    else if (s.start && s.end)
      dims.push(dim("hours", L.hours, "unknown", mode, msg(`Часы ${s.start}–${s.end} без часового пояса`, `Hours ${s.start}–${s.end} without a time zone`), { howToResolve: msg("Уточнить часовой пояс рабочих часов", "Confirm the time zone of the working hours"), evidence: ev(f.schedule) }));
    else dims.push(dim("hours", L.hours, "unknown", mode, msg("Рабочие часы не указаны", "Working hours are not stated"), { howToResolve: msg("Уточнить рабочие часы и часовой пояс команды", "Ask for working hours and the team time zone") }));
  }

  // 9. Безопасность (жёстко отсекаются только явные признаки; отсутствие признаков ≠ проверка)
  {
    const sv = f.safety.value;
    if (sv.upfrontFee) dims.push(dim("safety", L.safety, "fail", "hard", msg("Требуют оплату/взнос от кандидата", "Asks the candidate to pay a fee"), { evidence: ev(f.safety) }));
    else if (sv.unsafeContact) dims.push(dim("safety", L.safety, "fail", "hard", msg("Небезопасный канал связи/оплаты", "Unsafe contact/payment channel"), { evidence: ev(f.safety) }));
    else if (v.postingKind !== "job_posting") dims.push(dim("safety", L.postingType, "fail", "hard", v.postingKindReason));
    else {
      const inter = isIntermediary(v.company, v.canonicalUrl);
      dims.push(
        dim(
          "safety",
          L.safety,
          "unknown",
          "soft",
          inter
            ? msg("Площадка-посредник; работодатель и выплата не проверены", "Intermediary platform; employer and payout not verified")
            : msg("Автоматических признаков риска нет — это не проверка работодателя", "No automatic red flags — this is not employer verification"),
          { howToResolve: msg("Проверить сайт работодателя, договор и способ выплаты", "Check the employer's website, contract and payout method") },
        ),
      );
    }
  }

  // 10. Исключённые темы
  {
    const body = normalizeText(`${v.title} ${v.company} ${v.description.slice(0, 8000)}`);
    const hit = rules.excludedKeywords.filter((k) => phraseHit(body, k));
    if (hit.length) dims.push(dim("exclusions", L.exclusions, "fail", "hard", msg(`Найдено: ${hit.join(", ")}`, `Found: ${hit.join(", ")}`)));
  }

  // 11. Навыки (желательные не превращаются в обязательные; «со слов» ≠ подтверждено)
  {
    const sk = f.skills.value;
    const mine = new Map(input.skills.map((s) => [normalizeText(s.skill), s]));
    const req = sk.required.map((s) => ({ s, e: mine.get(normalizeText(s)) }));
    const missing = req.filter((r) => !r.e).map((r) => r.s);
    const selfOnly = req.filter((r) => r.e && r.e.kind !== "proven").map((r) => r.s);
    const proven = req.filter((r) => r.e?.kind === "proven").map((r) => r.s);
    if (!sk.required.length && !sk.preferred.length && !sk.mentioned.length)
      dims.push(dim("skills", L.skills, "na", "soft", msg("Конкретные навыки в объявлении не найдены", "No specific skills found in the posting")));
    else {
      const parts: Msg[] = [];
      if (proven.length) parts.push(msg(`подтверждено: ${proven.join(", ")}`, `proven: ${proven.join(", ")}`));
      if (selfOnly.length) parts.push(msg(`со слов, нужен пример: ${selfOnly.join(", ")}`, `self-reported, example needed: ${selfOnly.join(", ")}`));
      if (missing.length) parts.push(msg(`нет в профиле: ${missing.join(", ")}`, `not in profile: ${missing.join(", ")}`));
      if (sk.preferred.length) parts.push(msg(`желательно: ${sk.preferred.join(", ")}`, `nice to have: ${sk.preferred.join(", ")}`));
      if (!sk.required.length && sk.mentioned.length) parts.push(msg(`упомянуто (не обязательно): ${sk.mentioned.join(", ")}`, `mentioned (not required): ${sk.mentioned.join(", ")}`));
      dims.push(dim("skills", L.skills, missing.length ? "fail" : selfOnly.length ? "unknown" : "pass", "soft", parts.length ? join(parts) : msg("Обязательные навыки не выделены", "No required skills identified"), { evidence: ev(f.skills) }));
    }
  }

  // 12. Свежесть
  {
    const ref = v.publishedAt ?? v.firstSeenAt;
    const ageDays = ref ? (now.getTime() - new Date(ref).getTime()) / 86400000 : null;
    if (ageDays !== null && ageDays > rules.freshnessDays) {
      const d = Math.round(ageDays);
      dims.push(dim("freshness", L.freshness, "fail", "soft", msg(`Опубликовано ${d} дн. назад`, `Published ${d} days ago`)));
    }
  }

  const hardFails = dims.filter((d) => d.constraint === "hard" && d.status === "fail");
  const hardUnknown = dims.filter((d) => d.constraint === "hard" && d.status === "unknown");
  const fit: Fit = hardFails.length ? "unsuitable" : hardUnknown.length ? "needs_check" : "suitable";

  let relevance = best ? best.score : enabledTracks.length ? 0 : 40;
  if (best) {
    const idx = enabledTracks.findIndex((t) => t.id === best.track.id);
    relevance += Math.max(0, 10 - idx * 3);
  }
  relevance -= dims.filter((d) => d.constraint === "soft" && d.status === "fail").length * 8;
  relevance = Math.max(0, Math.min(100, Math.round(relevance)));

  const labeled = (d: Dimension) => msg(`${d.label.ru}: ${d.reason.ru}`, `${d.label.en}: ${d.reason.en}`);
  const unknowns = dims.filter((d) => d.status === "unknown").map(labeled);
  const gaps = dims.filter((d) => d.constraint === "soft" && d.status === "fail").map(labeled);

  let nextStep: Msg;
  if (fit === "unsuitable") {
    const h = hardFails[0];
    nextStep = msg(`Не тратить время: ${h.label.ru.toLowerCase()} — ${h.reason.ru}`, `Skip: ${h.label.en.toLowerCase()} — ${h.reason.en}`);
  } else if (fit === "needs_check") {
    const h = hardUnknown[0];
    const how = h.howToResolve ?? h.reason;
    nextStep = msg(`Уточнить: ${how.ru}`, `Clarify: ${how.en}`);
  } else if (v.lifecycle !== "open") nextStep = msg("Открыть первичную карточку и проверить, что приём открыт", "Open the primary posting and confirm it is still accepting applications");
  else nextStep = msg("Подготовить документы и отправить отклик вручную", "Prepare documents and apply manually");

  return {
    candidateId: input.candidateId,
    vacancyId: v.id,
    profileVersion: input.profileVersion,
    rulesVersion: RULES_VERSION,
    fit,
    trackId: best?.track.id ?? null,
    trackName: best?.track.name ?? null,
    relevance,
    dimensions: dims,
    unknowns,
    gaps,
    nextStep,
    inputHash: assessmentInputHash(input),
  };
}
