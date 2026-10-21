// «Дополнительные инструкции для ИИ»: человек своими словами задаёт условия поиска.
// Текст разбирается в структуру (правилами, а при подключённой модели — ещё и ИИ), структура применяется:
// исключённые площадки не опрашиваются и отсекаются, требования к вакансиям участвуют в оценке.
// Противоречия с настройками профиля показываются человеку и решаются только им.

import type { AiInstructions, DimensionStatus, InstructionDirectives, Msg, SearchRules, Vacancy, WorkFormat } from "../shared/types";
export type { AiInstructions, InstructionDirectives, WorkFormat };
import { msg } from "../shared/types";
import { blockedReason, SERVICE_FAMILIES } from "./policy";
import { COUNTRIES, countryName, detectPlaces } from "./geo";
import { normalizeText, phraseHit, sha } from "./text";

export interface InstructionConflict {
  id: string;
  instruction: Msg;
  settings: Msg;
}

export const EMPTY_DIRECTIVES: InstructionDirectives = { excludeSources: [], excludeHosts: [], excludeKeywords: [], requireKeywords: [], countries: [], excludeCountries: [], postingLanguages: [], workFormats: [], notes: [] };

const uniq = <T>(a: T[]) => [...new Set(a)];

const LANGS: Array<[string, RegExp]> = [
  ["en", /англ\w*|english/i],
  ["ru", /русск\w*|russian/i],
  ["de", /немецк\w*|german(?!y)/i],
  ["fr", /французск\w*|french/i],
  ["es", /испанск\w*|spanish/i],
  ["pt", /португальск\w*|portuguese/i],
  ["it", /итальянск\w*|italian/i],
  ["pl", /польск\w*|polish/i],
  ["uk", /украинск\w*|ukrainian/i],
];

// В JS \b не видит границ кириллических слов — для русских слов границы задаются явно
const W = "(?=[\\s,.;:!?]|$)";
const NEG = new RegExp(`((^|\\s)не\\s+(используй|ищи|показывай|предлагай|бери|рассматривай|присылай|нужн[а-яё]*)|исключ[а-яё]*|убери|избега[а-яё]*|(^|\\s)без${W}|(^|\\s)кроме${W}|никаких|игнорируй|\\bavoid\\b|\\bexclude\\b|\\bexcluding\\b|don'?t\\s+(use|show|include|want|search)|do\\s+not\\s+(use|show|include|want|search)|\\bskip\\b|\\bignore\\b|\\bno\\b|\\bnot\\b|\\bwithout\\b)`, "i");
const ONLY = /(только|лишь|исключительно|\bonly\b|\bjust\b|exclusively)/i;
const REQUIRE = /(должн[а-яё]*\s+(быть|содержать|упоминать)|обязательно\s+(упоминание|наличие)?|ищи\s+вакансии\s+(со?|про)(?=\s)|must\s+(mention|include|contain|have)|has\s+to\s+mention)/i;

/** Названия стран на русском в любом падеже: «германия/германии/германию», «польша/польши». */
function countryMentions(text: string): string[] {
  const out = new Set(detectPlaces(text).countries);
  const words = normalizeText(text).split(/[^a-zа-яё]+/i).filter(Boolean);
  for (const c of COUNTRIES) {
    for (const n of c.names) {
      if (!/[а-яё]/i.test(n) || n.includes(" ") || n.length < 5) continue;
      const stem = n.replace(/(ия|ья|ая|а|я|ь|й)$/i, "");
      if (stem.length < 4) continue;
      if (words.some((w) => w.startsWith(stem) && w.length - stem.length <= 3)) out.add(c.code);
    }
  }
  return [...out];
}

/** Площадки, упомянутые в тексте: семейства сервисов и явные домены. */
function serviceMentions(text: string): { sourceIds: string[]; hosts: string[] } {
  const t = ` ${normalizeText(text)} `;
  const sourceIds: string[] = [];
  const hosts: string[] = [];
  for (const f of SERVICE_FAMILIES) {
    if (f.names.some((n) => new RegExp(`(^|[^a-zа-яё0-9.])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zа-яё0-9]|$)`, "i").test(t))) {
      sourceIds.push(...f.sourceIds);
      hosts.push(...f.hosts);
    }
  }
  for (const m of text.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ru|com|io|app|kz|by|ua|org|net|co|de|uk|pl))\b/gi)) hosts.push(m[1].toLowerCase());
  return { sourceIds: uniq(sourceIds), hosts: uniq(hosts) };
}

const FORMAT_RE: Array<[WorkFormat, RegExp]> = [
  ["remote", /удал[её]нн?\w*|удалёнк\w*|удаленк\w*|remote|из дома|work from home/i],
  ["hybrid", /гибрид\w*|hybrid/i],
  ["office", /офис\w*|office|on-?site/i],
];

function quoted(text: string): string[] {
  return [...text.matchAll(/[«"“']([^»"”']{2,60})[»"”']/g)].map((m) => m[1].trim());
}

/** Что идёт после слова-отрицания: «без продаж и холодных звонков» → [«продаж», «холодных звонков»]. */
function tailPhrases(clause: string, re: RegExp): string[] {
  const m = clause.match(re);
  if (!m) return [];
  const tail = clause.slice((m.index ?? 0) + m[0].length);
  return tail
    .replace(/^(\s*(вакансий|вакансии|позиций|работы|jobs|roles|positions)\s*(со?|про|with|about|that mention|mentioning)?)/i, "")
    .split(/,|;|\s+и\s+|\s+или\s+|\s+and\s+|\s+or\s+/i)
    .map((s) => s.replace(/^\s*(слов[оа]?|со словами|словом|the word|words?)\s*/i, "").replace(/[.!?]+$/, "").trim())
    .filter((s) => s.length >= 3 && s.split(/\s+/).length <= 4);
}

/** Разбор правилами (без ИИ): работает всегда, на русском и английском. */
export function parseInstructions(text: string): InstructionDirectives {
  const d: InstructionDirectives = structuredClone(EMPTY_DIRECTIVES);
  // Точка внутри домена (hh.ru) фразу не разрывает
  const clauses = text.split(/[\n;!?]+|\.(?=\s|$)/).map((s) => s.trim()).filter(Boolean);
  for (const clause of clauses) {
    let understood = false;
    const neg = NEG.test(clause);
    const svc = serviceMentions(clause);
    const countries = countryMentions(clause);
    const langs = LANGS.filter(([, re]) => re.test(clause)).map(([c]) => c);
    const formats = FORMAT_RE.filter(([, re]) => re.test(clause)).map(([f]) => f);
    const quotes = quoted(clause);

    if ((svc.sourceIds.length || svc.hosts.length) && neg) {
      d.excludeSources.push(...svc.sourceIds);
      d.excludeHosts.push(...svc.hosts);
      understood = true;
    }
    if (countries.length && !svc.hosts.length) {
      (neg && !ONLY.test(clause) ? d.excludeCountries : d.countries).push(...countries);
      understood = true;
    }
    if (langs.length && /(язык|language|на\s+(английском|русском|немецком|французском|испанском)|in\s+(english|russian|german|french|spanish)|вакансии\s+на|postings?\s+in)/i.test(clause)) {
      d.postingLanguages.push(...langs);
      understood = true;
    }
    if (formats.length && /(формат|работ[а-яё]*|только|ищи|format|work|only|look|without|без|(^|\s)не(\s|$)|\bno\b)/i.test(clause)) {
      if (neg && !ONLY.test(clause)) {
        const keep = (["remote", "hybrid", "office"] as WorkFormat[]).filter((f) => !formats.includes(f));
        d.workFormats.push(...keep);
      } else d.workFormats.push(...formats);
      understood = true;
    }
    if (!understood && REQUIRE.test(clause)) {
      d.requireKeywords.push(...(quotes.length ? quotes : tailPhrases(clause, REQUIRE)));
      understood = d.requireKeywords.length > 0;
    }
    if (!understood && neg) {
      const words = quotes.length ? quotes : tailPhrases(clause, NEG);
      if (words.length) {
        d.excludeKeywords.push(...words);
        understood = true;
      }
    }
    if (!understood) d.notes.push(clause);
  }
  d.excludeSources = uniq(d.excludeSources);
  d.excludeHosts = uniq(d.excludeHosts);
  d.excludeKeywords = uniq(d.excludeKeywords.map((s) => s.toLowerCase()));
  d.requireKeywords = uniq(d.requireKeywords.map((s) => s.toLowerCase()));
  d.countries = uniq(d.countries);
  d.excludeCountries = uniq(d.excludeCountries).filter((c) => !d.countries.includes(c));
  d.postingLanguages = uniq(d.postingLanguages);
  d.workFormats = uniq(d.workFormats);
  return d;
}

/** Объединение разбора правилами и разбора ИИ (ИИ дополняет, но не стирает понятое правилами). */
export function mergeDirectives(a: InstructionDirectives, b: Partial<InstructionDirectives>): InstructionDirectives {
  const keys = Object.keys(EMPTY_DIRECTIVES) as Array<keyof InstructionDirectives>;
  const out = structuredClone(EMPTY_DIRECTIVES) as any;
  for (const k of keys) out[k] = uniq([...(a[k] as string[]), ...((b[k] as string[] | undefined) ?? [])]);
  // Фрагмент, который ИИ превратил в правило, больше не «непонятый»
  if (b.notes) out.notes = uniq(b.notes);
  return out as InstructionDirectives;
}

const FMT_NAME: Record<WorkFormat, Msg> = { remote: msg("удалённо", "remote"), hybrid: msg("гибрид", "hybrid"), office: msg("офис", "office") };
const list = (a: Msg[]): Msg => msg(a.map((x) => x.ru).join(", "), a.map((x) => x.en).join(", "));

/** Противоречия между инструкциями и настройками профиля — решает человек. */
export function findConflicts(rules: SearchRules, d: InstructionDirectives): InstructionConflict[] {
  const out: InstructionConflict[] = [];
  if (d.workFormats.length) {
    const allowed = (["remote", "hybrid", "office"] as WorkFormat[]).filter((f) => rules.workFormat[f]);
    const same = allowed.length === d.workFormats.length && allowed.every((f) => d.workFormats.includes(f));
    if (!same) out.push({ id: "format", instruction: msg(`Формат: ${list(d.workFormats.map((f) => FMT_NAME[f])).ru}`, `Format: ${list(d.workFormats.map((f) => FMT_NAME[f])).en}`), settings: msg(`В профиле: ${list(allowed.map((f) => FMT_NAME[f])).ru || "не выбран"}`, `In the profile: ${list(allowed.map((f) => FMT_NAME[f])).en || "none selected"}`) });
  }
  for (const k of d.excludeKeywords) {
    const t = rules.tracks.find((tr) => tr.enabled && tr.titleKeywords.some((w) => normalizeText(w).includes(normalizeText(k)) || normalizeText(k).includes(normalizeText(w))));
    if (t) out.push({ id: `keyword:${k}`, instruction: msg(`Исключить вакансии со словом «${k}»`, `Exclude jobs mentioning “${k}”`), settings: msg(`Направление «${t.name}» ищет именно такие вакансии`, `Job area “${t.name}” looks for exactly such jobs`) });
  }
  const known = new Set(rules.languages.items.map((l) => l.lang));
  for (const lg of d.postingLanguages) {
    if (rules.languages.items.length && !known.has(lg)) out.push({ id: `language:${lg}`, instruction: msg(`Вакансии на языке: ${lg}`, `Postings in language: ${lg}`), settings: msg("Этого языка нет в списке ваших языков", "This language is not among your languages") });
  }
  if (rules.location.country && d.excludeCountries.includes(rules.location.country) && rules.countryEligibility.mode === "hard") {
    out.push({ id: `country:${rules.location.country}`, instruction: msg(`Исключить ${countryName(rules.location.country, "ru")}`, `Exclude ${countryName(rules.location.country, "en")}`), settings: msg("Это ваша страна: вакансии должны нанимать из неё", "This is your country: jobs must hire from it") });
  }
  return out;
}

/** Правила с учётом решений по противоречиям: если человек выбрал инструкцию, она меняет настройку. */
export function effectiveRules(rules: SearchRules): SearchRules {
  const ai = rules.aiInstructions;
  const d = ai?.parsed;
  if (!ai || !d) return rules;
  const res = ai.resolutions ?? {};
  let r = rules;
  if (d.workFormats.length && res.format === "instruction") {
    r = { ...r, workFormat: { ...r.workFormat, mode: "hard", remote: d.workFormats.includes("remote"), hybrid: d.workFormats.includes("hybrid"), office: d.workFormats.includes("office") } };
  }
  return r;
}

/** Действующие директивы: исключения, по которым человек выбрал «настройки», не применяются. */
export function activeDirectives(rules: SearchRules): InstructionDirectives | null {
  const ai = rules.aiInstructions;
  if (!ai?.parsed || !ai.text.trim()) return null;
  const res = ai.resolutions ?? {};
  const d = structuredClone(ai.parsed);
  if (res.format !== "instruction") d.workFormats = []; // формат применяется через настройки, если выбрана инструкция
  d.excludeKeywords = d.excludeKeywords.filter((k) => res[`keyword:${k}`] !== "settings");
  d.postingLanguages = d.postingLanguages.filter((l) => res[`language:${l}`] !== "settings");
  d.excludeCountries = d.excludeCountries.filter((c) => res[`country:${c}`] !== "settings");
  return d;
}

export function unresolvedConflicts(rules: SearchRules): InstructionConflict[] {
  const ai = rules.aiInstructions;
  if (!ai?.parsed) return [];
  return findConflicts(rules, ai.parsed).filter((c) => !ai.resolutions?.[c.id]);
}

/** Язык текста вакансии по алфавиту и частым словам (грубо, но без сети). */
export function postingLanguage(v: Pick<Vacancy, "title" | "description">): string | null {
  const t = `${v.title} ${v.description.slice(0, 3000)}`;
  const cyr = (t.match(/[а-яё]/gi) ?? []).length;
  const lat = (t.match(/[a-z]/gi) ?? []).length;
  if (cyr + lat < 40) return null;
  if (cyr > lat) return /[їєі]/i.test(t) && !/[ыэъ]/i.test(t) ? "uk" : "ru";
  const n = normalizeText(t);
  const score = (words: string[]) => words.reduce((s, w) => s + (n.split(/\s+/).filter((x) => x === w).length), 0);
  const cand: Array<[string, number]> = [
    ["en", score(["the", "and", "you", "with", "for", "our"])],
    ["de", score(["und", "der", "die", "mit", "für", "wir"])],
    ["fr", score(["et", "les", "des", "pour", "avec", "nous"])],
    ["es", score(["y", "los", "las", "para", "con", "nosotros"])],
    ["pl", score(["i", "oraz", "dla", "się", "jest", "praca"])],
  ];
  cand.sort((a, b) => b[1] - a[1]);
  return cand[0][1] > 0 ? cand[0][0] : null;
}

export interface InstructionVerdict {
  status: DimensionStatus;
  reason: Msg;
  quote: string | null;
}

/** Проверка вакансии по инструкциям (без ИИ). Свободные заметки отдельно проверяет ИИ. */
export function checkInstructions(d: InstructionDirectives, v: Vacancy, aiNote?: { status: DimensionStatus; reason: Msg; quote: string | null } | null): InstructionVerdict {
  const body = normalizeText(`${v.title} ${v.company} ${v.description.slice(0, 8000)}`);
  // 1. Площадка
  if (d.excludeSources.includes(v.sourceId)) return { status: "fail", reason: msg(`Площадка исключена вашими инструкциями (${v.sourceId})`, `The site is excluded by your instructions (${v.sourceId})`), quote: null };
  const hostRules = d.excludeHosts.map((host) => ({ host, reason: "инструкция" }));
  for (const u of [v.canonicalUrl, v.sourceUrl, v.applyUrl]) {
    const b = u && blockedReason(u, hostRules);
    if (b) return { status: "fail", reason: msg(`Ссылка ведёт на исключённую вами площадку: ${b.split(":")[0]}`, `The link points to a site you excluded: ${b.split(":")[0]}`), quote: u };
  }
  // 2. Слова, которых нужно избегать
  const bad = d.excludeKeywords.filter((k) => phraseHit(body, k));
  if (bad.length) return { status: "fail", reason: msg(`Есть то, чего вы просили избегать: ${bad.join(", ")}`, `Contains what you asked to avoid: ${bad.join(", ")}`), quote: bad[0] };
  // 3. Обязательные слова
  if (d.requireKeywords.length && !d.requireKeywords.some((k) => phraseHit(body, k))) return { status: "fail", reason: msg(`Нет того, что вы просили: ${d.requireKeywords.join(", ")}`, `Missing what you asked for: ${d.requireKeywords.join(", ")}`), quote: null };
  // 4. Язык объявления
  if (d.postingLanguages.length) {
    const lg = postingLanguage(v);
    if (lg && !d.postingLanguages.includes(lg)) return { status: "fail", reason: msg(`Объявление на другом языке (${lg}), вы просили: ${d.postingLanguages.join(", ")}`, `The posting is in another language (${lg}); you asked for: ${d.postingLanguages.join(", ")}`), quote: null };
  }
  // 5. Страны
  const geo = v.facts.geography.value;
  if (d.excludeCountries.length && geo.allowed.length && geo.allowed.every((c) => d.excludeCountries.includes(c))) {
    return { status: "fail", reason: msg(`Только страны, которые вы исключили: ${geo.allowed.join(", ")}`, `Only countries you excluded: ${geo.allowed.join(", ")}`), quote: v.facts.geography.quote };
  }
  let unknown: Msg | null = null;
  if (d.countries.length) {
    if (geo.scope === "worldwide" || geo.allowed.some((c) => d.countries.includes(c))) {
      /* подходит */
    } else if (geo.allowed.length) {
      return { status: "fail", reason: msg(`Страны вакансии (${geo.allowed.join(", ")}) не из вашего списка: ${d.countries.join(", ")}`, `The job's countries (${geo.allowed.join(", ")}) are not in your list: ${d.countries.join(", ")}`), quote: v.facts.geography.quote };
    } else unknown = msg(`Не указано, подходит ли страна из вашего списка: ${d.countries.join(", ")}`, `It is not stated whether a country from your list fits: ${d.countries.join(", ")}`);
  }
  if (aiNote?.status === "fail") return aiNote;
  if (unknown) return { status: "unknown", reason: unknown, quote: null };
  if (aiNote) return aiNote;
  return { status: "pass", reason: msg("Соответствует вашим инструкциям", "Matches your instructions"), quote: null };
}

/** Площадки, которые не нужно опрашивать: их исключили все настоящие профили. */
export function sourcesExcludedByEveryone(rulesList: SearchRules[]): Set<string> {
  const sets = rulesList.map((r) => new Set(activeDirectives(r)?.excludeSources ?? []));
  if (!sets.length) return new Set();
  return new Set([...sets[0]].filter((s) => sets.every((x) => x.has(s))));
}

/** Ключ проверки свободной части инструкций: меняется вместе с текстом заметок. */
export function notesHash(d: InstructionDirectives | null): string | null {
  return d && d.notes.length ? sha(d.notes.join("\n")) : null;
}
