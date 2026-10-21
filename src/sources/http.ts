// HTTP-клиент сборщиков: таймаут, повтор с экспоненциальной задержкой, учёт Retry-After, отмена,
// ручное следование редиректам с проверкой каждого шага по политике исключённых источников.

import { blockedReason, type ExcludedHost } from "../core/policy";

export const USER_AGENT = "JobSearchDesktop/0.1 (+desktop app; local user; respects source limits)";

export class PolicyBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`Заблокировано политикой источников: ${reason}`);
  }
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  accept?: string;
  excluded: ExcludedHost[];
  maxRedirects?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  retryBaseMs?: number;
}

export interface FetchResult {
  status: number;
  finalUrl: string;
  text: string;
  headers: Headers;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Отменено"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Отменено"));
    }, { once: true });
  });

function retryAfterMs(h: Headers): number | null {
  const v = h.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.min(60_000, n * 1000);
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, Math.min(60_000, d - Date.now())) : null;
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Ответ больше ${Math.round(maxBytes / 1e6)} МБ — прерван`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

/** Один логический запрос с повторами. Возвращает результат даже для 4xx/5xx (кроме повторяемых, исчерпавших попытки — тогда тоже результат). */
export async function httpGet(url: string, opts: FetchOptions, fetcher: Fetcher = fetch): Promise<FetchResult> {
  const retries = opts.retries ?? 2;
  let attempt = 0;
  let lastErr: unknown = null;
  for (;;) {
    if (opts.signal?.aborted) throw new Error("Отменено");
    try {
      const res = await getFollowingRedirects(url, opts, fetcher);
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const wait = retryAfterMs(res.headers) ?? (opts.retryBaseMs ?? 1000) * 2 ** attempt;
        attempt++;
        await sleep(wait, opts.signal);
        continue;
      }
      return res;
    } catch (e) {
      if (e instanceof PolicyBlockedError) throw e;
      if (opts.signal?.aborted) throw new Error("Отменено");
      lastErr = e;
      if (attempt >= retries) break;
      attempt++;
      await sleep((opts.retryBaseMs ?? 1000) * 2 ** attempt, opts.signal);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function getFollowingRedirects(url: string, opts: FetchOptions, fetcher: Fetcher): Promise<FetchResult> {
  let current = url;
  const maxRedirects = opts.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const blocked = blockedReason(current, opts.excluded);
    if (blocked) throw new PolicyBlockedError(blocked);
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 25_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const res = await fetcher(current, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: { "User-Agent": USER_AGENT, Accept: opts.accept ?? "application/json, text/html;q=0.8, */*;q=0.5", ...(opts.headers ?? {}) },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      continue;
    }
    const text = await readLimited(res, opts.maxBytes ?? 15_000_000);
    return { status: res.status, finalUrl: current, text, headers: res.headers };
  }
  throw new Error("Слишком много редиректов");
}
