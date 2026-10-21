import { createHash } from "node:crypto";

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&ndash;": "–",
  "&mdash;": "—",
  "&laquo;": "«",
  "&raquo;": "»",
  "&hellip;": "…",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&bull;": "•",
  "&euro;": "€",
  "&pound;": "£",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function safeCodePoint(code: number): string {
  try {
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
  } catch {
    return " ";
  }
}

/**
 * Превращает HTML объявления в простой текст с сохранением абзацев.
 * Скрипты, стили и разметка удаляются; результат никогда не интерпретируется как HTML.
 */
export function htmlToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Двойное экранирование встречается в RSS (&lt;p&gt;)
  if (/&lt;\/?[a-z]/i.test(s) && !/<[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/ul|\/ol)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .replace(/\r/g, "")
    .replace(/[ \t  ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function oneLine(value: unknown): string {
  return htmlToText(value).replace(/\s+/g, " ").trim();
}

/** Нормализация для сравнения и поиска фраз. */
export function normalizeText(value: unknown): string {
  return oneLine(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}+#./$€£₽-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sha(value: string, length = 24): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Совпадение фразы как отдельного слова (для однословных) или подстроки (для фраз). */
export function phraseHit(normalizedText: string, phrase: string): boolean {
  const p = normalizeText(phrase);
  if (p.length < 2) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(p)}(?=$|[^\\p{L}\\p{N}])`, "u");
  return re.test(normalizedText);
}

/** Короткая цитата вокруг первого совпадения регулярного выражения. */
export function quoteAround(text: string, re: RegExp, radius = 90): string | null {
  const flat = text.replace(/\s+/g, " ");
  const m = re.exec(flat);
  if (!m) return null;
  const start = Math.max(0, m.index - radius);
  const end = Math.min(flat.length, m.index + m[0].length + radius);
  return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
}

/** Проверка, что цитата действительно присутствует в тексте (защита от выдуманных AI-цитат). */
export function quoteIsInText(quote: string, text: string): boolean {
  const q = normalizeText(quote.replace(/^…|…$/g, ""));
  if (q.length < 6) return false;
  return normalizeText(text).includes(q);
}

export function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter((t) => t.length > 2));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(prefix = ""): string {
  return prefix + createHash("sha256").update(String(Math.random()) + process.hrtime.bigint()).digest("hex").slice(0, 16);
}
