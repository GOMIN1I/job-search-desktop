// Удаление дублей. Порядок: устойчивый ID источника → канонический URL → requisition ID ATS →
// осторожный fallback (компания+название+локация+похожий текст). Разные requisition или города не склеиваются.
// Fallback-слияние всегда обратимо и записывается в журнал.

import { jaccard, normalizeText, tokenSet } from "./text";

export interface VacRef {
  id: string;
  sourceId: string;
  sourceJobId: string | null;
  canonicalUrl: string;
  requisitionId: string | null;
  company: string;
  title: string;
  location: string;
  description: string;
}

export interface DedupeIndex {
  bySourceJob(sourceId: string, sourceJobId: string): VacRef | null;
  byCanonicalUrl(url: string): VacRef | null;
  byRequisition(requisitionId: string): VacRef | null;
  byFallbackKey(key: string): VacRef[];
}

export type DedupeDecision =
  | { kind: "same_source_id" | "same_url" | "same_requisition"; target: VacRef; reason: string }
  | { kind: "fallback"; target: VacRef; reason: string; similarity: number }
  | { kind: "new"; reason: string; rejectedFallback?: string };

const COMPANY_SUFFIX = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|ooo|ооо|ао|пао|group|holdings?|technologies|technology|labs)\b/g;

export function fallbackKey(company: string, title: string): string {
  const c = normalizeText(company).replace(COMPANY_SUFFIX, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const t = normalizeText(title).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${c}|${t}`;
}

function normLocation(loc: string): string {
  const n = normalizeText(loc);
  if (!n || /^(remote|worldwide|anywhere|удаленно|не указано|remote not specified|remote \/ not specified)$/.test(n)) return "remote";
  return n;
}

export function decideDedupe(incoming: VacRef, index: DedupeIndex): DedupeDecision {
  if (incoming.sourceJobId) {
    const hit = index.bySourceJob(incoming.sourceId, incoming.sourceJobId);
    if (hit) return { kind: "same_source_id", target: hit, reason: `Тот же ID в источнике ${incoming.sourceId}` };
  }
  const byUrl = index.byCanonicalUrl(incoming.canonicalUrl);
  if (byUrl) return { kind: "same_url", target: byUrl, reason: "Совпадает канонический URL" };
  if (incoming.requisitionId) {
    const hit = index.byRequisition(incoming.requisitionId);
    if (hit) return { kind: "same_requisition", target: hit, reason: `Совпадает requisition ${incoming.requisitionId}` };
  }
  const candidates = index.byFallbackKey(fallbackKey(incoming.company, incoming.title)).filter((c) => c.id !== incoming.id);
  let rejected: string | undefined;
  for (const c of candidates) {
    if (c.requisitionId && incoming.requisitionId && c.requisitionId !== incoming.requisitionId) {
      rejected = "разные requisition ID";
      continue;
    }
    if (normLocation(c.location) !== normLocation(incoming.location)) {
      rejected = `разные локации (${c.location || "—"} / ${incoming.location || "—"})`;
      continue;
    }
    const a = tokenSet(c.description.slice(0, 4000));
    const b = tokenSet(incoming.description.slice(0, 4000));
    const sim = a.size > 30 && b.size > 30 ? jaccard(a, b) : 1;
    if (sim < 0.6) {
      rejected = `тексты различаются (сходство ${sim.toFixed(2)})`;
      continue;
    }
    return { kind: "fallback", target: c, similarity: sim, reason: `Та же компания, название и локация; сходство текста ${sim.toFixed(2)}` };
  }
  return { kind: "new", reason: "Новое объявление", rejectedFallback: rejected };
}
