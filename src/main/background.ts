// Поиск, когда приложение закрыто: системная задача запускает приложение с флагом --background-search
// в назначенное время. macOS — LaunchAgent (launchd выполняет пропущенный запуск после пробуждения),
// Windows — задача Планировщика с «будить компьютер» и «запустить при первой возможности».
// Когда компьютер выключен, ОС ничего запустить не может — для этого есть сервер поиска (cloud).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ScheduleSettings } from "../shared/types";
import { nextSlot } from "../core/schedule";

export const BACKGROUND_FLAG = "--background-search";
export const LAUNCH_LABEL = "app.jobsearchdesktop.background-search";
export const WIN_TASK = "Job Search Desktop - background search";

const run = (cmd: string, args: string[]) =>
  new Promise<{ code: number; out: string }>((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as unknown as number) || 1 : 0, out: `${stdout}${stderr}` }));
  });

export interface OsTaskSpec {
  /** Команда запуска приложения: исполняемый файл и аргументы (в разработке — Electron + путь к приложению). */
  program: string[];
  schedule: ScheduleSettings;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Время задачи ОС — по часам компьютера: ближайший слот в поясе человека переводится в местное время машины.
 *  При каждом запуске приложения задача пересоздаётся, так что смена пояса или летнего времени учитывается. */
export function localTimeOf(s: ScheduleSettings, now = new Date()): { hour: number; minute: number; weekday: number } {
  const at = nextSlot(s, now);
  return { hour: at.getHours(), minute: at.getMinutes(), weekday: at.getDay() === 0 ? 7 : at.getDay() };
}

export function launchAgentPlist(spec: OsTaskSpec, logDir: string): string {
  const t = localTimeOf(spec.schedule);
  const cal = `<dict><key>Hour</key><integer>${t.hour}</integer><key>Minute</key><integer>${t.minute}</integer>${spec.schedule.cadence === "weekly" ? `<key>Weekday</key><integer>${t.weekday % 7}</integer>` : ""}</dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_LABEL}</string>
  <key>ProgramArguments</key><array>${spec.program.map((a) => `<string>${esc(a)}</string>`).join("")}</array>
  <key>StartCalendarInterval</key>${cal}
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(path.join(logDir, "background-search.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(path.join(logDir, "background-search.log"))}</string>
</dict>
</plist>
`;
}

export function windowsTaskXml(spec: OsTaskSpec, now = new Date()): string {
  const t = localTimeOf(spec.schedule, now);
  const day = new Date(now);
  const start = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}T${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}:00`;
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const trigger = spec.schedule.cadence === "weekly"
    ? `<CalendarTrigger><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><${days[t.weekday - 1]} /></DaysOfWeek></ScheduleByWeek></CalendarTrigger>`
    : `<CalendarTrigger><StartBoundary>${start}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
  const [exe, ...args] = spec.program;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Job Search Desktop: scheduled job search while the app is closed</Description></RegistrationInfo>
  <Triggers>${trigger}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <WakeToRun>true</WakeToRun>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${esc(exe)}</Command><Arguments>${esc(args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "))}</Arguments></Exec></Actions>
</Task>
`;
}

export interface OsTaskStatus {
  supported: boolean;
  installed: boolean;
  detail: string;
}

/** Установить или убрать задачу ОС под текущее расписание. */
export async function syncOsTask(spec: OsTaskSpec | null, opts: { logDir: string; tmpDir?: string }): Promise<OsTaskStatus> {
  if (process.platform === "darwin") {
    const dir = path.join(os.homedir(), "Library", "LaunchAgents");
    const file = path.join(dir, `${LAUNCH_LABEL}.plist`);
    const domain = `gui/${process.getuid?.() ?? 501}`;
    await run("launchctl", ["bootout", domain, file]);
    if (!spec) {
      fs.rmSync(file, { force: true });
      return { supported: true, installed: false, detail: "removed" };
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, launchAgentPlist(spec, opts.logDir));
    const r = await run("launchctl", ["bootstrap", domain, file]);
    return { supported: true, installed: r.code === 0, detail: r.code === 0 ? file : r.out.trim() };
  }
  if (process.platform === "win32") {
    await run("schtasks", ["/Delete", "/TN", WIN_TASK, "/F"]);
    if (!spec) return { supported: true, installed: false, detail: "removed" };
    const xmlFile = path.join(opts.tmpDir ?? os.tmpdir(), "jsd-background-task.xml");
    // Планировщик ожидает UTF-16 LE с BOM
    fs.writeFileSync(xmlFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsTaskXml(spec), "utf16le")]));
    const r = await run("schtasks", ["/Create", "/TN", WIN_TASK, "/XML", xmlFile, "/F"]);
    fs.rmSync(xmlFile, { force: true });
    return { supported: true, installed: r.code === 0, detail: r.code === 0 ? WIN_TASK : r.out.trim() };
  }
  return { supported: false, installed: false, detail: process.platform };
}

export async function osTaskStatus(): Promise<OsTaskStatus> {
  if (process.platform === "darwin") {
    const r = await run("launchctl", ["print", `gui/${process.getuid?.() ?? 501}/${LAUNCH_LABEL}`]);
    return { supported: true, installed: r.code === 0, detail: r.code === 0 ? "loaded" : "not loaded" };
  }
  if (process.platform === "win32") {
    const r = await run("schtasks", ["/Query", "/TN", WIN_TASK]);
    return { supported: true, installed: r.code === 0, detail: r.code === 0 ? "registered" : "not registered" };
  }
  return { supported: false, installed: false, detail: process.platform };
}
