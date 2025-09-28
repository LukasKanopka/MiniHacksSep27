// Netlify Function: Stats (GET /api/stats)
// - Returns counts for Document and Chunk
// - Returns vector index info for 'chunk_embedding_idx'

import { ok, internalError, getCorrelationId, logError } from "./_shared/http";
import { runRead } from "./_shared/neo4j";

export const handler = async (event: any) => {
  const correlationId = getCorrelationId((event && event.headers) ? event.headers : {});

  try {
    const data = await runRead(async (session: any) => {
      // Counts
      const docRes = await session.run("MATCH (d:Document) RETURN count(d) AS c");
      const chunkRes = await session.run("MATCH (c:Chunk) RETURN count(c) AS c");
      const personRes = await session.run("MATCH (p:Person) RETURN count(p) AS c");
      const mentionsRes = await session.run("MATCH (:Chunk)-[r:MENTIONS]->(:Person) RETURN count(r) AS c");

      const docCount = Number(docRes?.records?.[0]?.get?.("c") ?? 0);
      const chunkCount = Number(chunkRes?.records?.[0]?.get?.("c") ?? 0);
      const personCount = Number(personRes?.records?.[0]?.get?.("c") ?? 0);
      const mentionsCount = Number(mentionsRes?.records?.[0]?.get?.("c") ?? 0);

      // Index info (Aura: procedure availability depends on edition/version; fallback to empty if error)
      let indexInfo: any = null;
      try {
        const idxRes = await session.run(`
          CALL db.indexes()
          YIELD name, state, type, entityType, labelsOrTypes, properties
          WHERE name = 'chunk_embedding_idx'
          RETURN name, state, type, entityType, labelsOrTypes, properties
        `);
        if (Array.isArray(idxRes?.records) && idxRes.records.length > 0) {
          const r = idxRes.records[0];
          indexInfo = {
            name: r.get?.("name"),
            state: r.get?.("state"),
            type: r.get?.("type"),
            entityType: r.get?.("entityType"),
            labelsOrTypes: r.get?.("labelsOrTypes"),
            properties: r.get?.("properties"),
          };
        }
      } catch {
        indexInfo = null;
      }

      return { docCount, chunkCount, personCount, mentionsCount, index: indexInfo };
    });

    return ok(data, correlationId);
  } catch (e: any) {
    logError("stats_failed", correlationId, { error: e?.message ?? String(e) });
    return internalError("Stats query failed", correlationId, { error: e?.message ?? String(e) });
  }
};