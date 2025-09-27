/* Minimal Node global typing to avoid external @types dependencies */
declare const process: { env: Record<string, string | undefined> };

/**
 * Zero-dependency environment helpers for Netlify Functions.
 *
 * Usage pattern inside a Function:
 *   import { getCorrelationId } from "./_shared/http";
 *   import { readEnv, requireEnv, validateRequired, loadAppConfig } from "./_shared/env";
 *
 *   // Validate only what THIS function needs:
 *   validateRequired(["OPENROUTER_API_KEY"]);
 *
 *   // Read individual values:
 *   const apiKey = requireEnv("OPENROUTER_API_KEY");
 *   const region = readEnv("S3_REGION", "us-east-1");
 *
 *   // Or load a structured app config without throwing:
 *   const cfg = loadAppConfig();
 *   // cfg.openrouter.baseUrl is always set (defaults to the template value if unset)
 *
 * Notes:
 * - These helpers do not throw at import time.
 * - Use requireEnv()/validateRequired() to fail fast for function-specific needs.
 * - Minimal normalization: values are trimmed; empty string is treated as undefined.
 */

/**
 * Return an environment variable or a default (if provided). Empty strings are treated as undefined.
 * Values are trimmed.
 */
export function readEnv(name: string, def?: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return def;
  }
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) {
    return def !== undefined ? def : undefined;
  }
  return trimmed;
}

/**
 * Return a required environment variable. Throws a descriptive Error if missing or empty.
 */
export function requireEnv(name: string): string {
  const val = readEnv(name);
  if (val === undefined) {
    throw new Error(
      `Missing required environment variable '${name}'. Ensure it is defined in your environment or .env file.`
    );
  }
  return val;
}

/**
 * Validate a list of required environment variables. Aggregates all missing ones into a single Error.
 */
export function validateRequired(names: string[]): void {
  const missing: string[] = [];
  for (const n of names) {
    if (readEnv(n) === undefined) {
      missing.push(n);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(
        ", "
      )}. Ensure they are defined in your environment or .env file.`
    );
  }
}

export type AppConfig = {
  openrouter: {
    apiKey?: string;
    baseUrl: string;
    genModel: string;
    embedModel: string;
  };
  s3: {
    bucket?: string;
    region?: string;
  };
  worker: {
    ingestUrl?: string;
    signingSecret?: string;
  };
  neo4j: {
    uri?: string;
    username?: string;
    password?: string;
  };
  site: {
    netlifySiteUrl?: string;
  };
};

/**
 * Load a structured application config from environment variables.
 * This function never throws; where sensible, defaults are applied to provide stable strings.
 * Use validateRequired() in individual functions to enforce must-have variables for a given endpoint.
 */
export function loadAppConfig(): AppConfig {
  return {
    openrouter: {
      apiKey: readEnv("OPENROUTER_API_KEY"),
      baseUrl: readEnv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")!,
      genModel: readEnv("OPENROUTER_GEN_MODEL", "anthropic/claude-3.5-sonnet")!,
      embedModel: readEnv("OPENROUTER_EMBED_MODEL", "openai/text-embedding-3-small")!,
    },
    s3: {
      bucket: readEnv("S3_BUCKET"),
      region: readEnv("S3_REGION"),
    },
    worker: {
      ingestUrl: readEnv("WORKER_INGEST_URL"),
      signingSecret: readEnv("WORKER_SIGNING_SECRET"),
    },
    neo4j: {
      uri: readEnv("NEO4J_URI"),
      username: readEnv("NEO4J_USERNAME"),
      password: readEnv("NEO4J_PASSWORD"),
    },
    site: {
      netlifySiteUrl: readEnv("NETLIFY_SITE_URL"),
    },
  };
}