# Local/E2E Testing Runbook

This runbook provides a deterministic end-to-end procedure to validate the project locally using the sample PDFs in [final pdfs/](final pdfs/Aaron_Brown.pdf:1). It brings up:
- Netlify Functions API per [netlify.toml](netlify.toml:1)
- Python Worker (local) per [neo4j/src/main.py](neo4j/src/main.py:1)
- Neo4j AuraDB or Desktop initialized via [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1)
- AWS S3 with CORS and IAM from [docs/s3-cors.json](docs/s3-cors.json:1) and [docs/iam-policy.json](docs/iam-policy.json:1)
Then runs: health → upload session → direct PUT to S3 → ingest_start webhook → worker processing → search.

1. Prerequisites
- Node 18+, Python 3.11+, Netlify CLI, Neo4j AuraDB/Desktop, AWS credentials.
- Environment variables (see [AGENTREADME.md: Local Development](AGENTREADME.md:522) and [.env.example](.env.example:1)). Create .env at repo root with:
  - OPENROUTER_API_KEY=
  - OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
  - OPENROUTER_GEN_MODEL=anthropic/claude-3.5-sonnet
  - OPENROUTER_EMBED_MODEL=openai/text-embedding-3-small
  - NEO4J_URI=bolt+s://<aura-host>:7687
  - NEO4J_USERNAME=neo4j
  - NEO4J_PASSWORD=
  - AWS_ACCESS_KEY_ID=
  - AWS_SECRET_ACCESS_KEY=
  - S3_BUCKET=
  - S3_REGION=
  - WORKER_INGEST_URL=http://localhost:8000/worker/ingest
  - WORKER_SIGNING_SECRET=
  - NETLIFY_SITE_URL=http://localhost:8888
- Where to set envs:
  - Netlify dev: export in your shell or place in .env (the Functions read process.env; see [netlify/functions/_shared/env.ts](netlify/functions/_shared/env.ts:1)).
  - Worker: .env is read by [neo4j/src/config.py](neo4j/src/config.py:1) and [python.main()](neo4j/src/main.py:1).
  - Optional (local-only convenience): WORKER_LOCAL_DATA_DIR to point Worker at [final pdfs/](final pdfs/Aaron_Brown.pdf:1) so local processing matches your manifest paths.

2. Service setup
- Neo4j
  - Create an AuraDB instance or a local Desktop DB; obtain NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD.
  - Initialize schema using [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1).
  - Neo4j Browser: open your DB, paste the statements from [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1), run them.
  - cypher-shell: run with your credentials and execute the same statements; ensure the vector index uses 1536 dimensions as defined in [neo4j/src/setup.cypher](neo4j/src/setup.cypher:8).
- S3
  - Create an S3 bucket for uploads (set S3_BUCKET and S3_REGION).
  - Apply CORS from [docs/s3-cors.json](docs/s3-cors.json:1); confirm AllowedOrigins include http://localhost:8888.
  - Ensure IAM policy aligns with [docs/iam-policy.json](docs/iam-policy.json:1): Functions require s3:PutObject on a prefix for presigned PUT; Worker requires s3:GetObject on the same prefix for ingestion.

3. Start local services
- Netlify Functions (API)
  - Install dependencies, then start Netlify dev which uses [netlify.toml](netlify.toml:1).
  - Expected dev URL: http://localhost:8888 with Functions exposed under /api/* via redirects in [netlify.toml](netlify.toml:12).
- Python Worker (local)
  - Start the FastAPI app in [python.main()](neo4j/src/main.py:1) using uvicorn example from [AGENTREADME.md: Local Development](AGENTREADME.md:544).
  - Ensure [neo4j/src/config.py](neo4j/src/config.py:1) is reading env values; set WORKER_SIGNING_SECRET before starting.
  - Recommended for local: set WORKER_LOCAL_DATA_DIR to the repository path final pdfs to process those PDFs directly.

4. Health checks
- Verify the API is up:
  - GET http://localhost:8888/api/health implemented by [netlify/functions/health.ts](netlify/functions/health.ts:1).
  - Expected 200 JSON per [AGENTREADME.md: API Spec](AGENTREADME.md:196): { status: ok, time: ISO8601 } and optional correlationId echo.

5. Upload session and direct S3 PUT
- Build a manifest from local [final pdfs/](final pdfs/Aaron_Brown.pdf:1).
  - For each file choose: path (e.g., "people/Aaron_Brown.pdf"), contentType=application/pdf, size in bytes from the file.
- Request presigned URLs:
  - POST http://localhost:8888/api/upload/session handled by [netlify/functions/upload.ts](netlify/functions/upload.ts:1).
  - Body contains files: [AGENTREADME.md: API Spec](AGENTREADME.md:206).
  - Expected 200 response fields per [AGENTREADME.md](AGENTREADME.md:212): uploadSessionId, expiresInSeconds, presignedUrls keyed by original path with method PUT and headers including Content-Type, and s3Prefix.
- Upload each PDF directly to S3:
  - For each entry in presignedUrls, perform an HTTP PUT to the url with the returned headers (ensure Content-Type is application/pdf).
  - Common CORS pitfalls: preflight must allow PUT and Content-Type; ensure bucket CORS matches [docs/s3-cors.json](docs/s3-cors.json:1) and local clock is in sync to avoid signature validation errors.

6. Ingestion kickoff
- Start ingestion:
  - POST http://localhost:8888/api/ingest/start via [netlify/functions/ingest_start.ts](netlify/functions/ingest_start.ts:1).
  - Body includes: uploadSessionId, s3Prefix, files array with path, size, and sha256; include etag if available. See [AGENTREADME.md: API Spec](AGENTREADME.md:225).
- Signing and verification:
  - The Function signs the webhook using HMAC; see [netlify/functions/_shared/hmac.ts](netlify/functions/_shared/hmac.ts:1).
  - The Worker verifies the signature and timestamp in [neo4j/src/main.py: ingest_webhook()](neo4j/src/main.py:321) using the shared WORKER_SIGNING_SECRET.
- Expected response and logs:
  - Function returns 202 { jobId, status: "queued" } per [AGENTREADME.md](AGENTREADME.md:239).
  - Worker logs show ingest_webhook_accept and processing details; upserts are executed via [neo4j/src/db.py](neo4j/src/db.py:1).
- Local mode note:
  - For local development, [neo4j/src/main.py](neo4j/src/main.py:33) reads files from WORKER_LOCAL_DATA_DIR and ignores s3Prefix; to match your manifest, set WORKER_LOCAL_DATA_DIR to the repository folder [final pdfs/](final pdfs/Aaron_Brown.pdf:1).

7. Search
- After ingestion completes, run search:
  - POST http://localhost:8888/api/search using [netlify/functions/search.ts](netlify/functions/search.ts:1).
  - Expected 200 response shape per [AGENTREADME.md](AGENTREADME.md:242): queryEmbeddingModel, results array (person, score, citations), and optional answer/cost fields.
- Prerequisites:
  - Vector index is online at 1536 dims as created in [neo4j/src/setup.cypher](neo4j/src/setup.cypher:8).
  - OpenRouter embedding is configured (OPENROUTER_API_KEY, model in [.env.example](.env.example:8)); see [docs/openrouter.md](docs/openrouter.md:1).

8. Verification checklist
- Neo4j
  - Vector index exists and is ONLINE (chunk_embedding_idx 1536 cosine). See [AGENTREADME.md: Vector index](AGENTREADME.md:334).
  - Document and Chunk counts are greater than zero after ingest.
  - Optional: run example queries from [AGENTREADME.md: Example Cypher](AGENTREADME.md:154).
- API
  - /api/health returns status ok quickly (<50ms local).
  - /api/upload/session returns presigned URLs with correct headers.
  - /api/ingest/start returns 202 and Worker logs indicate processing.
  - /api/search returns top-K people with citations within expected latency.

9. Troubleshooting
- S3 CORS: Preflight failures on PUT indicate CORS mismatch; re-apply [docs/s3-cors.json](docs/s3-cors.json:1) and wait a few minutes.
- IAM denies: Ensure presigned PUT policy allows s3:PutObject and Worker has s3:GetObject as per [docs/iam-policy.json](docs/iam-policy.json:1).
- AuraDB vector index dim mismatch: Ensure 1536 dims in [neo4j/src/setup.cypher](neo4j/src/setup.cypher:8) matches your embedding model.
- OPENROUTER_API_KEY missing/invalid: /api/search will fail at embedding; set keys per [.env.example](.env.example:1).
- Worker HMAC mismatch: Confirm WORKER_SIGNING_SECRET matches between Functions and Worker; see verification in [neo4j/src/main.py: ingest_webhook()](neo4j/src/main.py:321).
- Clock skew: If signature verification fails, ensure local time sync; Worker tolerates ±5 minutes per [neo4j/src/main.py](neo4j/src/main.py:55).

10. E2E smoke using one PDF
- Minimal path to validate pipeline before large batches:
  - Choose one file: [final pdfs/Aaron_Brown.pdf](final pdfs/Aaron_Brown.pdf:1).
  - Create upload session for a single entry with path "people/Aaron_Brown.pdf", contentType application/pdf, and the correct size.
  - PUT to the returned presigned URL.
  - POST ingest_start with that single file’s metadata.
  - Wait for Worker logs to show ingest_job_done and then POST /api/search with a simple query (e.g., "project experience") to confirm results.

Planned additions
- An optional batch helper script [scripts/upload-fixtures.js](scripts/upload-fixtures.js:1) will automate creating the manifest and uploading all PDFs from [final pdfs/](final pdfs/Aaron_Brown.pdf:1) during local testing.