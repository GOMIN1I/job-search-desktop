import { describe, expect, it } from "vitest";
import { assess } from "../src/core/assess";
import { judgePay, parseSalaryText } from "../src/core/money";
import { convertWindow, parseWorkingHours } from "../src/core/timezone";
import { extractFacts } from "../src/core/facts";
import { classifyPosting } from "../src/core/classify";
import { interpretCheck } from "../src/core/lifecycle";
import { blockedReason, canonicalizeUrl, DEFAULT_EXCLUDED_HOSTS, safeExternalUrl, SERVICE_FAMILIES } from "../src/core/policy";
import { decideDedupe, fallbackKey, type DedupeIndex, type VacRef } from "../src/core/dedupe";
import { planSchedule } from "../src/core/schedule";
import { NOW, rulesRu, vac } from "./helpers";

const dimOf = (a: ReturnType<typeof assess>, key: string) => a.dimensions.find((d) => d.key === key)!;
const base = (over: Parameters<typeof vac>[0]) => vac(over);

describe("единая функция решения", () => {
  const goodText =
    "Entry level data annotation role, training provided. Remote from Russia and CIS is welcome. Salary $800 per month, fixed. Written communication via chat and email only, no calls. Flexible hours. English B1 required.";

  it("подходит, только когда все жёсткие условия подтверждены", () => {
    const v = base({ title: "Junior Data Annotator", description: goodText, location: "Russia, CIS" });
    const a = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c1", now: NOW });
    expect(a.dimensions.filter((d) => d.constraint === "hard" && d.status !== "pass" && d.status !== "na")).toEqual([]);
    expect(a.fit).toBe("suitable");
    expect(a.nextStep.en).toMatch(/primary posting/); // lifecycle unchecked → сначала проверить карточку
  });

  it("одна вакансия — разные кандидаты и условия", () => {
    const v = base({ title: "Junior Data Annotator", description: goodText, location: "Russia, CIS" });
    const ru = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "a", now: NOW });
    const us = assess({ rules: rulesRu({ location: { country: "US", city: null, timezone: "America/New_York" } }), profileVersion: 1, skills: [], vacancy: v, candidateId: "b", now: NOW });
    const highFloor = assess({ rules: rulesRu({ pay: { mode: "hard", minimums: [{ currency: "USD", amountMonthly: 1000 }] } }), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    expect(ru.fit).toBe("suitable");
    expect(us.fit).toBe("unsuitable"); // локация «Russia, CIS» не включает США
    expect(dimOf(highFloor, "pay").status).toBe("fail");
    expect(highFloor.fit).toBe("unsuitable");
  });

  it("unknown ≠ reject: Worldwide даёт needs_check, US only — reject", () => {
    const body = "Image annotation work for our computer vision datasets. Entry level, training provided. $900 per month. Chat only, no calls. Flexible hours. English B1.";
    const ww = base({ title: "Data Annotator", description: body, location: "Worldwide" });
    const usOnly = base({ title: "Data Annotator", description: `${body} US only.`, location: "United States" });
    const a1 = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: ww, candidateId: "c", now: NOW });
    const a2 = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: usOnly, candidateId: "c", now: NOW });
    expect(dimOf(a1, "country").status).toBe("unknown");
    expect(a1.fit).toBe("needs_check");
    expect(dimOf(a2, "country").status).toBe("fail");
    expect(a2.fit).toBe("unsuitable");
  });

  it("EMEA/Europe не доказывают найм из России; EU only исключает; явное исключение России — reject", () => {
    const mk = (location: string, extra = "") => assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: base({ title: "Data Annotator", description: `Annotation. ${extra}`, location }), candidateId: "c", now: NOW });
    expect(dimOf(mk("EMEA"), "country").status).toBe("unknown");
    expect(dimOf(mk("Europe"), "country").status).toBe("unknown");
    expect(dimOf(mk("EU only"), "country").status).toBe("fail");
    expect(dimOf(mk("Worldwide", "We cannot hire in sanctioned countries: Cuba, Iran, North Korea, Russia."), "country").status).toBe("fail");
  });

  it("высокое совпадение не обходит жёсткий reject", () => {
    const v = base({ title: "Data Annotator", description: "Data annotation, labeling, dataset curation, bounding box and transcription work. Entry level. $3000 per month. Candidates must be located in the United States.", location: "United States" });
    const a = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    expect(a.relevance).toBeGreaterThan(50);
    expect(a.fit).toBe("unsuitable");
  });

  it("senior под junior-ярлыком отсекается по годам опыта", () => {
    const v = base({ title: "Junior Business Analyst", description: "Requirements: 4+ years of experience as a business analyst. BPMN.", location: "Russia" });
    const a = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    const e = dimOf(a, "experience");
    expect(e.status).toBe("fail");
    expect(e.reason.ru).toMatch(/junior/);
  });

  it("обязательный навык ≠ желательный; «со слов» ≠ подтверждено", () => {
    const text = "Requirements:\nExcel and SQL\nNice to have:\nPython\nAbout the role: entry level";
    const f = extractFacts({ title: "Junior Data Analyst", company: "X", location: "Russia", description: text });
    expect(f.skills.value.required.sort()).toEqual(["Excel", "SQL"]);
    expect(f.skills.value.preferred).toEqual(["Python"]);
    const v = base({ title: "Junior Data Analyst", description: text, location: "Russia" });
    const a = assess({
      rules: rulesRu(), profileVersion: 1, vacancy: v, candidateId: "c", now: NOW,
      skills: [
        { id: "1", candidateId: "c", skill: "Excel", kind: "proven", evidence: "", url: null, createdAt: "", updatedAt: "" },
        { id: "2", candidateId: "c", skill: "SQL", kind: "self_reported", evidence: "", url: null, createdAt: "", updatedAt: "" },
      ],
    });
    const s = dimOf(a, "skills");
    expect(s.status).toBe("unknown");
    expect(s.reason.en).toMatch(/self-reported, example needed: SQL/);
    expect(s.reason.en).toMatch(/nice to have: Python/);
    expect(s.constraint).toBe("soft");
  });

  it("обязательные звонки отсекаются для трека без звонков", () => {
    const v = base({ title: "Customer Support Specialist", description: "Handle inbound calls and phone support for customers. Remote from Russia. 40 000 ₽ в месяц.", location: "Russia" });
    const a = assess({ rules: rulesRu({ voice: { mode: "unset", noPhoneWork: false, noVoiceScreening: false } }), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    const vd = dimOf(a, "voice");
    expect(vd.status).toBe("fail");
    expect(vd.constraint).toBe("hard"); // трек «Поддержка в чате и email» noCalls
  });

  it("язык: требуемый уровень выше профиля — reject; не указан — unknown", () => {
    const hi = base({ title: "Data Annotator", description: "Native-level English required. Remote from Russia.", location: "Russia" });
    const a = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: hi, candidateId: "c", now: NOW });
    expect(dimOf(a, "language").status).toBe("fail");
    const none = base({ title: "Data Annotator", description: "We label images for our models. Remote work. This is a long English description ".repeat(5), location: "Russia" });
    expect(dimOf(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: none, candidateId: "c", now: NOW }), "language").status).toBe("unknown");
  });

  it("«your native language» не означает требование native English", () => {
    const f = extractFacts({ title: "Linguistic Tester", company: "X", location: "Remote", description: "You will translate content from English to your native language. Good English required." });
    expect(f.languages.value.find((l) => l.lang === "en")!.level).not.toBe("C2");
  });

  it("«fluent English» при B2 в профиле — уточнить, а не отказ; явный C1 при B2 — отказ", () => {
    const fluent = base({ title: "Data Annotator", description: "Requirements: Fluent in English. Remote from Russia.", location: "Russia" });
    expect(dimOf(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: fluent, candidateId: "c", now: NOW }), "language").status).toBe("unknown");
    const c1 = base({ title: "Data Annotator", description: "Requirements: English C1 level. Remote from Russia.", location: "Russia" });
    expect(dimOf(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: c1, candidateId: "c", now: NOW }), "language").status).toBe("fail");
  });

  it("неполный перечень стран («+ 35 other countries») — unknown, а не отказ", () => {
    const v = base({ title: "Data Annotator", description: "Annotation tasks for AI models with clear guidelines and training.", location: "US, UK, Canada, Australia + 35 other countries" });
    expect(dimOf(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW }), "country").status).toBe("unknown");
  });

  it("исключённые темы и платное обучение — жёсткий отказ", () => {
    const v = base({ title: "Chat Support Agent", description: "Support for an online casino via chat.", location: "Russia" });
    expect(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW }).fit).toBe("unsuitable");
    const fee = base({ title: "Data Annotator", description: "Pay a registration fee of $50 to start.", location: "Russia" });
    expect(dimOf(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: fee, candidateId: "c", now: NOW }), "safety").status).toBe("fail");
  });

  it("без явных признаков риска безопасность остаётся «не проверено» (soft unknown), а не pass", () => {
    const v = base({ title: "Data Annotator", description: "Annotation work on image datasets for an AI team, with a clear guideline.", location: "Russia" });
    const s = dimOf(assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW }), "safety");
    expect(s.status).toBe("unknown");
    expect(s.constraint).toBe("soft");
  });

  it("при нуле направлений оценка работает (role = na)", () => {
    const v = base({ title: "Anything", description: "Some job", location: "Russia" });
    const a = assess({ rules: rulesRu({ tracks: [] }), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    expect(dimOf(a, "role").status).toBe("na");
  });

  it("все сообщения двуязычные", () => {
    const v = base({ title: "Data Annotator", description: "Annotation. Worldwide.", location: "Worldwide" });
    const a = assess({ rules: rulesRu(), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    for (const d of a.dimensions) {
      expect(d.reason.ru.length).toBeGreaterThan(0);
      expect(d.reason.en.length).toBeGreaterThan(0);
      expect(d.label.en).not.toMatch(/[а-яё]/i);
    }
    expect(a.nextStep.en).not.toMatch(/[а-яё]/i);
  });
});

describe("оплата", () => {
  const floors = [{ currency: "RUB", amountMonthly: 25000 }, { currency: "USD", amountMonthly: 500 }];
  it("«до» не гарантирует минимум", () => {
    const s = parseSalaryText("Зарплата до 60 000 ₽ в месяц")!;
    expect(s.kind).toBe("up_to");
    expect(judgePay(s, floors).status).toBe("unknown");
  });
  it("«до» ниже минимума — reject", () => {
    const s = parseSalaryText("до 20 000 ₽ в месяц")!;
    expect(judgePay(s, floors).status).toBe("fail");
  });
  it("оценка площадки — unknown", () => {
    const s = parseSalaryText("Estimated salary: $2,000 - $3,000 per month (Glassdoor estimate)")!;
    expect(s.kind).toBe("platform_estimate");
    expect(judgePay(s, floors).status).toBe("unknown");
  });
  it("почасовая без гарантированных часов — unknown; с гарантией — считается", () => {
    const s = parseSalaryText("$10 per hour, flexible schedule")!;
    expect(s.kind).toBe("hourly");
    expect(judgePay(s, floors).status).toBe("unknown");
    const g = parseSalaryText("$10 per hour, guaranteed 20 hours per week")!;
    expect(g.guaranteedHoursPerWeek).toBe(20);
    expect(judgePay(g, floors).status).toBe("pass"); // 10*20*4.33 = 866
  });
  it("почасовая так мала, что даже 40 ч/нед ниже минимума — reject", () => {
    const s = parseSalaryText("$2 per hour")!;
    expect(judgePay(s, floors).status).toBe("fail");
  });
  it("валюта без правила (EUR) — unknown без выдуманного курса", () => {
    const s = parseSalaryText("€900 per month")!;
    const v = judgePay(s, floors);
    expect(v.status).toBe("unknown");
    expect(v.reason.en).toMatch(/No minimum is set for EUR/);
  });
  it("годовой оклад пересчитывается, рубли «от … до …»", () => {
    expect(judgePay(parseSalaryText("$12,000 - $15,000 per year")!, floors).status).toBe("pass");
    const r = parseSalaryText("от 30 000 до 45 000 руб. в месяц")!;
    expect([r.min, r.max, r.currency]).toEqual([30000, 45000, "RUB"]);
    expect(judgePay(r, floors).status).toBe("pass");
  });
  it("оплата за задачу не даёт месячного минимума", () => {
    expect(judgePay(parseSalaryText("$1000 per task")!, floors).status).toBe("unknown");
  });
});

describe("часовые пояса и DST", () => {
  it("9–17 ET летом и зимой пересчитывается по-разному для Самары (UTC+4)", () => {
    const summer = convertWindow("09:00", "17:00", "America/New_York", "Europe/Samara", "2026-07-15");
    const winter = convertWindow("09:00", "17:00", "America/New_York", "Europe/Samara", "2026-12-15");
    expect([summer.startLocal, summer.endLocal, summer.crossesMidnight]).toEqual(["17:00", "01:00", true]);
    expect([winter.startLocal, winter.endLocal]).toEqual(["18:00", "02:00"]);
  });
  it("распознаёт рабочие часы с зоной", () => {
    expect(parseWorkingHours("Working hours: 9am-5pm EST, Monday to Friday")).toMatchObject({ start: "09:00", end: "17:00", zone: "America/New_York" });
    expect(parseWorkingHours("График с 10:00 до 19:00 МСК")).toMatchObject({ start: "10:00", end: "19:00", zone: "Europe/Moscow" });
    expect(parseWorkingHours("Requires 2-3 years")).toBeNull();
  });
  it("часы вне окна кандидата — reject", () => {
    const v = vac({ title: "Data Annotator", description: "Remote from Russia. Shift 9am-5pm PST.", location: "Russia" });
    const a = assess({ rules: rulesRu({ hours: { mode: "hard", earliestLocal: "08:00", latestLocal: "22:00", maxWeeklyHours: 40 } }), profileVersion: 1, skills: [], vacancy: v, candidateId: "c", now: NOW });
    expect(dimOf(a, "hours").status).toBe("fail");
  });
});

describe("тип объявления", () => {
  it("навигация vs объявление vs пул vs сигнал", () => {
    expect(classifyPosting({ title: "Careers", company: "Acme", url: "https://acme.com/careers", description: "x".repeat(200) }).kind).toBe("navigation");
    expect(classifyPosting({ title: "Data Analyst", company: "Acme", url: "https://acme.com/careers/", description: "x".repeat(200) }).kind).toBe("navigation");
    expect(classifyPosting({ title: "General Application", company: "Acme", url: "https://acme.com/jobs/1", description: "Join our talent community for future opportunities. ".repeat(4) }).kind).toBe("talent_pool");
    expect(classifyPosting({ title: "Data Analyst", company: "", url: "https://agg.example/1", description: "x".repeat(200) }).kind).toBe("aggregator_signal");
    expect(classifyPosting({ title: "Data Analyst Bootcamp", company: "School", url: "https://s.example/1", description: "Course fee: $500. Pay for the course and get a job. ".repeat(3) }).kind).toBe("paid_training");
    expect(classifyPosting({ title: "Junior Data Analyst", company: "Acme", url: "https://boards.greenhouse.io/acme/jobs/123", description: "Real description of the job with tasks. ".repeat(3) }).kind).toBe("job_posting");
  });
});

describe("жизненный цикл объявления", () => {
  const r = (p: Partial<Parameters<typeof interpretCheck>[0]>) => interpretCheck({ url: "https://acme.com/jobs/1", finalUrl: "https://acme.com/jobs/1", httpStatus: 200, bodyText: "", error: null, policyBlocked: null, isEmployerPage: true, ...p }, "Junior Data Analyst", "unchecked", NOW.toISOString());
  it("явное закрытие работодателем — closed", () => {
    expect(r({ bodyText: "Junior Data Analyst. This position has been filled." }).lifecycle).toBe("closed");
  });
  it("404 — не подтверждено, а не закрыто работодателем", () => {
    const x = r({ httpStatus: 404 });
    expect(x.lifecycle).toBe("unconfirmed");
    expect(x.evidence.type).toBe("http_404");
  });
  it("403/429/5xx/CAPTCHA/сеть не доказывают закрытие", () => {
    for (const p of [{ httpStatus: 403 }, { httpStatus: 429 }, { httpStatus: 503 }, { bodyText: "Please complete the CAPTCHA" }, { error: "ETIMEDOUT", httpStatus: null }]) {
      expect(r(p).lifecycle).not.toBe("closed");
    }
  });
  it("редирект на общий каталог учитывается отдельно", () => {
    expect(r({ finalUrl: "https://acme.com/careers" }).evidence.type).toBe("redirect_to_listing");
  });
  it("открытая карточка с названием — open", () => {
    expect(r({ bodyText: "Junior Data Analyst — apply now. ".repeat(20) }).lifecycle).toBe("open");
  });
  it("агрегатор о закрытии — не «закрыто работодателем»", () => {
    expect(r({ bodyText: "This job is no longer available", isEmployerPage: false }).lifecycle).toBe("unconfirmed");
  });
});

describe("исключённые источники — только по выбору пользователя", () => {
  const family = SERVICE_FAMILIES.find((f) => f.id === "headhunter")!;
  const ex = family.hosts.map((host) => ({ host, reason: "Исключено пользователем" }));
  it("по умолчанию ничего не исключено: hh.ru доступен", () => {
    expect(DEFAULT_EXCLUDED_HOSTS).toEqual([]);
    expect(blockedReason("https://hh.ru/vacancy/1", DEFAULT_EXCLUDED_HOSTS)).toBeNull();
    expect(safeExternalUrl("https://hh.ru/vacancy/1", DEFAULT_EXCLUDED_HOSTS).ok).toBe(true);
    expect(() => vac({ title: "X", description: "y", url: "https://hh.ru/vacancy/5" })).not.toThrow();
  });
  it("исключённое пользователем семейство блокируется во всех формах", () => {
    expect(blockedReason("https://hh.ru/vacancy/1", ex)).toBeTruthy();
    expect(blockedReason("https://samara.hh.ru/vacancy/1", ex)).toBeTruthy();
    expect(blockedReason("https://redirect.example.com/?url=https%3A%2F%2Fhh.ru%2Fvacancy%2F1", ex)).toBeTruthy();
    expect(blockedReason("https://mirror.example/go/hh.ru/vacancy/1", ex)).toBeTruthy();
    expect(blockedReason("https://api.hh.ru/vacancies", ex)).toBeTruthy();
    expect(blockedReason("https://rabota.by/vacancy/2", ex)).toBeTruthy();
  });
  it("похожие, но другие домены не блокируются", () => {
    expect(blockedReason("https://shh.ru/x", ex)).toBeNull();
    expect(blockedReason("https://career.habr.com/vacancies/1", ex)).toBeNull();
  });
  it("исключённая запись не попадает в базу, внешняя ссылка не открывается", () => {
    expect(() => vac({ title: "X", description: "y", url: "https://hh.ru/vacancy/5" }, ex)).toThrow();
    expect(() => vac({ title: "X", description: "Apply at https://hh.ru/vacancy/5 please" }, ex)).toThrow();
    expect(safeExternalUrl("https://hh.ru/vacancy/1", ex).ok).toBe(false);
    expect(safeExternalUrl("javascript:alert(1)", ex).ok).toBe(false);
    expect(safeExternalUrl("file:///etc/passwd", ex).ok).toBe(false);
    expect(safeExternalUrl("https://example.com/job", ex).ok).toBe(true);
  });
  it("канонический URL убирает трекинг", () => {
    expect(canonicalizeUrl("https://www.Example.com/jobs/1/?utm_source=x&b=2&a=1#top")).toBe("https://example.com/jobs/1?a=1&b=2");
  });
});

describe("дедупликация", () => {
  const ref = (p: Partial<VacRef>): VacRef => ({ id: "x", sourceId: "s1", sourceJobId: null, canonicalUrl: "https://a.example/1", requisitionId: null, company: "Acme Inc", title: "Support Agent", location: "Remote", description: "Help customers via chat and email. ".repeat(20), ...p });
  const index = (existing: VacRef[]): DedupeIndex => ({
    bySourceJob: (s, id) => existing.find((e) => e.sourceId === s && e.sourceJobId === id) ?? null,
    byCanonicalUrl: (u) => existing.find((e) => e.canonicalUrl === u) ?? null,
    byRequisition: (r) => existing.find((e) => e.requisitionId === r) ?? null,
    byFallbackKey: (k) => existing.filter((e) => fallbackKey(e.company, e.title) === k),
  });
  it("дубль между источниками по URL", () => {
    const d = decideDedupe(ref({ id: "n", sourceId: "s2" }), index([ref({ id: "e1" })]));
    expect(d.kind).toBe("same_url");
  });
  it("fallback по компании+названию+локации с похожим текстом", () => {
    const d = decideDedupe(ref({ id: "n", sourceId: "s2", canonicalUrl: "https://b.example/zz", company: "ACME" }), index([ref({ id: "e1" })]));
    expect(d.kind).toBe("fallback");
  });
  it("разные requisition и разные города не склеиваются", () => {
    const diffReq = decideDedupe(ref({ id: "n", canonicalUrl: "https://b.example/2", requisitionId: "greenhouse:2" }), index([ref({ id: "e1", requisitionId: "greenhouse:1" })]));
    expect(diffReq.kind).toBe("new");
    const diffCity = decideDedupe(ref({ id: "n", canonicalUrl: "https://b.example/3", location: "Berlin" }), index([ref({ id: "e1", location: "Lisbon" })]));
    expect(diffCity.kind).toBe("new");
    expect(diffCity.kind === "new" && diffCity.rejectedFallback).toMatch(/локации/);
  });
});

describe("расписание", () => {
  const s = { enabled: true, paused: false, cadence: "daily" as const, time: "09:00", weekday: 1, runInBackground: true };
  it("первое включение не запускает задним числом", () => {
    expect(planSchedule(s, null, new Date(2026, 9, 21, 12, 0)).action).toBe("none");
  });
  it("вовремя — run; после сна — один catchup и записанные пропуски", () => {
    expect(planSchedule(s, new Date(2026, 9, 20, 9, 0).toISOString(), new Date(2026, 9, 21, 9, 5)).action).toBe("run");
    const p = planSchedule(s, new Date(2026, 9, 17, 9, 0).toISOString(), new Date(2026, 9, 21, 15, 0));
    expect(p.action).toBe("catchup");
    expect(p.missed.length).toBe(3); // 18, 19, 20
  });
  it("пауза и выключение", () => {
    expect(planSchedule({ ...s, paused: true }, null, new Date()).action).toBe("paused");
    expect(planSchedule({ ...s, enabled: false }, null, new Date()).action).toBe("disabled");
  });
  it("уже обработанный слот не запускается повторно", () => {
    const slot = new Date(2026, 9, 21, 9, 0).toISOString();
    expect(planSchedule(s, slot, new Date(2026, 9, 21, 9, 10)).action).toBe("none");
  });
  it("еженедельно", () => {
    const w = { ...s, cadence: "weekly" as const, weekday: 3 }; // среда
    const p = planSchedule(w, new Date(2026, 9, 14, 9, 0).toISOString(), new Date(2026, 9, 21, 9, 1)); // 21.10.2026 — среда
    expect(p.action).toBe("run");
  });
});
