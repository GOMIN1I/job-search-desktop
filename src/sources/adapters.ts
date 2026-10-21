// Адаптеры поддержанных источников. Каждый адаптер знает формат ответа, пагинацию и честно сообщает покрытие.
// Условия использования проверены по официальным страницам источников 2026-10-21 (см. docs/SOURCES.md).

import type { Coverage, Msg, SourceKind } from "../shared/types";
import { msg } from "../shared/types";
import { decodeEntities, htmlToText, oneLine } from "../core/text";
import { httpGet, type FetchOptions, type Fetcher } from "./http";

export interface RawJob {
  sourceId: string;
  sourceJobId: string | null;
  title: string;
  company: string;
  url: string;
  applyUrl: string | null;
  description: string;
  location: string;
  employmentType: string | null;
  levelText: string | null;
  publishedAt: string | null;
  salary: { min?: number | string | null; max?: number | string | null; currency?: string | null; period?: string | null; text?: string | null; estimate?: boolean } | null;
  tags: string[];
  remoteBySource: boolean;
  isEmployerAts: boolean;
}

export interface SourceDefinition {
  id: string;
  kind: SourceKind;
  label: string;
  homepage: string;
  minIntervalMinutes: number;
  maxPages: number;
  coverageNote: Msg;
  termsNote: Msg;
  attribution: string;
  enabledByDefault: boolean;
}

export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    id: "jobicy", kind: "jobicy", label: "Jobicy", homepage: "https://jobicy.com", minIntervalMinutes: 360, maxPages: 1, enabledByDefault: true,
    coverageNote: msg("Удалённые вакансии за последние 7 дней; до 100 за проход (одна страница из нескольких)", "Remote jobs from the last 7 days; up to 100 per pass (one page of several)"),
    termsNote: msg("Автоматический проход не чаще раза в час; указывать Jobicy и ссылку на исходную карточку", "Automated pass at most hourly; credit Jobicy and link to the original posting"),
    attribution: "Jobicy",
  },
  {
    id: "remotive", kind: "remotive", label: "Remotive", homepage: "https://remotive.com", minIntervalMinutes: 360, maxPages: 1, enabledByDefault: true,
    coverageNote: msg("Публичный API с задержкой 24 ч; лимит 300 записей", "Public API delayed by 24 h; capped at 300 records"),
    termsNote: msg("Не чаще 4 раз в сутки (>2 запросов/мин блокируются); ссылка на Remotive обязательна", "At most 4 times per day (>2 requests/min are blocked); link back to Remotive"),
    attribution: "Remotive",
  },
  {
    id: "remoteok", kind: "remoteok", label: "Remote OK", homepage: "https://remoteok.com", minIntervalMinutes: 720, maxPages: 1, enabledByDefault: true,
    coverageNote: msg("Последние ~100 объявлений ленты; старше — не видны", "Latest ~100 feed items; older ones are not visible"),
    termsNote: msg("Ссылка на Remote OK и указание источника обязательны", "Link to Remote OK and name it as the source"),
    attribution: "Remote OK",
  },
  {
    id: "himalayas", kind: "himalayas", label: "Himalayas", homepage: "https://himalayas.app", minIntervalMinutes: 1440, maxPages: 3, enabledByDefault: true,
    coverageNote: msg("По 20 на страницу (максимум API), cursor-пагинация; за проход 3 страницы из ~6 000+; данные обновляются раз в 24 ч", "20 per page (API maximum), cursor pagination; 3 pages per pass out of 6,000+; data refreshes every 24 h"),
    termsNote: msg("Видимая атрибуция Himalayas; кнопка отклика ведёт на applicationLink; не передавать в другие доски", "Visible Himalayas credit; Apply uses applicationLink; do not redistribute to other boards"),
    attribution: "Himalayas",
  },
  {
    id: "workingnomads", kind: "workingnomads", label: "Working Nomads", homepage: "https://www.workingnomads.com", minIntervalMinutes: 720, maxPages: 1, enabledByDefault: true,
    coverageNote: msg("Публичная JSON-лента последних объявлений (несколько десятков)", "Public JSON feed of recent postings (a few dozen)"),
    termsNote: msg("Официальных лимитов не опубликовано; опрос не чаще 2 раз в сутки, ссылка на источник", "No published limits; polled at most twice a day, link back to the source"),
    attribution: "Working Nomads",
  },
  {
    id: "weworkremotely", kind: "weworkremotely", label: "We Work Remotely", homepage: "https://weworkremotely.com", minIntervalMinutes: 720, maxPages: 1, enabledByDefault: true,
    coverageNote: msg("RSS всех категорий — только текущая первая страница ленты", "All-categories RSS — only the current first page of the feed"),
    termsNote: msg("Публичный RSS; ссылка на исходную карточку WWR", "Public RSS; link to the original WWR posting"),
    attribution: "We Work Remotely",
  },
  {
    id: "habrcareer", kind: "habrcareer", label: "Хабр Карьера", homepage: "https://career.habr.com", minIntervalMinutes: 720, maxPages: 2, enabledByDefault: true,
    coverageNote: msg("RSS новых вакансий, 2 страницы (фактически ~50 на страницу); краткое описание, полный текст — на карточке", "RSS of new vacancies, 2 pages (about 50 per page in practice); short summary, full text on the posting"),
    termsNote: msg("Публичный RSS Хабр Карьеры; ссылка на исходную карточку", "Public Habr Career RSS; link to the original posting"),
    attribution: "Хабр Карьера",
  },
  {
    id: "ats", kind: "ats", label: "Компании (Greenhouse / Lever / Ashby)", homepage: "", minIntervalMinutes: 1440, maxPages: 25, enabledByDefault: true,
    coverageNote: msg("Полные публичные доски выбранных компаний; до 25 компаний за проход", "Full public boards of selected companies; up to 25 companies per pass"),
    termsNote: msg("Публичные Job Board API самих ATS; 1 запрос на компанию в сутки, пауза между компаниями", "Official public job-board APIs of the ATS; 1 request per company per day, pause between companies"),
    attribution: "",
  },
];

export interface CollectResult {
  items: RawJob[];
  coverage: Coverage;
  httpStatus: number | null;
  /** Ошибка части страниц: итог считается частичным, а не успешным. */
  partialError: string | null;
}

export interface CollectContext {
  fetchOpts: FetchOptions;
  fetcher?: Fetcher;
  maxPages: number;
  companies?: Array<{ name: string; atsKind: string; atsSlug: string }>;
  pauseMs?: number;
}

const arr = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v === null || v === undefined || (v as unknown) === "" ? [] : [v]);
const isoOrNull = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};
const CP_CHARS = Object.keys(CP1252).join("");
const MOJIBAKE_RE = new RegExp(`[\u00c2-\u00f4][\u0080-\u00bf${CP_CHARS}]{1,3}`, "g");

/** Исправление «двойной» кодировки UTF-8→Windows-1252 (встречается в Remote OK: «â€”» вместо «—»). */
export function repairMojibake(s: string): string {
  if (!MOJIBAKE_RE.test(s)) return s;
  MOJIBAKE_RE.lastIndex = 0;
  return s.replace(MOJIBAKE_RE, (seq) => {
    const bytes = [...seq].map((c) => CP1252[c] ?? c.charCodeAt(0));
    if (bytes.some((b) => b > 0xff)) return seq;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return seq;
    }
  });
}

function jsonOf(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: ответ не JSON / response is not JSON`);
  }
}

// ---------- Парсеры (чистые функции, тестируются на фикстурах) ----------

export function parseJobicy(payload: any): { items: RawJob[]; next: string | null } {
  const items = arr(payload?.jobs).map((r: any): RawJob => ({
    sourceId: "jobicy",
    sourceJobId: r.id == null ? null : String(r.id),
    title: oneLine(r.jobTitle),
    company: oneLine(r.companyName),
    url: r.url,
    applyUrl: r.url,
    description: htmlToText(r.jobDescription || r.jobExcerpt),
    location: oneLine(r.jobGeo),
    employmentType: arr(r.jobType).join(", ") || null,
    levelText: r.jobLevel ?? null,
    publishedAt: isoOrNull(r.pubDate),
    salary: r.salaryMin || r.salaryMax ? { min: r.salaryMin, max: r.salaryMax, currency: r.salaryCurrency, period: r.salaryPeriod } : null,
    tags: arr(r.jobIndustry).map(String),
    remoteBySource: true,
    isEmployerAts: false,
  }));
  return { items, next: payload?.hasMore ? payload?.nextCursor ?? null : null };
}

export function parseRemotive(payload: any): RawJob[] {
  return arr(payload?.jobs).map((r: any): RawJob => ({
    sourceId: "remotive",
    sourceJobId: r.id == null ? null : String(r.id),
    title: oneLine(r.title),
    company: oneLine(r.company_name),
    url: r.url,
    applyUrl: r.url,
    description: htmlToText(r.description),
    location: oneLine(r.candidate_required_location),
    employmentType: r.job_type ?? null,
    levelText: null,
    publishedAt: isoOrNull(r.publication_date ? `${r.publication_date}${/Z|[+-]\d\d:?\d\d$/.test(r.publication_date) ? "" : "Z"}` : null),
    salary: r.salary ? { text: String(r.salary) } : null,
    tags: [r.category, ...arr(r.tags)].filter(Boolean).map(String),
    remoteBySource: true,
    isEmployerAts: false,
  }));
}

export function parseRemoteOk(payload: any): RawJob[] {
  return arr(payload)
    .filter((r: any) => r && (r.position || r.company) && r.id)
    .map((r: any): RawJob => ({
      sourceId: "remoteok",
      sourceJobId: String(r.id),
      title: repairMojibake(oneLine(r.position)),
      company: repairMojibake(oneLine(r.company)),
      url: r.url || r.apply_url,
      applyUrl: r.apply_url || r.url,
      description: repairMojibake(htmlToText(r.description)),
      location: oneLine(r.location) || "Remote (location not specified)",
      employmentType: null,
      levelText: null,
      publishedAt: isoOrNull(r.date || r.epoch),
      salary: Number(r.salary_min) > 0 || Number(r.salary_max) > 0 ? { min: r.salary_min, max: r.salary_max, currency: "USD", period: "year" } : null,
      tags: arr(r.tags).map(String),
      remoteBySource: true,
      isEmployerAts: false,
    }));
}

export function parseHimalayas(payload: any): { items: RawJob[]; next: string | null; total: number | null } {
  const items = arr(payload?.jobs).map((r: any): RawJob => {
    const restrictions = arr(r.locationRestrictions).map((v: any) => (typeof v === "string" ? v : v?.name || v?.alpha2 || "")).filter(Boolean);
    return {
      sourceId: "himalayas",
      sourceJobId: r.guid || null,
      title: oneLine(r.title),
      company: oneLine(r.companyName),
      url: r.guid || r.applicationLink,
      applyUrl: r.applicationLink || r.guid,
      description: htmlToText(r.description || r.excerpt),
      location: restrictions.length ? restrictions.join(", ") : "Worldwide",
      employmentType: r.employmentType ?? null,
      levelText: arr(r.seniority).join(", ") || null,
      publishedAt: isoOrNull(r.pubDate),
      salary: r.minSalary || r.maxSalary ? { min: r.minSalary, max: r.maxSalary, currency: r.currency, period: r.salaryPeriod } : null,
      tags: [...arr(r.categories), ...arr(r.parentCategories)].map(String),
      remoteBySource: true,
      isEmployerAts: false,
    };
  });
  return { items, next: payload?.nextCursor ?? null, total: typeof payload?.totalCount === "number" ? payload.totalCount : null };
}

export function parseWorkingNomads(payload: any): RawJob[] {
  return arr(payload).map((r: any): RawJob => {
    const tags = typeof r.tags === "string" ? r.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : arr(r.tags).map((t: any) => (typeof t === "string" ? t : t?.name || ""));
    const m = /\/job\/go\/(\d+)/.exec(String(r.url || ""));
    return {
      sourceId: "workingnomads",
      sourceJobId: m ? m[1] : r.id != null ? String(r.id) : null,
      title: oneLine(r.title),
      company: oneLine(r.company_name),
      url: r.url,
      applyUrl: r.url,
      description: htmlToText(r.description),
      location: oneLine(r.location) || "Remote (location not specified)",
      employmentType: null,
      levelText: null,
      publishedAt: isoOrNull(r.pub_date),
      salary: null,
      tags: [r.category_name, ...tags].filter(Boolean),
      remoteBySource: true,
      isEmployerAts: false,
    };
  });
}

function rssTag(item: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(item);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function rssItems(xml: string): string[] {
  return String(xml).match(/<item>[\s\S]*?<\/item>/gi) || [];
}

export function parseWwr(xml: string): RawJob[] {
  return rssItems(xml).map((item, i): RawJob => {
    const full = oneLine(decodeEntities(rssTag(item, "title")));
    const sep = full.indexOf(":");
    const company = sep > 0 ? full.slice(0, sep).trim() : "";
    const title = sep > 0 ? full.slice(sep + 1).trim() : full;
    const url = oneLine(rssTag(item, "link") || rssTag(item, "guid"));
    const region = oneLine(decodeEntities(rssTag(item, "region")));
    const country = oneLine(decodeEntities(rssTag(item, "country"))).replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").trim();
    return {
      sourceId: "weworkremotely",
      sourceJobId: url || `wwr-${i}`,
      title,
      company,
      url,
      applyUrl: url,
      description: htmlToText(decodeEntities(rssTag(item, "description"))),
      location: [region, country].filter(Boolean).join(" · ") || "Remote (location not specified)",
      employmentType: oneLine(rssTag(item, "type")) || null,
      levelText: null,
      publishedAt: isoOrNull(rssTag(item, "pubDate")),
      salary: null,
      tags: [rssTag(item, "category"), rssTag(item, "skills")].map((t) => oneLine(decodeEntities(t))).filter(Boolean),
      remoteBySource: true,
      isEmployerAts: false,
    };
  });
}

export function parseHabr(xml: string): RawJob[] {
  return rssItems(xml).map((item, i): RawJob => {
    const rawTitle = oneLine(decodeEntities(rssTag(item, "title")));
    const tm = /«([^»]+)»/u.exec(rawTitle);
    const description = oneLine(decodeEntities(rssTag(item, "description")));
    const url = oneLine(rssTag(item, "link"));
    const locations = [...description.matchAll(/([\p{Lu}][\p{L}\s.-]*?)\s*\(([\p{L}\s-]+)\)/gu)].map((m) => `${m[1].trim()} (${m[2].trim()})`);
    const remote = /Можно удал[её]нно/iu.test(description);
    const flat = description.replace(/[\u00a0\u202f]/g, " ");
    const sal = [null, /(?:^|\s)От\s+(\d[\d\s]*?)\s*₽/iu.exec(flat)?.[1], /(?:^|\s)до\s+(\d[\d\s]*?)\s*₽/iu.exec(flat)?.[1]];
    const n = (v?: string | null) => (v ? Number(v.replace(/\s+/g, "")) : null);
    const level = ["intern", "junior", "middle", "senior", "lead"].find((v) => new RegExp(`#${v}(?:[,\\s.]|$)`, "i").test(description)) || null;
    const min = n(sal?.[1]);
    const max = n(sal?.[2]);
    return {
      sourceId: "habrcareer",
      sourceJobId: oneLine(rssTag(item, "guid")) || url || `habr-${i}`,
      title: tm ? tm[1].trim() : rawTitle.replace(/^Требуется\s+/iu, "").trim(),
      company: oneLine(decodeEntities(rssTag(item, "author"))),
      url,
      applyUrl: url,
      description,
      location: [...locations, remote ? "Можно удалённо" : null].filter(Boolean).join(" · ") || "Не указано",
      employmentType: /Неполный рабочий день/iu.test(description) ? "Part-time" : /Полный рабочий день/iu.test(description) ? "Full-time" : null,
      levelText: level,
      publishedAt: isoOrNull(rssTag(item, "pubDate")),
      salary: min || max ? { min, max, currency: "RUB", period: "month" } : null,
      tags: description.match(/#[\p{L}\p{N}:/.+-]+/gu) || [],
      remoteBySource: false,
      isEmployerAts: false,
    };
  });
}

export function parseGreenhouse(payload: any, companyName: string, slug: string): RawJob[] {
  return arr(payload?.jobs).map((r: any): RawJob => ({
    sourceId: "ats",
    sourceJobId: `greenhouse:${slug}:${r.id}`,
    title: oneLine(r.title),
    company: companyName || oneLine(r.company_name) || slug,
    url: r.absolute_url,
    applyUrl: r.absolute_url,
    description: htmlToText(decodeEntities(String(r.content || ""))),
    location: oneLine(r.location?.name),
    employmentType: null,
    levelText: null,
    publishedAt: isoOrNull(r.first_published || r.updated_at),
    salary: null,
    tags: arr(r.departments).map((d: any) => d?.name).filter(Boolean),
    remoteBySource: false,
    isEmployerAts: true,
  }));
}

export function parseLever(payload: any, companyName: string, slug: string): RawJob[] {
  return arr(payload).map((r: any): RawJob => {
    const lists = arr(r.lists).map((l: any) => `${l.text}\n${htmlToText(l.content)}`).join("\n\n");
    const sr = r.salaryRange;
    return {
      sourceId: "ats",
      sourceJobId: `lever:${slug}:${r.id}`,
      title: oneLine(r.text),
      company: companyName || slug,
      url: r.hostedUrl,
      applyUrl: r.applyUrl || r.hostedUrl,
      description: [htmlToText(r.description || r.descriptionPlain), lists, htmlToText(r.additional)].filter(Boolean).join("\n\n"),
      location: [r.categories?.location, ...arr(r.categories?.allLocations)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") || (r.workplaceType === "remote" ? "Remote" : ""),
      employmentType: r.categories?.commitment ?? null,
      levelText: null,
      publishedAt: isoOrNull(r.createdAt),
      salary: sr && (sr.min || sr.max) ? { min: sr.min, max: sr.max, currency: sr.currency, period: sr.interval } : null,
      tags: [r.categories?.team, r.categories?.department, r.workplaceType].filter(Boolean),
      remoteBySource: false,
      isEmployerAts: true,
    };
  });
}

export function parseAshby(payload: any, companyName: string, slug: string): RawJob[] {
  return arr(payload?.jobs)
    .filter((r: any) => r.isListed !== false)
    .map((r: any): RawJob => ({
      sourceId: "ats",
      sourceJobId: `ashby:${slug}:${r.id}`,
      title: oneLine(r.title),
      company: companyName || slug,
      url: r.jobUrl,
      applyUrl: r.applyUrl || r.jobUrl,
      description: htmlToText(r.descriptionHtml || r.descriptionPlain),
      location: [r.location, ...arr(r.secondaryLocations).map((l: any) => l?.location)].filter(Boolean).join(", ") + (r.isRemote ? " · Remote" : ""),
      employmentType: r.employmentType ?? null,
      levelText: null,
      publishedAt: isoOrNull(r.publishedAt),
      salary: r.compensation?.summaryComponents?.[0]
        ? (() => {
            const c = r.compensation.summaryComponents[0];
            return { min: c.minValue, max: c.maxValue, currency: c.currencyCode, period: c.interval };
          })()
        : null,
      tags: [r.department, r.team].filter(Boolean),
      remoteBySource: false,
      isEmployerAts: true,
    }));
}

export function atsBoardUrl(kind: string, slug: string): string | null {
  const s = encodeURIComponent(slug.trim());
  if (kind === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`;
  if (kind === "lever") return `https://api.lever.co/v0/postings/${s}?mode=json`;
  if (kind === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`;
  return null;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Отменено"));
    }, { once: true });
  });

// ---------- Сбор ----------

export async function collect(def: SourceDefinition, ctx: CollectContext): Promise<CollectResult> {
  const get = (url: string, accept?: string) => httpGet(url, { ...ctx.fetchOpts, accept }, ctx.fetcher);
  const ensureOk = (status: number, label: string) => {
    if (status < 200 || status >= 300) throw Object.assign(new Error(`${label}: HTTP ${status}`), { httpStatus: status });
  };
  const pages = Math.max(1, Math.min(def.maxPages, ctx.maxPages));
  const win = (ru: string, en: string) => msg(ru, en);
  switch (def.kind) {
    case "jobicy": {
      const r = await get("https://jobicy.com/api/jobs?count=100");
      ensureOk(r.status, def.label);
      const p = parseJobicy(jsonOf(r.text, def.label));
      return { items: p.items, httpStatus: r.status, partialError: null, coverage: { pagesRequested: 1, pagesFetched: 1, perPageLimit: 100, itemsReturned: p.items.length, exhausted: !p.next, window: win("последние 7 дней", "last 7 days") } };
    }
    case "remotive": {
      const r = await get("https://remotive.com/api/remote-jobs?limit=300");
      ensureOk(r.status, def.label);
      const items = parseRemotive(jsonOf(r.text, def.label));
      return { items, httpStatus: r.status, partialError: null, coverage: { pagesRequested: 1, pagesFetched: 1, perPageLimit: 300, itemsReturned: items.length, exhausted: items.length < 300, window: win("задержка 24 ч", "24 h delay") } };
    }
    case "remoteok": {
      const r = await get("https://remoteok.com/api");
      ensureOk(r.status, def.label);
      const items = parseRemoteOk(jsonOf(r.text, def.label));
      return { items, httpStatus: r.status, partialError: null, coverage: { pagesRequested: 1, pagesFetched: 1, perPageLimit: null, itemsReturned: items.length, exhausted: false, window: win("последние объявления ленты", "latest feed items") } };
    }
    case "workingnomads": {
      const r = await get("https://www.workingnomads.com/api/exposed_jobs/");
      ensureOk(r.status, def.label);
      const items = parseWorkingNomads(jsonOf(r.text, def.label));
      return { items, httpStatus: r.status, partialError: null, coverage: { pagesRequested: 1, pagesFetched: 1, perPageLimit: null, itemsReturned: items.length, exhausted: false, window: win("последние объявления ленты", "latest feed items") } };
    }
    case "weworkremotely": {
      const r = await get("https://weworkremotely.com/remote-jobs.rss", "application/rss+xml, application/xml, text/xml");
      ensureOk(r.status, def.label);
      const items = parseWwr(r.text);
      return { items, httpStatus: r.status, partialError: null, coverage: { pagesRequested: 1, pagesFetched: 1, perPageLimit: null, itemsReturned: items.length, exhausted: false, window: win("первая страница RSS", "first RSS page") } };
    }
    case "himalayas": {
      const items: RawJob[] = [];
      let cursor: string | null = null;
      let fetched = 0;
      let status: number | null = null;
      let partialError: string | null = null;
      let exhausted = false;
      for (let i = 0; i < pages; i++) {
        try {
          const url: string = `https://himalayas.app/jobs/api?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const r = await get(url);
          status = r.status;
          ensureOk(r.status, def.label);
          const p = parseHimalayas(jsonOf(r.text, def.label));
          items.push(...p.items);
          fetched++;
          cursor = p.next;
          if (!cursor) {
            exhausted = true;
            break;
          }
          await wait(ctx.pauseMs ?? 1200, ctx.fetchOpts.signal);
        } catch (e) {
          if (fetched === 0) throw e;
          partialError = (e as Error).message;
          break;
        }
      }
      return { items, httpStatus: status, partialError, coverage: { pagesRequested: pages, pagesFetched: fetched, perPageLimit: 20, itemsReturned: items.length, exhausted, window: win("новые сверху, кэш 24 ч", "newest first, 24 h cache") } };
    }
    case "habrcareer": {
      const items: RawJob[] = [];
      let fetched = 0;
      let status: number | null = null;
      let partialError: string | null = null;
      for (let i = 1; i <= pages; i++) {
        try {
          const r = await get(`https://career.habr.com/vacancies/rss?page=${i}&per_page=25`, "application/rss+xml, application/xml, text/xml");
          status = r.status;
          ensureOk(r.status, def.label);
          const got = parseHabr(r.text);
          items.push(...got);
          fetched++;
          if (!got.length) break;
          if (i < pages) await wait(ctx.pauseMs ?? 1200, ctx.fetchOpts.signal);
        } catch (e) {
          if (fetched === 0) throw e;
          partialError = (e as Error).message;
          break;
        }
      }
      return { items, httpStatus: status, partialError, coverage: { pagesRequested: pages, pagesFetched: fetched, perPageLimit: null, itemsReturned: items.length, exhausted: false, window: win("новые вакансии RSS", "new vacancies RSS") } };
    }
    case "ats": {
      const companies = (ctx.companies ?? []).slice(0, pages);
      if (!companies.length) throw Object.assign(new Error("not_configured"), { notConfigured: true });
      const items: RawJob[] = [];
      const errors: string[] = [];
      let fetched = 0;
      for (const c of companies) {
        const url = atsBoardUrl(c.atsKind, c.atsSlug);
        if (!url) {
          errors.push(`${c.name}: неизвестный ATS ${c.atsKind}`);
          continue;
        }
        try {
          const r = await get(url);
          if (r.status === 404) {
            errors.push(`${c.name}: доска не найдена (HTTP 404) / board not found`);
            continue;
          }
          ensureOk(r.status, c.name);
          const data = jsonOf(r.text, c.name);
          const got = c.atsKind === "greenhouse" ? parseGreenhouse(data, c.name, c.atsSlug) : c.atsKind === "lever" ? parseLever(data, c.name, c.atsSlug) : parseAshby(data, c.name, c.atsSlug);
          items.push(...got);
          fetched++;
        } catch (e) {
          if (ctx.fetchOpts.signal?.aborted) throw e;
          errors.push(`${c.name}: ${(e as Error).message}`);
        }
        await wait(ctx.pauseMs ?? 800, ctx.fetchOpts.signal);
      }
      if (!fetched && errors.length) throw new Error(errors.join("; "));
      return {
        items,
        httpStatus: 200,
        partialError: errors.length ? errors.join("; ") : null,
        coverage: { pagesRequested: companies.length, pagesFetched: fetched, perPageLimit: null, itemsReturned: items.length, exhausted: true, window: win("все открытые на досках компаний", "all open roles on company boards") },
      };
    }
    default:
      throw new Error(`Нет адаптера для источника ${def.kind}`);
  }
}
