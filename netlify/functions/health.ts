// Netlify Function: Health Check
// - Method: GET /api/health
// - No auth, simple JSON response with status, time, and optional correlationId
// - Echo x-correlation-id header back in response header and body (if provided)

export const handler = async (event: any) => {
  // Case-insensitive lookup for x-correlation-id
  const hdrs = (event && event.headers) ? event.headers : {};
  let correlationId: string | undefined = undefined;
  for (const k in hdrs) {
    if (Object.prototype.hasOwnProperty.call(hdrs, k) && k.toLowerCase() === "x-correlation-id") {
      correlationId = String(hdrs[k]);
      break;
    }
  }

  const nowIso = new Date().toISOString();

  const body: Record<string, any> = {
    status: "ok",
    time: nowIso
  };
  if (correlationId) {
    body.correlationId = correlationId;
  }

  // Minimal structured log
  try {
    // Always include correlationId key; use null when absent for consistent shape in logs
    console.log(JSON.stringify({
      ts: nowIso,
      level: "info",
      msg: "health",
      correlationId: correlationId ?? null
    }));
  } catch (_e) {
    // Best-effort logging; do not fail the function
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8"
  };
  if (correlationId) {
    headers["x-correlation-id"] = correlationId;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(body)
  };
};