// Главный процесс Electron: окно, безопасность, IPC, фоновый поток сбора, локальный планировщик, трей, уведомления.

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, safeStorage, session, shell, Tray } from "electron";
import path from "node:path";
import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { openDatabase } from "../db/db";
import { Repo } from "../db/repo";
import { createApi, type Platform } from "./api";
import { planSchedule } from "../core/schedule";
import { assessAll, refreshFacts } from "../pipeline/run";
import type { Msg, ScheduleSettings, ScheduleState, UiLang } from "../shared/types";
import { msg } from "../shared/types";

// Каталог данных — в пользовательском профиле, отдельно от бинарника. JSD_USER_DATA — для синтетических демо/тестов.
if (process.env.JSD_USER_DATA) app.setPath("userData", path.resolve(process.env.JSD_USER_DATA));
app.setName("Job Search Desktop");
if (process.platform === "win32") app.setAppUserModelId("app.jobsearchdesktop");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let repo: Repo;
let quitting = false;
let worker: Worker | null = null;
let runState: { running: boolean; runId: string | null; progress: unknown } = { running: false, runId: null, progress: null };

const dataDir = () => app.getPath("userData");
const dbPath = () => path.join(dataDir(), "jobsearch.sqlite");

function uiLang(): UiLang {
  const l = repo?.getMeta<UiLang | null>("ui_lang", null);
  return l ?? (app.getLocale().toLowerCase().startsWith("ru") ? "ru" : "en");
}
const t = (m: Msg) => m[uiLang()];

function send(event: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload);
}

function iconPath(): string {
  const candidates = [path.join(process.resourcesPath ?? "", "icon.png"), path.join(app.getAppPath(), "build", "icon.png"), path.join(__dirname, "..", "..", "build", "icon.png")];
  return candidates.find((p) => fs.existsSync(p)) ?? "";
}

async function startRun(trigger: "manual" | "scheduled" | "catchup"): Promise<{ runId: string | null; error: string | null; alreadyRunning?: boolean }> {
  if (worker) return { runId: runState.runId, error: t(msg("Поиск уже выполняется", "A search is already running")), alreadyRunning: true };
  return new Promise((resolve) => {
    let resolved = false;
    const w = new Worker(path.join(__dirname, "worker.js"), { workerData: { dbPath: dbPath(), trigger } });
    worker = w;
    runState = { running: true, runId: null, progress: null };
    send("run-progress", runState);
    w.on("message", (m: any) => {
      if (m.type === "progress") {
        runState = { running: true, runId: m.runId, progress: m };
        send("run-progress", runState);
        if (!resolved) {
          resolved = true;
          resolve({ runId: m.runId, error: null });
        }
      } else if (m.type === "done") {
        runState = { running: false, runId: m.runId, progress: null };
        send("run-finished", m);
        deliverNotifications();
        updateTray();
      } else if (m.type === "error") {
        runState = { running: false, runId: m.runId, progress: null };
        send("run-finished", { error: m.message });
        if (!resolved) {
          resolved = true;
          resolve({ runId: m.runId, error: m.message, alreadyRunning: m.alreadyRunning });
        }
      }
    });
    w.on("error", (e: Error) => {
      repo.log("error", "worker", e.message);
      if (!resolved) {
        resolved = true;
        resolve({ runId: null, error: e.message });
      }
    });
    w.on("exit", () => {
      worker = null;
      if (runState.running) runState = { running: false, runId: runState.runId, progress: null };
      send("run-finished", { runId: runState.runId });
      send("data-changed", { what: "all" });
      updateTray();
    });
  });
}

/** Системные уведомления только для новых событий; повторов нет (event id учитывается). */
function deliverNotifications() {
  const since = repo.getMeta<string>("notifications_delivered_until", new Date(0).toISOString());
  const list = repo.listNotifications(null, 50).filter((n) => n.createdAt > since && !n.readAt);
  if (list.length && Notification.isSupported()) {
    const first = list[0];
    const n = new Notification({
      title: list.length > 1 ? t(msg(`Новых результатов: ${list.length}`, `New results: ${list.length}`)) : t(first.title),
      body: list.length > 1 ? list.slice(0, 3).map((x) => t(x.body)).join("\n") : t(first.body),
      silent: false,
    });
    n.on("click", () => {
      showWindow();
      send("navigate", { page: "today" });
    });
    n.show();
  }
  if (list.length) repo.setMeta("notifications_delivered_until", list[0].createdAt);
}

// ---------- Планировщик (локальный: работает, только пока приложение запущено) ----------
let scheduleTimer: NodeJS.Timeout | null = null;

function scheduleTick() {
  const s = { enabled: false, paused: false, cadence: "daily", time: "09:00", weekday: 1, runInBackground: true, ...repo.getMeta<Partial<ScheduleSettings>>("schedule", {}) } as ScheduleSettings;
  const st = repo.getMeta<ScheduleState>("schedule_state", { lastHandledSlot: null, lastRunId: null });
  const plan = planSchedule(s, st.lastHandledSlot, new Date());
  if (plan.action === "none" && plan.slot && !st.lastHandledSlot) {
    repo.setMeta("schedule_state", { ...st, lastHandledSlot: plan.slot });
    return;
  }
  if (plan.action !== "run" && plan.action !== "catchup") return;
  for (const m of plan.missed) repo.addScheduleEvent("missed", m, "Компьютер был выключен/спал или приложение закрыто / computer off, asleep or app closed");
  if (worker) {
    repo.addScheduleEvent("skipped_running", plan.slot, "Уже выполняется другой поиск / another search is running");
    repo.setMeta("schedule_state", { ...st, lastHandledSlot: plan.slot });
    return;
  }
  repo.addScheduleEvent(plan.action === "run" ? "ran" : "catchup", plan.slot, plan.action === "catchup" ? `Один догоняющий запуск, пропущено слотов: ${plan.missed.length + 1}` : "");
  repo.setMeta("schedule_state", { ...st, lastHandledSlot: plan.slot });
  if (plan.missed.length) {
    repo.addNotification({ candidateId: null, kind: "schedule_missed", dedupeKey: `missed:${plan.slot}`, title: msg("Пропущены запуски по расписанию", "Scheduled runs were missed"), body: msg(`Пропущено: ${plan.missed.length + 1}. Выполнен один догоняющий поиск.`, `Missed: ${plan.missed.length + 1}. One catch-up search was run.`), vacancyId: null });
  }
  void startRun(plan.action === "run" ? "scheduled" : "catchup").then((r) => {
    if (r.runId) repo.setMeta("schedule_state", { lastHandledSlot: plan.slot, lastRunId: r.runId });
  });
}

function startScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = setInterval(scheduleTick, 60_000);
  setTimeout(scheduleTick, 5_000);
}

// ---------- Окно и трей ----------
function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function updateTray() {
  if (!tray) return;
  const s = { enabled: false, paused: false, ...repo.getMeta<Partial<ScheduleSettings>>("schedule", {}) };
  tray.setToolTip(`Job Search Desktop — ${runState.running ? t(msg("идёт поиск", "searching")) : s.enabled ? (s.paused ? t(msg("расписание на паузе", "schedule paused")) : t(msg("расписание включено", "schedule on"))) : t(msg("расписание выключено", "schedule off"))}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t(msg("Открыть", "Open")), click: showWindow },
      { label: runState.running ? t(msg("Поиск выполняется…", "Search running…")) : t(msg("Запустить поиск", "Run search")), enabled: !runState.running, click: () => void startRun("manual") },
      { type: "separator" },
      { label: t(msg("Выход", "Quit")), click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

function createTray() {
  const ip = iconPath();
  if (!ip) return;
  const img = nativeImage.createFromPath(ip).resize({ width: 18, height: 18 });
  tray = new Tray(img);
  tray.on("click", showWindow);
  updateTray();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Job Search Desktop",
    backgroundColor: "#f7f8f8",
    icon: iconPath() || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  // Никакой навигации внутри окна и новых окон: внешние ссылки — только через проверенный API.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://") && !url.startsWith("http://localhost:5173")) e.preventDefault();
  });
  win.on("close", (e) => {
    const s = { runInBackground: true, enabled: false, ...repo.getMeta<Partial<ScheduleSettings>>("schedule", {}) };
    if (!quitting && s.runInBackground && s.enabled && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  if (process.env.JSD_DEV_URL) void win.loadURL(process.env.JSD_DEV_URL);
  else void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

function platformImpl(): Platform {
  const materialsDir = path.join(dataDir(), "materials");
  const backupDir = path.join(dataDir(), "backups");
  fs.mkdirSync(materialsDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  return {
    dataDir: dataDir(),
    dbPath: dbPath(),
    materialsDir,
    backupDir,
    appVersion: app.getVersion(),
    platform: process.platform,
    systemLocale: app.getLocale(),
    async openFile(o) {
      const r = await dialog.showOpenDialog(win!, { title: o.title, properties: ["openFile"], filters: o.filters });
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    },
    async saveFile(o) {
      const r = await dialog.showSaveDialog(win!, { title: o.title, defaultPath: path.join(app.getPath("documents"), o.defaultPath), filters: o.filters });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    openExternal: (url) => shell.openExternal(url),
    openPath: (p) => shell.openPath(p),
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, "base64")),
    async printToPdf(html) {
      const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
      try {
        await w.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`);
        return await w.webContents.printToPDF({ pageSize: "A4", printBackground: true, margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
      } finally {
        w.destroy();
      }
    },
    startRun,
    cancelRun: () => {
      if (!worker) return false;
      worker.postMessage({ type: "cancel" });
      return true;
    },
    runState: () => runState,
    emit: send,
    onScheduleChanged: () => {
      updateTray();
      scheduleTick();
    },
  };
}

app.on("second-instance", showWindow);

app.whenReady().then(() => {
  if (!gotLock) return;
  const opened = openDatabase(dbPath(), { backupDir: path.join(dataDir(), "backups") });
  repo = new Repo(opened.db);
  repo.seedDefaults();
  repo.closeStaleRuns(0);
  if (refreshFacts(repo) > 0) assessAll(repo);
  if (opened.backupPath) repo.log("info", "db", `Backup before migration: ${opened.backupPath}`);

  // Запрет любых разрешений (камера, геолокация и т.д.) и строгая CSP для всех ответов.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const api = createApi(repo, platformImpl());
  ipcMain.handle("api", async (event, payload) => {
    // Принимаем вызовы только от собственного окна.
    if (!win || event.sender.id !== win.webContents.id) return { ok: false, error: msg("Отклонено", "Rejected"), code: "forbidden" };
    const method = typeof payload?.method === "string" ? payload.method : "";
    return api(method, payload?.args);
  });

  if (process.platform === "darwin") {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu" },
        { role: "editMenu" },
        { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, ...(app.isPackaged ? [] : [{ role: "toggleDevTools" as const }])] },
        { role: "windowMenu" },
      ]),
    );
  } else Menu.setApplicationMenu(null);

  createWindow();
  createTray();
  startScheduler();
  powerMonitor.on("resume", () => setTimeout(scheduleTick, 10_000));
});

app.on("activate", showWindow);
app.on("before-quit", () => {
  quitting = true;
  worker?.postMessage({ type: "cancel" });
});
app.on("window-all-closed", () => {
  const s = { runInBackground: true, enabled: false, ...repo?.getMeta<Partial<ScheduleSettings>>("schedule", {}) };
  if (!(s.runInBackground && s.enabled)) app.quit();
});
