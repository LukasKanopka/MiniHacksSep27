// Netlify Function: Person - GET /api/person/:id

import { getCorrelationId, ok, badRequest, internalError, logInfo, logError, jsonResponse } from "./_shared/http";
import { runRead } from "./_shared/neo4j";

type PersonResponse = {
  id: string;
  name?: string;
  roles: string[];
  skills: string[];
  projects: Array<{ id?: string; name?: string }>;
  evidence: Array<{ documentId?: string; chunkId?: string; snippet?: string; score: number }>;
};

function extractIdFromPath(path: string): string | undefined {
  if (typeof path !== "string" || path.length === 0) return undefined;
  const parts = path.split("/").filter((p) => p && p.trim().length > 0);
  if (parts.length === 0) return undefined;
  const last = parts[parts.length - 1].trim();
  return last.length > 0 ? last : undefined;
}

function toStr(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

function toStrArr(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const x of arr) {
    const s = typeof x === "string" ? x : (x !== null && x !== undefined ? String(x) : "");
    const t = s.trim();
    if (t.length > 0) out.push(t);
  }
  return out;
}

export const handler = async (event: any) => {
  const correlationId = getCorrelationId(event?.headers ?? {});
  try {
    if (event?.httpMethod && String(event.httpMethod).toUpperCase() !== "GET") {
      return badRequest("Only GET is allowed for this endpoint", correlationId);
    }

    const personId = extractIdFromPath(String(event?.path ?? ""));
    if (!personId) {
      return badRequest("person id is required", correlationId, { field: "id" });
    }

    const cypher = `
MATCH (p:Person {id: $id})
OPTIONAL MATCH (p)-[:HAS_ROLE]->(r:Role)
OPTIONAL MATCH (p)-[:HAS_SKILL]->(s:Skill)
OPTIONAL MATCH (p)-[:CONTRIBUTED_TO]->(proj:Project)
OPTIONAL MATCH (c:Chunk)-[:MENTIONS]->(p)
OPTIONAL MATCH (c)-[:CHUNK_OF]->(d:Document)
WITH p,
     collect(DISTINCT r.title) AS roles,
     collect(DISTINCT s.name) AS skills,
     collect(DISTINCT {id: proj.id, name: proj.name}) AS projects,
     collect(DISTINCT {documentId: d.id, chunkId: c.id, snippet: substring(c.text,0,240), score: 0.0}) AS evid
RETURN p AS person, roles, skills, projects, evid[0..10] AS evidence
`;

    const result = await runRead(async (session: any) => {
      return await session.run(cypher, { id: personId });
    });

    const rec = (result && Array.isArray(result.records) && result.records.length > 0) ? result.records[0] : undefined;
    if (!rec) {
      return jsonResponse(404, { code: "not_found", message: "person not found" }, correlationId);
    }

    const pNode = rec.get?.("person");
    if (!pNode) {
      return jsonResponse(404, { code: "not_found", message: "person not found" }, correlationId);
    }

    const pProps = pNode && typeof pNode === "object" && pNode.properties ? pNode.properties : pNode;
    const id = toStr(pProps?.id) ?? personId;
    const name = toStr(pProps?.name);

    // Arrays may contain nulls; clean them
    const rolesRaw = rec.get?.("roles");
    const roles = toStrArr(rolesRaw);
    const skillsRaw = rec.get?.("skills");
    const skills = toStrArr(skillsRaw);

    const projRaw = rec.get?.("projects");
    const projects: Array<{ id?: string; name?: string }> = [];
    if (Array.isArray(projRaw)) {
      for (const p of projRaw) {
        const pid = toStr((p && (p.id ?? p["id"])) as any);
        const pname = toStr((p && (p.name ?? p["name"])) as any);
        if (pid || pname) {
          projects.push({ id: pid, name: pname });
        }
      }
    }

    const evRaw = rec.get?.("evidence");
    const evidence: Array<{ documentId?: string; chunkId?: string; snippet?: string; score: number }> = [];
    if (Array.isArray(evRaw)) {
      for (const e of evRaw) {
        const documentId = toStr(e?.documentId ?? e?.["documentId"]);
        const chunkId = toStr(e?.chunkId ?? e?.["chunkId"]);
        const snippet = toStr(e?.snippet ?? e?.["snippet"]);
        const scoreVal = e?.score;
        const score = typeof scoreVal === "number" ? scoreVal : 0.0;
        if (documentId || chunkId || snippet) {
          evidence.push({ documentId, chunkId, snippet, score });
        }
      }
    }

    const response: PersonResponse = {
      id,
      name,
      roles,
      skills,
      projects,
      evidence,
    };

    logInfo("person_ok", correlationId, { personId: id, evidenceCount: evidence.length });
    return ok(response, correlationId);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    logError("person_failed", correlationId, { error: message });
    return internalError("An unexpected error occurred", correlationId);
  }
};