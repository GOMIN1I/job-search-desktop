import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSearchServer } from "../server/src/server";
import { CloudClient } from "../src/main/cloud";
import { openDatabase } from "../src/db/db";
import { Repo } from "../src/db/repo";
import { parseInstructions } from "../src/core/instructions";
import { nextSlot, previousSlot } from "../src/core/schedule";
import { fakeFetcher } from "./fakeSources";
import { rulesRu } from "./helpers";
import type { ScheduleSettings } from "../src/shared/types";

const sec = { encryptionAvailable: () => true, encrypt: (s: string) => Buffer.from(s).toString("base64"), decrypt: (b: string) => Buffer.from(b, "base64").toString() };
const cleanup: Array<() => void> = [];
afterAll(() => cleanup.forEach((f) => f()));

describe("расписание в часовом поясе человека", () => {
  it("09:00 по Алматы — это 04:00 UTC, независимо от пояса машины", () => {
    const s: ScheduleSettings = { enabled: true, paused: false, cadence: "daily", time: "09:00", weekday: 1, runInBackground: false, timezone: "Asia/Almaty" };
    expect(nextSlot(s, new Date("2026-10-22T03:00:00Z")).toISOString()).toBe("2026-10-22T04:00:00.000Z");
    expect(previousSlot(s, new Date("2026-10-22T03:00:00Z")).toISOString()).toBe("2026-10-21T04:00:00.000Z");
  });
  it("переход на зимнее время (Нью-Йорк, 1 ноября 2026) учитывается", () => {
    const s: ScheduleSettings = { enabled: true, paused: false, cadence: "daily", time: "09:00", weekday: 1, runInBackground: false, timezone: "America/New_York" };
    expect(nextSlot(s, new Date("2026-10-31T12:00:00Z")).toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(nextSlot(s, new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
  it("еженедельно — в нужный день недели", () => {
    const s: ScheduleSettings = { enabled: true, paused: false, cadence: "weekly", time: "08:30", weekday: 1, runInBackground: false, timezone: "Europe/Berlin" };
    expect(nextSlot(s, new Date("2026-10-22T12:00:00Z")).toISOString()).toBe("2026-10-26T07:30:00.000Z"); // понедельник, CET
  });
});

describe("сервер поиска: поиск, когда компьютер выключен", () => {
  it("профиль → поиск по расписанию без приложения → результаты при возвращении", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-cloud-"));
    let clock = new Date("2026-10-22T03:58:00Z"); // 08:58 в Алматы
    const srv = createSearchServer({ dataDir: path.join(dir, "srv"), secret: "x".repeat(40), fetcher: fakeFetcher() as any, now: () => clock, pauseMs: 0, tickMs: 3_600_000 });
    const port = await srv.listen(0);
    cleanup.push(() => srv.close());

    // Приложение
    const { db } = openDatabase(path.join(dir, "app.sqlite"));
    const repo = new Repo(db);
    repo.seedDefaults();
    const text = "Не используй hh.ru и связанные сервисы";
    repo.createCandidate({ id: "c1", name: "Алекс (пример)", rules: { ...rulesRu(), aiInstructions: { text, parsed: parseInstructions(text), parsedBy: "rules", parsedAt: null, parsedFor: text, resolutions: {} } } });
    const schedule: ScheduleSettings = { enabled: true, paused: false, cadence: "daily", time: "09:00", weekday: 1, runInBackground: false, timezone: "Asia/Almaty" };
    const client = new CloudClient(repo, sec, async () => ({ hhToken: "secret-hh", adzuna: null }), () => schedule);
    const st = await client.connect(`http://127.0.0.1:${port}`, false);
    expect(st.connected).toBe(true);

    // Сервер получил профиль с инструкциями; доступы без согласия не переданы
    const status0 = await (await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: { Authorization: `Bearer ${sec.decrypt(repo.getMeta("cloud_token_enc", ""))}` } })).json();
    expect(status0.hasCredentials).toBe(false);
    expect(status0.next).toBe("2026-10-22T04:00:00.000Z");

    // «Компьютер выключен»: сервер сам проверяет расписание
    await srv.tick(); // 08:58 — отметка текущего слота, без запуска задним числом
    clock = new Date("2026-10-22T04:01:00Z"); // 09:01 в Алматы
    await srv.tick();
    const status1 = await (await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: { Authorization: `Bearer ${sec.decrypt(repo.getMeta("cloud_token_enc", ""))}` } })).json();
    expect(status1.runs[0]).toMatchObject({ trigger: "scheduled" });
    expect(status1.lastStatus).toMatch(/succeeded|partial/);
    await srv.tick(); // повторно в тот же слот — не ищет
    const status2 = await (await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: { Authorization: `Bearer ${sec.decrypt(repo.getMeta("cloud_token_enc", ""))}` } })).json();
    expect(status2.runs).toHaveLength(1);

    // Человек вернулся: приложение забирает собранное, оценивает по своим правилам и уведомляет
    expect(repo.listVacanciesForCandidate("c1")).toHaveLength(0);
    const got = await client.pull();
    expect(got!.inserted).toBeGreaterThan(3);
    expect(repo.listVacanciesForCandidate("c1").length).toBe(got!.inserted);
    expect(repo.listNotifications("c1").length).toBeGreaterThan(0);
    // Повторный забор не дублирует
    expect((await client.pull())!.inserted).toBe(0);

    // Согласие на передачу доступов
    client.setShareCredentials(true);
    await client.push();
    const status3 = await (await fetch(`http://127.0.0.1:${port}/v1/status`, { headers: { Authorization: `Bearer ${sec.decrypt(repo.getMeta("cloud_token_enc", ""))}` } })).json();
    expect(status3.hasCredentials).toBe(true);
    // Файл аккаунта на сервере не содержит токен в открытом виде
    const reg = fs.readFileSync(path.join(dir, "srv", "registry.sqlite"));
    expect(reg.includes(Buffer.from("secret-hh"))).toBe(false);

    // Удаление аккаунта
    await client.disconnect(true);
    expect(client.state().connected).toBe(false);
    expect(fs.readdirSync(path.join(dir, "srv", "accounts")).filter((f) => f.endsWith(".sqlite"))).toHaveLength(0);
    db.close();
  });

  it("без токена — 401; чужой токен не даёт доступа", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-cloud2-"));
    const srv = createSearchServer({ dataDir: dir, secret: "y".repeat(40), fetcher: fakeFetcher() as any, pauseMs: 0, tickMs: 3_600_000 });
    const port = await srv.listen(0);
    cleanup.push(() => srv.close());
    expect((await fetch(`http://127.0.0.1:${port}/v1/results`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${port}/v1/results`, { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });
});
