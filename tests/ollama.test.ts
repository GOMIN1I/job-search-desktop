import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { CATALOG, OllamaManager, withInstalledGemma, type JobProgress } from "../src/main/ollama";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "jsd-oll-"));

describe("менеджер локальных моделей", () => {
  it("показывает установленные 12B MLX и E12B под точными тегами, без дублей и посторонних моделей", () => {
    const base = CATALOG.map((model) => ({ ...model, sizeBytes: null }));
    const result = withInstalledGemma(base, [
      { name: "gemma4:e2b", size: 7e9 },
      { name: "gemma4:12b-mlx", size: 7714091504 },
      { name: "gemma4:12b-mlx", size: 7714091504 },
      { name: "gemma4:e12b", size: 8e9 },
      { name: "nomic-embed-text:latest", size: 2e8 },
    ]);
    expect(result.map((model) => model.model)).toEqual(["gemma4:e2b", "gemma4:e4b", "gemma4:12b", "gemma4:12b-mlx", "gemma4:e12b"]);
    expect(result[0].sizeBytes).toBe(7e9);
    expect(result[3]).toMatchObject({ id: "large_mlx", title: "Gemma 4 12B", runtime: "mlx", minRamGb: null, sizeBytes: 7714091504 });
    expect(result[4]).toMatchObject({ title: "Gemma 4 E12B", runtime: "ollama" });
    expect(base).toHaveLength(4);
    expect(withInstalledGemma(base, [])).toEqual(base);
  });

  it("скачивание продолжается после обрыва (Range) и проверяется SHA-256", async () => {
    const dir = tmp();
    const data = Buffer.from("x".repeat(5000) + "y".repeat(5000));
    const sha = createHash("sha256").update(data).digest("hex");
    let calls = 0;
    const ranges: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      calls++;
      const range = (init.headers as Record<string, string>)?.Range;
      if (range) ranges.push(range);
      const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      // Первый ответ обрывается на середине
      const chunk = calls === 1 ? data.subarray(0, 4000) : data.subarray(start);
      // Первая порция доходит, затем соединение рвётся (error() в start() сбросил бы и уже поставленные данные).
      let sent = false;
      const first = calls === 1;
      const body = new ReadableStream({
        pull(c) {
          if (!sent) {
            sent = true;
            c.enqueue(new Uint8Array(chunk));
          } else if (first) c.error(new Error("connection reset"));
          else c.close();
        },
      });
      return new Response(body, { status: range ? 206 : 200 });
    }) as typeof fetch;
    const events: JobProgress[] = [];
    const m = new OllamaManager({ downloadsDir: dir, emit: (p) => events.push(p), fetcher, home: dir });
    const target = path.join(dir, "file.bin");
    await m.download("https://example.com/file.bin", target, { size: data.length, sha256: sha }, "engine", new AbortController().signal);
    expect(fs.readFileSync(target).equals(data)).toBe(true);
    expect(ranges[0]).toBe("bytes=4000-");
    expect(events.some((e) => e.phase === "verify")).toBe(true);
  });

  it("неверная контрольная сумма — файл удаляется, ошибка понятна", async () => {
    const dir = tmp();
    const data = Buffer.from("abc".repeat(100));
    const fetcher = (async () => new Response(new Uint8Array(data), { status: 200 })) as typeof fetch;
    const m = new OllamaManager({ downloadsDir: dir, emit: () => {}, fetcher, home: dir });
    const target = path.join(dir, "f.bin");
    await expect(m.download("https://e.x/f", target, { size: data.length, sha256: "0".repeat(64) }, "engine", new AbortController().signal)).rejects.toThrow(/Контрольная сумма/);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(`${target}.part`)).toBe(false);
  });

  it("состояние движка: не установлен / работает со списком моделей", async () => {
    const dir = tmp();
    const down = new OllamaManager({ downloadsDir: dir, emit: () => {}, fetcher: (async () => { throw new TypeError("refused"); }) as typeof fetch, home: dir, platform: "linux" });
    // На linux пути /usr/... могут существовать у разработчика — проверяем только состояние сервера
    expect(["missing", "stopped"]).toContain((await down.status()).state);
    const up = new OllamaManager({
      downloadsDir: dir, emit: () => {}, home: dir,
      fetcher: (async (url: string) => (url.endsWith("/api/version") ? Response.json({ version: "0.40.7" }) : Response.json({ models: [{ name: "gemma4:e2b", size: 4.6e9 }] }))) as typeof fetch,
    });
    const st = await up.status();
    expect(st.state).toBe("running");
    expect(st.models[0].name).toBe("gemma4:e2b");
  });

  it("загрузка модели: прогресс суммируется по слоям, успех завершает задачу; неподдержанная модель отклоняется", async () => {
    const dir = tmp();
    const lines = [
      { status: "pulling manifest" },
      { status: "pulling a", digest: "a", total: 100, completed: 50 },
      { status: "pulling b", digest: "b", total: 300, completed: 300 },
      { status: "pulling a", digest: "a", total: 100, completed: 100 },
      { status: "success" },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n";
    const events: JobProgress[] = [];
    const m = new OllamaManager({ downloadsDir: dir, emit: (p) => events.push(p), home: dir, fetcher: (async () => new Response(lines, { status: 200 })) as typeof fetch });
    await m.pull("gemma4:e2b");
    const last = events[events.length - 1];
    expect(last.phase).toBe("done");
    expect(last.completed).toBe(400);
    expect(last.total).toBe(400);
    await expect(m.pull("some/other-model")).rejects.toThrow(/поддержанных/);
  });

  it("обычная 12B скачивается на Windows, MLX отклоняется до запроса к серверу", async () => {
    const requests: string[] = [];
    const m = new OllamaManager({ downloadsDir: tmp(), emit: () => {}, platform: "win32", fetcher: (async (_url, init) => {
      requests.push(JSON.parse(init!.body as string).model);
      return new Response('{"status":"success"}\n');
    }) as typeof fetch });
    await m.pull("gemma4:12b");
    await expect(m.pull("gemma4:12b-mlx")).rejects.toThrow(/Apple Silicon/);
    expect(requests).toEqual(["gemma4:12b"]);
  });

  it("ошибка Ollama при загрузке — понятная ошибка, а не тихий успех", async () => {
    const dir = tmp();
    const events: JobProgress[] = [];
    const m = new OllamaManager({ downloadsDir: dir, emit: (p) => events.push(p), home: dir, fetcher: (async () => new Response(JSON.stringify({ error: "no space left on device" }) + "\n", { status: 200 })) as typeof fetch });
    await expect(m.pull("gemma4:e4b")).rejects.toThrow(/no space/);
    expect(events[events.length - 1].phase).toBe("error");
  });

  it("каталог: размеры из манифеста реестра, рекомендация по памяти", async () => {
    const dir = tmp();
    const m = new OllamaManager({ downloadsDir: dir, emit: () => {}, home: dir, fetcher: (async () => Response.json({ layers: [{ size: 1e9 }, { size: 5e8 }] })) as typeof fetch });
    const c = await m.catalog();
    expect(c.models).toHaveLength(4);
    expect(c.models[0].sizeBytes).toBe(1.5e9);
    expect(["light", "quality"]).toContain(c.recommended);
  });
});
