# AGENTREADME.md — PRD + Technical Architecture

This document is the single source of truth for product requirements, APIs, data model, operations, and deployment for this project. It covers the entire system from upload to ingestion, graph construction, and query for “find the right people”.

Decision highlights
- Frontend: Netlify-deployed SPA (React/Vite) with folder upload UX, using presigned URLs for S3 direct uploads. See [netlify.toml](netlify.toml:1).
- API layer: Netlify Functions (Node) for upload-session, search, and ingestion kickoff: [functions/upload.ts](netlify/functions/upload.ts:1), [functions/ingest_start.ts](netlify/functions/ingest_start.ts:1), [functions/search.ts](netlify/functions/search.ts:1), [functions/person.ts](netlify/functions/person.ts:1), [functions/documents.ts](netlify/functions/documents.ts:1), [functions/health.ts](netlify/functions/health.ts:1).
- Worker: Python service on Railway, reusing existing Neo4j code ([neo4j/src/main.py](neo4j/src/main.py:1), [neo4j/src/db.py](neo4j/src/db.py:1), [neo4j/src/config.py](neo4j/src/config.py:1)). Add signed webhooks [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1) and [neo4j/src/main.py:finalize_job()](neo4j/src/main.py:1).
- LLMs: OpenRouter for generation and embeddings: [openrouter.generate()](docs/openrouter.md:1) and [openrouter.embed()](docs/openrouter.md:1).
  - Primary generation: anthropic/claude-3.5-sonnet
  - Fallback generation: openai/gpt-4o-mini
  - Primary embedding: openai/text-embedding-3-small (1536 dims, cost-efficient)
  - Fallback embedding: voyage/voyage-3-lite
- Storage: 
  - Raw files: AWS S3 with presigned URLs (default). Cloudflare R2 is an alternate with similar API.
  - Graph + vectors: Neo4j AuraDB (managed). Store both knowledge graph and chunk vectors via native vector indexes.
- Auth: MVP disables Netlify Identity; secure worker webhook with HMAC signature (shared secret). Identity can be enabled post-MVP.
- CI/CD: Netlify builds SPA + Functions based on [netlify.toml](netlify.toml:1).



## 1) Product Overview and Goals

Problem
- Unstructured, scattered documents make it hard to identify “who is best suited” for a task.
- Users need to upload a folder, transform it into a searchable knowledge graph, and query to find the right people with evidence.

Desired outcomes
- Uploads of mixed files (PDF, DOCX, PPTX, CSV, MD, TXT, images) at scale.
- Automated parsing, chunking, embedding, and graph construction.
- Low-latency search that returns people, rationale, and citations.

Success metrics
- Upload-to-search readiness median &lt; 5 minutes for 500MB.
- P95 query latency &lt; 1.5s for top-10 results.
- Evidence coverage: ≥ 90% results include at least one citation.
- Cost ceiling: &lt; $2 per 100MB ingested (LLM + infra), configurable.



## 2) Target Users and Use Cases

Personas
- Recruiter/Manager: Finds internal experts for projects.
- Analyst/Researcher: Maps skills across orgs and projects.
- Ops Engineer: Maintains ingestion pipelines and data quality.

Prioritized user stories
- As a user, I can upload a folder and monitor ingestion progress.
- As a user, I can search for “people experienced with X” and get ranked results with citations.
- As a user, I can view a person profile with top evidence and related projects.
- As an operator, I can observe costs, latencies, and failure modes easily.



## 3) Non-Functional Requirements

- Availability: 99.9% for query endpoints; ingestion may be best-effort.
- Scalability: Horizontal scaling on Functions and Worker; S3 and AuraDB managed.
- Latency: P95 query &lt; 1.5s for top-10; ingestion batch parallelism tunable.
- Cost ceilings: Configurable per environment; default throttle for OpenRouter qps.
- Data durability: S3 for blobs, AuraDB for graph with automated backups.
- Privacy/PII: Encryption in transit (TLS), at rest (S3 SSE, AuraDB), safe deletion flow.



## 4) System Architecture

Components
- SPA Frontend (Netlify): Folder upload UI; calls Functions to get presigned URLs; observes ingestion status; runs queries.
- Netlify Functions (Node): Issues S3 presigned URLs, triggers ingestion job, proxies search queries to Neo4j/Aura, and minimal orchestration.
- Python Worker (Railway): Ingests via webhook, downloads files from S3, parses (Unstructured API recommended), chunks, embeds via OpenRouter, and writes to Neo4j with vector indexes; exposes webhooks [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1), [neo4j/src/main.py:finalize_job()](neo4j/src/main.py:1).
- Data Stores: S3 for raw blobs; Neo4j AuraDB for graph and chunk vectors.

Why Netlify Functions + Python Worker
- Functions provide low-latency edge-ish API and presigned URL generation, with simple CI/CD on Netlify.
- Python Worker is ideal for parsing libraries, batching, and Neo4j driver usage, reusing [neo4j/src/db.py](neo4j/src/db.py:1).

Storage choices
- S3: Ubiquitous, durable, lifecycle policies, least-cost at scale, presigned URL support.
- AuraDB: Managed Neo4j with native vector index capabilities and Cypher support; simplifies modeling “person-centric” relationships.

ASCII data flow

  [Browser SPA]
       |
       | 1) request upload session
       v
  [Netlify Function: upload] --2) presigned URLs--> [S3 Bucket]
       ^
       | 3) PUT files directly to S3
       |
       | 4) POST ingest_start(job) 
       v
  [Netlify Function: ingest_start] --5) signed webhook--> [Python Worker on Railway]
       |
       v 6) GET from S3, parse, chunk, embed via OpenRouter
  [Unstructured API]   [OpenRouter]
       |
       v 7) Upsert graph + vectors
  [Neo4j AuraDB]
       ^
       | 8) search(q) runs vector search + aggregation
  [Netlify Function: search] &lt;-- [Browser SPA]



## 5) Data Ingestion and Processing

Folder upload via presigned URLs
- SPA requests an upload session at [functions/upload.ts](netlify/functions/upload.ts:1) with manifest (paths, sizes, MIME).
- Function returns presigned PUT URLs for each file with short TTL (e.g., 15 min).
- Browser uploads directly to S3; completion triggers [functions/ingest_start.ts](netlify/functions/ingest_start.ts:1) which posts a signed webhook to [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1).

Parsing strategy
- Use Unstructured API to avoid bundling heavy binaries in Functions/Worker. For PDFs, PPTX, images, it normalizes to text elements with layout metadata.
- Fallbacks (if needed in Worker): PyMuPDF for PDF, python-docx, mammoth for DOCX, Tesseract OCR for images; but prefer API to simplify ops.

Chunking
- Strategy: semantic-aware chunking by element type; or simple token-based.
- Default parameters:
  - chunk_tokens: 600
  - overlap_tokens: 80
  - min_tokens: 80
  - split on headings/bullets where possible; merge small elements.

Embeddings and extraction via OpenRouter
- Generation: [openrouter.generate()](docs/openrouter.md:1) primary model anthropic/claude-3.5-sonnet; fallback openai/gpt-4o-mini.
- Embeddings: [openrouter.embed()](docs/openrouter.md:1) primary model openai/text-embedding-3-small (1536 dims), fallback voyage/voyage-3-lite.
- Headers: 
  - Authorization: Bearer OPENROUTER_API_KEY
  - HTTP-Referer: NETLIFY_SITE_URL (recommended by OpenRouter)
  - X-Title: Site or app name
- Rate limiting/backoff:
  - On 429/5xx: exponential backoff with jitter; max 5 retries; circuit-breaker at queue level.
  - Parallelism caps per model (e.g., 8 concurrent embedding calls; 2 concurrent generations).
- Idempotency:
  - Deduplicate documents by SHA256(document_bytes) stored on Document node.
  - Chunk fingerprint SHA1(text_normalized) prevents duplicate chunk writes.
  - Worker retries use idempotency keys per file.

Backpressure
- Queue ingestion by batch of N files (e.g., 20), each file split into chunks; embed in batches of 64 with max request size &lt; 2MB payload.
- Persist partial progress per document to allow resume.



## 6) Querying: “Find the right people”

Query flow
1) User submits query text to [functions/search.ts](netlify/functions/search.ts:1).
2) Function embeds query via [openrouter.embed()](docs/openrouter.md:1).
3) Neo4j vector search on Chunk.embedding; retrieve top-K chunks with scores.
4) Project chunks → entities via MENTIONS/DERIVED_FROM/CHUNK_OF and join to Person.
5) Rank/aggregate by combined score; optional synthesis via [openrouter.generate()](docs/openrouter.md:1) with citations.

Ranking formula
- base = cosine_similarity
- entity_gain = + alpha * (person_skill_match + role_weight + recency_decay)
- doc_quality = + beta * (source_weight)
- final_score = w1*base + w2*entity_gain + w3*doc_quality
- Tie-breakers: recent activity, org priority, number of distinct documents citing.

Example Cypher: vector search (AuraDB 5.28 with vector index)
- Create vector index:

  CALL db.index.vector.createNodeIndex(
    'chunk_embedding_idx',
    'Chunk',
    'embedding',
    1536,
    'cosine'
  );

- Top-K chunks for query embedding:

  WITH $embedding AS emb, 10 AS k
  CALL db.index.vector.queryNodes('chunk_embedding_idx', emb, k)
  YIELD node AS c, score
  MATCH (c)-[:CHUNK_OF]->(d:Document)
  OPTIONAL MATCH (c)-[:MENTIONS]->(p:Person)
  RETURN c, d, p, score
  ORDER BY score DESC
  LIMIT k;

- Aggregation to people:

  WITH $embedding AS emb, 50 AS k
  CALL db.index.vector.queryNodes('chunk_embedding_idx', emb, k)
  YIELD node AS c, score
  OPTIONAL MATCH (c)-[:MENTIONS]->(p:Person)
  WITH p, collect({chunk: c, score: score}) AS hits
  WHERE p IS NOT NULL
  RETURN p, reduce(s=0.0, h IN hits | s + h.score) AS aggScore, hits[0..5] AS topEvidence
  ORDER BY aggScore DESC
  LIMIT 10;



## 7) API Specification

Conventions
- All requests/responses JSON; UTF-8; application/json.
- Correlation ID header: x-correlation-id echoed in responses/logs.
- Errors: JSON { code, message, details? } with HTTP status.

Netlify Functions (Node)
1) [functions/health.ts](netlify/functions/health.ts:1)
- GET /api/health
- Auth: none
- 200: { status: ok, time: ISO8601 }

2) [functions/upload.ts](netlify/functions/upload.ts:1)
- POST /api/upload/session
- Auth: none (MVP); consider Netlify Identity later
- Request:
  {
    "files": [
      { "path": "folder/a.pdf", "contentType": "application/pdf", "size": 12345 },
      { "path": "folder/b.docx", "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "size": 23456 }
    ]
  }
- Response 200:
  {
    "uploadSessionId": "us_123",
    "expiresInSeconds": 900,
    "presignedUrls": {
      "folder/a.pdf": { "url": "https://s3...", "headers": { "Content-Type": "application/pdf" }, "method": "PUT" },
      "folder/b.docx": { "url": "https://s3...", "headers": { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, "method": "PUT" }
    },
    "s3Prefix": "customerX/us_123/"
  }
- 4xx: validation errors; 5xx: internal.
- Rate limits: 10 req/min per IP; enforce via Netlify Edge middleware if needed.

3) [functions/ingest_start.ts](netlify/functions/ingest_start.ts:1)
- POST /api/ingest/start
- Auth: none (MVP); implement JWT later
- Request:
  {
    "uploadSessionId": "us_123",
    "s3Prefix": "customerX/us_123/",
    "files": [
      { "path": "folder/a.pdf", "etag": "W/abcd", "size": 12345, "sha256": "..." }
    ]
  }
- Behavior:
  - Creates job_id.
  - Sends signed webhook to [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1) with HMAC header.
- Response 202:
  { "jobId": "job_789", "status": "queued" }

4) [functions/search.ts](netlify/functions/search.ts:1)
- POST /api/search
- Auth: none (MVP)
- Request:
  { "q": "who knows graph embeddings", "topK": 10, "synthesize": true }
- Response 200:
  {
    "queryEmbeddingModel": "openai/text-embedding-3-small",
    "results": [
      {
        "person": { "id": "p1", "name": "Alice", "skills": ["Neo4j"] },
        "score": 0.87,
        "citations": [
          { "documentId": "d123", "chunkId": "c1", "score": 0.76, "snippet": "..." }
        ]
      }
    ],
    "answer": "Top experts include Alice...",
    "cost": { "embedding": 0.0002, "generation": 0.0004 }
  }

5) [functions/person.ts](netlify/functions/person.ts:1)
- GET /api/person/:id
- Auth: none (MVP)
- Response 200:
  {
    "id": "p1",
    "name": "Alice",
    "roles": ["Staff Engineer"],
    "skills": ["Neo4j", "NLP"],
    "projects": [{ "id": "proj9", "name": "Knowledge Graph" }],
    "evidence": [{ "documentId": "d1", "chunkId": "c2", "snippet": "...", "score": 0.61 }]
  }

6) [functions/documents.ts](netlify/functions/documents.ts:1)
- GET /api/documents?status=ingested|failed|pending
- Response 200:
  { "documents": [{ "id": "d1", "path": "folder/a.pdf", "status": "ingested" }] }

Worker (Python on Railway)
1) [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1)
- POST /worker/ingest
- Auth: HMAC signature (X-Signature, X-Timestamp)
- Request:
  {
    "jobId": "job_789",
    "s3Prefix": "customerX/us_123/",
    "files": [{ "path": "folder/a.pdf", "sha256": "..." }],
    "options": { "chunkTokens": 600, "overlapTokens": 80 }
  }
- Behavior:
  - Verify HMAC.
  - For each file: download from S3, parse (Unstructured API), chunk, embed via OpenRouter, upsert to Neo4j via [neo4j/src/db.py](neo4j/src/db.py:1).
- Response 202: { "jobId": "job_789", "status": "processing" }

2) [neo4j/src/main.py:finalize_job()](neo4j/src/main.py:1)
- POST /worker/finalize
- Auth: HMAC signature
- Request:
  { "jobId": "job_789", "summary": { "documents": 14, "chunks": 438, "errors": 0 } }
- Response 200: { "status": "ok" }

Error codes (representative)
- 400 invalid_request, 401 unauthorized, 403 forbidden, 404 not_found, 409 conflict, 413 payload_too_large, 429 rate_limited, 500 internal_error, 503 temporarily_unavailable.



## 8) Graph Data Model

Node labels
- Person: id, name, emails[], skills[], createdAt, updatedAt
- Organization: id, name, domain
- Role: id, title, seniority
- Skill: id, name, category?
- Project: id, name, startedAt?, endedAt?
- Document: id (sha256), path, source, mime, bytes, createdAt, status
- Chunk: id, text, embedding (vector[1536]), tokens, order, section, page?, createdAt

Relationships
- (Person)-[:WORKS_AT]->(Organization)
- (Person)-[:HAS_ROLE]->(Role)
- (Person)-[:HAS_SKILL]->(Skill)
- (Person)-[:CONTRIBUTED_TO]->(Project)
- (Chunk)-[:MENTIONS]->(Person|Organization|Skill|Project)
- (Chunk)-[:CHUNK_OF]->(Document)
- (Document)-[:DERIVED_FROM]->(Document) for versioning/derivatives

Constraints and indexes
- CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE;
- CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
- CREATE INDEX chunk_order IF NOT EXISTS FOR (c:Chunk) ON (c.order);

Vector index (AuraDB)
- CALL db.index.vector.createNodeIndex('chunk_embedding_idx', 'Chunk', 'embedding', 1536, 'cosine');

Upserts (pattern)
- MERGE (d:Document {id: $docId})
  ON CREATE SET d.path = $path, d.mime = $mime, d.createdAt = datetime()
  ON MATCH SET d.updatedAt = datetime();
- MERGE (c:Chunk {id: $chunkId})
  SET c.text = $text, c.embedding = $embedding, c.order = $order, c.tokens = $tokens
  WITH c
  MATCH (d:Document {id: $docId})
  MERGE (c)-[:CHUNK_OF]->(d);



## 9) Environment Variables

LLM/OpenRouter
- OPENROUTER_API_KEY — required for all calls
- OPENROUTER_BASE_URL — default https://openrouter.ai/api/v1
- OPENROUTER_GEN_MODEL — default anthropic/claude-3.5-sonnet
- OPENROUTER_EMBED_MODEL — default openai/text-embedding-3-small
- Referenced by: [functions/search.ts](netlify/functions/search.ts:1), Worker client (see [docs/openrouter.md](docs/openrouter.md:1))

Neo4j
- NEO4J_URI, NEO4J_USERNAME (or NEO4J_USER), NEO4J_PASSWORD
- Used by: [neo4j/src/config.py](neo4j/src/config.py:1), [neo4j/src/db.py](neo4j/src/db.py:1)

AWS/S3
- AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
- S3_BUCKET, S3_REGION
- Used by: [functions/upload.ts](netlify/functions/upload.ts:1), [functions/ingest_start.ts](netlify/functions/ingest_start.ts:1), Worker downloader

Worker/webhooks
- WORKER_INGEST_URL — e.g., https://&lt;railway-app&gt;.up.railway.app/worker/ingest
- WORKER_SIGNING_SECRET — HMAC secret for webhook signatures
- Used by: [functions/ingest_start.ts](netlify/functions/ingest_start.ts:1), [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1)

Netlify/Frontend
- NETLIFY_SITE_URL — used in OpenRouter headers
- NETLIFY_IDENTITY_SITE — set only if enabling Identity post-MVP



## 10) Deployment (Netlify + External Services)

Netlify
- Connect repo; set build: npm run build; publish dir: dist; functions dir: netlify/functions.
- Env vars: all listed above in site settings.
- Optional Identity: keep disabled for MVP.

Example [netlify.toml](netlify.toml:1)

  [build]
    command = "npm run build"
    publish = "dist"
    functions = "netlify/functions"

  [[redirects]]
    from = "/*"
    to = "/index.html"
    status = 200

Neo4j AuraDB
- Create AuraDB instance; get NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD.
- Initialize constraints, indexes, and vector index.

AWS S3
- Create bucket; enable SSE (AES256); block public access.
- IAM least-privilege policy for presigned access:
  - s3:PutObject for bucket/prefix
  - s3:GetObject for Worker
- Configure CORS for browser PUTs with content-type headers.

Python Worker on Railway
- Create Railway service from Python; set requirements from [neo4j/requirements.txt](neo4j/requirements.txt:1).
- Set env vars: Neo4j, OpenRouter, S3 (if directly accessing), WORKER_SIGNING_SECRET.
- Expose HTTP with routes [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1), [neo4j/src/main.py:finalize_job()](neo4j/src/main.py:1).



## 11) Security and Compliance

MVP Auth
- Public Functions; rely on secret webhooks to Worker.
- Post-MVP: enable Netlify Identity; validate JWT in Functions.

Webhook HMAC signatures
- Signature scheme: sig = HMAC_SHA256(secret, timestamp + "." + body); send headers:
  - X-Timestamp: unix epoch seconds
  - X-Signature: hex lowercase
- Verify: absolute(now - timestamp) &lt; 5 mins; constant-time compare.

Secrets management
- Store only in Netlify/ Railway env managers; no commits.
- Rotate every 90 days; versioned via tagging.

PII and encryption
- TLS for all transport; S3 at-rest encryption; AuraDB managed encryption.
- Presigned URL TTLs: 15 minutes default.

Deletion and RTBF
- Delete by document id; cascade delete CHUNK_OF, MENTIONS edges.
- Optionally tombstone records to support audit logs.



## 12) Observability and Operations

Logging
- Structure: JSON logs with fields ts, level, msg, correlationId, jobId, docId, filePath, model.
- Correlation: carry x-correlation-id from SPA → Functions → Worker.

Metrics
- Ingest: files/min, chunks/min, embeddings/sec, failure rate.
- Query: P50/P95 latency, hit rate, vector recall proxy (score thresholds).
- Cost: $ per document, $ per 1K tokens (embedding/generation).

Alerting/Dashboards
- Use Netlify logs and Railway logs; forward to Sentry or Logtail.
- AuraDB metrics: CPU, memory, query times, index health.

Runbooks
- OpenRouter 429s: reduce concurrency, backoff, switch to fallback models.
- Neo4j transaction timeouts: tune batch sizes; use periodic commits.
- S3 upload failures: check CORS, content-type, clock skew.



## 13) Testing Strategy

Unit tests
- Chunker behavior with fixtures; LLM stubs for [openrouter.generate()](docs/openrouter.md:1) and [openrouter.embed()](docs/openrouter.md:1).
- Cypher builders: validate MERGE patterns.

Integration tests
- Local minio/S3 stub uploads; ingest small corpus; assert graph nodes/edges.

E2E
- Netlify dev stack; upload sample folder; run search; snapshot top results.
- Deterministic prompting: set system prompts; temperature=0; golden outputs.

CI
- Lint Functions and Worker; run tests on PR; deploy previews on Netlify.



## 14) Cost and Performance Planning

Token flows
- Embedding dominates at scale; choose openai/text-embedding-3-small (1536 dims) for cost efficiency.
- Generation used only for synthesis; optional.

Estimates (order-of-magnitude)
- Embedding 1MB (~750K tokens raw text after parsing/dedup) ≈ $0.015 at $0.02 per 1M tokens.
- Generation per answer (1K in/1K out tokens) ≈ $0.018–$0.02 depending on model.

Concurrency and batching
- Embeddings: batch chunks up to 64; cap 8 concurrent requests.
- Generation: 1–2 concurrent; queue excess.

Caching & dedup
- Document hash (sha256) to skip reprocess.
- Chunk fingerprint to prevent duplicate vectors.
- Cache query embeddings for identical queries (LRU, TTL 1h).



## 15) Roadmap

MVP
- Upload → Ingest → Search for people; citations; minimal UI.
- Public APIs; HMAC-secured worker; basic metrics.

Phase 2
- Netlify Identity auth and RBAC.
- RAG answer synthesis with richer layouts and multi-doc reasoning.
- Feedback loops (thumbs up/down) to tune ranking.
- Human-in-the-loop labeling for entity linking.
- UI graph visualization and person profiles editing.

Phase 3
- Incremental sync/watch on storage.
- Advanced skill inference from projects and roles.
- Cost-aware dynamic batching and autoscaling policies.



## 16) Local Development

Prereqs
- Node 18+, Python 3.11+, Neo4j Desktop or AuraDB, AWS credentials (dev).
- Install Python deps: see [neo4j/requirements.txt](neo4j/requirements.txt:1).

.env template (root)
- OPENROUTER_API_KEY=
- OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
- OPENROUTER_GEN_MODEL=anthropic/claude-3.5-sonnet
- OPENROUTER_EMBED_MODEL=openai/text-embedding-3-small
- NEO4J_URI=bolt+s://&lt;aura-host&gt;:7687
- NEO4J_USERNAME=neo4j
- NEO4J_PASSWORD=
- AWS_ACCESS_KEY_ID=
- AWS_SECRET_ACCESS_KEY=
- S3_BUCKET=
- S3_REGION=
- WORKER_INGEST_URL=http://localhost:8000/worker/ingest
- WORKER_SIGNING_SECRET=
- NETLIFY_SITE_URL=http://localhost:8888

Run Netlify dev
- npm install
- netlify dev (or npm run dev with Netlify CLI), uses [netlify.toml](netlify.toml:1)

Worker local
- python -m uvicorn neo4j.src.main:app --port 8000 (example if using FastAPI) or python [neo4j/src/main.py](neo4j/src/main.py:1) if simple server.
- Ensure [neo4j/src/config.py](neo4j/src/config.py:1) reads .env.

Seed scripts/fixtures
- Small sample docs in test fixtures; run a script to create sample Persons/Skills using [neo4j/src/db.py](neo4j/src/db.py:1).



## Appendix: Implementation Notes

- Functions layout:
  - [functions/upload.ts](netlify/functions/upload.ts:1): S3 client, presigned PUT, return mapping.
  - [functions/ingest_start.ts](netlify/functions/ingest_start.ts:1): build manifest, HMAC sign, POST to Worker.
  - [functions/search.ts](netlify/functions/search.ts:1): embed query, Cypher query via AuraDB HTTP driver or serverless proxy.
  - [functions/person.ts](netlify/functions/person.ts:1), [functions/documents.ts](netlify/functions/documents.ts:1): simple lookups.
- Worker:
  - Entry: [neo4j/src/main.py](neo4j/src/main.py:1) with [neo4j/src/main.py:ingest_webhook()](neo4j/src/main.py:1) and [neo4j/src/main.py:finalize_job()](neo4j/src/main.py:1).
  - Neo4j driver usage per [neo4j/src/db.py](neo4j/src/db.py:1); env from [neo4j/src/config.py](neo4j/src/config.py:1).
- OpenRouter usage: see [openrouter.generate()](docs/openrouter.md:1) and [openrouter.embed()](docs/openrouter.md:1); include Referer/X-Title headers; implement retry/backoff.
- All filenames and declarations in this document are clickable references to intended or existing files for rapid navigation.

