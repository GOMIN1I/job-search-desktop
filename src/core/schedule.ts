// Локальный планировщик: вычисление слотов, пропусков и одного контролируемого догоняющего запуска.
// Работает только пока приложение запущено (окно или фоновый режим). При выключенном компьютере запусков нет.

import type { ScheduleSettings } from "../shared/types";

/** Окно, в течение которого запуск считается «вовремя», а не догоняющим. */
export const ON_TIME_WINDOW_MS = 15 * 60 * 1000;
export const MAX_RECORDED_MISSES = 14;

function atLocal(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function isoWeekday(d: Date): number {
  const w = d.getDay();
  return w === 0 ? 7 : w;
}

/** Последний слот расписания не позже `now` (локальное время машины). */
export function previousSlot(s: ScheduleSettings, now: Date): Date {
  let d = atLocal(now, s.time);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  if (s.cadence === "weekly") {
    while (isoWeekday(d) !== s.weekday) d.setDate(d.getDate() - 1);
  }
  return d;
}

export function nextSlot(s: ScheduleSettings, now: Date): Date {
  let d = atLocal(now, s.time);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  if (s.cadence === "weekly") {
    while (isoWeekday(d) !== s.weekday) d.setDate(d.getDate() + 1);
  }
  return d;
}

function stepBack(s: ScheduleSettings, d: Date): Date {
  const x = new Date(d);
  x.setDate(x.getDate() - (s.cadence === "weekly" ? 7 : 1));
  return x;
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
