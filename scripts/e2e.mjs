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
  const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: ["."] }), env: { ...process.env, JSD_USER_DATA: dataDir, LANG: lang === "ru" ? "ru_RU.UTF-8" : "en_US.UTF-8" } });
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
const shot = async (win, name) => win.screenshot({ path: path.join(shots, `${lang}-${name}.png`) });
const tag = process.env.E2E_EXECUTABLE ? "packaged" : "source";

const { app, win, errors } = await launch();
try {
  await setSize(app, 1280, 820);
  // Онбординг: язык
  await win.getByRole("combobox", { name: /Язык интерфейса|Interface language/ }).selectOption(lang);
  await win.waitForTimeout(300);
  await shot(win, "01-welcome");
  check("onboarding welcome visible", await win.getByText(lang === "ru" ? "Начать настройку" : "Start setup").isVisible());

  // Полный онбординг синтетического кандидата
  await win.getByRole("button", { name: lang === "ru" ? "Начать настройку" : "Start setup" }).click();
  await win.getByLabel(lang === "ru" ? "Имя или псевдоним (видно только вам)" : "Name or nickname (visible only to you)").fill(lang === "ru" ? "Тестовый кандидат" : "Test candidate");
  await win.getByRole("button", { name: lang === "ru" ? "Далее" : "Next" }).click();
  await win.getByText(lang === "ru" ? "Разметка данных / annotation" : "Data annotation").click();
  await win.getByText(lang === "ru" ? "Поддержка в чате и email" : "Chat & email support").click();
  await shot(win, "02-onboarding-goals");
  await win.getByRole("button", { name: lang === "ru" ? "Далее" : "Next" }).click(); // experience
  await win.getByLabel(lang === "ru" ? "Навык" : "Skill").fill("Excel");
  await win.getByRole("button", { name: lang === "ru" ? "Добавить" : "Add" }).click();
  await win.getByRole("button", { name: lang === "ru" ? "Далее" : "Next" }).click(); // place
  await win.getByLabel(lang === "ru" ? "Фактическая страна проживания" : "Actual country of residence").selectOption("KZ");
  await win.getByRole("group", { name: lang === "ru" ? "Требовать подтверждение найма из моей страны" : "Require confirmation of hiring from my country" }).getByRole("button", { name: lang === "ru" ? "Обязательно" : "Required" }).click();
  await shot(win, "03-onboarding-place");
  for (let i = 0; i < 6; i++) await win.getByRole("button", { name: lang === "ru" ? "Далее" : "Next" }).click();
  await shot(win, "04-onboarding-review");
  await win.getByRole("button", { name: lang === "ru" ? "Создать профиль" : "Create profile" }).click();
  await win.getByRole("heading", { name: lang === "ru" ? "Сегодня" : "Today" }).waitFor();
  await shot(win, "05-today-empty");
  check("today shows empty-state text", await win.getByText(lang === "ru" ? "Вакансий в базе пока нет" : "No jobs in the database yet", { exact: false }).isVisible());

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
  await shot(win, "06-today-demo");

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
  await shot(win, "07-vacancy-detail");
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
  await shot(win, "08-application-detail");
  check("application modal opened", await win.getByRole("dialog").isVisible());
  await win.getByRole("dialog").getByRole("button", { name: new RegExp(lang === "ru" ? "Письмо для вакансии · шаблон" : "Letter for a job · template") }).click();
  await win.waitForTimeout(800);
  check("template letter attached", (await win.getByRole("dialog").locator(".order-item").count()) >= 1);
  await win.getByRole("dialog").getByRole("button", { name: lang === "ru" ? "Отметить: отправлено вручную" : "Mark: applied manually" }).click();
  await win.getByRole("button", { name: lang === "ru" ? "Подтвердить" : "Confirm" }).click();
  await win.waitForTimeout(600);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  await shot(win, "09-applications-board");
  check("board shows submitted column card", (await win.locator(".app-card").count()) >= 1);

  // Профиль
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Профиль" : "Profile", exact: true }).click();
  await win.waitForTimeout(600);
  await shot(win, "10-profile");
  await win.getByRole("button", { name: lang === "ru" ? "Черновик резюме из фактов" : "CV draft from facts" }).click();
  await win.waitForTimeout(600);
  check("CV draft created", (await win.getByText(lang === "ru" ? "Резюме (черновик)" : "CV (draft)").count()) >= 1);

  // Настройки
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Настройки" : "Settings", exact: true }).click();
  for (const tab of lang === "ru" ? ["Поиск и расписание", "Источники", "AI", "Приватность", "Журнал"] : ["Search & schedule", "Sources", "AI", "Privacy", "Log"]) {
    await win.getByRole("tab", { name: tab }).click();
    await win.waitForTimeout(400);
    await shot(win, `11-settings-${tab.replace(/[^a-zA-Zа-яА-Я]+/g, "-").toLowerCase()}`);
  }
  await win.getByRole("tab", { name: lang === "ru" ? "Поиск и расписание" : "Search & schedule" }).click();
  await win.getByLabel(lang === "ru" ? "Регулярный поиск" : "Regular search").click();
  await win.waitForTimeout(500);
  check("schedule shows next run", await win.getByText(lang === "ru" ? "Следующий запуск" : "Next run").first().isVisible());

  // Размеры окна
  for (const [w, h, n] of [[960, 640, "small"], [1600, 1000, "large"]]) {
    await setSize(app, w, h);
    await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Вакансии" : "Jobs", exact: true }).click();
    await win.waitForTimeout(500);
    await shot(win, `12-vacancies-${n}`);
  }
  const overflow = await win.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check("no horizontal page overflow at large size", !overflow);
  // Тёмная тема (системная)
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = "dark"; });
  await setSize(app, 1280, 820);
  await win.waitForTimeout(500);
  await shot(win, "13-vacancies-dark");
  await win.locator("nav.sidebar").getByRole("button", { name: lang === "ru" ? "Сегодня" : "Today", exact: true }).click();
  await win.waitForTimeout(500);
  await shot(win, "14-today-dark");
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
