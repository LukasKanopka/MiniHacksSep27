 // Neo4j client utilities for Netlify Functions
 // - Singleton Driver creation and reuse
 // - Safe READ session helper (with connectivity fallback)
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

 function jsonLog(level: "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
   // eslint-disable-next-line no-console
   console[level](JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(extra ?? {}) }));
 }

 function toBolt(uri: string): string {
   try {
     const u = new URL(uri);
     if (u.protocol.startsWith("neo4j")) {
       u.protocol = u.protocol.includes("+s") ? "bolt+s:" : "bolt:";
       return u.toString();
     }
     return uri;
   } catch {
     return uri.replace("neo4j+s://", "bolt+s://").replace("neo4j://", "bolt://");
   }
 }

 function toSSC(uri: string): string {
   try {
     const u = new URL(uri);
     if (u.protocol.startsWith("neo4j")) {
       u.protocol = "neo4j+ssc:";
       return u.toString();
     }
     if (u.protocol.startsWith("bolt")) {
       u.protocol = "bolt+ssc:";
       return u.toString();
     }
     return uri;
   } catch {
     return uri
       .replace("neo4j+s://", "neo4j+ssc://")
       .replace("bolt+s://", "bolt+ssc://")
       .replace("neo4j://", "neo4j+ssc://")
       .replace("bolt://", "bolt+ssc://");
   }
 }

 function newDriver(uri: string, username: string, password: string): Driver {
   return neo4j.driver(
     uri,
     neo4j.auth.basic(username, password),
     {
       maxConnectionPoolSize: 10,
     }
   );
 }

 async function verifyOnce(d: Driver): Promise<void> {
   const s: Session = d.session({ defaultAccessMode: neo4j.session.READ });
   try {
     await s.run("RETURN 1 AS ok");
   } finally {
     try { await s.close(); } catch { /* ignore */ }
   }
 }

 /**
  * Legacy getter (kept for compatibility). Might return a driver that isn't verified yet.
  */
 export function getDriver(): Driver {
   if (globalThis.__neo4jDriver) return globalThis.__neo4jDriver;
   const uri = requireEnv("NEO4J_URI");
   const username = requireEnv("NEO4J_USERNAME");
   const password = requireEnv("NEO4J_PASSWORD");
   const d: Driver = newDriver(uri, username, password);
   globalThis.__neo4jDriver = d;
   return d;
 }

 /**
  * Build or reuse a verified driver, applying fallback strategies if needed:
  * 1) Try NEO4J_URI as-is (e.g., neo4j+s)
  * 2) On routing/cert errors, try bolt+s
  * 3) On cert errors, try +ssc (relaxed verification) to unblock dev on TLS interception networks
  */
 async function getDriverWithFallback(): Promise<Driver> {
   // Reuse if already verified in this cold/warm start
   if (globalThis.__neo4jDriver) return globalThis.__neo4jDriver;

   const uri = requireEnv("NEO4J_URI");
   const username = requireEnv("NEO4J_USERNAME");
   const password = requireEnv("NEO4J_PASSWORD");

   // 1) primary
   try {
     const d = newDriver(uri, username, password);
     await verifyOnce(d);
     globalThis.__neo4jDriver = d;
     return d;
   } catch (e: any) {
     const msg = String(e?.message ?? e);
     // 2) bolt fallback on routing issues
     if (uri.startsWith("neo4j") && msg.includes("Unable to retrieve routing information")) {
       const bolt = toBolt(uri);
       try {
         const d2 = newDriver(bolt, username, password);
         await verifyOnce(d2);
         jsonLog("info", "neo4j_js_fallback_to_bolt", { from: uri, to: bolt });
         globalThis.__neo4jDriver = d2;
         return d2;
       } catch (e2: any) {
         const m2 = String(e2?.message ?? e2);
         jsonLog("error", "neo4j_js_bolt_failed", { from: uri, to: bolt, error: m2 });
         // 3) +ssc on cert errors
         if (m2.includes("certificate") || m2.includes("SSL") || m2.toLowerCase().includes("verify")) {
           const ssc = toSSC(bolt);
           try {
             const d3 = newDriver(ssc, username, password);
             await verifyOnce(d3);
             jsonLog("warn", "neo4j_js_fallback_to_ssc", { from: bolt, to: ssc });
             globalThis.__neo4jDriver = d3;
             return d3;
           } catch (e3: any) {
             jsonLog("error", "neo4j_js_ssc_failed", { from: bolt, to: ssc, error: String(e3?.message ?? e3) });
             throw e3;
           }
         }
         throw e2;
       }
     }
     // 3) direct cert error on primary -> try +ssc
     if (msg.includes("certificate") || msg.includes("SSL") || msg.toLowerCase().includes("verify")) {
       const ssc = toSSC(uri);
       try {
         const d3 = newDriver(ssc, username, password);
         await verifyOnce(d3);
         jsonLog("warn", "neo4j_js_fallback_to_ssc", { from: uri, to: ssc });
         globalThis.__neo4jDriver = d3;
         return d3;
       } catch (e3: any) {
         jsonLog("error", "neo4j_js_ssc_failed", { from: uri, to: ssc, error: String(e3?.message ?? e3) });
         throw e3;
       }
     }
     throw e;
   }
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
  * Ensures connectivity and applies fallback strategies before running the query.
  */
 export async function runRead<T>(fn: (session: Session) => Promise<T>): Promise<T> {
   const driver = await getDriverWithFallback();
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
 CALL db.index.vector.queryNodes('chunk_embedding_idx', k, emb)
 YIELD node AS c, score
 OPTIONAL MATCH (c)-[:CHUNK_OF]->(d:Document)
 OPTIONAL MATCH (c)-[:MENTIONS]->(p:Person)
 WITH p, c, d, score
 WHERE p IS NOT NULL
  AND p.name IS NOT NULL
  AND size(split(p.name,' ')) >= 2 AND size(split(p.name,' ')) <= 4
  AND NOT toLower(p.name) CONTAINS 'computer science'
  AND NOT toLower(p.name) CONTAINS 'software engineering'
  AND NOT toLower(p.name) CONTAINS 'data structures'
  AND NOT toLower(p.name) CONTAINS 'advanced algorithms'
  AND NOT toLower(p.name) CONTAINS 'network security'
  AND NOT toLower(p.name) CONTAINS 'machine learning'
  AND NOT toLower(p.name) CONTAINS 'google cloud'
  AND NOT toLower(p.name) CONTAINS 'magna cum laude'
  AND NOT toLower(p.name) CONTAINS 'cum laude'
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