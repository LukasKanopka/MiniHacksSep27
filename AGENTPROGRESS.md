# AGENTPROGRESS.md — Execution Plan and Build Progress

Last updated: 2025-09-27

Purpose
- Single source of truth for implementation plan, milestones, DoD, and progress.
- Derived from the PRD + architecture in [AGENTREADME.md](AGENTREADME.md:1).
- Tracks status across Frontend (Netlify SPA), API (Netlify Functions), Worker (Python on Railway), Data (Neo4j AuraDB), LLM (OpenRouter/Gemini), and Infra (AWS S3).

Current repository snapshot
Present
- [AGENTREADME.md](AGENTREADME.md:1)
- [neo4j/requirements.txt](neo4j/requirements.txt:1)
- [neo4j/src/config.py](neo4j/src/config.py:1)
- [neo4j/src/db.py](neo4j/src/db.py:1)
- [neo4j/src/main.py](neo4j/src/main.py:1)
- [.gitignore](.gitignore:1)

Missing (to be created)
- Netlify config and SPA
  - [netlify.toml](netlify.toml:1)
  - SPA scaffold under [web/](web/README.md:1) with Vite/React and Liquid Glass UI
- Netlify Functions (API)
  - [netlify/functions/health.ts](netlify/functions/health.ts:1)
  - [netlify/functions/upload.ts](netlify/functions/upload.ts:1)
  - [netlify/functions/ingest_start.ts](netlify/functions/ingest_start.ts:1)
  - [netlify/functions/search.ts](netlify/functions/search.ts:1)
  - [netlify/functions/person.ts](netlify/functions/person.ts:1)
  - [netlify/functions/documents.ts](netlify/functions/documents.ts:1)
  - Shared helpers:
    - [netlify/functions/_shared/env.ts](netlify/functions/_shared/env.ts:1)
    - [netlify/functions/_shared/http.ts](netlify/functions/_shared/http.ts:1)
    - [netlify/functions/_shared/s3.ts](netlify/functions/_shared/s3.ts:1)
    - [netlify/functions/_shared/hmac.ts](netlify/functions/_shared/hmac.ts:1)
    - [netlify/functions/_shared/neo4j.ts](netlify/functions/_shared/neo4j.ts:1)
    - [netlify/functions/_shared/openrouter.ts](netlify/functions/_shared/openrouter.ts:1)
- Documentation and configs
  - [docs/openrouter.md](docs/openrouter.md:1)
  - [docs/s3-cors.json](docs/s3-cors.json:1)
  - [docs/iam-policy.json](docs/iam-policy.json:1)
- Neo4j setup
  - [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1)

Status legend
- [ ] not started
- [-] in progress
- [x] done

Milestone 0 — Repo scaffolding and shared config
- [ ] Add Netlify configuration [netlify.toml](netlify.toml:1) (build, publish, functions, SPA redirect)
- [ ] Create .env.example aligned with [AGENTREADME.md:Local Development](AGENTREADME.md:522)
- [ ] Node env validation helper [netlify/functions/_shared/env.ts](netlify/functions/_shared/env.ts:1)
- [ ] HTTP helpers (responses, correlation ID) [netlify/functions/_shared/http.ts](netlify/functions/_shared/http.ts:1)
- [ ] OpenRouter usage notes [docs/openrouter.md](docs/openrouter.md:1)
Definition of Done:
- Netlify CLI boots with [netlify.toml](netlify.toml:1)
- Missing envs fail fast with clear messages

Milestone 1 — API layer (Netlify Functions)
- [ ] Health: [netlify/functions/health.ts](netlify/functions/health.ts:1) GET /api/health with ts + correlation echo
- [ ] Upload session: [netlify/functions/upload.ts](netlify/functions/upload.ts:1) presigned S3 PUT URLs; uses [netlify/functions/_shared/s3.ts](netlify/functions/_shared/s3.ts:1)
- [ ] Ingestion kickoff: [netlify/functions/ingest_start.ts](netlify/functions/ingest_start.ts:1) HMAC-sign and POST to Worker; uses [netlify/functions/_shared/hmac.ts](netlify/functions/_shared/hmac.ts:1)
- [ ] Search: [netlify/functions/search.ts](netlify/functions/search.ts:1) query embedding via [docs/openrouter.md](docs/openrouter.md:1), AuraDB query via [netlify/functions/_shared/neo4j.ts](netlify/functions/_shared/neo4j.ts:1), optional synthesis
- [ ] Person: [netlify/functions/person.ts](netlify/functions/person.ts:1)
- [ ] Documents: [netlify/functions/documents.ts](netlify/functions/documents.ts:1)
Definition of Done:
- Endpoints match API spec in [AGENTREADME.md](AGENTREADME.md:189)
- Basic rate limits optional post-MVP

Milestone 2 — Worker ingestion pipeline (Python on Railway)
- [ ] Webhook ingest with HMAC verify: [neo4j/src/main.py](neo4j/src/main.py:1) ingest_webhook()
- [ ] Job finalize endpoint: [neo4j/src/main.py](neo4j/src/main.py:1) finalize_job()
- [ ] S3 downloader (boto3) and Unstructured API client
- [ ] Chunker (600 tokens, 80 overlap, min 80)
- [ ] Embeddings via OpenRouter with backoff and caps (8 concurrent)
- [ ] Idempotency: doc SHA256, chunk SHA1 fingerprints
- [ ] Neo4j upserts via [neo4j/src/db.py](neo4j/src/db.py:1) (Documents, Chunks, CHUNK_OF; MENTIONS stub)
Definition of Done:
- Given a dev S3 prefix, pipeline produces chunks with embeddings in AuraDB and returns 202/200 on webhooks

Milestone 3 — Data layer (Neo4j AuraDB)
- [ ] Provision AuraDB and set envs
- [ ] Apply constraints and index:
  - person_id unique, doc_id unique, chunk_order index
  - vector index chunk_embedding_idx (1536, cosine)
- [ ] Seed minimal dataset for smoke test
Artifacts:
- [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1)
Definition of Done:
- Index online; sample search query returns results

Milestone 4 — Frontend SPA (Vite + React + Liquid Glass UI)
- [ ] Scaffold SPA under [web/](web/README.md:1): [web/index.html](web/index.html:1), [web/src/main.tsx](web/src/main.tsx:1), [web/src/App.tsx](web/src/App.tsx:1)
- [ ] Configure Netlify dev proxy to Functions
- [ ] Directory upload UI: calls [netlify/functions/upload.ts](netlify/functions/upload.ts:1), PUTs to S3, then [netlify/functions/ingest_start.ts](netlify/functions/ingest_start.ts:1)
- [ ] Ingestion status panel (simple accepted/queued indicator)
- [ ] Search UI: calls [netlify/functions/search.ts](netlify/functions/search.ts:1), renders people with citations; optional synthesized answer
- [ ] Person profile route /person/:id using [netlify/functions/person.ts](netlify/functions/person.ts:1)
Definition of Done:
- E2E flow from folder selection to “job queued” and search results rendering

Milestone 5 — Infra: AWS S3, IAM, and CORS
- [ ] Create bucket with SSE, block public access
- [ ] CORS allowing browser PUT with Content-Type
- [ ] IAM policies: presigned PutObject (Functions), GetObject (Worker)
Artifacts:
- [docs/s3-cors.json](docs/s3-cors.json:1), [docs/iam-policy.json](docs/iam-policy.json:1)
Definition of Done:
- Browser PUT via presigned URL succeeds; Worker can GET objects

Milestone 6 — LLM integration (OpenRouter/Gemini)
- [ ] Node-side OpenRouter client [netlify/functions/_shared/openrouter.ts](netlify/functions/_shared/openrouter.ts:1) with headers (Authorization, Referer, X-Title)
- [ ] Worker embedding/generation client with retries and concurrency caps
- [ ] Documentation of models and fallbacks [docs/openrouter.md](docs/openrouter.md:1)
Definition of Done:
- Stable embeddings for search; optional generation for synthesis

Milestone 7 — Security and observability
- [ ] HMAC signature scheme per PRD in Functions and Worker
- [ ] Correlation ID propagation SPA → Functions → Worker
- [ ] Structured JSON logs (ts, level, correlationId, jobId, filePath, model)
- [ ] Minimal metrics in logs (ingest rates, latencies, costs)
Definition of Done:
- Signed webhooks enforced; requests traceable end-to-end

Milestone 8 — Testing and CI/CD
- [ ] Unit tests: chunker, HMAC, OpenRouter stubs for [docs/openrouter.md](docs/openrouter.md:1)
- [ ] Integration: local/minio upload, ingestion, Aura asserts
- [ ] E2E: Netlify dev + local Worker, sample folder upload, search snapshot
- [ ] Netlify deploy previews; lint/tests on PR
Suggested layout:
- [web/src/__tests__/index.test.tsx](web/src/__tests__/index.test.tsx:1)
- [netlify/functions/__tests__/upload.test.ts](netlify/functions/__tests__/upload.test.ts:1)
- [neo4j/tests/test_chunker.py](neo4j/tests/test_chunker.py:1)
Definition of Done:
- CI green; deploy preview functional

Critical path (build order)
1) Netlify scaffolding + health: [netlify.toml](netlify.toml:1), [netlify/functions/health.ts](netlify/functions/health.ts:1)
2) Upload flow MVP: [netlify/functions/upload.ts](netlify/functions/upload.ts:1) + S3 CORS/IAM + SPA upload
3) Ingestion kickoff: [netlify/functions/ingest_start.ts](netlify/functions/ingest_start.ts:1) + Worker HMAC verify in [neo4j/src/main.py](neo4j/src/main.py:1)
4) Minimal Worker ingestion: S3 GET → simple parse (TXT) → chunk → embed → upsert via [neo4j/src/db.py](neo4j/src/db.py:1); create Aura indexes via [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1)
5) Search path: [netlify/functions/search.ts](netlify/functions/search.ts:1) + SPA search UI
6) Person/documents endpoints and UI
7) Observability + tests + deployment

Definitions of Done per milestone (rollup)
- Upload MVP: SPA uploads and receives 202 job acceptance; logs visible
- Ingest MVP: TXT/DOCX → Chunks with embeddings in AuraDB; vector index online
- Search MVP: Returns top-K people with citations within dev latency targets
- E2E MVP: Upload → Ingest → Search locally via Netlify dev + local Worker
- Deploy MVP: Netlify site + Functions live; Worker on Railway; AuraDB online; sample corpus searchable

Environment variables (from PRD)
- LLM: OPENROUTER_API_KEY, OPENROUTER_BASE_URL, OPENROUTER_GEN_MODEL, OPENROUTER_EMBED_MODEL
- Neo4j: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD
- S3: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, S3_REGION
- Worker: WORKER_INGEST_URL, WORKER_SIGNING_SECRET
- Netlify: NETLIFY_SITE_URL
Reference: [AGENTREADME.md](AGENTREADME.md:349)

Risks and mitigations
- LLM rate limits: implement retries/backoff, concurrency caps, fallbacks in [docs/openrouter.md](docs/openrouter.md:1)
- Parsing variance: start with Unstructured API; capture parse errors; add fallbacks later
- Aura vector compatibility: confirm 1536 dims and index availability pre-ingest
- S3 CORS: pre-validate with permissive dev CORS and clock sync

Immediate next actions
- [ ] Create [netlify.toml](netlify.toml:1) and [netlify/functions/health.ts](netlify/functions/health.ts:1)
- [ ] Implement [netlify/functions/upload.ts](netlify/functions/upload.ts:1) + [netlify/functions/_shared/s3.ts](netlify/functions/_shared/s3.ts:1); add [docs/s3-cors.json](docs/s3-cors.json:1)
- [ ] Scaffold SPA under [web/](web/README.md:1) with directory upload wired to /api/upload/session
- [ ] Implement [netlify/functions/ingest_start.ts](netlify/functions/ingest_start.ts:1) + HMAC helper; verify Worker webhook in [neo4j/src/main.py](neo4j/src/main.py:1)
- [ ] Provision AuraDB and apply [neo4j/src/setup.cypher](neo4j/src/setup.cypher:1)
- [ ] Minimal Worker path: S3 GET → TXT parse → chunk → [docs/openrouter.md](docs/openrouter.md:1) embed → upsert via [neo4j/src/db.py](neo4j/src/db.py:1)

Progress summary (current)
- Worker scaffolding present: [neo4j/src/config.py](neo4j/src/config.py:1), [neo4j/src/db.py](neo4j/src/db.py:1), [neo4j/src/main.py](neo4j/src/main.py:1)
- All Netlify Functions, SPA, and infra configs are pending creation
- No CI tests or docs yet beyond [AGENTREADME.md](AGENTREADME.md:1)

End of file.