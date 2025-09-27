# OpenRouter Client (Netlify Functions)

Purpose
- Zero-dependency Node client for OpenRouter used by Functions and Worker.
- Centralizes headers, model defaults, retries/backoff, and correlation-id propagation.
- Implemented in [netlify/functions/_shared/openrouter.ts](netlify/functions/_shared/openrouter.ts:1). See exports [openrouter.embed()](netlify/functions/_shared/openrouter.ts:1) and [openrouter.generate()](netlify/functions/_shared/openrouter.ts:1).
- PRD notes and header guidance in [AGENTREADME.md](AGENTREADME.md:116).

Environment variables
- OPENROUTER_API_KEY — required
- OPENROUTER_BASE_URL — default https://openrouter.ai/api/v1
- OPENROUTER_GEN_MODEL — default anthropic/claude-3.5-sonnet
- OPENROUTER_EMBED_MODEL — default openai/text-embedding-3-small
- NETLIFY_SITE_URL — used for HTTP-Referer header

Required headers
- Authorization: Bearer OPENROUTER_API_KEY
- HTTP-Referer: NETLIFY_SITE_URL (recommended by OpenRouter for safety/abuse prevention)
- X-Title: find-right-people
- x-correlation-id: optional; if present, will be forwarded and should be echoed in responses/logs (see [netlify/functions/_shared/http.ts](netlify/functions/_shared/http.ts:1))

Models (primary/fallback)
- Generation (default): anthropic/claude-3.5-sonnet; fallback openai/gpt-4o-mini
- Embeddings (default): openai/text-embedding-3-small (1536 dims); fallback voyage/voyage-3-lite

Endpoints
- POST /chat/completions
- POST /embeddings

Retries and concurrency
- Policy: exponential backoff with jitter for 429/5xx up to 5 attempts total.
- Non-retryable statuses (e.g., 400/401/403/404/413) fail fast.
- Concurrency caps guidance (apply at queue/pool level):
  - Embeddings: max 8 concurrent requests
  - Generations: max 2 concurrent requests

Client API
- [openrouter.embed()](netlify/functions/_shared/openrouter.ts:1)
  - Signature: async function embed(texts: string[], opts?: { model?: string; correlationId?: string; signal?: AbortSignal }): Promise<{ model: string; embeddings: number[][]; cost?: { embedding?: number } }>
  - Sends POST /embeddings with { model, input: texts }
  - Headers include Authorization, HTTP-Referer, X-Title, and x-correlation-id (when provided)
  - Default model from OPENROUTER_EMBED_MODEL via [readEnv()](netlify/functions/_shared/env.ts:1)
- [openrouter.generate()](netlify/functions/_shared/openrouter.ts:1)
  - Signature: async function generate(messages: { role: "system" | "user" | "assistant"; content: string }[], opts?: { model?: string; temperature?: number; maxTokens?: number; correlationId?: string; signal?: AbortSignal }): Promise<{ model: string; text: string; usage?: { inputTokens?: number; outputTokens?: number } }>
  - Sends POST /chat/completions with { model, messages, temperature?, max_tokens? }
  - Same headers and retry behavior
  - Default model from OPENROUTER_GEN_MODEL via [readEnv()](netlify/functions/_shared/env.ts:1)

Usage examples
Embedding a query
- API: [openrouter.embed()](netlify/functions/_shared/openrouter.ts:1)
- Types: [type ChatMessage](netlify/functions/_shared/openrouter.ts:1) (for generation), but embeddings take string[].

Example:
1) Ensure env: OPENROUTER_API_KEY, OPENROUTER_EMBED_MODEL (optional), NETLIFY_SITE_URL
2) In a Function handler:
- Correlation id optional; if you extract it, pass as opts.correlationId to propagate. You can use helpers in [netlify/functions/_shared/http.ts](netlify/functions/_shared/http.ts:1).

Call:
[openrouter.embed()](netlify/functions/_shared/openrouter.ts:1)
Returns: { model, embeddings: number[][], cost?: { embedding?: number } }

Generation (chat completion)
- API: [openrouter.generate()](netlify/functions/_shared/openrouter.ts:1)
- Messages must be an array of { role, content } using [type ChatMessage](netlify/functions/_shared/openrouter.ts:1).

Call:
[openrouter.generate()](netlify/functions/_shared/openrouter.ts:1)
Returns: { model, text, usage?: { inputTokens?, outputTokens? } }

Cost and telemetry
- Costs depend on model; embeddings chosen for cost efficiency (openai/text-embedding-3-small at 1536 dims).
- Structured logs should include correlationId; Functions echo x-correlation-id back (see [netlify/functions/_shared/http.ts](netlify/functions/_shared/http.ts:1) and [netlify/functions/health.ts](netlify/functions/health.ts:1)).
- On 429s, reduce concurrency; backoff; optionally switch to fallback models per PRD.

Notes
- Base URL defaults to https://openrouter.ai/api/v1 but can be overridden via OPENROUTER_BASE_URL.
- Headers and model defaults are composed inside the client for consistency.
- For long-running or batched operations, cap concurrency (8 embed, 2 generate) and aggregate costs/usage for observability.