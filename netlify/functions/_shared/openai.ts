/**
 * Minimal OpenAI embeddings client for Netlify Functions.
 * Uses global fetch; no external deps.
 */
import { readEnv, requireEnv } from "./env";

declare function fetch(input: any, init?: any): Promise<any>;

export async function embedOpenAI(
  texts: string[],
  opts?: { model?: string; correlationId?: string; signal?: AbortSignal }
): Promise<{ model: string; embeddings: number[][] }> {
  if (!Array.isArray(texts) || texts.length === 0) {
    return { model: opts?.model || readEnv("OPENAI_EMBED_MODEL", "text-embedding-3-small")!, embeddings: [] };
  }
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = (opts?.model || readEnv("OPENAI_EMBED_MODEL", "text-embedding-3-small"))!;
  const url = "https://api.openai.com/v1/embeddings";

  const headers: Record<string, string> = {
    "authorization": `Bearer ${apiKey}`,
    "content-type": "application/json",
    "accept": "application/json",
  };
  if (opts?.correlationId) headers["x-correlation-id"] = opts.correlationId;

  const body = JSON.stringify({ model, input: texts });

  const res = await fetch(url, { method: "POST", headers, body, signal: (opts as any)?.signal });
  const status = res?.status ?? 0;
  if (!res || !res.ok) {
    const text = (res && typeof res.text === "function") ? await res.text() : "";
    throw new Error(`OpenAI embeddings error ${status}: ${text}`);
  }
  const json = await res.json();
  const embeddings: number[][] =
    Array.isArray(json?.data) ? json.data.map((d: any) => d?.embedding ?? []) : [];
  return { model, embeddings };
}

export const openai = { embedOpenAI };