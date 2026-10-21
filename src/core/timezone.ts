// Пересчёт рабочих часов работодателя в часовой пояс кандидата на конкретную дату (с учётом DST).

const ZONE_ALIASES: Record<string, string> = {
  et: "America/New_York", est: "America/New_York", edt: "America/New_York", eastern: "America/New_York",
  ct: "America/Chicago", cst: "America/Chicago", cdt: "America/Chicago", central: "America/Chicago",
  mt: "America/Denver", mst: "America/Denver", mdt: "America/Denver", mountain: "America/Denver",
  pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  gmt: "UTC", utc: "UTC", bst: "Europe/London", uk: "Europe/London", london: "Europe/London",
  cet: "Europe/Berlin", cest: "Europe/Berlin", eet: "Europe/Bucharest", eest: "Europe/Bucharest",
  msk: "Europe/Moscow", мск: "Europe/Moscow", moscow: "Europe/Moscow", москва: "Europe/Moscow",
  ist: "Asia/Kolkata", sgt: "Asia/Singapore", aest: "Australia/Sydney", aedt: "Australia/Sydney",
};

export function resolveZone(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (ZONE_ALIASES[t]) return ZONE_ALIASES[t];
  const m = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/.exec(t);
  if (m) {
    const h = Number(m[2]);
    if (m[3] && m[3] !== "00") return null; // нецелые смещения как Etc не выражаются
    // Etc/GMT имеет инвертированный знак.
    return h === 0 ? "UTC" : `Etc/GMT${m[1] === "+" ? "-" : "+"}${h}`;
  }
  if (isValidZone(token.trim())) return token.trim();
  return null;
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Смещение зоны (минуты к UTC) в конкретный момент. */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Локальное время «дата + HH:MM» в зоне → момент UTC. */
export function zonedToUtc(ymd: string, hhmm: string, zone: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let offset = zoneOffsetMinutes(zone, new Date(guess));
  let result = guess - offset * 60000;
  const offset2 = zoneOffsetMinutes(zone, new Date(result));
  if (offset2 !== offset) {
    offset = offset2;
    result = guess - offset * 60000;
  }
  return new Date(result);
}

export function formatInZone(at: Date, zone: string): { ymd: string; hhmm: string } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export interface ConvertedWindow {
  startLocal: string;
  endLocal: string;
  /** Окончание приходится на следующий календарный день кандидата. */
  crossesMidnight: boolean;
  employerZone: string;
  date: string;
}

/** Перевести рабочее окно работодателя в часовой пояс кандидата на указанную дату работодателя. */
export function convertWindow(start: string, end: string, employerZone: string, candidateZone: string, employerDate: string): ConvertedWindow {
  const s = zonedToUtc(employerDate, start, employerZone);
  let e = zonedToUtc(employerDate, end, employerZone);
  if (e.getTime() <= s.getTime()) e = new Date(e.getTime() + 24 * 3600 * 1000);
  const sl = formatInZone(s, candidateZone);
  const el = formatInZone(e, candidateZone);
  return { startLocal: sl.hhmm, endLocal: el.hhmm, crossesMidnight: sl.ymd !== el.ymd, employerZone, date: employerDate };
}

/** Помещается ли окно [start,end] (локальные часы кандидата) в доступное окно кандидата. */
export function windowFits(startLocal: string, endLocal: string, crossesMidnight: boolean, earliest: string, latest: string): boolean {
  const s = toMinutes(startLocal);
  let e = toMinutes(endLocal);
  if (crossesMidnight || e <= s) e += 24 * 60;
  const a = toMinutes(earliest);
  let b = toMinutes(latest);
  if (b <= a) b += 24 * 60;
  return s >= a && e <= b;
}

/** Найти часы работы в тексте: «9am–5pm EST», «с 10:00 до 19:00 МСК», «09:00-18:00 CET». */
export function parseWorkingHours(text: string): { start: string; end: string; zone: string | null; quote: string } | null {
  const flat = text.replace(/\s+/g, " ");
  const t = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
  const z = String.raw`\(?\s*((?:utc|gmt)\s*[+-]\s*\d{1,2}(?::?\d{2})?|[a-zа-я]{2,8}(?:\s+time)?)?\s*\)?`;
  const res: RegExp[] = [
    new RegExp(String.raw`(?:с|from)?\s*${t}\s*(?:-|–|—|to|до)\s*${t}\s*${z}`, "i"),
  ];
  for (const re of res) {
    let m: RegExpExecArray | null;
    const g = new RegExp(re.source, "gi");
    while ((m = g.exec(flat))) {
      const [full, h1, m1, ap1, h2, m2, ap2, zoneRaw] = m;
      // Нужен признак времени: двоеточие, am/pm или зона — иначе это диапазон чисел, а не часы.
      if (!m1 && !m2 && !ap1 && !ap2) continue;
      const startH = to24(Number(h1), ap1 || ap2);
      const endH = to24(Number(h2), ap2);
      if (startH === null || endH === null) continue;
      const zoneToken = (zoneRaw || "").replace(/\s+time$/i, "").trim();
      const zone = resolveZone(zoneToken);
      const pad = (n: number) => String(n).padStart(2, "0");
      return {
        start: `${pad(startH)}:${m1 || "00"}`,
        end: `${pad(endH)}:${m2 || "00"}`,
        zone,
        quote: full.trim(),
      };
    }
  }
  return null;
}

function to24(h: number, ap?: string): number | null {
  if (!Number.isFinite(h) || h > 24) return null;
  if (!ap) return h % 24;
  const pm = /^p/i.test(ap);
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}
