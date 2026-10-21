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
  habr: `<?xml version="1.0"?><rss><channel><item><title>Требуется «Младший бизнес-аналитик» (Самара)</title><description>Компания «Синт Софт» ищет хорошего специалиста на вакансию «Младший бизнес-аналитик». Самара (Россия). Полный рабочий день. Можно удалённо. От 40 000 ₽ до 60 000 ₽. Требуемые навыки: #junior, #BPMN, #SQL.</description><author>Синт Софт</author><pubDate>Wed, 21 Oct 2026 14:19:55 +0300</pubDate><link>https://career.habr.com/vacancies/1000000001</link><guid>1000000001</guid></item></channel></rss>`,
};

export type FakeBehavior = Partial<Record<"jobicy" | "remotive" | "himalayas" | "remoteok" | "workingnomads" | "weworkremotely" | "habrcareer", "ok" | "500" | "429" | "throw" | "empty" | "badjson">>;

export function fakeFetcher(behavior: FakeBehavior = {}, calls: string[] = []) {
  return async (url: string): Promise<Response> => {
    calls.push(url);
    const key = url.includes("jobicy") ? "jobicy" : url.includes("remotive") ? "remotive" : url.includes("himalayas") ? "himalayas" : url.includes("remoteok") ? "remoteok" : url.includes("workingnomads") ? "workingnomads" : url.includes("weworkremotely") ? "weworkremotely" : url.includes("habr") ? "habrcareer" : "other";
    const b = (behavior as any)[key] ?? "ok";
    if (b === "throw") throw new TypeError("fetch failed (offline)");
    if (b === "500") return new Response("err", { status: 500 });
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
      : "not found";
    if (key === "other") return new Response("not found", { status: 404 });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };
}
