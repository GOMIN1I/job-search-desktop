import type { SearchRules, Vacancy } from "../src/shared/types";
import { emptyRules, ROLE_TEMPLATES, trackFromTemplate } from "../src/core/templates";
import { normalizeRaw } from "../src/pipeline/normalize";
import type { RawJob } from "../src/sources/adapters";
import { DEFAULT_EXCLUDED_HOSTS, type ExcludedHost } from "../src/core/policy";

export const NOW = new Date("2026-10-21T08:00:00Z");

export function raw(p: Partial<RawJob> & { title: string; description: string }): RawJob {
  return {
    sourceId: "fixture",
    sourceJobId: p.sourceJobId ?? p.title,
    company: "Synthetic Co",
    url: `https://jobs.example.com/${encodeURIComponent(p.title)}`,
    applyUrl: null,
    location: "Worldwide",
    employmentType: null,
    levelText: null,
    publishedAt: "2026-10-20T08:00:00Z",
    salary: null,
    tags: [],
    remoteBySource: true,
    isEmployerAts: false,
    ...p,
  };
}

export function vac(p: Partial<RawJob> & { title: string; description: string }, excluded: ExcludedHost[] = DEFAULT_EXCLUDED_HOSTS): Vacancy {
  const r = normalizeRaw(raw(p), excluded, NOW);
  if (!r.ok) throw new Error(`normalize failed: ${r.detail}`);
  return r.vacancy;
}

/** Синтетический кандидат: живёт в России, удалёнка, минимум 25 000 ₽ или $500, письменная работа. */
export function rulesRu(over: Partial<SearchRules> = {}): SearchRules {
  const base = emptyRules();
  return {
    ...base,
    tracks: ["ai-annotation", "written-support", "ba"].map((id) => trackFromTemplate(ROLE_TEMPLATES.find((t) => t.id === id)!)),
    location: { country: "RU", city: "Самара", timezone: "Europe/Samara" },
    countryEligibility: { mode: "hard" },
    workFormat: { mode: "hard", remote: true, hybrid: true, office: false, hybridCities: ["Самара"] },
    pay: { mode: "hard", minimums: [{ currency: "RUB", amountMonthly: 25000 }, { currency: "USD", amountMonthly: 500 }] },
    hours: { mode: "hard", earliestLocal: "08:00", latestLocal: "23:00", maxWeeklyHours: 40 },
    languages: { mode: "hard", items: [{ lang: "en", written: "B2", spoken: "B1", basis: "self_reported" }, { lang: "ru", written: "C2", spoken: "C2", basis: "certified" }] },
    voice: { mode: "hard", noPhoneWork: true, noVoiceScreening: true },
    experience: { mode: "hard", maxYearsRequired: 1, allowSenior: false },
    excludedKeywords: ["gambling", "casino"],
    freshnessDays: 30,
    ...over,
  };
}
