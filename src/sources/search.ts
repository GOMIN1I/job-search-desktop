// Источники с поиском по запросу и постраничной выдачей: hh.ru (официальный API, нужен OAuth-токен),
// Adzuna (ключ пользователя), The Muse, Arbeitnow, поиск Himalayas, Remotive и Jobicy.
// Запросы строятся из направлений, которые человек выбрал в профиле, поэтому выдача не ограничена «последними в ленте».

import { htmlToText, oneLine } from "../core/text";
import type { RawJob } from "./adapters";

const arr = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const iso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------- hh.ru ----------

/** ISO-код страны → id региона hh.ru (верхний уровень справочника /areas). */
export const HH_AREAS: Record<string, number> = { RU: 113, UA: 5, KZ: 40, BY: 16, UZ: 97, AZ: 9, GE: 28, KG: 48, AM: 1, MD: 2788, TJ: 2112, TM: 2113 };

export function parseHh(payload: any): { items: RawJob[]; pages: number; found: number } {
  const items = arr(payload?.items).map((r: any): RawJob => {
    const snippet = [r.snippet?.responsibility, r.snippet?.requirement].filter(Boolean).map((x: string) => htmlToText(x)).join("\n");
    const formats = arr(r.work_format).map((f: any) => f?.id).filter(Boolean);
    const remote = r.schedule?.id === "remote" || formats.includes("REMOTE");
    const conditions = [r.schedule?.name, r.employment?.name, r.experience?.name, ...arr(r.work_format).map((f: any) => f?.name)].filter(Boolean).join(", ");
    return {
      sourceId: "hh",
      sourceJobId: r.id == null ? null : String(r.id),
      title: oneLine(r.name),
      company: oneLine(r.employer?.name),
      url: r.alternate_url || `https://hh.ru/vacancy/${r.id}`,
      applyUrl: r.apply_alternate_url || r.alternate_url || null,
      description: [snippet, conditions].filter(Boolean).join("\n"),
      location: oneLine(r.area?.name) + (remote ? " (удалённо / remote)" : ""),
      employmentType: r.employment?.name ?? null,
      levelText: r.experience?.name ?? null,
      publishedAt: iso(r.published_at),
      salary: r.salary && (r.salary.from || r.salary.to)
        ? { min: r.salary.from, max: r.salary.to, currency: r.salary.currency === "RUR" ? "RUB" : r.salary.currency, period: "month", text: r.salary.gross ? "до вычета налогов / gross" : null }
        : null,
      tags: [r.professional_roles?.[0]?.name].filter(Boolean),
      remoteBySource: remote,
      isEmployerAts: false,
    };
  });
  return { items, pages: Number(payload?.pages) || 0, found: Number(payload?.found) || 0 };
}

// ---------- Adzuna ----------

export const ADZUNA_COUNTRIES = ["gb", "us", "at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "in", "it", "mx", "nl", "nz", "pl", "sg", "za"];

export function parseAdzuna(payload: any): { items: RawJob[]; count: number } {
  const items = arr(payload?.results).map((r: any): RawJob => ({
    sourceId: "adzuna",
    sourceJobId: r.id == null ? null : String(r.id),
    title: oneLine(htmlToText(r.title)),
    company: oneLine(r.company?.display_name),
    url: r.redirect_url,
    applyUrl: r.redirect_url,
    description: htmlToText(r.description),
    location: oneLine(r.location?.display_name),
    employmentType: r.contract_time ?? null,
    levelText: null,
    publishedAt: iso(r.created),
    // Оценка площадки (salary_is_predicted) не считается подтверждённой оплатой
    salary: r.salary_min || r.salary_max ? { min: r.salary_min, max: r.salary_max, currency: null, period: "year", estimate: String(r.salary_is_predicted) === "1" } : null,
    tags: [r.category?.label].filter(Boolean),
    remoteBySource: false,
    isEmployerAts: false,
  }));
  return { items, count: Number(payload?.count) || 0 };
}

// ---------- The Muse ----------

export function parseMuse(payload: any): { items: RawJob[]; pageCount: number } {
  const items = arr(payload?.results).map((r: any): RawJob => {
    const locations = arr(r.locations).map((l: any) => l?.name).filter(Boolean);
    return {
      sourceId: "themuse",
      sourceJobId: r.id == null ? null : String(r.id),
      title: oneLine(r.name),
      company: oneLine(r.company?.name),
      url: r.refs?.landing_page,
      applyUrl: r.refs?.landing_page ?? null,
      description: htmlToText(r.contents),
      location: locations.join(", ") || "Not specified",
      employmentType: null,
      levelText: arr(r.levels).map((l: any) => l?.name).filter(Boolean).join(", ") || null,
      publishedAt: iso(r.publication_date),
      salary: null,
      tags: arr(r.categories).map((c: any) => c?.name).filter(Boolean),
      remoteBySource: locations.length > 0 && locations.every((l: string) => /remote/i.test(l)),
      isEmployerAts: false,
    };
  });
  return { items, pageCount: Number(payload?.page_count) || 0 };
}

// ---------- Arbeitnow ----------

export function parseArbeitnow(payload: any): { items: RawJob[]; next: string | null } {
  const items = arr(payload?.data).map((r: any): RawJob => ({
    sourceId: "arbeitnow",
    sourceJobId: r.slug ?? null,
    title: oneLine(r.title),
    company: oneLine(r.company_name),
    url: r.url,
    applyUrl: r.url,
    description: htmlToText(r.description),
    location: oneLine(r.location) + (r.remote ? " (remote)" : ""),
    employmentType: arr(r.job_types).join(", ") || null,
    levelText: null,
    publishedAt: iso(r.created_at),
    salary: null,
    tags: arr(r.tags).map(String),
    remoteBySource: !!r.remote,
    isEmployerAts: false,
  }));
  return { items, next: payload?.links?.next ?? null };
}

/** Поисковые запросы из профилей: по 1–2 главные фразы каждого включённого направления, без повторов. */
export function buildQueries(tracks: Array<{ enabled: boolean; titleKeywords: string[] }>, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Первые фразы всех направлений, затем вторые — чтобы каждое направление попало в лимит
  for (let round = 0; round < 2; round++) {
    for (const t of tracks) {
      if (!t.enabled) continue;
      const k = (t.titleKeywords[round] ?? "").trim();
      if (!k || k.length < 3) continue;
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(k);
      if (out.length >= max) return out;
    }
  }
  return out;
}
