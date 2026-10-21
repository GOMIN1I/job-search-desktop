// Синтетические ответы источников (структура как у реальных API на 2026-10-21, содержимое вымышлено).

export const FIX = {
  jobicy: {
    apiVersion: "2", hasMore: false, nextCursor: null,
    jobs: [
      { id: 9001, url: "https://jobicy.com/jobs/9001-junior-data-annotator", jobTitle: "Junior Data Annotator", companyName: "Synth Vision", jobIndustry: ["Data Science"], jobType: ["Full-Time"], jobGeo: "Russia, Kazakhstan", jobLevel: "Entry", jobDescription: "<p>Entry level. Training provided.</p><p>Label images via our tool. Chat and email only, no calls. Flexible hours. English B1.</p>", pubDate: "2026-10-20T10:00:00+00:00", salaryMin: 9000, salaryMax: 12000, salaryCurrency: "USD", salaryPeriod: "yearly" },
      { id: 9002, url: "https://jobicy.com/jobs/9002-senior-ml-engineer", jobTitle: "Senior ML Engineer", companyName: "Synth Vision", jobIndustry: ["Engineering"], jobType: ["Full-Time"], jobGeo: "USA", jobLevel: "Senior", jobDescription: "<p>7+ years of experience.</p>", pubDate: "2026-10-20T10:00:00+00:00", salaryMin: 190000, salaryMax: 250000, salaryCurrency: "USD", salaryPeriod: "yearly" },
    ],
  },
  remotive: {
    "0-legal-notice": "…", jobs: [
      { id: 7001, url: "https://remotive.com/remote-jobs/customer-support/chat-support-7001", title: "Chat Support Agent", company_name: "Helpful Synth", category: "Customer Service", tags: ["zendesk"], job_type: "full_time", publication_date: "2026-10-19T08:00:00", candidate_required_location: "Worldwide", salary: "$1,000 - $1,200 per month", description: "<p>Answer tickets by chat and email. Entry level.</p>" },
      // Тот же пост, что у Jobicy, но другой URL — проверка fallback-дедупликации
      { id: 7002, url: "https://remotive.com/remote-jobs/data/junior-data-annotator-7002", title: "Junior Data Annotator", company_name: "Synth Vision Inc", category: "Data", tags: [], job_type: "full_time", publication_date: "2026-10-20T08:00:00", candidate_required_location: "Russia, Kazakhstan", salary: "", description: "<p>Entry level. Training provided.</p><p>Label images via our tool. Chat and email only, no calls. Flexible hours. English B1.</p>" },
      // Запрещённое происхождение
      { id: 7003, url: "https://remotive.com/remote-jobs/x-7003", title: "Mirror job", company_name: "Mirror", category: "x", tags: [], job_type: "", publication_date: "2026-10-20T08:00:00", candidate_required_location: "Russia", salary: "", description: "<p>Apply via https://hh.ru/vacancy/123</p>" },
    ],
  },
  himalayas: {
    totalCount: 3, nextCursor: null, jobs: [
      { title: "AI Response Evaluator", companyName: "Rater Synth", employmentType: "Contractor", minSalary: null, maxSalary: null, seniority: ["Entry-level"], currency: null, locationRestrictions: ["Armenia", "Kazakhstan"], categories: ["AI"], parentCategories: [], description: "<p>Evaluate LLM responses. $15 per hour.</p>", pubDate: 1792483205, applicationLink: "https://himalayas.app/companies/rater-synth/jobs/ai-response-evaluator?utm_source=api", guid: "https://himalayas.app/companies/rater-synth/jobs/ai-response-evaluator" },
    ],
  },
  remoteok: [
    { legal: "Please link back to Remote OK" },
    { id: "5001", slug: "x", date: "2026-10-20T08:00:05+00:00", company: "Synth Ops", position: "Back Office Assistant â€” Remote", tags: ["ops"], description: "Order processing in CRM. Entry level.", location: "", apply_url: "https://remoteOK.com/remote-jobs/5001", url: "https://remoteOK.com/remote-jobs/5001", salary_min: 0, salary_max: 0 },
  ],
  workingnomads: [
    { url: "https://www.workingnomads.com/job/go/3001/", title: "Content Moderator", description: "<p>Moderate user content. Entry level.</p>", company_name: "Mod Synth", category_name: "Admin", tags: "moderation,content", location: "Europe, LATAM", pub_date: "2026-10-20T13:39:57-04:00" },
  ],
  wwr: `<?xml version="1.0"?><rss><channel><item><title>Synth Docs: Documentation Assistant</title><region>Anywhere in the World</region><country></country><category>Admin</category><type>Contract</type><description>&lt;p&gt;Maintain documents in Word and Excel.&lt;/p&gt;</description><pubDate>Mon, 20 Oct 2026 10:00:00 +0000</pubDate><link>https://weworkremotely.com/remote-jobs/synth-docs-documentation-assistant</link><guid>https://weworkremotely.com/remote-jobs/synth-docs-documentation-assistant</guid></item></channel></rss>`,
  themuse: {
    page: 0, page_count: 1, total: 1, results: [
      { id: 41001, name: "Data Labeling Specialist", type: "external", publication_date: "2026-10-20T09:00:00Z", contents: "<p>Label text data. Entry level. Remote within the EU.</p>", locations: [{ name: "Flexible / Remote" }], levels: [{ name: "Entry Level" }], categories: [{ name: "Data and Analytics" }], refs: { landing_page: "https://www.themuse.com/jobs/synthlabel/data-labeling-specialist" }, company: { name: "Synth Label" } },
    ],
  },
  arbeitnow: {
    data: [
      { slug: "support-agent-berlin-1", company_name: "Synth GmbH", title: "Customer Support Agent (Remote)", description: "<p>Chat support in English. Entry level.</p>", remote: true, url: "https://www.arbeitnow.com/jobs/companies/synth-gmbh/support-agent-berlin-1", tags: ["Support"], job_types: ["Full time"], location: "Berlin", created_at: 1792483205 },
    ],
    links: { next: null },
  },
  hh: {
    found: 1, pages: 1, page: 0, per_page: 100, items: [
      { id: "123456", name: "Младший аналитик данных", area: { id: "113", name: "Россия" }, salary: { from: 60000, to: 80000, currency: "RUR", gross: false }, published_at: "2026-10-20T10:00:00+0300", alternate_url: "https://hh.ru/vacancy/123456", apply_alternate_url: "https://hh.ru/applicant/vacancy_response?vacancyId=123456", employer: { name: "Синт Дата" }, snippet: { requirement: "Excel, SQL на базовом уровне.", responsibility: "Разметка и проверка данных." }, schedule: { id: "remote", name: "Удаленная работа" }, experience: { id: "noExperience", name: "Нет опыта" }, employment: { id: "full", name: "Полная занятость" } },
    ],
  },
  habr: `<?xml version="1.0"?><rss><channel><item><title>Требуется «Младший бизнес-аналитик» (Самара)</title><description>Компания «Синт Софт» ищет хорошего специалиста на вакансию «Младший бизнес-аналитик». Самара (Россия). Полный рабочий день. Можно удалённо. От 40 000 ₽ до 60 000 ₽. Требуемые навыки: #junior, #BPMN, #SQL.</description><author>Синт Софт</author><pubDate>Wed, 21 Oct 2026 14:19:55 +0300</pubDate><link>https://career.habr.com/vacancies/1000000001</link><guid>1000000001</guid></item></channel></rss>`,
};

export type FakeBehavior = Partial<Record<"jobicy" | "remotive" | "himalayas" | "remoteok" | "workingnomads" | "weworkremotely" | "habrcareer" | "themuse" | "arbeitnow" | "hh", "ok" | "500" | "429" | "403" | "throw" | "empty" | "badjson">>;

export const ALL_DEFAULT_SOURCES = ["jobicy", "remotive", "himalayas", "remoteok", "workingnomads", "weworkremotely", "habrcareer", "themuse", "arbeitnow"] as const;

export function fakeFetcher(behavior: FakeBehavior = {}, calls: string[] = [], headers: Array<Record<string, string>> = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push(url);
    headers.push(Object.fromEntries(new Headers(init?.headers ?? {}).entries()));
    const key = url.includes("jobicy") ? "jobicy" : url.includes("remotive") ? "remotive" : url.includes("himalayas") ? "himalayas" : url.includes("remoteok") ? "remoteok" : url.includes("workingnomads") ? "workingnomads" : url.includes("weworkremotely") ? "weworkremotely" : url.includes("habr") ? "habrcareer" : url.includes("themuse") ? "themuse" : url.includes("arbeitnow") ? "arbeitnow" : url.includes("api.hh.ru") ? "hh" : "other";
    const b = (behavior as any)[key] ?? "ok";
    if (b === "throw") throw new TypeError("fetch failed (offline)");
    if (b === "500") return new Response("err", { status: 500 });
    if (b === "403") return new Response('{"errors":[{"type":"forbidden"}]}', { status: 403 });
    if (b === "429") return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
    if (b === "badjson") return new Response("<html>not json</html>", { status: 200 });
    const body =
      key === "jobicy" ? (b === "empty" ? { jobs: [] } : FIX.jobicy)
      : key === "remotive" ? (b === "empty" ? { jobs: [] } : FIX.remotive)
      : key === "himalayas" ? (b === "empty" ? { jobs: [] } : FIX.himalayas)
      : key === "remoteok" ? (b === "empty" ? [] : FIX.remoteok)
      : key === "workingnomads" ? (b === "empty" ? [] : FIX.workingnomads)
      : key === "weworkremotely" ? (b === "empty" ? "<rss></rss>" : FIX.wwr)
      : key === "habrcareer" ? (b === "empty" ? "<rss></rss>" : FIX.habr)
      : key === "themuse" ? (b === "empty" ? { results: [], page_count: 0 } : FIX.themuse)
      : key === "arbeitnow" ? (b === "empty" ? { data: [], links: { next: null } } : FIX.arbeitnow)
      : key === "hh" ? (b === "empty" ? { items: [], pages: 0, found: 0 } : FIX.hh)
      : "not found";
    if (key === "other") return new Response("not found", { status: 404 });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };
}

/** Поведение «у всех источников по умолчанию одно и то же». */
export const allDefault = (b: "throw" | "empty"): FakeBehavior => Object.fromEntries(ALL_DEFAULT_SOURCES.map((k) => [k, b]));
