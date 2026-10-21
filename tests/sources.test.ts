import { describe, expect, it } from "vitest";
import { collect, SOURCE_DEFINITIONS } from "../src/sources/adapters";
import { museCategories } from "../src/sources/adapters";
import { buildQueries, parseAdzuna, parseArbeitnow, parseHh, parseMuse } from "../src/sources/search";
import { FIX, fakeFetcher } from "./fakeSources";

const def = (id: string) => SOURCE_DEFINITIONS.find((d) => d.id === id)!;
const base = { fetchOpts: { excluded: [], retries: 0, retryBaseMs: 0 }, pauseMs: 0 };

describe("источники с поиском по запросу", () => {
  it("hh.ru: разбор выдачи, рубли, удалёнка, ссылка на отклик", () => {
    const p = parseHh(FIX.hh);
    expect(p.found).toBe(1);
    expect(p.items[0]).toMatchObject({ sourceId: "hh", sourceJobId: "123456", company: "Синт Дата", remoteBySource: true, url: "https://hh.ru/vacancy/123456" });
    expect(p.items[0].salary).toMatchObject({ min: 60000, max: 80000, currency: "RUB", period: "month" });
    expect(p.items[0].description).toMatch(/Разметка и проверка данных/);
  });

  it("hh.ru без доступа — «не настроен», а не «работает»", async () => {
    await expect(collect(def("hh"), { ...base, maxPages: 2, queries: ["аналитик"], fetcher: fakeFetcher() as any })).rejects.toMatchObject({ notConfigured: true });
  });

  it("hh.ru с токеном: Bearer и HH-User-Agent, регион страны, отказ 403 не маскируется", async () => {
    const calls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const r = await collect(def("hh"), { ...base, maxPages: 4, queries: ["аналитик данных", "разметка"], countries: ["RU"], credentials: { hhToken: "tok" }, fetcher: fakeFetcher({}, calls, headers) as any });
    expect(r.items).toHaveLength(1); // одна и та же вакансия по двум запросам — без дублей
    expect(calls[0]).toMatch(/api\.hh\.ru\/vacancies\?text=.+&area=113/);
    expect(headers[0].authorization).toBe("Bearer tok");
    expect(headers[0]["hh-user-agent"]).toMatch(/JobSearchDesktop/);
    await expect(collect(def("hh"), { ...base, maxPages: 2, queries: ["x"], credentials: { hhToken: "bad" }, fetcher: fakeFetcher({ hh: "403" }) as any })).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("Adzuna без ключа — «не настроен»; разбор: оценка площадки помечена", async () => {
    await expect(collect(def("adzuna"), { ...base, maxPages: 2, queries: ["data"], fetcher: fakeFetcher() as any })).rejects.toMatchObject({ notConfigured: true });
    const p = parseAdzuna({ count: 1, results: [{ id: 5, title: "<strong>Data</strong> Entry", company: { display_name: "Synth" }, location: { display_name: "London" }, description: "Typing", redirect_url: "https://www.adzuna.co.uk/jobs/land/ad/5", created: "2026-10-20T10:00:00Z", salary_min: 20000, salary_max: 22000, salary_is_predicted: "1" }] });
    expect(p.items[0]).toMatchObject({ title: "Data Entry", company: "Synth" });
    expect(p.items[0].salary).toMatchObject({ estimate: true });
  });

  it("The Muse и Arbeitnow: разбор, удалёнка, пагинация", async () => {
    expect(parseMuse(FIX.themuse).items[0]).toMatchObject({ sourceId: "themuse", remoteBySource: true, company: "Synth Label" });
    expect(parseArbeitnow(FIX.arbeitnow)).toMatchObject({ next: null });
    const r = await collect(def("themuse"), { ...base, maxPages: 3, queries: ["data annotator"], fetcher: fakeFetcher() as any });
    expect(r.items.length).toBe(1);
    expect(r.coverage.perPageLimit).toBe(20);
  });

  it("Himalayas ищет по каждому направлению и читает свежую ленту", async () => {
    const calls: string[] = [];
    await collect(def("himalayas"), { ...base, maxPages: 6, queries: ["data annotator", "chat support"], fetcher: fakeFetcher({}, calls) as any });
    expect(calls.some((u) => u.includes("/jobs/api/search?q=data%20annotator"))).toBe(true);
    expect(calls.some((u) => u.includes("/jobs/api/search?q=chat%20support"))).toBe(true);
    expect(calls.some((u) => /\/jobs\/api\?limit=20/.test(u))).toBe(true);
  });

  it("запросы строятся из включённых направлений без повторов; категории The Muse подбираются по смыслу", () => {
    const q = buildQueries([
      { enabled: true, titleKeywords: ["data annotator", "data labeling"] },
      { enabled: false, titleKeywords: ["sales"] },
      { enabled: true, titleKeywords: ["Data Annotator", "chat support"] },
    ]);
    expect(q).toEqual(["data annotator", "data labeling", "chat support"]);
    expect(museCategories(["chat support", "data labeling"])).toEqual(expect.arrayContaining(["Customer Service", "Data and Analytics"]));
  });
});
