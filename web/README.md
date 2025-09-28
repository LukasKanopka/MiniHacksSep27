# Minimal React SPA for Local E2E Testing


RUN COMMAND 

uvicorn src.main:app --app-dir neo4j --port 8000 --reload


This is a minimal Vite + React SPA to exercise the Netlify Functions API and ingestion/search flow defined in [AGENTREADME.md](../AGENTREADME.md:1). It implements:
- Health check via [functions/health.ts](../netlify/functions/health.ts:1)
- Folder upload session → S3 PUT via [functions/upload.ts](../netlify/functions/upload.ts:1)
- Ingestion kickoff via [functions/ingest_start.ts](../netlify/functions/ingest_start.ts:1)
- Search via [functions/search.ts](../netlify/functions/search.ts:1)

Key files:
- [web/index.html](./index.html:1): Root HTML
- [web/src/main.tsx](./src/main.tsx:1): App bootstrap
- [web/src/App.tsx](./src/App.tsx:1): Health, upload, and search UI/logic
- [web/vite.config.ts](./vite.config.ts:1): Vite config
- [web/package.json](./package.json:1): Vite/React dependencies and scripts
- Netlify wiring: [netlify.toml](../netlify.toml:1) and root [package.json](../package.json:1)

Prereqs
- Follow the env/service setup in [docs/TESTING.md](../docs/TESTING.md:1) (Neo4j, S3 CORS/IAM, Worker).
- Ensure .env is populated per [AGENTREADME.md:Local Development](../AGENTREADME.md:522) and [.env.example](../.env.example:1).

Install and run (local)
1) Install SPA deps
- npm --prefix web install

2) Build SPA
- npm --prefix web run build
- This produces web/dist (Netlify publish target per [netlify.toml](../netlify.toml:7)).

3) Run Netlify Dev (from repo root) to serve Functions + SPA
- npm run dev
- Default URL http://localhost:8888
- Functions available under /api/* via redirects in [netlify.toml](../netlify.toml:12).

Using the SPA
- Health: Click “GET /api/health”, expected payload per [functions/health.ts](../netlify/functions/health.ts:1).
- Upload:
  - Click “Choose folder” (webkitdirectory) to pick your local PDFs (e.g., the repo’s [final pdfs/](../final%20pdfs/Aaron_Brown.pdf:1) directory).
  - Click “Start Upload Session + Upload + Ingest”.
  - The app will:
    - POST /api/upload/session via [functions/upload.ts](../netlify/functions/upload.ts:1) with a manifest built from File.webkitRelativePath.
    - PUT each file to S3 using presigned URLs.
    - POST /api/ingest/start via [functions/ingest_start.ts](../netlify/functions/ingest_start.ts:1).
- Search: Enter a query and POST /api/search via [functions/search.ts](../netlify/functions/search.ts:1). Minimal result list and raw response viewer included.

Notes
- Ensure S3 CORS/IAM match [docs/s3-cors.json](../docs/s3-cors.json:1) and [docs/iam-policy.json](../docs/iam-policy.json:1) or browser PUTs will fail.
- The Worker must be running per [neo4j/src/main.py](../neo4j/src/main.py:1) and reachable at WORKER_INGEST_URL; HMAC secret must match Functions (see [netlify/functions/_shared/hmac.ts](../netlify/functions/_shared/hmac.ts:1)).
- Vector index must be created in Neo4j per [neo4j/src/setup.cypher](../neo4j/src/setup.cypher:1).

Known limitations (MVP)
- Links to repo docs (e.g., [docs/TESTING.md](../docs/TESTING.md:1)) aren’t served by Netlify publish (web/dist) in dev; open them in your editor. This SPA focuses on exercising the API flow, not documentation hosting.