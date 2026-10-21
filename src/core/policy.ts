// Исключённые пользователем источники и канонические URL.
// Исключённый домен запрещён в любой форме: прямой адрес, поддомен, зеркало,
// URL-параметр редиректа (?url=https://example.com/...), закодированная ссылка внутри другого URL.

export interface ExcludedHost {
  host: string; // домен без схемы; правило действует и на поддомены
  reason: string;
}

/** По умолчанию приложение ничего не исключает: источники выбирает сам пользователь. */
export const DEFAULT_EXCLUDED_HOSTS: ExcludedHost[] = [];

/**
 * Справочник семейств сервисов: если пользователь исключает «hh.ru и связанные сервисы»,
 * исключаются все домены семейства. Сам по себе справочник ничего не блокирует.
 */
export const SERVICE_FAMILIES: Array<{ id: string; names: string[]; sourceIds: string[]; hosts: string[] }> = [
  {
    id: "headhunter",
    names: ["hh.ru", "hh", "headhunter", "хедхантер", "хэдхантер", "хх", "хх.ру", "hh.kz", "rabota.by"],
    sourceIds: ["hh"],
    hosts: ["hh.ru", "headhunter.ru", "hh.kz", "hh.uz", "hh1.az", "headhunter.ge", "headhunter.kg", "rabota.by", "hhcdn.ru", "hh.ua"],
  },
  { id: "linkedin", names: ["linkedin", "линкедин", "линкедин.com"], sourceIds: [], hosts: ["linkedin.com", "lnkd.in"] },
  { id: "indeed", names: ["indeed", "индид"], sourceIds: [], hosts: ["indeed.com"] },
  { id: "habr", names: ["хабр", "habr", "хабр карьера", "career.habr.com"], sourceIds: ["habrcareer"], hosts: ["career.habr.com"] },
  { id: "superjob", names: ["superjob", "суперджоб"], sourceIds: [], hosts: ["superjob.ru"] },
];

export const ALLOWED_OPEN_SCHEMES = new Set(["https:", "http:", "mailto:"]);

const TRACKING_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "ref", "referrer", "source", "gh_src", "lever-source", "lever-origin", "fbclid", "gclid",
  "mc_cid", "mc_eid", "trk", "src",
];

export function hostMatches(hostname: string, rule: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  const r = rule.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return h === r || h.endsWith("." + r);
}

function decodeRepeated(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

/** Возвращает причину блокировки или null. Проверяет хост, параметры и вложенные ссылки. */
export function blockedReason(rawUrl: string | null | undefined, excluded: ExcludedHost[]): string | null {
  if (!rawUrl) return null;
  const text = decodeRepeated(String(rawUrl));
  let parsed: URL | null = null;
  try {
    parsed = new URL(text);
  } catch {
    parsed = null;
  }
  for (const rule of excluded) {
    if (parsed && hostMatches(parsed.hostname, rule.host)) return `${rule.host}: ${rule.reason}`;
    // Вложенный адрес в параметрах или пути (редиректоры, зеркала, прокси).
    const escaped = rule.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nested = new RegExp(`(^|[^a-z0-9-])([a-z0-9-]+\\.)*${escaped}(?=[/:?#&"'\\s]|$)`, "i");
    const tail = parsed ? parsed.pathname + parsed.search + parsed.hash : text;
    if (nested.test(tail)) return `${rule.host} (вложенная ссылка): ${rule.reason}`;
  }
  return null;
}

/** Канонический URL: без трекинга, якоря, хвостового слэша; хост в нижнем регистре. */
export function canonicalizeUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  for (const key of TRACKING_KEYS) parsed.searchParams.delete(key);
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  parsed.protocol = "https:";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.searchParams.sort();
  return parsed.toString();
}

/** Идентификатор заявки (requisition) из известных ATS-адресов. */
export function requisitionFromUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  const p = u.pathname;
  let m: RegExpMatchArray | null;
  if (h.includes("greenhouse.io") && (m = p.match(/\/jobs\/(\d+)/))) return `greenhouse:${m[1]}`;
  if (u.searchParams.get("gh_jid")) return `greenhouse:${u.searchParams.get("gh_jid")}`;
  if (h.includes("lever.co") && (m = p.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i))) return `lever:${m[1].toLowerCase()}`;
  if (h.includes("ashbyhq.com") && (m = p.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i))) return `ashby:${m[1].toLowerCase()}`;
  if (h.includes("workable.com") && (m = p.match(/\/j\/([0-9A-F]{6,})/i))) return `workable:${m[1].toUpperCase()}`;
  if (h.includes("career.habr.com") && (m = p.match(/\/vacancies\/(\d+)/))) return `habr:${m[1]}`;
  return null;
}

/** Проверка адреса перед открытием во внешнем браузере. */
export function safeExternalUrl(rawUrl: string, excluded: ExcludedHost[]): { ok: true; url: string } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Некорректный адрес" };
  }
  if (!ALLOWED_OPEN_SCHEMES.has(u.protocol)) return { ok: false, reason: `Схема ${u.protocol} не разрешена` };
  const blocked = blockedReason(rawUrl, excluded);
  if (blocked) return { ok: false, reason: `Источник исключён в ваших настройках: ${blocked}` };
  return { ok: true, url: u.toString() };
}
