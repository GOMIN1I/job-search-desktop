// Планировщик: вычисление слотов, пропусков и одного контролируемого догоняющего запуска.
// Один и тот же код работает в приложении, в системной фоновой задаче и на сервере поиска.

import type { ScheduleSettings } from "../shared/types";

/** Окно, в течение которого запуск считается «вовремя», а не догоняющим. */
export const ON_TIME_WINDOW_MS = 15 * 60 * 1000;
export const MAX_RECORDED_MISSES = 14;

// Время слотов считается в часовом поясе человека (schedule.timezone), а не машины, на которой идёт поиск:
// одинаково для приложения и для сервера. Переход на летнее время учитывается.

const systemZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface Wall { y: number; mo: number; d: number; h: number; mi: number; wd: number }

function wallIn(date: Date, tz: string): Wall {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday) + 1;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd };
}

/** UTC-момент для «стенного» времени в поясе tz. */
function fromWall(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const w = wallIn(new Date(t), tz);
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
    t = guess - (asUtc - t);
  }
  return new Date(t);
}

/** Слот на календарный день (сдвиг dayShift от дня `base` в поясе tz). */
function slotOnDay(s: ScheduleSettings, base: Date, dayShift: number): { at: Date; wd: number } {
  const tz = s.timezone || systemZone();
  const w = wallIn(base, tz);
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + dayShift));
  const [h, m] = s.time.split(":").map(Number);
  const at = fromWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, tz);
  const wd = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  return { at, wd };
}

/** Последний слот расписания не позже `now`. */
export function previousSlot(s: ScheduleSettings, now: Date): Date {
  for (let shift = 0; shift > -15; shift--) {
    const x = slotOnDay(s, now, shift);
    if (x.at.getTime() > now.getTime()) continue;
    if (s.cadence === "weekly" && x.wd !== s.weekday) continue;
    return x.at;
  }
  return slotOnDay(s, now, -7).at;
}

export function nextSlot(s: ScheduleSettings, now: Date): Date {
  for (let shift = 0; shift < 15; shift++) {
    const x = slotOnDay(s, now, shift);
    if (x.at.getTime() <= now.getTime()) continue;
    if (s.cadence === "weekly" && x.wd !== s.weekday) continue;
    return x.at;
  }
  return slotOnDay(s, now, 7).at;
}

function stepBack(s: ScheduleSettings, d: Date): Date {
  return previousSlot(s, new Date(d.getTime() - 60_000));
}

export interface SchedulePlan {
  action: "none" | "run" | "catchup" | "disabled" | "paused";
  slot: string | null; // слот, который обрабатывается сейчас
  missed: string[]; // пропущенные слоты (для журнала), без последнего, который догоняется
  next: string | null;
}

/**
 * lastHandledSlot — последний слот, по которому уже принято решение (запуск или фиксация пропуска).
 * Возвращает максимум один запуск: либо вовремя, либо один догоняющий после сна/выключения.
 */
export function planSchedule(s: ScheduleSettings, lastHandledSlot: string | null, now: Date): SchedulePlan {
  if (!s.enabled) return { action: "disabled", slot: null, missed: [], next: null };
  const next = nextSlot(s, now).toISOString();
  if (s.paused) return { action: "paused", slot: null, missed: [], next };
  const due = previousSlot(s, now);
  const last = lastHandledSlot ? new Date(lastHandledSlot) : null;
  if (last && last.getTime() >= due.getTime()) return { action: "none", slot: null, missed: [], next };
  // Первое включение: не запускать задним числом, просто отметить текущий слот как обработанный.
  if (!last) return { action: "none", slot: due.toISOString(), missed: [], next };
  const late = now.getTime() - due.getTime();
  const missed: string[] = [];
  let p = stepBack(s, due);
  while (p.getTime() > last.getTime() && missed.length < MAX_RECORDED_MISSES) {
    missed.unshift(p.toISOString());
    p = stepBack(s, p);
  }
  if (late <= ON_TIME_WINDOW_MS) return { action: "run", slot: due.toISOString(), missed, next };
  return { action: "catchup", slot: due.toISOString(), missed, next };
}
