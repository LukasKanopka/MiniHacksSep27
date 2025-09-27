// Netlify Function: Upload Session - Presigned S3 PUT URLs
// Endpoint: POST /api/upload/session

import { getCorrelationId, ok, badRequest, internalError, logInfo, logError } from "./_shared/http";
import { requireEnv, readEnv } from "./_shared/env";
import { createS3Client, sanitizePath, buildKey, presignPutUrl } from "./_shared/s3";

type UploadFileReq = { path: string; contentType: string; size: number };
type PresignedEntry = { url: string; headers: Record<string, string>; method: "PUT" };

const TTL_SECONDS = 900;
const MAX_FILES = 500;

function generateUploadSessionId(): string {
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `us_${Date.now()}${rand}`;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
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
      logError("upload_session_invalid", correlationId, { reason: "invalid_json" });
      return badRequest("Invalid JSON body", correlationId);
    }

    const arr = parsed?.files;
    if (!Array.isArray(arr) || arr.length === 0) {
      logError("upload_session_invalid", correlationId, { reason: "files_missing_or_empty" });
      return badRequest("Request must include a non-empty 'files' array", correlationId);
    }
    if (arr.length > MAX_FILES) {
      logError("upload_session_invalid", correlationId, { reason: "too_many_files", count: arr.length, max: MAX_FILES });
      return badRequest(`Too many files in one request. Max allowed is ${MAX_FILES}`, correlationId);
    }

    const files: UploadFileReq[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      const p = f?.path;
      const ct = f?.contentType;
      const size = f?.size;

      if (!isNonEmptyString(p) || !isNonEmptyString(ct) || typeof size !== "number" || size < 0) {
        logError("upload_session_invalid", correlationId, { reason: "invalid_file_entry", index: i });
        return badRequest("Each file must have non-empty 'path', non-empty 'contentType', and 'size' >= 0", correlationId);
      }

      files.push({ path: String(p).trim(), contentType: String(ct).trim(), size });
    }

    const bucket = requireEnv("S3_BUCKET");
    const region = readEnv("S3_REGION");

    const client = createS3Client();
    const uploadSessionId = generateUploadSessionId();
    const prefix = `anon/${uploadSessionId}/`;

    const presignedUrls: Record<string, PresignedEntry> = {};

    for (const f of files) {
      const safePath = sanitizePath(f.path);
      const key = buildKey(prefix, safePath);
      const signed = await presignPutUrl(client, {
        bucket,
        key,
        contentType: f.contentType,
        expiresInSeconds: TTL_SECONDS,
      });
      presignedUrls[f.path] = {
        url: signed.url,
        headers: signed.headers,
        method: "PUT",
      };
    }

    const responseBody = {
      uploadSessionId,
      expiresInSeconds: TTL_SECONDS,
      presignedUrls,
      s3Prefix: prefix,
    };

    logInfo("upload_session_created", correlationId, {
      files: files.length,
      uploadSessionId,
      region: region ?? null,
      bucket,
    });

    return ok(responseBody, correlationId);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    logError("upload_session_error", correlationId, { error: message });
    return internalError("An unexpected error occurred", correlationId);
  }
};