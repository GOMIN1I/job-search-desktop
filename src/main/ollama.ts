// Локальные AI-модели без терминала: проверка и установка Ollama, загрузка моделей Gemma с прогрессом
// и продолжением после обрыва, удаление и проверка, что модель действительно отвечает на нашей задаче.
// Большие файлы скачиваются только по явному действию пользователя.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { msg, type Msg } from "../shared/types";
import { OpenAICompatibleTransport } from "../ai/transports";
import { EXTRACT_JSON_SCHEMA, EXTRACT_SYSTEM, ExtractSchema, extractUserPrompt } from "../ai/prompts";

export const OLLAMA_BASE = "http://127.0.0.1:11434";

export interface CatalogModel {
  id: "light" | "quality" | "large" | "large_mlx" | "installed";
  model: string; // имя в Ollama
  title: string;
  minRamGb: number | null;
  sizeBytes: number | null; // из Ollama для установленной модели, иначе из реестра
  licenseUrl: string;
  runtime?: "ollama" | "mlx";
}

export const CATALOG: Array<Omit<CatalogModel, "sizeBytes">> = [
  { id: "light", model: "gemma4:e2b", title: "Gemma 4 E2B", minRamGb: 8, licenseUrl: "https://ollama.com/library/gemma4" },
  { id: "quality", model: "gemma4:e4b", title: "Gemma 4 E4B", minRamGb: 16, licenseUrl: "https://ollama.com/library/gemma4" },
  { id: "large", model: "gemma4:12b", title: "Gemma 4 12B", minRamGb: null, runtime: "ollama", licenseUrl: "https://ollama.com/library/gemma4" },
  { id: "large_mlx", model: "gemma4:12b-mlx", title: "Gemma 4 12B", minRamGb: null, runtime: "mlx", licenseUrl: "https://ollama.com/library/gemma4" },
];

/** Keep installed Gemma variants selectable under their exact local tag; never invent a registry download. */
export function withInstalledGemma(models: CatalogModel[], installed: EngineStatus["models"]): CatalogModel[] {
  const sizes = new Map(installed.map((local) => [local.name, local.size]));
  const result = models.map((model) => ({ ...model, sizeBytes: sizes.get(model.model) ?? model.sizeBytes }));
  const known = new Set(result.map((model) => model.model));
  for (const local of installed) {
    if (!local.name.startsWith("gemma4:") || known.has(local.name)) continue;
    const mlx = /(?:^|[-:])mlx(?:$|-)/i.test(local.name);
    result.push({
      id: "installed", model: local.name,
      title: local.name === "gemma4:12b-mlx" ? "Gemma 4 12B" : local.name === "gemma4:e12b" ? "Gemma 4 E12B" : local.name,
      minRamGb: null, sizeBytes: local.size, runtime: mlx ? "mlx" : "ollama",
      licenseUrl: "https://ollama.com/library/gemma4",
    });
    known.add(local.name);
  }
  return result;
}

export interface EngineStatus {
  state: "running" | "stopped" | "missing";
  version: string | null;
  installedPath: string | null;
  models: Array<{ name: string; size: number }>;
}

export interface JobProgress {
  job: string; // "engine" | имя модели
  phase: "download" | "verify" | "install" | "start" | "pull" | "done" | "error" | "cancelled";
  completed?: number;
  total?: number;
  message?: Msg;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function diskFreeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export function fmtBytes(n: number | null | undefined, lang: "ru" | "en" = "ru"): string {
  if (!n && n !== 0) return "?";
  const gb = n / 1e9;
  if (gb >= 1) return `${gb.toLocaleString(lang === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 1 })} ${lang === "ru" ? "ГБ" : "GB"}`;
  return `${Math.round(n / 1e6)} ${lang === "ru" ? "МБ" : "MB"}`;
}

export class OllamaManager {
  private jobs = new Map<string, AbortController>();
  private sizeCache = new Map<string, number>();

  constructor(private readonly opts: { downloadsDir: string; emit: (p: JobProgress) => void; fetcher?: typeof fetch; platform?: NodeJS.Platform; home?: string }) {}

  private get f() {
    return this.opts.fetcher ?? fetch;
  }
  private get platform() {
    return this.opts.platform ?? process.platform;
  }
  private get home() {
    return this.opts.home ?? os.homedir();
  }

  private candidatePaths(): string[] {
    if (this.platform === "darwin") return [path.join(this.home, "Applications", "Ollama.app"), "/Applications/Ollama.app", "/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"];
    if (this.platform === "win32") {
      const local = process.env.LOCALAPPDATA ?? path.join(this.home, "AppData", "Local");
      return [path.join(local, "Programs", "Ollama", "ollama app.exe"), path.join(local, "Programs", "Ollama", "ollama.exe")];
    }
    return ["/usr/local/bin/ollama", "/usr/bin/ollama"];
  }

  async status(): Promise<EngineStatus> {
    const installedPath = this.candidatePaths().find((p) => fs.existsSync(p)) ?? null;
    try {
      const v = await this.f(`${OLLAMA_BASE}/api/version`, { signal: AbortSignal.timeout(1500) });
      if (v.ok) {
        const version = String(((await v.json()) as { version?: string }).version ?? "");
        const tags = await this.f(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
        const data = tags.ok ? ((await tags.json()) as { models?: Array<{ name: string; size: number }> }) : { models: [] };
        return { state: "running", version, installedPath, models: (data.models ?? []).map((m) => ({ name: m.name, size: m.size })) };
      }
    } catch {
      /* не запущен */
    }
    return { state: installedPath ? "stopped" : "missing", version: null, installedPath, models: [] };
  }

  /** Размеры моделей берутся из манифеста официального реестра Ollama, а не из памяти. */
  async catalog(): Promise<{ models: CatalogModel[]; ramGb: number; diskFree: number | null; recommended: CatalogModel["id"] }> {
    const ramGb = Math.round(os.totalmem() / 1024 ** 3);
    const models: CatalogModel[] = [];
    for (const c of CATALOG) {
      let size = this.sizeCache.get(c.model) ?? null;
      if (size === null) {
        try {
          const [name, tag] = c.model.split(":");
          const r = await this.f(`https://registry.ollama.ai/v2/library/${name}/manifests/${tag}`, {
            headers: { Accept: "application/vnd.docker.distribution.manifest.v2+json" },
            signal: AbortSignal.timeout(10000),
          });
          if (r.ok) {
            const m = (await r.json()) as { layers?: Array<{ size: number }> };
            size = (m.layers ?? []).reduce((s, l) => s + (l.size || 0), 0);
            this.sizeCache.set(c.model, size);
          }
        } catch {
          size = null;
        }
      }
      models.push({ ...c, sizeBytes: size });
    }
    const recommended = ramGb >= 24 ? "quality" : "light";
    return { models, ramGb, diskFree: diskFreeBytes(this.home), recommended };
  }

  cancel(job: string): boolean {
    const c = this.jobs.get(job);
    if (!c) return false;
    c.abort();
    return true;
  }

  private begin(job: string): AbortController {
    this.jobs.get(job)?.abort();
    const c = new AbortController();
    this.jobs.set(job, c);
    return c;
  }

  // ---------- установка движка ----------

  private async releaseAsset(): Promise<{ url: string; name: string; size: number; sha256: string | null; version: string }> {
    const r = await this.f("https://api.github.com/repos/ollama/ollama/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "JobSearchDesktop" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const rel = (await r.json()) as { tag_name: string; assets: Array<{ name: string; size: number; browser_download_url: string }> };
    const want = this.platform === "darwin" ? "Ollama-darwin.zip" : this.platform === "win32" ? "OllamaSetup.exe" : null;
    if (!want) throw new Error("Автоматическая установка поддержана для macOS и Windows");
    const asset = rel.assets.find((a) => a.name === want);
    if (!asset) throw new Error(`В релизе ${rel.tag_name} нет ${want}`);
    let sha256: string | null = null;
    const sums = rel.assets.find((a) => a.name === "sha256sum.txt");
    if (sums) {
      const s = await this.f(sums.browser_download_url, { signal: AbortSignal.timeout(15000) });
      if (s.ok) {
        const line = (await s.text()).split(/\r?\n/).find((l) => l.trim().endsWith(want));
        sha256 = line ? line.trim().split(/\s+/)[0].toLowerCase() : null;
      }
    }
    return { url: asset.browser_download_url, name: want, size: asset.size, sha256, version: rel.tag_name };
  }

  async engineInfo(): Promise<{ size: number; version: string; name: string } | null> {
    try {
      const a = await this.releaseAsset();
      return { size: a.size, version: a.version, name: a.name };
    } catch {
      return null;
    }
  }

  /** Скачивание с продолжением после обрыва (HTTP Range) и проверкой SHA-256. */
  async download(url: string, target: string, expected: { size: number; sha256: string | null }, job: string, signal: AbortSignal): Promise<void> {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      if (have >= expected.size) break;
      try {
        const res = await this.f(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal, redirect: "follow" });
        if (!(res.status === 200 || res.status === 206) || !res.body) throw new Error(`HTTP ${res.status}`);
        const append = res.status === 206 && have > 0;
        const out = fs.createWriteStream(part, { flags: append ? "a" : "w" });
        let done = append ? have : 0;
        let last = 0;
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            if (!out.write(value)) await new Promise((r) => out.once("drain", r));
            done += value.byteLength;
            if (Date.now() - last > 250) {
              this.opts.emit({ job, phase: "download", completed: done, total: expected.size });
              last = Date.now();
            }
          }
        } finally {
          // Уже полученные байты дописываются на диск даже при обрыве — следующая попытка продолжит с этого места.
          await new Promise<void>((resolve) => out.end(() => resolve()));
        }
        break;
      } catch (e) {
        if (signal.aborted) throw e;
        if (attempt === 3) throw e;
        await sleep(1500 * (attempt + 1));
      }
    }
    const size = fs.statSync(part).size;
    if (size !== expected.size) throw new Error(`Размер файла ${size} не совпадает с ожидаемым ${expected.size}`);
    if (expected.sha256) {
      this.opts.emit({ job, phase: "verify" });
      const hash = await new Promise<string>((resolve, reject) => {
        const h = createHash("sha256");
        fs.createReadStream(part).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
      });
      if (hash !== expected.sha256) {
        fs.rmSync(part, { force: true });
        throw new Error("Контрольная сумма не совпала — файл удалён, скачайте заново");
      }
    }
    fs.renameSync(part, target);
  }

  async installEngine(): Promise<EngineStatus> {
    const job = "engine";
    const ctrl = this.begin(job);
    try {
      const a = await this.releaseAsset();
      const free = diskFreeBytes(this.opts.downloadsDir);
      if (free !== null && free < a.size * 2.5) throw new Error(`Недостаточно места: нужно ${fmtBytes(a.size * 2.5)}, свободно ${fmtBytes(free)}`);
      const file = path.join(this.opts.downloadsDir, `${a.version}-${a.name}`);
      if (!fs.existsSync(file)) await this.download(a.url, file, { size: a.size, sha256: a.sha256 }, job, ctrl.signal);
      this.opts.emit({ job, phase: "install" });
      if (this.platform === "darwin") {
        const dest = path.join(this.home, "Applications");
        fs.mkdirSync(dest, { recursive: true });
        await new Promise<void>((resolve, reject) => execFile("/usr/bin/ditto", ["-x", "-k", file, dest], (err) => (err ? reject(err) : resolve())));
        fs.rmSync(file, { force: true });
      } else if (this.platform === "win32") {
        // Официальный установщик открывается с собственным интерфейсом: пользователь видит и подтверждает установку.
        spawn(file, [], { detached: true, stdio: "ignore" }).unref();
      }
      return await this.startEngine(job);
    } catch (e) {
      const err = e as Error;
      this.opts.emit({ job, phase: ctrl.signal.aborted ? "cancelled" : "error", message: msg(err.message, err.message) });
      throw e;
    } finally {
      this.jobs.delete(job);
    }
  }

  async startEngine(job = "engine"): Promise<EngineStatus> {
    let st = await this.status();
    if (st.state === "running") return st;
    this.opts.emit({ job, phase: "start" });
    const p = st.installedPath ?? this.candidatePaths().find((x) => fs.existsSync(x));
    if (p) {
      if (this.platform === "darwin" && p.endsWith(".app")) spawn("/usr/bin/open", ["-a", p], { detached: true, stdio: "ignore" }).unref();
      else spawn(p, p.endsWith("ollama") || p.endsWith("ollama.exe") ? ["serve"] : [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    // Установщик Windows может ещё работать — ждём до 3 минут.
    const deadline = Date.now() + (this.platform === "win32" ? 180_000 : 60_000);
    while (Date.now() < deadline) {
      await sleep(1500);
      st = await this.status();
      if (st.state === "running") {
        this.opts.emit({ job, phase: "done" });
        return st;
      }
    }
    throw new Error("Ollama не запустилась. Откройте её вручную и нажмите «Проверить ещё раз»");
  }

  // ---------- модели ----------

  async pull(model: string, opts: { allowAny?: boolean } = {}): Promise<void> {
    if (!opts.allowAny && !CATALOG.some((c) => c.model === model)) throw new Error(`Модель ${model} не из списка поддержанных`);
    if (CATALOG.find((c) => c.model === model)?.runtime === "mlx" && (this.platform !== "darwin" || process.arch !== "arm64")) throw new Error("MLX requires a Mac with Apple Silicon");
    const ctrl = this.begin(model);
    try {
      const res = await this.f(`${OLLAMA_BASE}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }), signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let last = 0;
      const totals = new Map<string, { completed: number; total: number }>();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
          if (ev.error) throw new Error(ev.error);
          if (ev.digest && ev.total) totals.set(ev.digest, { completed: ev.completed ?? 0, total: ev.total });
          if (Date.now() - last > 300 || ev.status === "success") {
            const sum = [...totals.values()].reduce((a, b) => ({ completed: a.completed + b.completed, total: a.total + b.total }), { completed: 0, total: 0 });
            this.opts.emit({ job: model, phase: ev.status === "success" ? "done" : "pull", completed: sum.completed, total: sum.total, message: msg(ev.status ?? "", ev.status ?? "") });
            last = Date.now();
          }
          if (ev.status === "success") return;
        }
      }
      throw new Error("Загрузка прервалась — нажмите «Продолжить загрузку»");
    } catch (e) {
      const err = e as Error;
      // Ollama сохраняет уже скачанные части: повторный запуск продолжит с того же места.
      this.opts.emit({ job: model, phase: ctrl.signal.aborted ? "cancelled" : "error", message: msg(err.message, err.message) });
      throw e;
    } finally {
      this.jobs.delete(model);
    }
  }

  async remove(model: string): Promise<void> {
    const res = await this.f(`${OLLAMA_BASE}/api/delete`, { method: "DELETE", body: JSON.stringify({ model }) });
    if (!res.ok && res.status !== 404) throw new Error(`Ollama HTTP ${res.status}`);
  }

  /** Проверка на нашей реальной задаче: извлечь требования из короткого объявления и пройти схему. */
  async verify(model: string): Promise<{ ok: boolean; seconds: number; error: string | null }> {
    const t = new OpenAICompatibleTransport(`${OLLAMA_BASE}/v1`, null, model, this.f);
    const sample = {
      title: "Junior Data Annotator",
      company: "Sample Labs",
      location: "Remote",
      description: "Entry level. Label images using clear guidelines. Requirements: Excel. Nice to have: Python. English B2 written. Chat and email only, no calls. Salary $800 per month.",
    };
    const started = Date.now();
    try {
      const r = await t.complete({ system: EXTRACT_SYSTEM, user: extractUserPrompt(sample), schema: EXTRACT_JSON_SCHEMA as any, maxTokens: 1500 });
      const parsed = ExtractSchema.safeParse(JSON.parse(r.text.replace(/^```(?:json)?|```$/g, "").trim()));
      const seconds = Math.round((Date.now() - started) / 100) / 10;
      if (!parsed.success) return { ok: false, seconds, error: "ответ не по схеме" };
      return { ok: true, seconds, error: null };
    } catch (e) {
      return { ok: false, seconds: Math.round((Date.now() - started) / 100) / 10, error: (e as Error).message };
    }
  }
}
