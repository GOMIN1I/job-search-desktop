// Нормализация сырых записей источника в Vacancy: политика источников, канонический URL, факты, тип объявления, жизненный цикл.

import type { LifecycleEvidence, Vacancy } from "../shared/types";
import { msg } from "../shared/types";
import { blockedReason, canonicalizeUrl, requisitionFromUrl, type ExcludedHost } from "../core/policy";
import { extractFacts } from "../core/facts";
import { classifyPosting, isIntermediary } from "../core/classify";
import { deadlinePassed } from "../core/lifecycle";
import { normalizeText, sha, uid } from "../core/text";
import type { RawJob } from "../sources/adapters";

export type NormalizeResult =
  | { ok: true; vacancy: Vacancy }
  | { ok: false; reason: "policy" | "invalid"; detail: string };

export function contentHashOf(r: { title: string; company: string; location: string; description: string; salaryKey: string }): string {
  return sha([normalizeText(r.title), normalizeText(r.company), normalizeText(r.location), normalizeText(r.description).slice(0, 20000), r.salaryKey].join("|"));
}

export function normalizeRaw(raw: RawJob, excluded: ExcludedHost[], now: Date, opts: { isDemo?: boolean; provenance?: string } = {}): NormalizeResult {
  for (const candidateUrl of [raw.url, raw.applyUrl]) {
    const b = blockedReason(candidateUrl, excluded);
    if (b) return { ok: false, reason: "policy", detail: b };
  }
  // Ссылки на исключённые источники внутри текста: происхождение запрещено — запись не используется.
  const inText = blockedReason(raw.description.slice(0, 20000), excluded);
  if (inText) return { ok: false, reason: "policy", detail: inText };
  const canonical = canonicalizeUrl(raw.url) ?? canonicalizeUrl(raw.applyUrl);
  if (!canonical || !raw.title) return { ok: false, reason: "invalid", detail: "Нет названия или корректного URL / missing title or valid URL" };
  const at = now.toISOString();
  const facts = extractFacts({
    title: raw.title,
    company: raw.company,
    location: raw.location,
    description: raw.description,
    levelText: raw.levelText,
    employmentType: raw.employmentType,
    tags: raw.tags,
    remoteBySource: raw.remoteBySource,
    salary: raw.salary ?? undefined,
  });
  const posting = classifyPosting({ title: raw.title, company: raw.company, url: canonical, description: raw.description });
  const tags = [...raw.tags];
  if (isIntermediary(raw.company, canonical)) tags.push("intermediary_platform");
  let lifecycle: Vacancy["lifecycle"] = "unchecked";
  const evidence: LifecycleEvidence[] = [];
  if (facts.closureText.value) {
    lifecycle = raw.isEmployerAts ? "closed" : "unconfirmed";
    evidence.push({ type: raw.isEmployerAts ? "employer_closed_text" : "aggregator_closed", at, url: canonical, httpStatus: null, detail: msg(`В тексте: «${facts.closureText.quote}»`, `In the text: "${facts.closureText.quote}"`) });
  } else if (deadlinePassed(facts.deadline.value, now)) {
    lifecycle = "closed";
    evidence.push({ type: "deadline_passed", at, url: canonical, httpStatus: null, detail: msg(`Срок подачи истёк: ${facts.deadline.value}`, `Application deadline passed: ${facts.deadline.value}`) });
  } else if (raw.isEmployerAts) {
    lifecycle = "open";
    evidence.push({ type: "employer_ats_listed", at, url: canonical, httpStatus: 200, detail: msg("Опубликовано на официальной ATS-доске работодателя", "Listed on the employer's official ATS board") });
  } else {
    evidence.push({ type: "feed_only", at, url: canonical, httpStatus: null, detail: msg("Видно только в ленте источника; первичная карточка не проверялась", "Seen only in the source feed; primary posting not checked") });
  }
  const salaryKey = JSON.stringify([facts.salary.min, facts.salary.max, facts.salary.currency, facts.salary.period]);
  const vacancy: Vacancy = {
    id: uid("vac-"),
    title: raw.title,
    company: raw.company || "",
    companyId: null,
    canonicalUrl: canonical,
    sourceUrl: raw.url,
    applyUrl: raw.applyUrl,
    sourceId: raw.sourceId,
    sourceJobId: raw.sourceJobId,
    requisitionId: requisitionFromUrl(raw.applyUrl) ?? requisitionFromUrl(raw.url),
    location: raw.location || "",
    employmentType: raw.employmentType,
    levelText: raw.levelText,
    description: raw.description,
    publishedAt: raw.publishedAt,
    firstSeenAt: at,
    lastSeenAt: at,
    lastCheckedAt: null,
    lifecycle,
    lifecycleEvidence: evidence,
    postingKind: posting.kind,
    postingKindReason: posting.reason,
    contentHash: contentHashOf({ title: raw.title, company: raw.company, location: raw.location, description: raw.description, salaryKey }),
    facts,
    mergedIntoId: null,
    isDemo: !!opts.isDemo,
    tags,
    provenance: opts.provenance ?? `source:${raw.sourceId}`,
  };
  return { ok: true, vacancy };
}
