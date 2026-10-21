// Разбор оплаты. Сумма всегда хранится с валютой, периодом и типом.
// Никаких предположений о 160 часах: месячная сумма из почасовой ставки
// считается только при гарантированных оплачиваемых часах.

import type { MoneyFloor, Msg, PayPeriod, SalaryFact, SalaryKind } from "../shared/types";
import { msg } from "../shared/types";
import { normalizeText, quoteAround } from "./text";

const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/\$|usd|долл/i, "USD"],
  [/€|eur|евро/i, "EUR"],
  [/£|gbp|фунт/i, "GBP"],
  [/₽|руб|rub|р\./i, "RUB"],
  [/₸|kzt|тенге/i, "KZT"],
];

export const WEEKS_PER_MONTH = 52 / 12; // 4.333…

export function currencyFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = String(text).trim();
  if (/^[A-Z]{3}$/.test(t.toUpperCase()) && t.length === 3) return t.toUpperCase();
  for (const [re, code] of CURRENCY_SYMBOLS) if (re.test(t)) return code;
  return null;
}

export function periodFrom(text: string | null | undefined): PayPeriod {
  if (!text) return null;
  const t = normalizeText(text);
  if (/(^|\s|\/)(hour|hourly|hr|h|час|ч|почасов)/.test(t) || /per hour|в час|\/ ?час|\/hr/.test(t)) return "hour";
  if (/(^|\s)(day|daily|день|сутки)|per day|в день/.test(t)) return "day";
  if (/(^|\s)(week|weekly|недел)|per week|в неделю/.test(t)) return "week";
  if (/(^|\s)(month|monthly|mo|мес)|per month|в месяц/.test(t)) return "month";
  if (/(^|\s)(year|yearly|annual|annum|yr|год)|per year|в год|\bpa\b/.test(t)) return "year";
  if (/per task|за задачу|per project|за проект|per item/.test(t)) return "task";
  return null;
}

function parseAmount(raw: string, suffix?: string): number | null {
  let s = raw.replace(/[\s  ']/g, "");
  if (/^\d{1,3}([,.]\d{3})+$/.test(s)) s = s.replace(/[,.]/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const k = (suffix || "").toLowerCase();
  if (k === "k" || k === "к" || k === "тыс") return n * 1000;
  return n;
}

const AMOUNT = String.raw`(\d[\d\s  .,']*)\s*(k|к|тыс\.?)?`;
const CUR = String.raw`(\$|€|£|₽|usd|eur|gbp|rub|руб(?:\.|лей|ля)?|р\.)`;

/** Извлечь оплату из текста объявления. Возвращает null, если сумма не найдена. */
export function parseSalaryText(text: string): SalaryFact | null {
  const flat = text.replace(/\s+/g, " ");
  const lower = flat.toLowerCase();
  const estimate = /(estimated|estimate|est\.|platform estimate|glassdoor|оценка площадки|по оценке)/i.test(flat);
  const patterns: Array<{ re: RegExp; kind: SalaryKind }> = [
    // $20–30 / hour, €2,000 - €3,000 per month
    { re: new RegExp(String.raw`${CUR}\s*${AMOUNT}\s*(?:-|–|—|to|до)\s*${CUR}?\s*${AMOUNT}`, "i"), kind: "range" },
    // от 25 000 до 40 000 ₽
    { re: new RegExp(String.raw`от\s*${AMOUNT}\s*${CUR}?\s*до\s*${AMOUNT}\s*${CUR}`, "i"), kind: "range" },
    { re: new RegExp(String.raw`${AMOUNT}\s*${CUR}\s*(?:-|–|—|to)\s*${AMOUNT}\s*${CUR}`, "i"), kind: "range" },
    // до 50 000 ₽ / up to $3000
    { re: new RegExp(String.raw`(?:up to|до)\s*${CUR}?\s*${AMOUNT}\s*${CUR}?`, "i"), kind: "up_to" },
    // от 30 000 ₽ / from $1500
    { re: new RegExp(String.raw`(?:from|от|starting at)\s*${CUR}?\s*${AMOUNT}\s*${CUR}?`, "i"), kind: "from" },
    // $25/hour, 1500 USD per month
    { re: new RegExp(String.raw`${CUR}\s*${AMOUNT}`, "i"), kind: "fixed" },
    { re: new RegExp(String.raw`${AMOUNT}\s*${CUR}`, "i"), kind: "fixed" },
  ];
  for (const { re, kind } of patterns) {
    const m = re.exec(flat);
    if (!m) continue;
    const groups = m.slice(1);
    const curToken = groups.find((g) => g && new RegExp(`^${CUR}$`, "i").test(g.trim()));
    const currency = currencyFrom(curToken || "");
    if (!currency) continue;
    const amounts: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g && /^\d/.test(g.trim())) {
        const next = groups[i + 1];
        const suffix = next && /^(k|к|тыс\.?)$/i.test(next) ? next.replace(".", "") : undefined;
        const v = parseAmount(g.trim(), suffix);
        if (v !== null) amounts.push(v);
      }
    }
    if (!amounts.length) continue;
    // Слишком маленькие «суммы» в рублях без контекста (например «2 года») отбрасываем.
    if (currency === "RUB" && Math.max(...amounts) < 100) continue;
    const tail = flat.slice(m.index, m.index + m[0].length + 40);
    const period = periodFrom(tail) ?? inferPeriodFromMagnitude(Math.max(...amounts), currency);
    let finalKind: SalaryKind = kind;
    if (estimate) finalKind = "platform_estimate";
    else if (period === "hour" && kind !== "up_to") finalKind = "hourly";
    const [min, max] =
      kind === "up_to" ? [null, amounts[0]] : kind === "from" ? [amounts[0], null] : kind === "fixed" ? [amounts[0], amounts[0]] : [amounts[0], amounts[1] ?? amounts[0]];
    return {
      kind: finalKind,
      min,
      max,
      currency,
      period,
      guaranteedHoursPerWeek: parseGuaranteedHours(lower),
      origin: "text",
      quote: quoteAround(flat, re, 60),
    };
  }
  return null;
}

function inferPeriodFromMagnitude(amount: number, currency: string): PayPeriod {
  // Только как явная подсказка для отображения; для порога неизвестный период = unknown.
  if (currency === "RUB") return amount >= 10000 ? "month" : null;
  return null;
}

/** «Guaranteed 20 hours per week», «гарантированно 30 часов в неделю». «Up to 40 hours» гарантией не считается. */
export function parseGuaranteedHours(lowerText: string): number | null {
  const m =
    /(?:guaranteed|minimum of|at least|гарантированн\w*|не менее)\s*(\d{1,2})\s*(?:\+\s*)?(?:paid\s+)?(?:hours?|hrs?|час\w*)\s*(?:per|a|\/|в)\s*(?:week|wk|недел\w*)/i.exec(lowerText);
  if (m) return Number(m[1]);
  return null;
}

export function structuredSalary(input: {
  min?: number | string | null;
  max?: number | string | null;
  currency?: string | null;
  period?: string | null;
  estimate?: boolean;
}): SalaryFact | null {
  const min = Number(input.min) > 0 ? Number(input.min) : null;
  const max = Number(input.max) > 0 ? Number(input.max) : null;
  if (min === null && max === null) return null;
  const currency = currencyFrom(input.currency || "") || (input.currency ? String(input.currency).toUpperCase().slice(0, 3) : null);
  const period = periodFrom(input.period || "");
  let kind: SalaryKind = min !== null && max !== null ? (min === max ? "fixed" : "range") : min !== null ? "from" : "up_to";
  if (input.estimate) kind = "platform_estimate";
  else if (period === "hour") kind = "hourly";
  return { kind, min, max, currency, period, guaranteedHoursPerWeek: null, origin: "structured", quote: null };
}

export const UNKNOWN_SALARY: SalaryFact = {
  kind: "unknown",
  min: null,
  max: null,
  currency: null,
  period: null,
  guaranteedHoursPerWeek: null,
  origin: "none",
  quote: null,
};

export interface PayVerdict {
  status: "pass" | "fail" | "unknown";
  reason: Msg;
  monthlyMin: number | null;
  monthlyMax: number | null;
}

function toMonthly(amount: number | null, period: PayPeriod, guaranteedHours: number | null): number | null {
  if (amount === null) return null;
  switch (period) {
    case "month":
      return amount;
    case "year":
      return amount / 12;
    case "week":
      return amount * WEEKS_PER_MONTH;
    case "hour":
      return guaranteedHours ? amount * guaranteedHours * WEEKS_PER_MONTH : null;
    default:
      return null;
  }
}

export function fmtMoney(n: number | null, currency: string | null): string {
  if (n === null) return "?";
  const v = Math.round(n).toLocaleString("ru-RU");
  return currency ? `${v} ${currency}` : v;
}

/**
 * Сравнение с месячным минимумом кандидата.
 * pass — подтверждённая нижняя граница не ниже минимума;
 * fail — даже максимум ниже минимума;
 * unknown — всё остальное (нет суммы, «до», оценка площадки, ставка без гарантии часов, валюта без правила).
 */
export function judgePay(s: SalaryFact, floors: MoneyFloor[]): PayVerdict {
  const u = (reason: Msg, monthlyMin: number | null = null, monthlyMax: number | null = null): PayVerdict => ({ status: "unknown", reason, monthlyMin, monthlyMax });
  if (s.kind === "unknown" || (!s.min && !s.max)) return u(msg("Оплата в объявлении не указана", "Pay is not stated in the posting"));
  const floor = floors.find((f) => f.currency === s.currency);
  const monthlyMin = toMonthly(s.min, s.period, s.guaranteedHoursPerWeek);
  const monthlyMax = toMonthly(s.max, s.period, s.guaranteedHoursPerWeek);
  // Максимально возможный месяц для почасовой ставки (полная загрузка 40 ч/нед) — только для отсечения.
  const ceilingMonthly = s.period === "hour" && s.max ? s.max * 40 * WEEKS_PER_MONTH : monthlyMax;
  const cur = s.currency ?? "?";
  if (!floor) {
    return u(
      msg(`Для валюты ${cur} минимум не задан — пересчёт по курсу автоматически не выполняется`, `No minimum is set for ${cur} — no automatic currency conversion is applied`),
      monthlyMin,
      monthlyMax,
    );
  }
  if (s.period === "task") return u(msg("Оплата за задачу не даёт гарантированного месячного дохода", "Per-task pay does not guarantee a monthly income"));
  if (s.period === null || s.period === "day") {
    return u(msg("Период оплаты не указан или посуточный — месячную сумму нельзя подтвердить", "Pay period is missing or daily — a monthly amount cannot be confirmed"));
  }
  const fl = fmtMoney(floor.amountMonthly, floor.currency);
  if (ceilingMonthly !== null && ceilingMonthly < floor.amountMonthly) {
    const c = fmtMoney(ceilingMonthly, s.currency);
    return { status: "fail", reason: msg(`Даже максимум (${c}/мес) ниже минимума ${fl}`, `Even the maximum (${c}/mo) is below the minimum ${fl}`), monthlyMin, monthlyMax };
  }
  if (s.kind === "platform_estimate") return u(msg("Это оценка площадки, а не сумма работодателя", "This is a platform estimate, not the employer's figure"), monthlyMin, monthlyMax);
  if (s.kind === "up_to") return u(msg("Указано только «до» — нижняя граница не гарантирована", "Only an \"up to\" amount — no guaranteed lower bound"), monthlyMin, monthlyMax);
  if (s.period === "hour" && !s.guaranteedHoursPerWeek) {
    return u(msg("Почасовая ставка без гарантированных оплачиваемых часов", "Hourly rate without guaranteed paid hours"));
  }
  if (monthlyMin !== null && monthlyMin >= floor.amountMonthly) {
    const m = fmtMoney(monthlyMin, s.currency);
    return { status: "pass", reason: msg(`Нижняя граница ${m}/мес ≥ ${fl}`, `Lower bound ${m}/mo ≥ ${fl}`), monthlyMin, monthlyMax };
  }
  return u(msg("Нижняя граница ниже минимума или не указана — уточнить итоговую сумму", "Lower bound is below the minimum or missing — confirm the final amount"), monthlyMin, monthlyMax);
}
