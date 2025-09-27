/* Minimal Node global typing to avoid external @types dependencies */
declare const process: { env: Record<string, string | undefined> };

/**
 * S3 utilities for Netlify Functions.
 *
 * Exports:
 * - createS3Client(): S3Client
 * - sanitizePath(p: string): string
 * - buildKey(prefix: string, relativePath: string): string
 * - presignPutUrl(client: S3Client, params): Promise<{ url: string; headers: Record<string,string> }>
 *
 * Usage example from [handler()](netlify/functions/upload.ts:1):
 *   import { createS3Client, sanitizePath, buildKey, presignPutUrl } from "./_shared/s3";
 *
 *   const client = createS3Client();
 *   const cleaned = sanitizePath("folder//a.pdf");
 *   const key = buildKey("anon/us_123/", cleaned);
 *   const signed = await presignPutUrl(client, {
 *     bucket: "my-bucket",
 *     key,
 *     contentType: "application/pdf",
 *     expiresInSeconds: 900
 *   });
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Create an S3 client using region from environment.
 * - Region is read from process.env.S3_REGION at call time.
 * - Does not throw at import time.
 */
export function createS3Client(): S3Client {
  const regionRaw = process.env.S3_REGION;
  const region = regionRaw ? String(regionRaw).trim() : undefined;

  const cfg: Record<string, unknown> = {};
  if (region) {
    cfg.region = region;
  }
  return new S3Client(cfg);
}

/**
 * Sanitize a file path by:
 * - Converting backslashes to forward slashes
 * - Trimming whitespace
 * - Stripping leading "./" or "/" (repeatedly)
 * - Normalizing consecutive slashes to a single slash
 */
export function sanitizePath(p: string): string {
  let s = String(p ?? "").replace(/\\+/g, "/").trim();

  // Remove leading "./" repeatedly
  while (s.startsWith("./")) {
    s = s.slice(2);
  }
  // Remove all leading "/"
  while (s.startsWith("/")) {
    s = s.slice(1);
  }

  // Collapse duplicate slashes
  s = s.replace(/\/+/g, "/");

  return s;
}

/**
 * Build an S3 object key by joining a prefix and a relative path.
 * Both parts are sanitized; ensures a single slash boundary.
 */
export function buildKey(prefix: string, relativePath: string): string {
  const pre = sanitizePath(prefix);
  const rel = sanitizePath(relativePath);

  if (!pre) return rel;
  if (!rel) return pre; // avoid trailing slash when no relative path
  return `${pre}/${rel}`;
}

/**
 * Create a presigned PUT URL for uploading to S3.
 * Returns the URL and required headers (Content-Type). The HTTP method is implied by the caller.
 */
export async function presignPutUrl(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }
): Promise<{ url: string; headers: Record<string, string> }> {
  const cmd = new PutObjectCommand({
    Bucket: params.bucket,
    Key: params.key,
    ContentType: params.contentType,
  });

  const url = await getSignedUrl(client, cmd, {
    expiresIn: params.expiresInSeconds,
  });

  return {
    url,
    headers: {
      "Content-Type": params.contentType,
    },
  };
}