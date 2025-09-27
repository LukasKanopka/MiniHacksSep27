/**
 * HMAC helpers for Netlify Functions (zero-dependency types)
 *
 * Exposes:
 * - hmacHexSha256(secret, message) -> lowercase hex digest
 * - buildSignedHeaders(secret, body, ts?) -> headers for webhook signing
 *
 * Usage:
 *   const body = JSON.stringify({ hello: "world" });
 *   const headers = buildSignedHeaders("secret", body);
 *   // headers = {
 *   //   "X-Timestamp": "1730....",
 *   //   "X-Signature": "<hex>",
 *   //   "Content-Type": "application/json"
 *   // }
 */

declare function require(name: string): any;

// Lazy import without Node type dependencies
const crypto = require("crypto") as any;

/**
 * Compute HMAC-SHA256 over the message with the provided secret.
 *
 * @example
 * const sig = hmacHexSha256("topsecret", "1700000000.{\"a\":1}");
 * // => "e3b0c44298fc1c149afbf4c8996fb92427ae41e..." (hex, lowercase)
 */
export function hmacHexSha256(secret: string, message: string): string {
  const h = crypto.createHmac("sha256", String(secret));
  h.update(String(message));
  const hex = h.digest("hex");
  // Node returns lowercase by default; enforce to be explicit
  return String(hex).toLowerCase();
}

/**
 * Build signed headers for webhook POSTs.
 *
 * Signature scheme:
 *   timestamp = unix seconds (integer)
 *   payload = `${timestamp}.${body}`
 *   signature = HMAC_SHA256(secret, payload) as hex lowercase
 *
 * @param secret signing key
 * @param body raw JSON string to be sent
 * @param ts optional unix timestamp (seconds). If omitted, computed from Date.now()
 *
 * @example
 * const body = JSON.stringify({ ok: true });
 * const headers = buildSignedHeaders("secret", body, 1700000000);
 * // headers["X-Signature"] is HMAC_SHA256("secret", "1700000000."+body)
 */
export function buildSignedHeaders(
  secret: string,
  body: string,
  ts?: number
): { "X-Timestamp": string; "X-Signature": string; "Content-Type": "application/json" } {
  const timestamp =
    typeof ts === "number" && isFinite(ts) ? Math.floor(ts) : Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.${body}`;
  const signature = hmacHexSha256(secret, payload);
  return {
    "X-Timestamp": String(timestamp),
    "X-Signature": signature,
    "Content-Type": "application/json",
  };
}