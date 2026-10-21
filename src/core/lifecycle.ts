// Интерпретация повторной проверки первичной карточки.
// 403/429/5xx/CAPTCHA/JS-оболочка/ошибка сети не доказывают закрытие.
// 404 хранится как технический результат, а не как «закрыто работодателем».

import type { Lifecycle, LifecycleEvidence, Msg } from "../shared/types";
import { msg } from "../shared/types";
import { hasClosureText } from "./facts";
import { normalizeText } from "./text";

export interface CheckResult {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  bodyText: string;
  error: string | null;
  policyBlocked: string | null;
  isEmployerPage: boolean; // сайт работодателя или его ATS, а не агрегатор
}

const LISTING_PATH = /^\/?(careers?|jobs|vacancies|positions|open-positions|вакансии)?\/?$/i;

function titleFound(title: string, body: string): boolean {
  const tokens = normalizeText(title).split(" ").filter((t) => t.length > 2);
  if (!tokens.length) return false;
  const b = normalizeText(body);
  const hit = tokens.filter((t) => b.includes(t)).length;
  return hit / tokens.length >= 0.6;
}

export function interpretCheck(r: CheckResult, title: string, previous: Lifecycle, at: string): { lifecycle: Lifecycle; evidence: LifecycleEvidence } {
  const ev = (type: LifecycleEvidence["type"], detail: Msg): LifecycleEvidence => ({ type, at, url: r.finalUrl ?? r.url, httpStatus: r.httpStatus, detail });
  const keep = previous === "unchecked" ? "unconfirmed" : previous;
  if (r.policyBlocked) return { lifecycle: keep, evidence: ev("policy_blocked", msg(`Запрос не выполнялся: ${r.policyBlocked}`, `Request not made: ${r.policyBlocked}`)) };
  if (r.error) return { lifecycle: keep, evidence: ev("network_error", msg(`Сеть/таймаут: ${r.error}. Это не доказывает закрытие`, `Network/timeout: ${r.error}. This does not prove the job is closed`)) };
  const s = r.httpStatus ?? 0;
  if (s === 404 || s === 410) {
    return {
      lifecycle: "unconfirmed",
      evidence: ev("http_404", msg(`HTTP ${s}: страница не найдена. Это технический результат, работодатель закрытие не подтверждал`, `HTTP ${s}: page not found. A technical result — the employer has not confirmed closure`)),
    };
  }
  if (s === 403 || s === 401 || s === 429) return { lifecycle: keep, evidence: ev("http_blocked", msg(`HTTP ${s}: доступ ограничен — не удалось проверить`, `HTTP ${s}: access restricted — could not check`)) };
  if (s >= 500) return { lifecycle: keep, evidence: ev("http_error", msg(`HTTP ${s}: ошибка сервера — не удалось проверить`, `HTTP ${s}: server error — could not check`)) };
  if (/captcha|are you a robot|проверка, что вы не робот|cf-challenge|just a moment\.\.\./i.test(r.bodyText.slice(0, 5000))) {
    return { lifecycle: keep, evidence: ev("http_blocked", msg("Страница требует CAPTCHA — проверка не выполнена", "The page requires a CAPTCHA — not checked")) };
  }
  if (r.finalUrl && r.finalUrl !== r.url) {
    try {
      const a = new URL(r.url);
      const b = new URL(r.finalUrl);
      if (LISTING_PATH.test(b.pathname) && a.pathname !== b.pathname) {
        return {
          lifecycle: "unconfirmed",
          evidence: ev("redirect_to_listing", msg(`Редирект на общий каталог ${b.pathname} — карточка, вероятно, снята; прямого подтверждения нет`, `Redirected to the general listing ${b.pathname} — the posting was likely removed; no direct confirmation`)),
        };
      }
    } catch {
      /* ignore */
    }
  }
  const closure = hasClosureText(r.bodyText);
  if (closure) {
    const q = closure.slice(0, 160);
    if (r.isEmployerPage) return { lifecycle: "closed", evidence: ev("employer_closed_text", msg(`На странице работодателя: «${q}»`, `On the employer's page: "${q}"`)) };
    return { lifecycle: "unconfirmed", evidence: ev("aggregator_closed", msg(`Агрегатор пишет о закрытии: «${q}»; работодатель не подтверждал`, `The aggregator says closed: "${q}"; not confirmed by the employer`)) };
  }
  const textLen = r.bodyText.replace(/\s+/g, " ").trim().length;
  if (textLen < 400 && /enable javascript|you need to enable javascript|loading…|loading\.\.\.|<noscript/i.test(r.bodyText)) {
    return { lifecycle: keep, evidence: ev("js_shell", msg("Страница отдаёт JS-оболочку без текста — нужна ручная проверка в браузере", "The page is a JavaScript shell without text — check manually in a browser")) };
  }
  if (s >= 200 && s < 300 && titleFound(title, r.bodyText)) {
    return {
      lifecycle: "open",
      evidence: ev(
        "primary_page_ok",
        r.isEmployerPage
          ? msg("Карточка работодателя открывается, название найдено", "The employer's posting opens and the title was found")
          : msg("Карточка площадки открывается, название найдено (работодатель не проверен)", "The platform posting opens and the title was found (employer not verified)"),
      ),
    };
  }
  return {
    lifecycle: keep,
    evidence: ev("js_shell", msg(`HTTP ${s}: страница открылась, но название вакансии не найдено — нужна ручная проверка`, `HTTP ${s}: the page opened but the job title was not found — check manually`)),
  };
}

export function deadlinePassed(deadline: string | null, now: Date): boolean {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return false;
  return new Date(`${deadline}T23:59:59Z`).getTime() < now.getTime();
}
