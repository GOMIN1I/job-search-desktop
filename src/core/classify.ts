// Отделение реальных объявлений от навигации, «вечных» пулов кандидатов, платного обучения и сигналов агрегаторов.

import type { Msg, PostingKind } from "../shared/types";
import { msg } from "../shared/types";
import { normalizeText } from "./text";

const NAV_TITLES = [
  "careers", "career", "jobs", "open positions", "open roles", "view all jobs", "all jobs", "join us", "join our team",
  "work with us", "life at", "benefits", "our team", "teams", "locations", "students", "university", "early careers",
  "вакансии", "карьера", "работа у нас", "все вакансии", "присоединяйтесь", "о компании", "команда",
];

const TALENT_POOL = [
  /talent (?:pool|community|network)/i, /general application/i, /open application/i, /future (?:opportunities|openings|roles)/i,
  /evergreen/i, /not (?:an )?active (?:job )?opening/i, /don(?:'|’)t see (?:a|the) (?:role|position)/i, /submit your (?:resume|cv) for future/i,
  /кадров\w* резерв/i, /не нашли подходящ\w* вакансию/i, /отправьте резюме на будущее/i,
];

const PAID_TRAINING = [
  /(?:tuition|course fee|program fee|bootcamp fee|pay for (?:the )?(?:course|training|program))/i,
  /(?:платн\w* (?:курс|обучени)|стоимость (?:курса|обучения)|оплатите (?:курс|обучение)|рассрочк\w* на обучение)/i,
  /\b(?:bootcamp|online course|онлайн-курс)\b.*\b(?:enroll|запись|поступ)/i,
];

/** Известные платформы-посредники разметки/оценки AI: показываем отдельно от прямых работодателей. */
export const INTERMEDIARY_NAMES = [
  "opentrain", "outlier", "dataannotation", "data annotation tech", "remotasks", "appen", "telus international", "telus digital",
  "oneforma", "clickworker", "toloka", "mindrift", "alignerr", "prolific", "rws", "welocalize", "lionbridge", "scale ai", "turing",
];

export function isIntermediary(company: string, url: string): boolean {
  const c = normalizeText(company);
  const u = url.toLowerCase();
  return INTERMEDIARY_NAMES.some((n) => c.includes(n) || u.includes(n.replace(/\s+/g, "")));
}

export function classifyPosting(input: { title: string; company: string; url: string; description: string }): { kind: PostingKind; reason: Msg } {
  const title = normalizeText(input.title);
  const desc = input.description || "";
  if (NAV_TITLES.includes(title) || /^(view|see) (all|open)/.test(title)) {
    return { kind: "navigation", reason: msg(`Заголовок «${input.title}» — навигационная ссылка, а не объявление`, `"${input.title}" is a navigation link, not a job posting`) };
  }
  try {
    const u = new URL(input.url);
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (/^(|\/careers?|\/jobs|\/vacancies|\/вакансии|\/open-positions|\/join-us|\/en\/careers?|\/company\/careers?)$/.test(path) && !u.search) {
      return { kind: "navigation", reason: msg("Адрес ведёт на общий каталог вакансий, а не на конкретную карточку", "The link points to a general jobs listing, not a specific posting") };
    }
  } catch {
    /* некорректный адрес учитывается при нормализации */
  }
  for (const re of TALENT_POOL) if (re.test(`${input.title}\n${desc.slice(0, 3000)}`)) return { kind: "talent_pool", reason: msg("Пул кандидатов на будущее, а не активная вакансия", "Future talent pool, not an active opening") };
  for (const re of PAID_TRAINING) if (re.test(`${input.title}\n${desc.slice(0, 4000)}`)) return { kind: "paid_training", reason: msg("Платное обучение/курс, а не оплачиваемая работа", "Paid training/course, not paid work") };
  if (!input.company || /^(unknown employer|various|multiple companies|confidential)$/i.test(input.company.trim())) {
    return { kind: "aggregator_signal", reason: msg("Работодатель не указан — это сигнал агрегатора, нужна первичная карточка", "No employer named — aggregator signal; the primary posting is needed") };
  }
  if (desc.trim().length < 60) return { kind: "aggregator_signal", reason: msg("Текста объявления почти нет — нужна проверка первичной карточки", "Almost no posting text — check the primary posting") };
  return { kind: "job_posting", reason: msg("Похоже на конкретное объявление", "Looks like a specific job posting") };
}
