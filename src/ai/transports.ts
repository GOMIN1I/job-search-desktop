// Транспорты AI-провайдеров. Ключ передаётся только из main-процесса; в renderer и журнал не попадает.

import Anthropic from "@anthropic-ai/sdk";
import type { Msg } from "../shared/types";
import { msg } from "../shared/types";

export type AiErrorCode = "no_provider" | "no_key" | "auth" | "rate_limited" | "invalid_response" | "budget" | "network" | "refusal" | "unknown_model" | "blocked_by_policy" | "cancelled" | "server";

export class AiError extends Error {
  constructor(public readonly code: AiErrorCode, public readonly userMessage: Msg, public readonly retryAfterMs: number | null = null) {
    super(`${code}: ${userMessage.en}`);
  }
}

export interface CompleteRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface CompleteResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface AiTransport {
  readonly provider: string;
  readonly model: string;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
  test(signal?: AbortSignal): Promise<{ ok: boolean; message: Msg; models: string[] }>;
}

// ---------- Anthropic (официальный SDK) ----------

export class AnthropicTransport implements AiTransport {
  readonly provider = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, public readonly model: string, opts: { baseURL?: string; fetch?: typeof fetch } = {}) {
    if (!apiKey) throw new AiError("no_key", msg("API-ключ Anthropic не задан", "Anthropic API key is not set"));
    this.client = new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000, baseURL: opts.baseURL, fetch: opts.fetch });
  }

  private mapError(e: unknown): AiError {
    if (e instanceof AiError) return e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AiError("auth", msg("Ключ отклонён провайдером (неверный или без доступа)", "The provider rejected the key (invalid or no access)"));
    if (e instanceof Anthropic.NotFoundError) return new AiError("unknown_model", msg(`Модель «${this.model}» не найдена`, `Model "${this.model}" not found`));
    if (e instanceof Anthropic.RateLimitError) {
      const ra = Number((e as any).headers?.get?.("retry-after"));
      return new AiError("rate_limited", msg("Лимит запросов провайдера (429) — повторите позже", "Provider rate limit (429) — try again later"), Number.isFinite(ra) ? ra * 1000 : null);
    }
    if (e instanceof Anthropic.BadRequestError) return new AiError("invalid_response", msg(`Провайдер отклонил запрос: ${(e as Error).message.slice(0, 200)}`, `The provider rejected the request: ${(e as Error).message.slice(0, 200)}`));
    if (e instanceof Anthropic.APIConnectionError) return new AiError("network", msg("Нет соединения с провайдером", "Cannot reach the provider"));
    if (e instanceof Anthropic.APIError) return new AiError("server", msg(`Ошибка провайдера ${(e as any).status ?? ""}`, `Provider error ${(e as any).status ?? ""}`));
    if ((e as Error)?.name === "AbortError" || /abort/i.test(String((e as Error)?.message))) return new AiError("cancelled", msg("Отменено", "Cancelled"));
    return new AiError("network", msg(`Сбой запроса: ${String((e as Error)?.message ?? e).slice(0, 200)}`, `Request failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`));
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    try {
      const res = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: { effort: "low", format: { type: "json_schema", schema: req.schema } },
        },
        { signal: req.signal },
      );
      if (res.stop_reason === "refusal") throw new AiError("refusal", msg("Модель отказалась отвечать на этот запрос", "The model declined this request"));
      if (res.stop_reason === "max_tokens") throw new AiError("invalid_response", msg("Ответ обрезан лимитом токенов", "Response truncated by the token limit"));
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      return { text, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens, model: res.model };
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async test(signal?: AbortSignal) {
    try {
      const page = await this.client.models.list({ limit: 50 }, { signal });
      const models = page.data.map((m) => m.id);
      const has = models.includes(this.model);
      return {
        ok: has,
        models,
        message: has
          ? msg(`Ключ принят, модель ${this.model} доступна`, `Key accepted, model ${this.model} is available`)
          : msg(`Ключ принят, но модель ${this.model} не найдена в списке`, `Key accepted, but model ${this.model} is not listed`),
      };
    } catch (e) {
      const err = this.mapError(e);
      return { ok: false, models: [], message: err.userMessage };
    }
  }
}

// ---------- OpenAI-совместимый (OpenAI, OpenRouter, локальные Ollama / LM Studio) ----------

export class OpenAICompatibleTransport implements AiTransport {
  readonly provider = "openai_compatible";
  constructor(private readonly baseUrl: string, private readonly apiKey: string | null, public readonly model: string, private readonly fetcher: typeof fetch = fetch) {
    if (!/^https?:\/\//i.test(baseUrl)) throw new AiError("no_provider", msg("Укажите адрес API (http/https)", "Set the API base URL (http/https)"));
  }
  private url(path: string) {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }
  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) };
  }
  private async statusError(res: Response): Promise<AiError> {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401 || res.status === 403) return new AiError("auth", msg("Ключ отклонён провайдером", "The provider rejected the key"));
    if (res.status === 404) return new AiError("unknown_model", msg(`Модель или адрес не найдены (${this.model})`, `Model or endpoint not found (${this.model})`));
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      return new AiError("rate_limited", msg("Лимит запросов провайдера (429)", "Provider rate limit (429)"), Number.isFinite(ra) ? ra * 1000 : null);
    }
    if (res.status === 400) return new AiError("invalid_response", msg(`Запрос отклонён: ${body}`, `Request rejected: ${body}`));
    return new AiError("server", msg(`Ошибка провайдера HTTP ${res.status}`, `Provider error HTTP ${res.status}`));
  }

  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    let res: Response;
    try {
      res = await this.fetcher(this.url("/chat/completions"), {
        method: "POST",
        headers: this.headers(),
        signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: 0,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_schema", json_schema: { name: "result", strict: true, schema: req.schema } },
        }),
      });
    } catch (e) {
      if (req.signal?.aborted) throw new AiError("cancelled", msg("Отменено", "Cancelled"));
      throw new AiError("network", msg(`Нет соединения с ${this.baseUrl}`, `Cannot reach ${this.baseUrl}`));
    }
    if (!res.ok) throw await this.statusError(res);
    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new AiError("invalid_response", msg("Ответ провайдера не JSON", "Provider response is not JSON"));
    }
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new AiError("invalid_response", msg("В ответе нет текста", "No text in the response"));
    return { text, tokensIn: Number(data?.usage?.prompt_tokens ?? 0), tokensOut: Number(data?.usage?.completion_tokens ?? 0), model: String(data?.model ?? this.model) };
  }

  async test(signal?: AbortSignal) {
    try {
      const res = await this.fetcher(this.url("/models"), { headers: this.headers(), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
      if (!res.ok) {
        const e = await this.statusError(res);
        return { ok: false, models: [], message: e.userMessage };
      }
      const data: any = await res.json();
      const models: string[] = (data?.data ?? []).map((m: any) => String(m.id));
      const has = models.includes(this.model);
      return {
        ok: has,
        models,
        message: has
          ? msg(`Соединение есть, модель ${this.model} доступна`, `Connected, model ${this.model} is available`)
          : msg(`Соединение есть, но модели ${this.model} нет. Доступны: ${models.slice(0, 8).join(", ") || "—"}`, `Connected, but model ${this.model} is missing. Available: ${models.slice(0, 8).join(", ") || "—"}`),
      };
    } catch {
      return { ok: false, models: [], message: msg(`Нет соединения с ${this.baseUrl}`, `Cannot reach ${this.baseUrl}`) };
    }
  }
}

// ---------- Тестовый транспорт (детерминированные тесты; никогда не используется как «live») ----------

export class TestTransport implements AiTransport {
  readonly provider = "test";
  calls: CompleteRequest[] = [];
  constructor(public readonly model: string, private readonly script: Array<CompleteResponse | AiError | ((req: CompleteRequest) => CompleteResponse)>) {}
  async complete(req: CompleteRequest): Promise<CompleteResponse> {
    this.calls.push(req);
    const next = this.script.shift();
    if (!next) throw new AiError("server", msg("Сценарий тестового транспорта исчерпан", "Test transport script exhausted"));
    if (next instanceof AiError) throw next;
    return typeof next === "function" ? next(req) : next;
  }
  async test() {
    return { ok: true, models: [this.model], message: msg("Тестовый транспорт", "Test transport") };
  }
}
