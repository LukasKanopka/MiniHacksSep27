/**
 * Shared HTTP helpers for Netlify Functions.
 *
 * Provides:
 * - Correlation ID extraction/propagation
 * - Consistent JSON responses
 * - Structured logging
 */

export type NetlifyResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * Extract the correlation ID from incoming headers, case-insensitive.
 * Expected header: "x-correlation-id"
 */
export function getCorrelationId(
  headers: Record<string, string | undefined>
): string | undefined {
  for (const key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      if (key.toLowerCase() === "x-correlation-id") {
        const val = headers[key];
        if (val === undefined || val === null) return undefined;
        const trimmed = String(val).trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
    }
  }
  return undefined;
}

/**
 * Build a JSON response with standard headers. Always sets:
 * - Content-Type: application/json; charset=utf-8
 * Optionally sets:
 * - x-correlation-id (when provided)
 */
export function jsonResponse(
  statusCode: number,
  body: unknown,
  correlationId?: string,
  extraHeaders?: Record<string, string>
): NetlifyResponse {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    ...(extraHeaders ?? {}),
  };
  if (correlationId) {
    headers["x-correlation-id"] = correlationId;
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(body ?? null),
  };
}

/**
 * Convenience 200 OK JSON response.
 */
export function ok(
  body: unknown,
  correlationId?: string,
  extraHeaders?: Record<string, string>
): NetlifyResponse {
  return jsonResponse(200, body, correlationId, extraHeaders);
}

/**
 * 400 Invalid request JSON response.
 * Body shape: { code: "invalid_request", message, details? }
 */
export function badRequest(
  message: string,
  correlationId?: string,
  details?: unknown
): NetlifyResponse {
  const payload: Record<string, unknown> = {
    code: "invalid_request",
    message,
  };
  if (details !== undefined) {
    payload.details = details;
  }
  return jsonResponse(400, payload, correlationId);
}

/**
 * 500 Internal error JSON response.
 * Body shape: { code: "internal_error", message, details? }
 */
export function internalError(
  message: string,
  correlationId?: string,
  details?: unknown
): NetlifyResponse {
  const payload: Record<string, unknown> = {
    code: "internal_error",
    message,
  };
  if (details !== undefined) {
    payload.details = details;
  }
  return jsonResponse(500, payload, correlationId);
}

/**
 * Structured INFO log in JSON format:
 * { ts, level, msg, correlationId, ...extra }
 */
export function logInfo(
  msg: string,
  correlationId?: string,
  extra?: Record<string, unknown>
): void {
  const base = {
    ts: new Date().toISOString(),
    level: "info",
    msg,
    correlationId,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ...base, ...(extra ?? {}) }));
}

/**
 * Structured ERROR log in JSON format:
 * { ts, level, msg, correlationId, ...extra }
 */
export function logError(
  msg: string,
  correlationId?: string,
  extra?: Record<string, unknown>
): void {
  const base = {
    ts: new Date().toISOString(),
    level: "error",
    msg,
    correlationId,
  };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ...base, ...(extra ?? {}) }));
}