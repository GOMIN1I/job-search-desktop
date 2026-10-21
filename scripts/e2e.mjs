// Сквозная проверка настоящего desktop-окна (Electron) на синтетических данных.
// Папка данных временная (JSD_USER_DATA), личные данные не используются. Скриншоты — docs/screenshots.
import { _electron as electron } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const shots = path.resolve("docs/screenshots");
fs.mkdirSync(shots, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsd-e2e-"));
const lang = process.env.E2E_LANG || "ru";
const log = (...a) => console.log("[e2e]", ...a);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  log(ok ? "PASS" : "FAIL", name, detail);
};

async function launch() {
  // E2E_EXECUTABLE — путь к собранному бинарнику (проверка упакованного приложения), иначе запуск из исходников.
  const exe = process.env.E2E_EXECUTABLE;
  const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: ["."] }), env: { ...process.env, JSD_USER_DATA: dataDir, JSD_NO_OS_TASK: "1", LANG: lang === "ru" ? "ru_RU.UTF-8" : "en_US.UTF-8" } });
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(String(e)));
  win.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await win.waitForLoadState("domcontentloaded");
  return { app, win, errors };
}

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [w, h]);
  await new Promise((r) => setTimeout(r, 350));
}
const L = (ru, en) => (lang === "ru" ? ru : en);
const shot = async (win, name) => win.screenshot({ path: path.join(shots, `${lang}-${name}.png`) });
const tag = process.env.E2E_EXECUTABLE ? "packaged" : "source";

const { app, win, errors } = await launch();
try {
  await setSize(app, 1280, 820);
  // Первый запуск (новый сценарий из 6 шагов): язык → знакомство → о вас → что ищете → где искать → помощник → первый поиск
  await win.getByRole("combobox", { name: /Язык интерфейса|Interface language/ }).selectOption(lang);
  await win.waitForTimeout(1600);
  await shot(win, "01-welcome");
  check("onboarding welcome visible", await win.getByRole("button", { name: L("Начать настройку", "Start setup") }).isVisible());
  await win.getByRole("button", { name: L("Начать настройку", "Start setup") }).click();
  check("next disabled without a name", await win.getByRole("button", { name: L("Дальше", "Next"), exact: true }).isDisabled());
  await win.getByLabel(L("Как к вам обращаться", "What should we call you")).fill(L("Тестовый кандидат", "Test candidate"));
  await win.getByLabel(L("В какой стране вы живёте", "Which country do you live in")).selectOption("KZ");
  await win.getByLabel(L("Навык", "Skill")).fill("Excel");
  await win.getByLabel(L("Пример / доказательство", "Example / evidence")).fill(L("учебный отчёт", "course report"));
  await win.getByLabel(L("Есть пример", "Have an example")).check();
  await win.getByRole("button", { name: L("Добавить", "Add"), exact: true }).click();
  await shot(win, "02-onboarding-about");
  await win.getByRole("button", { name: L("Дальше", "Next"), exact: true }).click();
  // Возврат назад сохраняет заполненное
  await win.getByRole("button", { name: L("Назад", "Back"), exact: true }).click();
  check("back keeps entered name", (await win.getByLabel(L("Как к вам обращаться", "What should we call you")).inputValue()).length > 0);
  await win.getByRole("button", { name: L("Дальше", "Next"), exact: true }).click();
  await win.getByText(L("Разметка данных / annotation", "Data annotation")).click();
  await win.getByText(L("Поддержка в чате и email", "Chat & email support")).click();
  await win.getByLabel(L("Минимальная оплата в месяц", "Minimum pay per month"), { exact: true }).fill("600");
  await win.getByLabel(L("Валюта", "Currency"), { exact: true }).selectOption("USD");
  await win.getByLabel(L("Без обязательных звонков по телефону", "No mandatory phone calls")).check();
  // Дополнительные инструкции для ИИ: свои слова → понятный разбор
  await win.locator("textarea.instr-text").fill(L("Не используй hh.ru и связанные сервисы", "Don't use hh.ru and related services"));
  await win.locator(".instr-parsed .mark", { hasText: "hh.ru" }).first().waitFor({ timeout: 5000 }).catch(() => {});
  check("onboarding instructions are parsed (hh.ru excluded)", (await win.locator(".instr-parsed .mark", { hasText: "hh.ru" }).count()) >= 1);
  await shot(win, "03-onboarding-wishes");
  await win.getByRole("button", { name: L("Сохранить и продолжить", "Save and continue") }).click();
  await win.getByRole("heading", { name: L("Где искать вакансии", "Where to look for jobs") }).waitFor();
  await shot(win, "04-onboarding-sources");
  await win.getByRole("button", { name: L("Дальше", "Next"), exact: true }).click();
  await win.getByRole("heading", { name: L("Помощник для разбора вакансий", "An assistant to read job postings") }).waitFor();
  await win.waitForTimeout(2500);
  await shot(win, "05-onboarding-assistant");
  check("assistant step shows two models", (await win.locator(".model").count()) === 2);
  // Если на машине уже есть Ollama с моделью — реально включаем её: приложение проверяет ответ на нашей задаче.
  const useBtn = win.locator(".model").first().getByRole("button", { name: L("Использовать", "Use"), exact: true });
  if (await useBtn.count()) {
    await useBtn.click();
    await win.locator(".model").first().getByText(L("Используется", "In use")).waitFor({ timeout: 120000 });
    check("local model verified and switched on", true);
    await shot(win, "05b-onboarding-assistant-in-use");
  }
  await win.getByRole("button", { name: L("Пропустить шаг", "Skip this step") }).click();
  await win.getByRole("heading", { name: L("Первый поиск", "First search") }).waitFor();
  await shot(win, "06-onboarding-search");
  await win.getByRole("button", { name: L("Искать позже", "Search later") }).click();
  // После настройки сразу открывается объяснение
  await win.getByRole("dialog").waitFor();
  await shot(win, "07-guide");
  check("guide opens after onboarding", await win.getByRole("dialog").isVisible());
  await win.getByRole("button", { name: L("Показать на экране", "Show me on screen") }).click();
  await win.waitForTimeout(700);
  await shot(win, "08-tour");
  check("tour highlights the search button", await win.locator(".tour-ring").isVisible());
  for (let i = 0; i < 5; i++) {
    await win.locator(".tour-pop .btn-primary").click();
    await win.waitForTimeout(250);
  }
  check("tour closes after last step", (await win.locator(".tour-pop").count()) === 0);
  await win.getByRole("heading", { name: L("Сегодня", "Today") }).waitFor();
  await shot(win, "09-today-empty");
  check("today shows search panel", await win.locator(".run-panel").isVisible());

  // Демо-данные (синтетика) и переключатель кандидата
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Настройки" : "Settings", exact: true }).click();
  await win.getByRole("tab", { name: lang === "ru" ? "Данные" : "Data" }).click();
  await win.getByRole("button", { name: lang === "ru" ? "Загрузить демо-данные" : "Load demo data" }).click();
  await win.waitForTimeout(1200);
  const sel = win.getByLabel(lang === "ru" ? "Кандидат" : "Candidate");
  const opts = await sel.locator("option").allTextContents();
  check("candidate switcher lists demo + real", opts.some((o) => o.includes("DEMO")) && opts.length >= 3, opts.join(" | "));
  await sel.selectOption("cand-demo");
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Сегодня" : "Today", exact: true }).click();
  await win.waitForTimeout(800);
  await shot(win, "10-today-demo");

  // Подборка: фильтр, поиск, карточка
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Вакансии" : "Jobs", exact: true }).click();
  await win.waitForTimeout(800);
  const count1 = await win.locator(".list-item").count();
  await win.getByLabel(lang === "ru" ? "Соответствие" : "Fit").selectOption("all");
  await win.getByLabel(lang === "ru" ? "Тип" : "Type").selectOption("all");
  await win.waitForTimeout(300);
  const countAll = await win.locator(".list-item").count();
  check("fit/type filters change the list", countAll > count1, `${count1} → ${countAll}`);
  await win.getByLabel(lang === "ru" ? "Поиск" : "Search").fill("Annotator");
  await win.waitForTimeout(300);
  const countSearch = await win.locator(".list-item").count();
  check("search narrows the list", countSearch > 0 && countSearch < countAll, String(countSearch));
  await win.getByLabel(lang === "ru" ? "Поиск" : "Search").fill("");
  await win.getByLabel(lang === "ru" ? "Соответствие" : "Fit").selectOption("active");
  await win.getByLabel(lang === "ru" ? "Тип" : "Type").selectOption("job_posting");
  await win.waitForTimeout(300);
  await win.locator(".list-item").first().click();
  await win.waitForTimeout(500);
  await shot(win, "11-vacancy-detail");
  check("detail shows assessment rows", (await win.locator(".dim-row").count()) >= 8);
  // клавиатура: стрелка вниз меняет выбор
  const before = await win.locator('.list-item[aria-selected="true"] .title').textContent();
  await win.locator(".list").focus();
  await win.keyboard.press("ArrowDown");
  await win.waitForTimeout(300);
  const after = await win.locator('.list-item[aria-selected="true"] .title').textContent();
  check("keyboard ArrowDown moves selection", before !== after, `${before} → ${after}`);
  // Сохранить и отклонить с причиной
  await win.getByRole("button", { name: lang === "ru" ? "Сохранить" : "Save" }).first().click();
  await win.waitForTimeout(400);
  check("save sets stage badge", await win.locator(".detail .badge", { hasText: lang === "ru" ? "Сохранено" : "Saved" }).first().isVisible());
  await win.getByRole("button", { name: lang === "ru" ? "Готовлю отклик" : "Preparing application" }).click();
  await win.waitForTimeout(800);
  await shot(win, "12-application-detail");
  check("application modal opened", await win.getByRole("dialog").isVisible());
  await win.getByRole("dialog").getByRole("button", { name: new RegExp(lang === "ru" ? "Письмо для вакансии, шаблон" : "Letter for a job, template") }).click();
  await win.waitForTimeout(800);
  check("template letter attached", (await win.getByRole("dialog").locator(".order-item").count()) >= 1);
  await win.getByRole("dialog").getByRole("button", { name: lang === "ru" ? "Отметить: отправлено вручную" : "Mark: applied manually" }).click();
  await win.getByRole("button", { name: lang === "ru" ? "Подтвердить" : "Confirm" }).click();
  await win.waitForTimeout(600);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  await shot(win, "13-applications-board");
  check("board shows submitted column card", (await win.locator(".app-card").count()) >= 1);

  // Профиль
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Профиль" : "Profile", exact: true }).click();
  await win.waitForTimeout(600);
  await shot(win, "14-profile");
  await win.getByRole("button", { name: lang === "ru" ? "Черновик резюме из фактов" : "CV draft from facts" }).click();
  await win.waitForTimeout(600);
  check("CV draft created", (await win.getByText(lang === "ru" ? "Резюме (черновик)" : "CV (draft)").count()) >= 1);

  // Инструкции в профиле: противоречие с настройками решает человек
  const instr = win.locator("textarea.instr-text");
  await instr.fill(L("Только офис. Без продаж", "Office only. No sales"));
  await win.locator(".instr-conflict").first().waitFor({ timeout: 5000 }).catch(() => {});
  const saveInstr = win.getByRole("button", { name: L("Сохранить инструкции", "Save instructions") });
  check("instruction conflict shown and blocks saving", (await win.locator(".instr-conflict").count()) >= 1 && (await saveInstr.isDisabled()));
  await win.locator(".instr-conflict").first().getByLabel(L("Главнее настройки профиля", "The profile settings win")).check();
  await shot(win, "14b-profile-instructions");
  check("conflict resolved enables saving", await saveInstr.isEnabled());
  await saveInstr.click();
  await win.waitForTimeout(900);
  const savedRules = await win.evaluate(async () => (await window.jsd.call("profile.get", { candidateId: "cand-demo" })).data.profile.rules.aiInstructions);
  check("instructions saved in the profile version", savedRules?.resolutions?.format === "settings" && savedRules?.parsed?.excludeKeywords?.length >= 1, JSON.stringify(savedRules?.parsed?.excludeKeywords));
  const dims = await win.evaluate(async () => { const l = (await window.jsd.call("vacancies.list", { candidateId: "cand-demo" })).data; const d = (await window.jsd.call("vacancies.get", { candidateId: "cand-demo", vacancyId: l[0].id })).data; return (d.assessment?.dimensions ?? []).map((x) => x.key); }).catch((e) => [String(e)]);
  check("instructions take part in assessment", dims.includes("instructions"), dims.join(","));

  // Настройки
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Настройки" : "Settings", exact: true }).click();
  for (const tab of lang === "ru" ? ["Поиск и расписание", "Источники", "AI", "Приватность", "Журнал"] : ["Search & schedule", "Sources", "AI", "Privacy", "Log"]) {
    await win.getByRole("tab", { name: tab }).click();
    await win.waitForTimeout(400);
    await shot(win, `15-settings-${tab.replace(/[^a-zA-Zа-яА-Я]+/g, "-").toLowerCase()}`);
  }
  await win.getByRole("tab", { name: lang === "ru" ? "Источники" : "Sources" }).click();
  await win.locator("#source-access").waitFor({ timeout: 8000 }).catch(() => {});
  check("source access panel for hh.ru and Adzuna", await win.locator("#source-access").isVisible() && (await win.locator("#source-access h3", { hasText: "hh.ru" }).count()) === 1);
  await win.getByRole("tab", { name: lang === "ru" ? "Поиск и расписание" : "Search & schedule" }).click();
  await win.getByLabel(lang === "ru" ? "Регулярный поиск" : "Regular search").click();
  await win.waitForTimeout(500);
  check("schedule shows next run", await win.getByText(lang === "ru" ? "Следующий запуск" : "Next run").first().isVisible());
  check("schedule has time zone and closed-app option", await win.getByLabel(L("Часовой пояс", "Time zone")).isVisible() && (await win.getByText(L("Искать, даже когда приложение закрыто", "Search even when the app is closed"), { exact: true }).count()) === 1);
  await win.locator("#cloud").scrollIntoViewIfNeeded();
  check("search server panel visible", await win.locator("#cloud").isVisible());
  await shot(win, "15b-settings-cloud");

  // Размеры окна
  for (const [w, h, n] of [[960, 640, "small"], [1600, 1000, "large"]]) {
    await setSize(app, w, h);
    await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Вакансии" : "Jobs", exact: true }).click();
    await win.waitForTimeout(500);
    await shot(win, `16-vacancies-${n}`);
  }
  const overflow = await win.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check("no horizontal page overflow at large size", !overflow);
  // Тёмная тема (системная)
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "dark"; });
  await setSize(app, 1280, 820);
  await win.waitForTimeout(500);
  await shot(win, "17-vacancies-dark");
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Сегодня" : "Today", exact: true }).click();
  await win.waitForTimeout(500);
  await shot(win, "18-today-dark");
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "system"; });
  check("no renderer errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("e2e flow completed", false, String(e?.message ?? e));
  await shot(win, "zz-failure").catch(() => {});
} finally {
  await app.close();
}

// Перезапуск: состояние сохраняется
{
  const { app: app2, win: win2 } = await launch();
  try {
    await win2.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Отклики" : "Applications", exact: true }).click();
    await win2.waitForTimeout(800);
    const cards = await win2.locator(".app-card").count();
    check("state persists after restart (applications)", cards >= 1, String(cards));
    const selVal = await win2.getByLabel(lang === "ru" ? "Кандидат" : "Candidate").inputValue();
    check("active candidate persisted", selVal === "cand-demo", selVal);
  } catch (e) {
    check("restart flow", false, String(e?.message ?? e));
  } finally {
    await app2.close();
  }
}
fs.rmSync(dataDir, { recursive: true, force: true });
fs.writeFileSync(path.join("artifacts", `e2e-${lang}-${tag}.json`), JSON.stringify({ at: new Date().toISOString(), target: tag, results }, null, 2));
const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
