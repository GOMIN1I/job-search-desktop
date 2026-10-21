// Детерминированное извлечение фактов из объявления. Каждый факт хранит цитату-доказательство
// и статус: structured (поле источника), stated (найдено в тексте), unknown (не найдено).
// Отсутствие упоминания никогда не превращается в «подтверждено».

import type { Cefr, Fact, SalaryFact, VacancyFacts } from "../shared/types";
import { detectPlaces } from "./geo";
import { parseSalaryText, structuredSalary, UNKNOWN_SALARY } from "./money";
import { normalizeText, quoteAround } from "./text";
import { parseWorkingHours } from "./timezone";

export const EXTRACTOR_VERSION = "rules-2026.10.21b";

export interface JobInput {
  title: string;
  company: string;
  location: string;
  description: string;
  levelText?: string | null;
  employmentType?: string | null;
  tags?: string[];
  remoteBySource?: boolean; // источник публикует только удалённые вакансии
  salary?: { min?: number | string | null; max?: number | string | null; currency?: string | null; period?: string | null; estimate?: boolean; text?: string | null };
}

const known = <T>(value: T, quote: string | null, status: "stated" | "structured" = "stated"): Fact<T> => ({ value, status, quote });
const unknown = <T>(value: T): Fact<T> => ({ value, status: "unknown", quote: null });

function firstQuote(text: string, res: RegExp[]): string | null {
  for (const re of res) {
    const q = quoteAround(text, re, 70);
    if (q) return q;
  }
  return null;
}

// ---------- Формат ----------
const RE_HYBRID = [/\bhybrid\b/i, /гибрид/i, /\d\s*(?:days?|дн\w*)\s*(?:a|per|в)\s*(?:week|недел)\w*\s*(?:in|в)\s*(?:the\s+)?(?:office|офис)/i];
const RE_OFFICE = [/\bon[- ]?site\b/i, /\bin[- ]office\b/i, /\boffice[- ]based\b/i, /работа в офисе/i, /только офис/i, /\brelocation required\b/i];
const RE_REMOTE = [/\bremote\b/i, /\bwork from home\b/i, /\bwfh\b/i, /удал[её]нн/i, /можно удал[её]нно/i, /\bdistributed team\b/i];

function extractFormat(all: string, input: JobInput): { format: Fact<"remote" | "hybrid" | "office" | "unknown">; hybridCity: Fact<string | null> } {
  const hybridQ = firstQuote(all, RE_HYBRID);
  if (hybridQ) {
    const cityMatch = /hybrid[^.\n]{0,40}?\b(?:in|from)\s+([A-Z][a-zA-Z .-]{2,30})/.exec(all) || /гибрид\w*[^.\n]{0,30}?(?:в|г\.)\s*([А-ЯЁ][а-яё-]{2,30})/.exec(all);
    return { format: known("hybrid", hybridQ), hybridCity: cityMatch ? known(cityMatch[1].trim(), hybridQ) : unknown(null) };
  }
  const officeQ = firstQuote(all, RE_OFFICE);
  const remoteQ = firstQuote(all, RE_REMOTE);
  if (officeQ && !remoteQ) return { format: known("office", officeQ), hybridCity: unknown(null) };
  if (remoteQ) return { format: known("remote", remoteQ), hybridCity: unknown(null) };
  if (input.remoteBySource) return { format: known("remote", "Источник публикует только удалённые вакансии", "structured"), hybridCity: unknown(null) };
  return { format: unknown("unknown"), hybridCity: unknown(null) };
}

// ---------- География ----------
const RESTRICT = /(\bonly\b|must be (?:based|located)|based in|located in|resid(?:e|ent|ing) (?:in|of)|authori[sz]ed to work in|eligible to work in|right to work in|within the|hiring in|открыта для|только для|из стран|в странах)/i;
const EXCLUDE = /(except|excluding|exclude|not (?:available|eligible|open|able)|cannot (?:hire|employ|accept)|unable to (?:hire|employ)|sanction|кроме|за исключением|не рассматрива)/i;

function extractGeography(input: JobInput, body: string): VacancyFacts["geography"] {
  const allowed = new Set<string>();
  const excluded = new Set<string>();
  const labels: string[] = [];
  let scope: "worldwide" | "region" | "countries" | "unknown" = "unknown";
  let quote: string | null = null;
  let status: "structured" | "stated" | "unknown" = "unknown";

  const loc = detectPlaces(input.location || "");
  if (input.location) labels.push(input.location);
  // «US, UK + 35 other countries», «and more» — перечень неполный: отсутствие страны не означает запрет.
  const partial = /\+\s*\d+\s*(other\s+)?(countries|locations|more)|and\s+\d+\s+more|other countries|and more|etc\.?|и другие|и др\./i.test(input.location || "");
  if (loc.countries.length || loc.regions.length) {
    loc.countries.forEach((c) => allowed.add(c));
    loc.regions.forEach((r) => allowed.add(r));
    scope = loc.countries.length && !loc.regions.length ? "countries" : "region";
    quote = `Локация: ${input.location}`;
    status = "structured";
  } else if (loc.worldwide) {
    scope = "worldwide";
    quote = `Локация: ${input.location}`;
    status = "structured";
  }

  const sentences = body.split(/(?<=[.!?;])\s+|\n+/).slice(0, 400);
  for (const s of sentences) {
    if (s.length > 400) continue;
    const isExcl = EXCLUDE.test(s);
    const isRestr = RESTRICT.test(s);
    if (!isExcl && !isRestr) continue;
    const places = detectPlaces(s);
    if (!places.countries.length && !places.regions.length) continue;
    if (isExcl) {
      places.countries.forEach((c) => excluded.add(c));
      places.regions.forEach((r) => excluded.add(r));
    } else {
      // Ограничение в тексте сужает разрешённое множество.
      if (scope === "worldwide" || scope === "unknown") allowed.clear();
      places.countries.forEach((c) => allowed.add(c));
      places.regions.forEach((r) => allowed.add(r));
      scope = places.countries.length && !places.regions.length ? "countries" : "region";
    }
    quote = s.trim().slice(0, 220);
    status = "stated";
  }
  for (const e of excluded) allowed.delete(e);
  if (partial && allowed.size) allowed.add("PARTIAL");
  if (status === "unknown") return { value: { scope: "unknown", allowed: [], excluded: [], labels }, status: "unknown", quote: null };
  return { value: { scope, allowed: [...allowed], excluded: [...excluded], labels }, status, quote };
}

// ---------- Языки ----------
const LANGS: Array<{ lang: string; re: RegExp }> = [
  { lang: "en", re: /(english|английск)/i },
  { lang: "ru", re: /(russian|русск)/i },
  { lang: "de", re: /(german|немецк)/i },
  { lang: "fr", re: /(french|французск)/i },
  { lang: "es", re: /(spanish|испанск)/i },
  { lang: "it", re: /(italian|итальянск)/i },
  { lang: "pt", re: /(portuguese|португальск)/i },
  { lang: "zh", re: /(chinese|mandarin|китайск)/i },
];

/** Уровень языка. approx=true, если уровень выведен из прилагательного («fluent»), а не указан по CEFR. */
function levelFrom(s: string, langRe: RegExp): { level: Cefr | null; approx: boolean } {
  const t = s.toLowerCase();
  const cefr = /\b([abc][12])\b/i.exec(t);
  if (cefr) return { level: cefr[1].toUpperCase() as Cefr, approx: false };
  // «native» относится к языку, только если стоит рядом с ним (не «your native language»).
  const L = langRe.source;
  if (new RegExp(`(native|bilingual|mother tongue)[- ]?(level|speaker)?[^.,;]{0,12}${L}|${L}[^.,;]{0,12}(native|mother tongue)|родн\\w* ${L}|носител\\w* ${L}`, "i").test(t) && !/native language|your native|own native/.test(t)) return { level: "C2", approx: false };
  if (/fluent|fluency|excellent|advanced|proficient|full professional|свободн|продвинут/.test(t)) return { level: "C1", approx: true };
  if (/upper[- ]intermediate|professional working|strong|good command|выше среднего/.test(t)) return { level: "B2", approx: true };
  if (/intermediate|conversational|средн|разговорн/.test(t)) return { level: "B1", approx: true };
  if (/basic|elementary|базов|начальн/.test(t)) return { level: "A2", approx: true };
  return { level: null, approx: false };
}

const PREFERRED = /(nice to have|preferred|is a plus|a plus|bonus|advantage|desirable|ideally|будет плюсом|желательно|преимуществ|приветствуется)/i;
const SPOKEN = /(spoken|verbal|oral|speak|speaking|calls?|phone|разговорн|устн|говор)/i;

function extractLanguages(body: string, title: string): VacancyFacts["languages"] {
  const items: Array<{ lang: string; level: Cefr | null; required: boolean; spoken: boolean; approx: boolean }> = [];
  let quote: string | null = null;
  const sentences = body.split(/(?<=[.!?;])\s+|\n+/);
  for (const { lang, re } of LANGS) {
    for (const s of sentences) {
      if (!re.test(s) || s.length > 350) continue;
      // «English-speaking team» без требований — не требование к кандидату.
      if (!/(english|английск|russian|русск|german|немецк|french|французск|spanish|испанск|italian|итальянск|portuguese|португальск|chinese|mandarin|китайск)[^.]{0,40}(level|skills|proficien|fluen|speak|written|writing|communicat|уровн|язык|владени|знани|native|c1|c2|b1|b2)|(fluent|native|proficien|excellent|strong|advanced|уровн\w* [abc][12]|знани\w*|владени\w*)[^.]{0,40}(english|английск|russian|русск|german|немецк|french|французск|spanish|испанск)/i.test(s)) continue;
      const { level: lvl, approx } = levelFrom(s, re);
      const existing = items.find((i) => i.lang === lang);
      const entry = { lang, level: lvl, required: !PREFERRED.test(s), spoken: SPOKEN.test(s), approx };
      if (existing) {
        if (lvl && (!existing.level || lvl > existing.level || (lvl === existing.level && existing.approx && !approx))) {
          existing.level = lvl;
          existing.approx = approx;
        }
        existing.spoken ||= entry.spoken;
        existing.required ||= entry.required;
      } else items.push(entry);
      quote ??= s.trim().slice(0, 220);
    }
  }
  if (items.length) return known(items, quote);
  // Объявление на английском без явного требования: язык нужен, уровень не указан.
  const latin = (body.match(/[a-z]/gi) || []).length;
  const cyr = (body.match(/[а-яё]/gi) || []).length;
  if (latin > 200 && latin > cyr * 3) return { value: [{ lang: "en", level: null, required: true, spoken: false }], status: "unknown", quote: "Объявление на английском; уровень языка явно не указан" };
  if (cyr > 200 || /[а-яё]/i.test(title)) return { value: [{ lang: "ru", level: null, required: true, spoken: false }], status: "unknown", quote: "Объявление на русском; уровень языка явно не указан" };
  return unknown([]);
}

// ---------- Звонки/голос ----------
const RE_PHONE = [
  /\bcold[- ]call/i, /\boutbound call/i, /\binbound call/i, /\bphone support\b/i, /\banswer(?:ing)? (?:the )?phones?\b/i,
  /\bcall cent(?:er|re)\b/i, /\bphone calls?\b/i, /\bvoice support\b/i, /\btelesales\b/i, /\bover the phone\b/i,
  /холодн\w* звон/i, /обзвон/i, /колл[- ]?центр/i, /входящ\w* звон/i, /исходящ\w* звон/i, /звонк\w* клиент/i, /телефонн\w* (?:продаж|переговор|консультац|звонк)/i,
];
const RE_WRITTEN = [/\bnon[- ]voice\b/i, /\bno phone\b/i, /\bno calls\b/i, /\b(?:chat|email) (?:and|&|\/) (?:chat|email)\b/i, /\bwritten (?:support|communication)\b/i, /без звонков/i, /только переписк/i, /в чатах? и (?:по )?(?:почте|email)/i, /по email и в чат/i];

function extractVoice(all: string): VacancyFacts["voice"] {
  const writtenQ = firstQuote(all, RE_WRITTEN);
  const phoneQ = firstQuote(all, RE_PHONE);
  const cold = /cold[- ]call|холодн\w* звон|telesales/i.test(all);
  if (phoneQ && !(writtenQ && /без звонков|no calls|non[- ]voice|no phone/i.test(writtenQ))) return known({ phoneWork: "yes", coldCalls: cold, writtenOnly: false }, phoneQ);
  if (writtenQ) return known({ phoneWork: "no", coldCalls: false, writtenOnly: true }, writtenQ);
  return unknown({ phoneWork: "unknown", coldCalls: false, writtenOnly: false });
}

// ---------- Опыт ----------
const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|head of|director|architect|vp)\b|старш\w*|ведущ\w*|руководител\w*|главн\w*|тимлид/i;
const JUNIOR_TITLE = /\b(junior|jr\.?|entry[- ]level|graduate|trainee|assistant|associate)\b|младш\w*|начинающ\w*/i;
const INTERN_TITLE = /\b(intern|internship)\b|стаж[её]р\w*|стажировк\w*|практикант/i;
const ENTRY_BODY = [/\bentry[- ]level\b/i, /\bno (?:prior )?experience (?:required|needed|necessary)\b/i, /\btraining (?:is )?provided\b/i, /без опыта/i, /опыт не (?:требуется|обязателен|важен)/i, /обучени\w* (?:предусмотрен|за сч[её]т компании|с нуля)/i];

const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, один: 1, два: 2, двух: 2, три: 3, трех: 3, трёх: 3, пять: 5 };

export function extractYears(text: string): { years: number; quote: string } | null {
  const flat = text.replace(/\s+/g, " ");
  const res = [
    /(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:-|–|to)?\s*(?:\d{1,2}\s*)?\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:relevant\s+|professional\s+|work\s+|hands-on\s+|proven\s+|commercial\s+)?(?:experience|exp\b|in\b|working)/gi,
    /(?:at least|minimum(?: of)?|min\.?|no less than)\s*(\d{1,2}|one|two|three|four|five)\s*\+?\s*(?:years?|yrs?)/gi,
    /опыт\w*\s*(?:работы\s*)?(?:от|не менее|более)\s*(\d{1,2}|одного|двух|трех|трёх|пяти)(?:-х)?\s*(?:лет|года|год)/gi,
    /(\d{1,2})\+?\s*(?:лет|года|год)\s*(?:опыта|релевантного опыта|коммерческого опыта)/gi,
  ];
  let best: { years: number; quote: string } | null = null;
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat))) {
      const tok = m[1].toLowerCase();
      const n = /^\d+$/.test(tok) ? Number(tok) : NUM_WORDS[tok] ?? (tok === "одного" ? 1 : tok === "пяти" ? 5 : NaN);
      if (!Number.isFinite(n) || n > 25) continue;
      // Предпочтительный опыт («ideally 3 years») не является обязательным.
      const ctx = flat.slice(Math.max(0, m.index - 60), m.index + m[0].length + 20);
      if (PREFERRED.test(ctx)) continue;
      if (!best || n > best.years) best = { years: n, quote: ctx.trim() };
    }
  }
  return best;
}

function extractExperience(input: JobInput, body: string): VacancyFacts["experience"] {
  const titleLevel = `${input.title} ${input.levelText || ""}`;
  let seniority: "intern" | "junior" | "mid" | "senior" | "lead" | null = null;
  if (/\b(lead|head of|director|principal|vp)\b|руководител|тимлид/i.test(input.title)) seniority = "lead";
  else if (SENIOR_TITLE.test(titleLevel)) seniority = "senior";
  else if (INTERN_TITLE.test(titleLevel)) seniority = "intern";
  else if (JUNIOR_TITLE.test(titleLevel)) seniority = "junior";
  else if (/\b(middle|mid[- ]level)\b|мидл/i.test(titleLevel)) seniority = "mid";
  const years = extractYears(body);
  const entryQ = firstQuote(body, ENTRY_BODY);
  const quote = years?.quote ?? entryQ ?? (seniority ? `Название/уровень: ${titleLevel.trim()}` : null);
  if (!seniority && !years && !entryQ) return unknown({ yearsMin: null, seniority: null, entrySignal: false });
  return known({ yearsMin: years?.years ?? null, seniority, entrySignal: !!entryQ }, quote);
}

// ---------- Навыки ----------
export const SKILL_DICTIONARY: string[] = [
  "Excel", "Google Sheets", "Word", "PowerPoint", "SQL", "Python", "R", "JavaScript", "HTML", "CSS", "Git", "Linux",
  "Jira", "Confluence", "Notion", "Airtable", "Trello", "Asana", "CRM", "Salesforce", "HubSpot", "Zendesk", "Freshdesk",
  "Intercom", "Bitrix24", "amoCRM", "1C", "1С", "BPMN", "UML", "REST API", "Postman", "Power BI", "Tableau", "Figma",
  "Photoshop", "Canva", "AutoCAD", "КОМПАС", "KOMPAS", "DIALux", "Revit", "SolidWorks", "ChatGPT", "LLM", "prompt engineering",
  "data annotation", "data labeling", "labeling", "annotation", "Label Studio", "QA", "testing", "SEO", "WordPress",
  "Shopify", "Amazon", "Wildberries", "Ozon", "Google Analytics", "Looker", "Agile", "Scrum", "Kanban", "ERP", "SAP",
];

const REQ_HEAD = /(requirements|qualifications|what you(?:'|’)ll need|what we(?:'|’)re looking for|must[- ]have|you have|you bring|требования|мы ожидаем|что мы ждем|что мы ждём|необходим\w*|обязательн\w*)/i;
const PREF_HEAD = /(nice to have|preferred|bonus points|pluses|would be a plus|будет плюсом|желательно|преимуществом будет|приветствуется)/i;
const OTHER_HEAD = /(responsibilities|what you(?:'|’)ll do|about (?:us|the role|the company)|benefits|we offer|обязанности|задачи|условия|мы предлагаем|о компании)/i;

function skillHits(segment: string): string[] {
  const norm = normalizeText(segment);
  const out: string[] = [];
  for (const s of SKILL_DICTIONARY) {
    const n = normalizeText(s);
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, "u").test(norm)) out.push(s);
  }
  return out;
}

function extractSkills(body: string): VacancyFacts["skills"] {
  const lines = body.split(/\n+/);
  let mode: "req" | "pref" | "other" | "none" = "none";
  const req = new Set<string>();
  const pref = new Set<string>();
  const mentioned = new Set<string>();
  let quote: string | null = null;
  for (const line of lines) {
    const short = line.length < 80;
    if (short && PREF_HEAD.test(line)) mode = "pref";
    else if (short && REQ_HEAD.test(line)) mode = "req";
    else if (short && OTHER_HEAD.test(line)) mode = "other";
    const hits = skillHits(line);
    if (!hits.length) continue;
    const inlinePref = PREFERRED.test(line);
    for (const h of hits) {
      if (mode === "pref" || inlinePref) pref.add(h);
      else if (mode === "req") req.add(h);
      else mentioned.add(h);
    }
    quote ??= line.trim().slice(0, 200);
  }
  for (const r of req) {
    pref.delete(r);
    mentioned.delete(r);
  }
  for (const p of pref) mentioned.delete(p);
  if (!req.size && !pref.size && !mentioned.size) return unknown({ required: [], preferred: [], mentioned: [] });
  return known({ required: [...req], preferred: [...pref], mentioned: [...mentioned] }, quote);
}

// ---------- График ----------
function extractSchedule(body: string): VacancyFacts["schedule"] {
  const hours = parseWorkingHours(body);
  const weekly = /(\d{1,2})\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*(?:hours?|hrs?|час\w*)\s*(?:per|a|\/|в)\s*(?:week|wk|недел\w*)/i.exec(body);
  const flexQ = firstQuote(body, [/\bflexible (?:hours|schedule)\b/i, /\basync(?:hronous)?\b/i, /\bwork (?:at )?your own (?:pace|hours)\b/i, /гибк\w* график/i, /свободн\w* график/i]);
  if (!hours && !weekly && !flexQ) return unknown({ start: null, end: null, zone: null, weeklyMin: null, weeklyMax: null, flexible: false });
  const wmin = weekly ? Number(weekly[1]) : null;
  const wmax = weekly ? Number(weekly[2] || weekly[1]) : null;
  return known(
    { start: hours?.start ?? null, end: hours?.end ?? null, zone: hours?.zone ?? null, weeklyMin: wmin, weeklyMax: wmax, flexible: !!flexQ },
    hours?.quote ?? (weekly ? weekly[0] : null) ?? flexQ,
  );
}

// ---------- Политика AI ----------
const RE_NO_AI = [
  /(?:do not|don't|please don't|must not)\s+use\s+(?:ai|chatgpt|generative ai|llms?)/i,
  /ai[- ]generated\s+(?:applications?|responses?|answers?|cover letters?|resumes?|content)\s+(?:will|may)\s+(?:be\s+)?(?:rejected|disqualified|not be considered)/i,
  /without (?:the )?(?:use|help) of (?:ai|chatgpt)/i,
  /не используйте (?:нейросет|ии|ai|chatgpt)/i,
  /(?:ответы|отклики|резюме|письма),?\s+(?:созданные|сгенерированные|написанные)\s+(?:с помощью\s+)?(?:нейросет|ии|ai)/i,
];

// ---------- Дедлайн ----------
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12 };

export function extractDeadline(body: string): Fact<string | null> {
  const flat = body.replace(/\s+/g, " ");
  const ctx = /(deadline|apply by|applications? (?:close|due|accepted until)|closing date|last day to apply|при[её]м (?:заявок|откликов|резюме) до|заявки принимаются до|срок подачи)[^.]{0,60}/i.exec(flat);
  if (!ctx) return unknown(null);
  const s = ctx[0];
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (m) return known(`${m[1]}-${m[2]}-${m[3]}`, s);
  m = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s);
  if (m) return known(`${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`, s);
  m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return known(`${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`, s);
  m = /(\d{1,2})\s+([A-Za-zА-Яа-яё]{3})[a-zа-яё]*\.?,?\s+(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return known(`${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`, s);
  return { value: null, status: "stated", quote: s };
}

const RE_CLOSED = [
  /no longer accepting applications/i, /this (?:job|position|posting|role) (?:is )?(?:no longer available|has been filled|has expired|is closed)/i,
  /position (?:has been )?filled/i, /job (?:has )?expired/i, /вакансия закрыта/i, /вакансия (?:находится )?в архиве/i, /при[её]м откликов (?:завершен|завершён|закрыт)/i,
];

export function hasClosureText(text: string): string | null {
  return firstQuote(text, RE_CLOSED);
}

export function extractFacts(input: JobInput): VacancyFacts {
  const body = input.description || "";
  const all = [input.title, input.location, input.employmentType, input.levelText, body].filter(Boolean).join("\n");
  const lowerAll = all.toLowerCase();

  let salary: SalaryFact = UNKNOWN_SALARY;
  const s = input.salary;
  const structured = s ? structuredSalary(s) : null;
  const fromText = parseSalaryText([s?.text, body].filter(Boolean).join("\n"));
  if (structured) {
    salary = structured;
    if (fromText && !structured.period) salary = { ...structured, period: fromText.period, guaranteedHoursPerWeek: fromText.guaranteedHoursPerWeek };
    if (fromText?.guaranteedHoursPerWeek) salary = { ...salary, guaranteedHoursPerWeek: fromText.guaranteedHoursPerWeek };
    if (salary.period === "hour" && salary.kind !== "platform_estimate" && salary.kind !== "up_to") salary = { ...salary, kind: "hourly" };
  } else if (fromText) salary = fromText;

  const { format, hybridCity } = extractFormat(all, input);
  const contractQ = firstQuote(all, [/independent contractor/i, /\bcontractor\b/i, /\bb2b\b/i, /\bfreelanc/i, /самозанят/i, /\bгпх\b/i, /договор подряда/i]);
  const employQ = firstQuote(all, [/full[- ]time employee/i, /\bemployment contract\b/i, /по тк рф/i, /оформление по тк/i, /трудов\w* договор/i, /официальное трудоустройство/i]);
  const contract: Fact<"employment" | "contractor" | "freelance" | "unknown"> = employQ
    ? known("employment", employQ)
    : contractQ
      ? known(/freelanc/i.test(contractQ) ? "freelance" : "contractor", contractQ)
      : unknown("unknown");

  const upfront = /(upfront fee|registration fee|pay (?:for|a fee for) (?:the )?training|starter kit fee|взнос|оплатить обучение|платное обучение|купить доступ|оплатите курс)/i.test(lowerAll);
  const unpaid = /(\bunpaid\b|\bvolunteer\b|без оплаты|неоплачиваем|бесплатная стажировка)/i.test(lowerAll);
  const unsafe = /(telegram only|whatsapp only|crypto only|payment in crypto only|только в телеграм)/i.test(lowerAll);
  const safetyQ = firstQuote(all, [/upfront fee|registration fee|взнос|оплатить обучение|платное обучение/i, /\bunpaid\b|\bvolunteer\b|без оплаты|неоплачиваем/i, /telegram only|whatsapp only|crypto only/i]);

  const aiQ = firstQuote(body, RE_NO_AI);
  const closedQ = hasClosureText(body);

  return {
    extractorVersion: EXTRACTOR_VERSION,
    salary,
    format,
    hybridCity,
    geography: extractGeography(input, body),
    languages: extractLanguages(body, input.title),
    voice: extractVoice(all),
    experience: extractExperience(input, body),
    skills: extractSkills(body),
    schedule: extractSchedule(body),
    aiPolicy: aiQ ? known({ prohibitsAi: true }, aiQ) : unknown({ prohibitsAi: false }),
    deadline: extractDeadline(body),
    contract,
    safety: upfront || unpaid || unsafe ? known({ upfrontFee: upfront, unpaid, unsafeContact: unsafe }, safetyQ) : unknown({ upfrontFee: false, unpaid: false, unsafeContact: false }),
    closureText: closedQ ? known(true, closedQ) : unknown(false),
  };
}
