// Netlify Function: Search (POST /api/search)
// - Validates request
// - Embeds query via OpenRouter
// - Runs Neo4j vector search (Aura)
// - Optionally synthesizes an answer
// - Logs and returns structured JSON with correlation ID

import { ok, badRequest, internalError, getCorrelationId, logInfo, logError } from "./_shared/http";
import { generate } from "./_shared/openrouter";
import { embedOpenAI } from "./_shared/openai";
import { queryPeopleByEmbedding } from "./_shared/neo4j";

type SearchReq = { q: string; topK?: number; synthesize?: boolean };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export const handler = async (event: any) => {
  const correlationId = getCorrelationId((event && event.headers) ? event.headers : {});

  // Validate and parse JSON body
  let payload: SearchReq | undefined;
  try {
    const raw = event && typeof event.body === "string" ? event.body : "";
    if (!raw || raw.trim().length === 0) {
      return badRequest("Missing JSON body", correlationId);
    }
    payload = JSON.parse(raw);
  } catch (_e) {
    return badRequest("Invalid JSON", correlationId);
  }

  // Input validation
  const qRaw = (payload && typeof payload.q === "string") ? payload.q.trim() : "";
  if (!qRaw) {
    return badRequest("Field 'q' is required and must be a non-empty string", correlationId, { field: "q" });
  }
  const k = clamp(
    (payload && typeof payload.topK === "number" && Number.isFinite(payload.topK)) ? Math.floor(payload.topK) : 10,
    1,
    50
  );
  const synthesize = !!(payload && payload.synthesize === true);

  // Step 1-2: Embed the query
  let queryEmbedding: number[] = [];
  let embeddingModel = "";

  try {
    const emb = await embedOpenAI([qRaw], { correlationId });
    embeddingModel = emb.model;
    queryEmbedding = Array.isArray(emb.embeddings?.[0]) ? emb.embeddings[0] : [];
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return internalError("Embedding returned no vector", correlationId);
    }
  } catch (e: any) {
    logError("search_failed", correlationId, { stage: "embed", error: e?.message ?? String(e) });
    return internalError("Failed to embed query", correlationId);
  }

  // Step 3: Neo4j vector search
  let neoResults: Array<{
    person: { id?: string; name?: string; roles?: string[]; skills?: string[] };
    aggScore: number;
    citations: Array<{ documentId?: string; chunkId?: string; score: number; snippet?: string }>;
  }> = [];
  try {
    neoResults = await queryPeopleByEmbedding(queryEmbedding, k);
  } catch (e: any) {
    logError("search_failed", correlationId, { stage: "vector_query", error: e?.message ?? String(e) });
    return internalError("Vector search failed", correlationId);
  }

  // Map to response schema
  const results = neoResults.map((r) => ({
    person: {
      id: r.person.id,
      name: r.person.name,
      skills: Array.isArray(r.person.skills) ? r.person.skills : [],
    },
    score: r.aggScore,
    citations: (Array.isArray(r.citations) ? r.citations : []).map((c) => ({
      documentId: c.documentId,
      chunkId: c.chunkId,
      score: c.score,
      snippet: c.snippet,
    })),
  }));

  // Step 4 (optional): Synthesize concise answer
  let answer: string | undefined = undefined;
  let generationCost: number | undefined = undefined;

  if (synthesize) {
    try {
      const topForSynthesis = results.slice(0, Math.min(results.length, 5));
      const evidenceLines: string[] = [];
      for (const r of topForSynthesis) {
        const personName = r.person.name ?? "(unknown)";
        const skills = Array.isArray(r.person.skills) && r.person.skills.length > 0 ? ` skills: ${r.person.skills.join(", ")}` : "";
        evidenceLines.push(`- Person: ${personName}${skills} (score: ${r.score.toFixed(4)})`);
        const citeLines: string[] = [];
        for (const c of r.citations.slice(0, 3)) {
          const snip = (c.snippet ?? "").replace(/\s+/g, " ").trim();
          citeLines.push(`  - doc:${c.documentId ?? ""} chunk:${c.chunkId ?? ""} score:${c.score.toFixed(4)} "${snip}"`);
        }
        if (citeLines.length > 0) evidenceLines.push(...citeLines);
      }

      const messages = [
        {
          role: "system" as const,
          content: "You are a helpful assistant. Answer concisely using only the provided evidence. If the evidence is insufficient, say that explicitly.",
        },
        {
          role: "user" as const,
          content:
            `Query:\n${qRaw}\n\nEvidence:\n` +
            (evidenceLines.length > 0 ? evidenceLines.join("\n") : "- (no evidence found)") +
            `\n\nTask: Provide a concise, actionable answer based on the evidence.`,
        },
      ];

      const gen = await generate(messages, { temperature: 0, correlationId });
      answer = (gen.text || "").trim() || undefined;
      // If cost is provided by the client in the future, attach it; currently not available from generate()
      // generationCost = (gen as any)?.cost?.generation;
    } catch (e: any) {
      // Best-effort: synthesis failure should not fail the whole request
      logError("search_failed", correlationId, { stage: "synthesis", error: e?.message ?? String(e) });
    }
  }

  const response: Record<string, any> = {
    queryEmbeddingModel: embeddingModel,
    results,
  };

  if (answer !== undefined) {
    response.answer = answer;
  }

  const cost: Record<string, number> = {};
  if (typeof generationCost === "number") cost.generation = generationCost;
  if (Object.keys(cost).length > 0) {
    response.cost = cost;
  }

  logInfo("search_ok", correlationId, { qLen: qRaw.length, topK: k, results: results.length });

  return ok(response, correlationId);
};