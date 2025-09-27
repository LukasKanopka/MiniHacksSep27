// Neo4j client utilities for Netlify Functions
// - Singleton Driver creation and reuse
// - Safe READ session helper
// - Vector search (AuraDB) for People by embedding

import { requireEnv } from "./env";

// Import the official Neo4j driver (runtime only, avoid external typings)
const neo4j = require("neo4j-driver");

// Minimal inline types to avoid external type deps
type Driver = any;
type Session = any;

declare global {
  // Reuse across invocations (cold/warm starts)
  // eslint-disable-next-line no-var
  var __neo4jDriver: Driver | undefined;
}

/**
 * Create or return the singleton Driver instance.
 * - Reads NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD via requireEnv()
 * - Configures a small pool (maxConnectionPoolSize: 10)
 * - Encryption is determined by the URI scheme (bolt+s / neo4j+s => encrypted)
 */
export function getDriver(): Driver {
  if (globalThis.__neo4jDriver) {
    return globalThis.__neo4jDriver;
  }

  const uri = requireEnv("NEO4J_URI");
  const username = requireEnv("NEO4J_USERNAME");
  const password = requireEnv("NEO4J_PASSWORD");

  const driver: Driver = neo4j.driver(
    uri,
    neo4j.auth.basic(username, password),
    {
      // Pool sizing appropriate for serverless functions
      maxConnectionPoolSize: 10,
      // Encryption is inferred from URI scheme in Neo4j 5.x (bolt+s / neo4j+s)
      // No explicit 'encrypted' flag needed here.
    }
  );

  globalThis.__neo4jDriver = driver;
  return driver;
}

/**
 * Close and clear the singleton driver (primarily for tests).
 */
export async function closeDriver(): Promise<void> {
  const d = globalThis.__neo4jDriver;
  if (d) {
    globalThis.__neo4jDriver = undefined;
    try {
      await d.close();
    } catch {
      // best effort
    }
  }
}

/**
 * Helper to run a function against a READ session, always closing the session.
 */
export async function runRead<T>(fn: (session: Session) => Promise<T>): Promise<T> {
  const driver = getDriver();
  const session: Session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    return await fn(session);
  } finally {
    try {
      await session.close();
    } catch {
      // best effort
    }
  }
}

// ---------- Mapping helpers ----------

function toNumberSafe(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof v.toNumber === "function") {
    try {
      return v.toNumber();
    } catch {
      return 0;
    }
  }
  return 0;
}

function toStringArraySafe(v: any): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : x !== null && x !== undefined ? String(x) : undefined))
      .filter((x): x is string => typeof x === "string");
  }
  if (typeof v === "string") return [v];
  return [];
}

function getPropSafe(obj: any, key: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  const raw = (obj as any)[key];
  return raw === null || raw === undefined ? undefined : raw;
}

// ---------- Vector Query ----------

/**
 * Vector search people by query embedding, aggregating evidence scores per Person.
 *
 * Returns:
 * Array<{
 *   person: { id?: string; name?: string; roles?: string[]; skills?: string[] };
 *   aggScore: number;
 *   citations: Array<{ documentId?: string; chunkId?: string; score: number; snippet?: string }>;
 * }>
 */
export async function queryPeopleByEmbedding(
  embedding: number[],
  topK: number
): Promise<
  Array<{
    person: { id?: string; name?: string; roles?: string[]; skills?: string[] };
    aggScore: number;
    citations: Array<{ documentId?: string; chunkId?: string; score: number; snippet?: string }>;
  }>
> {
  const cypher = `
WITH $embedding AS emb, toInteger($k) AS k
CALL db.index.vector.queryNodes('chunk_embedding_idx', emb, k)
YIELD node AS c, score
OPTIONAL MATCH (c)-[:CHUNK_OF]->(d:Document)
OPTIONAL MATCH (c)-[:MENTIONS]->(p:Person)
WITH p, c, d, score
WHERE p IS NOT NULL
WITH p, collect({c:c, d:d, score:score}) AS hits
RETURN p AS person,
       reduce(s=0.0, h IN hits | s + h.score) AS aggScore,
       [h IN hits | { documentId: h.d.id, chunkId: h.c.id, score: h.score, snippet: substring(h.c.text,0,240)}][0..5] AS topEvidence
ORDER BY aggScore DESC
LIMIT toInteger($k)
`;

  return await runRead(async (session) => {
    const res = await session.run(cypher, { embedding, k: toNumberSafe(topK) });

    const out: Array<{
      person: { id?: string; name?: string; roles?: string[]; skills?: string[] };
      aggScore: number;
      citations: Array<{ documentId?: string; chunkId?: string; score: number; snippet?: string }>;
    }> = [];

    for (const record of res.records ?? []) {
      const pNode = record.get?.("person");
      const agg = record.get?.("aggScore");
      const ev = record.get?.("topEvidence");

      // Person properties (handle Node shape from neo4j-driver)
      const props = pNode && typeof pNode === "object" && pNode.properties ? pNode.properties : pNode ?? {};
      const person = {
        id: getPropSafe(props, "id") !== undefined ? String(getPropSafe(props, "id")) : undefined,
        name: getPropSafe(props, "name") !== undefined ? String(getPropSafe(props, "name")) : undefined,
        roles: toStringArraySafe(getPropSafe(props, "roles")),
        skills: toStringArraySafe(getPropSafe(props, "skills")),
      };

      const aggScore = toNumberSafe(agg);

      const citations: Array<{ documentId?: string; chunkId?: string; score: number; snippet?: string }> = [];
      if (Array.isArray(ev)) {
        for (const h of ev) {
          const documentId = getPropSafe(h, "documentId");
          const chunkId = getPropSafe(h, "chunkId");
          const score = toNumberSafe(getPropSafe(h, "score"));
          const snippetRaw = getPropSafe(h, "snippet");
          citations.push({
            documentId: documentId !== undefined ? String(documentId) : undefined,
            chunkId: chunkId !== undefined ? String(chunkId) : undefined,
            score,
            snippet: typeof snippetRaw === "string" ? snippetRaw : (snippetRaw !== undefined ? String(snippetRaw) : undefined),
          });
        }
      }

      out.push({ person, aggScore, citations });
    }

    return out;
  });
}