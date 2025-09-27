/**
 * Zero-dependency OpenRouter client for Netlify Functions.
 * - Uses global fetch
 * - Retries with exponential backoff + jitter on 429/5xx (max 5 attempts)
 */

import { readEnv, requireEnv } from "./env";

declare function fetch(input: any, init?: any): Promise<any>;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function openrouterHeaders(correlationId?: string): Record<string, string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const referer = readEnv("NETLIFY_SITE_URL");
  const headers: Record<string, string> = {
    "authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
    "accept": "application/json",
    "X-Title": "find-right-people",
  };
  if (referer) headers["HTTP-Referer"] = referer as string;
  if (correlationId) headers["x-correlation-id"] = correlationId;
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number): number {
  // attempt starts at 1
  const base = 200; // ms
  const exp = Math.min(attempt - 1, 5);
  const jitter = Math.floor(Math.random() * 150); // 0-149ms
  return base * Math.pow(2, exp) + jitter;
}

function shouldRetryStatus(status: number): boolean {
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

export async function embed(
  texts: string[],
  opts?: { model?: string; correlationId?: string; signal?: AbortSignal }
): Promise<{ model: string; embeddings: number[][]; cost?: { embedding?: number } }> {
  const baseUrl = readEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")!;
  const model = (opts && opts.model) || readEnv("OPENROUTER_EMBED_MODEL", "openai/text-embedding-3-small")!;
  // Ensure API key is present early
  requireEnv("OPENROUTER_API_KEY");

  const url = `${baseUrl}/embeddings`;
  const payload: any = { model, input: texts };

  const maxAttempts = 5;
  let lastErr: any = undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: openrouterHeaders(opts?.correlationId),
        body: JSON.stringify(payload),
        signal: (opts as any)?.signal,
      });

      const status = (res && res.status) ? Number(res.status) : 0;
      if (res && res.ok) {
        const json = await res.json();
        const embeddings: number[][] =
          Array.isArray(json?.data) ? json.data.map((d: any) => d?.embedding ?? []) : [];
        const usedModel: string = json?.model ?? model;

        return {
          model: usedModel,
          embeddings,
          cost: json?.cost ? { embedding: json.cost.embedding } : undefined,
        };
      }

      // Non-OK
      const errBodyText = res && typeof res.text === "function" ? await res.text() : "";
      if (shouldRetryStatus(status) && attempt < maxAttempts) {
        // log and backoff
        try {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "openrouter.embed_http_error",
            attempt,
            status,
            correlationId: opts?.correlationId ?? null,
            model
          }));
        } catch {}
        await sleep(backoffDelayMs(attempt));
        continue;
      } else {
        throw new Error(`OpenRouter embeddings error ${status}: ${errBodyText}`);
      }
    } catch (e: any) {
      lastErr = e;
      // Network/other errors: retry
      if (attempt < maxAttempts) {
        try {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "openrouter.embed_network_error",
            attempt,
            correlationId: opts?.correlationId ?? null,
            model,
            error: e?.message ?? String(e)
          }));
        } catch {}
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      break;
    }
  }

  // Exhausted
  throw new Error(
    `OpenRouter embeddings failed after ${5} attempts: ${lastErr?.message ?? String(lastErr ?? "unknown error")}`
  );
}

export async function generate(
  messages: ChatMessage[],
  opts?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    correlationId?: string;
    signal?: AbortSignal;
  }
): Promise<{ model: string; text: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const baseUrl = readEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")!;
  const model = (opts && opts.model) || readEnv("OPENROUTER_GEN_MODEL", "anthropic/claude-3.5-sonnet")!;
  requireEnv("OPENROUTER_API_KEY");

  const url = `${baseUrl}/chat/completions`;
  const payload: any = {
    model,
    messages,
  };
  if (opts?.temperature !== undefined) payload.temperature = opts.temperature;
  if (opts?.maxTokens !== undefined) payload.max_tokens = opts.maxTokens;

  const maxAttempts = 5;
  let lastErr: any = undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: openrouterHeaders(opts?.correlationId),
        body: JSON.stringify(payload),
        signal: (opts as any)?.signal,
      });

      const status = (res && res.status) ? Number(res.status) : 0;
      if (res && res.ok) {
        const json = await res.json();

        const usedModel: string = json?.model ?? model;
        const text: string =
          json?.choices?.[0]?.message?.content ??
          json?.choices?.[0]?.text ??
          "";

        const usageRaw = json?.usage ?? {};
        const usage = {
          inputTokens: usageRaw?.prompt_tokens ?? usageRaw?.input_tokens,
          outputTokens: usageRaw?.completion_tokens ?? usageRaw?.output_tokens,
        };

        return { model: usedModel, text, usage };
      }

      const errBodyText = res && typeof res.text === "function" ? await res.text() : "";
      if (shouldRetryStatus(status) && attempt < maxAttempts) {
        try {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "openrouter.generate_http_error",
            attempt,
            status,
            correlationId: opts?.correlationId ?? null,
            model
          }));
        } catch {}
        await sleep(backoffDelayMs(attempt));
        continue;
      } else {
        throw new Error(`OpenRouter chat error ${status}: ${errBodyText}`);
      }
    } catch (e: any) {
      lastErr = e;
      if (attempt < maxAttempts) {
        try {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            msg: "openrouter.generate_network_error",
            attempt,
            correlationId: opts?.correlationId ?? null,
            model,
            error: e?.message ?? String(e)
          }));
        } catch {}
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      break;
    }
  }

  throw new Error(
    `OpenRouter chat failed after ${5} attempts: ${lastErr?.message ?? String(lastErr ?? "unknown error")}`
  );
}

export const openrouter = { embed, generate };