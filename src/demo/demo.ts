// Обезличенный синтетический демо-набор. Все компании и вакансии вымышлены, помечены is_demo
// и никогда не смешиваются с реальными данными (демо-кандидат оценивает только демо-вакансии).

import type { Repo } from "../db/repo";
import type { SearchRules } from "../shared/types";
import { ROLE_TEMPLATES, trackFromTemplate, emptyRules, DEFAULT_EXCLUDED_TOPICS } from "../core/templates";
import type { RawJob } from "../sources/adapters";
import { assessAll, ingestRaw } from "../pipeline/run";

export const DEMO_CANDIDATE_ID = "cand-demo";

export function demoRules(lang: "ru" | "en"): SearchRules {
  return {
    ...emptyRules(),
    tracks: ["ai-annotation", "ai-eval", "ai-trainer", "written-support", "data-entry"].map((id) => trackFromTemplate(ROLE_TEMPLATES.find((t) => t.id === id)!, lang)),
    location: { country: "KZ", city: "Алматы", timezone: "Asia/Almaty" },
    countryEligibility: { mode: "hard" },
    workFormat: { mode: "hard", remote: true, hybrid: false, office: false, hybridCities: [] },
    pay: { mode: "hard", minimums: [{ currency: "USD", amountMonthly: 600 }, { currency: "KZT", amountMonthly: 250000 }] },
    hours: { mode: "soft", earliestLocal: "09:00", latestLocal: "21:00", maxWeeklyHours: 40 },
    languages: { mode: "hard", items: [{ lang: "en", written: "B2", spoken: "B1", basis: "self_reported" }, { lang: "ru", written: "C2", spoken: "C2", basis: "certified" }] },
    voice: { mode: "hard", noPhoneWork: true, noVoiceScreening: false },
    experience: { mode: "hard", maxYearsRequired: 1, allowSenior: false },
    excludedKeywords: DEFAULT_EXCLUDED_TOPICS,
    freshnessDays: 30,
  };
}

const D = (n: number, now: Date) => new Date(now.getTime() - n * 86400000).toISOString();

function demoJobs(now: Date): RawJob[] {
  const base = { sourceId: "demo", applyUrl: null, employmentType: "Full-time", levelText: null, salary: null, tags: [], remoteBySource: true, isEmployerAts: false };
  const j = (id: string, p: Partial<RawJob> & { title: string; company: string; description: string; location: string }): RawJob => ({
    ...base, sourceJobId: id, url: `https://example.com/demo/jobs/${id}`, publishedAt: D(1, now), ...p,
  });
  return [
    j("d1", { title: "Junior Data Annotator", company: "Northwind Labs (demo)", location: "Kazakhstan, Uzbekistan, Armenia", description: "Entry level role, training provided.\nYou will label images and short texts for our AI models using clear guidelines.\nRequirements:\nEnglish B2 (written)\nExcel\nCommunication via chat and email only, no calls.\nFlexible hours, async team.\nSalary $800 per month, fixed, paid monthly via bank transfer." }),
    j("d2", { title: "AI Response Evaluator", company: "Contoso AI (demo)", location: "Worldwide", description: "Evaluate model responses against a rubric. LLM evaluation and rating work. Entry level, training provided. Pay: $12 per hour, flexible schedule, work as many hours as you like. Written English required at C1 level." }),
    j("d3", { title: "Chat Support Specialist", company: "Fabrikam Help (demo)", location: "United States", description: "Answer customer questions via chat and email. Zendesk. Entry level. Candidates must be located in the United States. $3,000 per month." }),
    j("d4", { title: "Junior Customer Support Agent", company: "Tailspin Retail (demo)", location: "Kazakhstan", description: "Support customers with orders. Inbound calls and phone support are a core part of the role. Salary from 300 000 ₸ per month. Entry level." , salary: { min: 300000, currency: "KZT", period: "month" } }),
    j("d5", { title: "Junior Data Entry Operator", company: "Litware Data (demo)", location: "Remote, CIS", description: "Ввод данных в CRM и Google Sheets, проверка карточек товаров. Опыт не требуется, обучение за счёт компании. Только переписка, без звонков. Гибкий график. Оплата до 400 000 ₸ в месяц.", salary: { text: "до 400 000 тенге в месяц" } }),
    j("d6", { title: "Junior Data Annotator (Senior track)", company: "Adventure Works (demo)", location: "EMEA", description: "Despite the title, requirements: 5+ years of experience in data labeling team management. Salary $2,000 - $2,500 per month." }),
    j("d7", { title: "AI Trainer — Russian language", company: "Wide World Tutors (demo)", location: "Kazakhstan, Russia, Armenia", description: "Train AI models by writing and reviewing Russian-language responses. Entry level, no experience required. $900 per month fixed for 20 guaranteed hours per week. Do not use AI tools to write your application answers — AI-generated applications will be rejected. Written work only, no calls. Flexible hours." }),
    j("d8", { title: "Careers", company: "Proseware (demo)", location: "", url: "https://example.com/demo/careers", description: "See all open positions at Proseware. Benefits, offices and teams." }),
    j("d9", { title: "General Application — Talent Community", company: "Proseware (demo)", location: "Worldwide", description: "Don't see the role you are looking for? Join our talent community and submit your resume for future opportunities." }),
    j("d10", { title: "Data Labeling QA (Night shift)", company: "Blue Yonder Ops (demo)", location: "Kazakhstan", description: "Quality checks of labeled datasets. Entry level. Shift 9am-5pm PST. $1,000 per month. Chat only, no calls. English B1." }),
    j("d11", { title: "Junior Data Annotator", company: "Northwind Labs (demo)", location: "Kazakhstan, Uzbekistan, Armenia", url: "https://example.com/demo/mirror/northwind-annotator", sourceJobId: "d11-mirror", description: "Entry level role, training provided.\nYou will label images and short texts for our AI models using clear guidelines.\nRequirements:\nEnglish B2 (written)\nExcel\nCommunication via chat and email only, no calls.\nFlexible hours, async team.\nSalary $800 per month, fixed, paid monthly via bank transfer." }),
    j("d12", { title: "Online Casino Chat Agent", company: "Lucky Demo Ltd (demo)", location: "Worldwide", description: "Chat support for an online casino platform. $1,200 per month. Entry level." }),
  ];
}

/** Создаёт (или обновляет) демо-кандидата и синтетические вакансии. Идемпотентно. */
export function loadDemo(repo: Repo, lang: "ru" | "en", now = new Date()) {
  if (!repo.getCandidate(DEMO_CANDIDATE_ID)) {
    repo.createCandidate({
      id: DEMO_CANDIDATE_ID,
      name: lang === "ru" ? "Демо: Алекс (пример)" : "Demo: Alex (sample)",
      rules: demoRules(lang),
      isDemo: true,
      notes: lang === "ru" ? "Синтетический профиль для знакомства с приложением. Данные вымышлены." : "Synthetic profile to explore the app. All data is fictional.",
      note: "demo",
    });
    repo.upsertSkill({ candidateId: DEMO_CANDIDATE_ID, skill: "Excel", kind: "proven", evidence: lang === "ru" ? "Учебный проект: таблица учёта заказов (пример)" : "Course project: order tracking sheet (sample)", url: null });
    repo.upsertSkill({ candidateId: DEMO_CANDIDATE_ID, skill: "data annotation", kind: "self_reported", evidence: lang === "ru" ? "Со слов, нужен пример" : "Self-reported, example needed", url: null });
    repo.upsertSkill({ candidateId: DEMO_CANDIDATE_ID, skill: "Google Sheets", kind: "proven", evidence: lang === "ru" ? "Пример отчёта в портфолио (вымышлено)" : "Sample report in portfolio (fictional)", url: null });
  }
  let n = 0;
  repo.transaction(() => {
    for (const r of demoJobs(now)) {
      const out = ingestRaw(repo, r, { runId: null, now, isDemo: true, provenance: "demo:synthetic" });
      if (out.change === "new") n++;
    }
  });
  assessAll(repo, { candidateIds: [DEMO_CANDIDATE_ID], now });
  return { created: n };
}
