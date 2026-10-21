// Запись коротких видео реальной работы приложения для сайта и ролика (Playwright + Electron).
// Данные — временная папка; профиль синтетический («Алекс, пример»); поиск — настоящий, по живым источникам.
// Результат: media-src/*.webm + кадры *.png. Затем scripts/encode-media.sh кодирует в mp4/jpg.
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = path.resolve(process.argv[2] || "media-src");
const lang = process.env.REC_LANG || "ru";
const only = process.env.REC_ONLY ? process.env.REC_ONLY.split(",") : null;
fs.mkdirSync(OUT, { recursive: true });
const L = (ru, en) => (lang === "ru" ? ru : en);
const W = 1280, H = 800;

// Заметный курсор и «волна» клика — видео понятнее без звука.
const CURSOR = `(() => {
  if (document.getElementById('rec-cursor')) return;
  const c = document.createElement('div'); c.id = 'rec-cursor';
  c.style.cssText = 'position:fixed;z-index:99999;left:-40px;top:-40px;width:22px;height:22px;pointer-events:none;transition:left .32s cubic-bezier(.22,1,.36,1),top .32s cubic-bezier(.22,1,.36,1)';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l15 8-6.5 1.6L8.6 18z" fill="#1c2226" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c);
  document.addEventListener('mousemove', e => { c.style.left = e.clientX - 3 + 'px'; c.style.top = e.clientY - 2 + 'px'; }, true);
  document.addEventListener('mousedown', e => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:99998;pointer-events:none;width:12px;height:12px;border-radius:50%;background:rgba(216,240,74,.9);left:'+(e.clientX-6)+'px;top:'+(e.clientY-6)+'px;transition:transform .45s ease-out,opacity .45s ease-out';
    document.documentElement.appendChild(r); requestAnimationFrame(() => { r.style.transform = 'scale(4)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  }, true);
})();`;

async function session(name, fn, { demo = false } = {}) {
  if (only && !only.includes(name)) return;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `jsd-rec-${name}-`));
  const vdir = fs.mkdtempSync(path.join(os.tmpdir(), `jsd-vid-${name}-`));
  const app = await electron.launch({ args: ["."], env: { ...process.env, JSD_USER_DATA: dataDir, JSD_NO_OS_TASK: "1" } });
  const win = await app.firstWindow();
  await win.waitForSelector("#root *", { timeout: 60000 });
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); b.center(); }, [W, H]);
  await win.evaluate(`localStorage.clear()`);
  if (demo) {
    await win.evaluate(() => window.jsd.call("app.setLang", { lang: "ru" }));
    await win.evaluate(() => window.jsd.call("demo.load"));
  } else {
    await win.evaluate((l) => window.jsd.call("app.setLang", { lang: l }), lang);
  }
  await win.reload();
  await win.waitForTimeout(900);
  await win.evaluate(CURSOR);
  const move = async (loc) => { const b = await loc.boundingBox(); if (b) await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await win.waitForTimeout(260); };
  const click = async (loc, pause = 500) => { await move(loc); await loc.click(); await win.waitForTimeout(pause); };
  const type = async (loc, text) => { await move(loc); await loc.click(); await loc.pressSequentially(text, { delay: 55 }); await win.waitForTimeout(250); };
  const shot = (n) => win.screenshot({ path: path.join(OUT, `${name}-${n}.png`) });
  // Запись экрана через CDP screencast: кадр приходит при каждом изменении, с меткой времени.
  const cdp = await win.context().newCDPSession(win);
  const frames = [];
  let n = 0;
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = path.join(vdir, `f${String(n++).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, ts: metadata.timestamp });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch { /* окно закрывается */ }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  const t0 = Date.now();
  await fn({ win, app, click, type, move, shot });
  await win.waitForTimeout(800);
  await cdp.send("Page.stopScreencast");
  const endTs = Date.now() / 1000;
  await app.close();
  // Сборка: concat с длительностью каждого кадра → постоянные 30 кадров/с
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : f.ts + Math.max(0.5, endTs - (t0 / 1000) - (f.ts - frames[0].ts) > 0 ? 0.8 : 0.5);
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`);
  });
  if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
  fs.writeFileSync(path.join(vdir, "list.txt"), lines.join("\n"));
  const { execFileSync } = await import("node:child_process");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(vdir, "list.txt"), "-vf", `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=decrease,pad=${W * 2}:${H * 2}:(ow-iw)/2:(oh-ih)/2:color=0xf6f8f4,fps=30,format=yuv420p`, "-c:v", "libx264", "-crf", "16", "-preset", "medium", path.join(OUT, `${name}.mp4`)]);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ seconds: (Date.now() - t0) / 1000, frames: frames.length }));
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log("recorded", name);
}

// 1. Настройка: знакомство → о вас → что ищете → где искать
await session("setup", async ({ win, click, type, shot }) => {
  await win.waitForTimeout(2200);
  await shot("welcome");
  await click(win.getByRole("button", { name: L("Начать настройку", "Start setup") }));
  await type(win.getByLabel(L("Как к вам обращаться", "What should we call you")), L("Алекс", "Alex"));
  await click(win.getByLabel(L("В какой стране вы живёте", "Which country do you live in")), 200);
  await win.getByLabel(L("В какой стране вы живёте", "Which country do you live in")).selectOption("KZ");
  await win.waitForTimeout(600);
  await shot("about");
  await click(win.getByRole("button", { name: L("Дальше", "Next"), exact: true }), 700);
  await click(win.getByText(L("Разметка данных / annotation", "Data annotation")), 350);
  await click(win.getByText("AI evaluation / rating"), 350);
  await click(win.getByText(L("Поддержка в чате и email", "Chat & email support")), 350);
  await win.mouse.wheel(0, 520);
  await win.waitForTimeout(500);
  await type(win.getByLabel(L("Минимальная оплата в месяц", "Minimum pay per month"), { exact: true }), "600");
  await win.getByLabel(L("Валюта", "Currency"), { exact: true }).selectOption("USD");
  await click(win.getByLabel(L("Без обязательных звонков по телефону", "No mandatory phone calls")), 600);
  await shot("wishes");
  await click(win.getByRole("button", { name: L("Сохранить и продолжить", "Save and continue") }), 900);
  await shot("sources");
  await win.waitForTimeout(1200);
  await click(win.getByRole("button", { name: L("Дальше", "Next"), exact: true }), 1500);
  await shot("assistant");
  await win.waitForTimeout(1500);
});

// 2. Настоящий поиск по живым сайтам (один раз, в пределах лимитов источников)
await session("search", async ({ win, click, shot }) => {
  // Быстрый профиль через API, чтобы ролик начинался с поиска
  await win.evaluate(async () => {
    const d = (await window.jsd.call("app.defaults")).data;
    const tpl = (await window.jsd.call("app.templates")).data.filter((t) => ["ai-annotation", "ai-eval", "written-support"].includes(t.id));
    const rules = { ...d.rules, excludedKeywords: d.excludedTopics, tracks: tpl.map((t) => ({ id: "trk-" + t.id, name: t.name, enabled: true, titleKeywords: t.titleKeywords, bodyKeywords: t.bodyKeywords, excludeKeywords: t.excludeKeywords, noCalls: !!t.noCalls, templateId: t.id })),
      location: { ...d.rules.location, country: "KZ" }, countryEligibility: { mode: "hard" }, pay: { mode: "hard", minimums: [{ currency: "USD", amountMonthly: 600 }] }, experience: { mode: "hard", maxYearsRequired: 1, allowSenior: false } };
    await window.jsd.call("candidates.create", { name: "Алекс (пример)", rules, skills: [] });
  });
  await win.reload();
  await win.waitForTimeout(1200);
  await win.evaluate(CURSOR);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(500);
  await shot("today");
  await click(win.locator("[data-tour='run']"), 400);
  await win.locator(".lane.active").first().waitFor({ timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(1200);
  await shot("running");
  await win.locator("[data-tour='run']").waitFor({ timeout: 240000 });
  await win.waitForTimeout(1500);
  await shot("finished");
  await click(win.locator("nav.sidebar [data-tour='nav-vacancies']"), 1500);
  await shot("results");
  await win.waitForTimeout(1500);
});

// 3. Разбор вакансии и отклик (демо-данные, вымышленные компании)
await session("results", async ({ win, click, shot }) => {
  await click(win.locator("nav.sidebar [data-tour='nav-vacancies']"), 1200);
  await click(win.locator(".list-item").nth(1), 1400);
  await shot("detail");
  await win.locator(".detail-pane").hover();
  for (let i = 0; i < 4; i++) { await win.mouse.wheel(0, 260); await win.waitForTimeout(420); }
  await shot("evidence");
  for (let i = 0; i < 4; i++) { await win.mouse.wheel(0, -260); await win.waitForTimeout(220); }
  await win.waitForTimeout(500);
  await click(win.getByRole("button", { name: L("Готовлю отклик", "Preparing application") }), 1400);
  await shot("application");
  await click(win.getByRole("dialog").getByRole("button", { name: new RegExp(L("Письмо для вакансии, шаблон", "Letter for a job, template")) }), 1300);
  await click(win.getByRole("dialog").getByLabel(L("Перечитал(а) требования в оригинале", "Re-read requirements in the original")), 500);
  await shot("letter");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(900);
  await shot("board");
  await win.waitForTimeout(1000);
}, { demo: true });
