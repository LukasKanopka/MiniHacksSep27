/**
 * Netlify Function: Ingestion Kickoff
 * Endpoint: POST /api/ingest/start
 *
 * Behavior:
 * - Validates request payload
 * - Generates jobId (job_<epochMillis><6-hex>)
 * - Sends signed webhook to WORKER_INGEST_URL using HMAC_SHA256(secret, `${ts}.${body}`)
 * - Propagates x-correlation-id to worker and back to client
 * - Returns 202 { jobId, status: "queued" } on success (any 2xx from worker)
 * - Maps worker non-2xx to 502 temporarily_unavailable
 */

import {
  getCorrelationId,
  badRequest,
  internalError,
  logInfo,
  logError,
  jsonResponse,
} from "./_shared/http";
import { requireEnv } from "./_shared/env";
import { buildSignedHeaders } from "./_shared/hmac";

/* Minimal Node global typing to avoid external @types dependencies */
declare const process: { env: Record<string, string | undefined> };

type IngestFile = {
  path: string;
  etag?: string;
  size: number;
  sha256: string;
};

type IngestStartRequest = {
  uploadSessionId: string;
  s3Prefix: string;
  files: IngestFile[];
};

type WorkerIngestPayload = {
  jobId: string;
  s3Prefix: string;
  files: IngestFile[];
  options: {
    chunkTokens: number;
    overlapTokens: number;
  };
};

const MAX_FILES = 10_000;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function generateJobId(): string {
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `job_${Date.now()}${rand}`;
}

function validateRequestBody(parsed: any): { ok: true; value: IngestStartRequest } | { ok: false; error: string } {
  const uploadSessionId = parsed?.uploadSessionId;
  const s3Prefix = parsed?.s3Prefix;
  const files = parsed?.files;

  if (!isNonEmptyString(uploadSessionId)) {
    return { ok: false, error: "Missing or empty 'uploadSessionId'" };
  }
  if (!isNonEmptyString(s3Prefix)) {
    return { ok: false, error: "Missing or empty 's3Prefix'" };
  }
  const trimmedPrefix = String(s3Prefix).trim();
  if (!trimmedPrefix.startsWith("anon/") || !trimmedPrefix.endsWith("/")) {
    return { ok: false, error: "'s3Prefix' must start with 'anon/' and end with '/'" };
  }

  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: "Request must include a non-empty 'files' array" };
  }
  if (files.length > MAX_FILES) {
    return { ok: false, error: `Too many files in one request. Max allowed is ${MAX_FILES}` };
  }

  const validatedFiles: IngestFile[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = f?.path;
    const size = f?.size;
    const sha256 = f?.sha256;
    const etag = f?.etag;

    if (!isNonEmptyString(path) || !isNonEmptyString(sha256) || typeof size !== "number" || size < 0) {
      return { ok: false, error: "Each file must have non-empty 'path', non-empty 'sha256', and 'size' >= 0" };
    }
    const file: IngestFile = {
      path: String(path).trim(),
      size,
      sha256: String(sha256).trim(),
    };
    if (etag !== undefined && etag !== null) {
      file.etag = String(etag);
    }
    validatedFiles.push(file);
  }

  return {
    ok: true,
    value: {
      uploadSessionId: String(uploadSessionId).trim(),
      s3Prefix: trimmedPrefix,
      files: validatedFiles,
    },
  };
}

export const handler = async (event: any) => {
  const correlationId = getCorrelationId(event?.headers ?? {});
  try {
    if (event?.httpMethod && String(event.httpMethod).toUpperCase() !== "POST") {
      return badRequest("Only POST is allowed for this endpoint", correlationId);
    }

    let parsed: any;
    try {
      parsed = event?.body ? JSON.parse(String(event.body)) : {};
    } catch (_e) {
      logError("ingest_start_failed", correlationId, { reason: "invalid_json" });
      return badRequest("Invalid JSON body", correlationId);
    }

    const v = validateRequestBody(parsed);
    if (!v.ok) {
      logError("ingest_start_failed", correlationId, { reason: "validation_error", detail: v.error });
      // Specific 400 messages per PRD
      if (v.error.includes("Too many files")) {
        return badRequest(v.error, correlationId);
      }
      return badRequest(v.error, correlationId);
    }

    const { s3Prefix, files } = v.value;
    const jobId = generateJobId();

    const workerUrl = requireEnv("WORKER_INGEST_URL");
    const signingSecret = requireEnv("WORKER_SIGNING_SECRET");

    const payload: WorkerIngestPayload = {
      jobId,
      s3Prefix,
      files,
      options: {
        chunkTokens: 600,
        overlapTokens: 80,
      },
    };

    const body = JSON.stringify(payload);
    const signed = buildSignedHeaders(signingSecret, body);

    const headers: Record<string, string> = {
      ...signed,
    };
    if (correlationId) {
      headers["x-correlation-id"] = correlationId;
    }
    const referer = process?.env?.NETLIFY_SITE_URL;
    if (typeof referer === "string" && referer.trim().length > 0) {
      headers["HTTP-Referer"] = String(referer).trim();
    }

    let workerRes: Response | undefined;
    try {
      workerRes = await fetch(workerUrl, {
        method: "POST",
        headers,
        body,
      } as any);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      logError("ingest_start_failed", correlationId, {
        reason: "fetch_error",
        error: message,
      });
      return internalError("An unexpected error occurred", correlationId);
    }

    if (!workerRes.ok) {
      logError("ingest_start_failed", correlationId, {
        reason: "worker_non_2xx",
        status: workerRes.status,
        statusText: workerRes.statusText,
      });
      return jsonResponse(
        502,
        {
          code: "temporarily_unavailable",
          message: "worker rejected ingest",
        },
        correlationId
      );
    }

    // Success path: do not parse worker body; treat any 2xx as accepted
    logInfo("ingest_start_queued", correlationId, { jobId, fileCount: files.length });
    return jsonResponse(202, { jobId, status: "queued" }, correlationId);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    logError("ingest_start_failed", correlationId, { error: message });
    return internalError("An unexpected error occurred", correlationId);
  }
};