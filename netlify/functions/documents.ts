// Netlify Function: Documents - GET /api/documents?status=ingested|failed|pending

import { getCorrelationId, ok, badRequest, internalError, logInfo, logError } from "./_shared/http";
import { runRead } from "./_shared/neo4j";

type DocItem = { id?: string; path?: string; status?: string };
type DocumentsResponse = { documents: DocItem[] };

function toStr(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  return String(v);
}

export const handler = async (event: any) => {
  const correlationId = getCorrelationId(event?.headers ?? {});
  try {
    if (event?.httpMethod && String(event.httpMethod).toUpperCase() !== "GET") {
      return badRequest("Only GET is allowed for this endpoint", correlationId);
    }

    const allowedStatuses = new Set(["ingested", "failed", "pending"]);
    const statusRaw = event?.queryStringParameters?.status;
    let statusParam: string | null = null;

    if (statusRaw !== undefined && statusRaw !== null && String(statusRaw).trim().length > 0) {
      const s = String(statusRaw).trim().toLowerCase();
      if (!allowedStatuses.has(s)) {
        return badRequest("Invalid 'status' value", correlationId, { allowed: Array.from(allowedStatuses) });
      }
      statusParam = s;
    }

    const cypher = `
MATCH (d:Document)
WHERE $status IS NULL OR d.status = $status
RETURN d
ORDER BY d.createdAt DESC
LIMIT 200
`;

    const res = await runRead(async (session: any) => {
      return await session.run(cypher, { status: statusParam });
    });

    const documents: DocItem[] = [];
    for (const record of res?.records ?? []) {
      const dNode = record.get?.("d");
      const props = dNode && typeof dNode === "object" && dNode.properties ? dNode.properties : dNode ?? {};
      documents.push({
        id: toStr(props?.id),
        path: toStr(props?.path),
        status: toStr(props?.status),
      });
    }

    logInfo("documents_ok", correlationId, { status: statusParam, count: documents.length });

    const body: DocumentsResponse = { documents };
    return ok(body, correlationId);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    logError("documents_failed", correlationId, { error: message });
    return internalError("An unexpected error occurred", correlationId);
  }
};