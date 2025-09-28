import React, { useMemo, useState } from "react";

type UploadSessionResponse = {
  uploadSessionId: string;
  expiresInSeconds: number;
  presignedUrls: Record<
    string,
    { url: string; headers?: Record<string, string>; method?: string }
  >;
  s3Prefix: string;
};

type IngestStartResponse = {
  jobId: string;
  status: string;
};

type SearchCitation = {
  documentId: string;
  chunkId: string;
  score: number;
  snippet?: string;
};

type SearchPerson = {
  id: string;
  name: string;
  roles?: string[];
  skills?: string[];
};

type SearchHit = {
  person: SearchPerson;
  score: number;
  citations?: SearchCitation[];
};

type SearchResponse = {
  queryEmbeddingModel?: string;
  results?: SearchHit[];
  answer?: string | null;
  cost?: { embedding?: number; generation?: number };
};

function jsonPretty(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function App() {
  // Health
  const [health, setHealth] = useState<any | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Upload
  const [pickedFiles, setPickedFiles] = useState<File[]>([]);
  const [fileLimit, setFileLimit] = useState(3);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [session, setSession] = useState<UploadSessionResponse | null>(null);
  const [ingest, setIngest] = useState<IngestStartResponse | null>(null);
  const [uploading, setUploading] = useState(false);

  // Search
  const [query, setQuery] = useState("who knows graph embeddings");
  const [searching, setSearching] = useState(false);
  const [searchRes, setSearchRes] = useState<SearchResponse | null>(null);

  const limitedFiles = useMemo(() => {
    return pickedFiles.slice(0, Math.max(1, fileLimit));
  }, [pickedFiles, fileLimit]);

  function log(line: string) {
    const ts = new Date().toLocaleTimeString();
    setUploadLog((prev) => [...prev, `[${ts}] ${line}`]);
  }

  async function handleHealthClick() {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/health", { method: "GET" });
      const data = await res.json();
      setHealth(data);
    } catch (e: any) {
      setHealth({ error: String(e) });
    } finally {
      setHealthLoading(false);
    }
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setPickedFiles(files);
    setUploadLog([]);
    setSession(null);
    setIngest(null);
  }

  async function runUploadAndIngest() {
    if (limitedFiles.length === 0) {
      log("No files selected");
      return;
    }

    setUploading(true);
    setSession(null);
    setIngest(null);

    try {
      // 1) Build manifest for /api/upload/session
      const manifestFiles = limitedFiles.map((f) => ({
        path: (f as any).webkitRelativePath || f.name,
        contentType: f.type || "application/octet-stream",
        size: f.size,
      }));

      log(`Creating upload session for ${manifestFiles.length} file(s) ...`);
      const sessRes = await fetch("/api/upload/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: manifestFiles }),
      });

      if (!sessRes.ok) {
        const errText = await sessRes.text();
        log(`upload/session failed: ${sessRes.status} ${errText}`);
        return;
      }

      const sess: UploadSessionResponse = await sessRes.json();
      setSession(sess);
      log(
        `Received session ${sess.uploadSessionId}, expires ${sess.expiresInSeconds}s; s3Prefix: ${sess.s3Prefix}`
      );

      // 2) PUT each file to its presigned URL
      const uploaded: { path: string; size: number; etag?: string }[] = [];
      for (const f of limitedFiles) {
        const key = (f as any).webkitRelativePath || f.name;
        const p = sess.presignedUrls[key];
        if (!p) {
          log(`No presigned URL for ${key} — skipping`);
          continue;
        }
        const headers = {
          ...(p.headers || {}),
          "Content-Type": f.type || "application/pdf",
        };
        const method = p.method || "PUT";

        log(`PUT ${key} ...`);
        const putRes = await fetch(p.url, { method, headers, body: f });
        const etag =
          putRes.headers.get("ETag") || putRes.headers.get("etag") || undefined;

        if (!putRes.ok) {
          const t = await putRes.text().catch(() => "");
          log(`PUT ${key} failed: ${putRes.status} ${t}`);
        } else {
          log(`PUT ${key} ok ${etag ? `(etag ${etag})` : ""}`);
          uploaded.push({ path: key, size: f.size, etag });
        }
      }

      if (uploaded.length === 0) {
        log("No successful uploads — aborting ingest.");
        return;
      }

      // 3) Kick off ingestion
      log(`Starting ingest for ${uploaded.length} uploaded file(s) ...`);
      const ingestRes = await fetch("/api/ingest/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadSessionId: sess.uploadSessionId,
          s3Prefix: sess.s3Prefix,
          files: uploaded,
        }),
      });

      if (!ingestRes.ok) {
        const t = await ingestRes.text().catch(() => "");
        log(`ingest/start failed: ${ingestRes.status} ${t}`);
        return;
      }

      const ingestJson: IngestStartResponse = await ingestRes.json();
      setIngest(ingestJson);
      log(`Ingest queued: jobId=${ingestJson.jobId} status=${ingestJson.status}`);
    } catch (e: any) {
      log(`Error: ${String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleSearch() {
    setSearching(true);
    setSearchRes(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, topK: 10, synthesize: false }),
      });
      const data = await res.json();
      setSearchRes(data);
    } catch (e: any) {
      setSearchRes({ answer: `Error: ${String(e)}` });
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <section>
        <h2>Health</h2>
        <div className="row" style={{ gap: 8 }}>
          <button onClick={handleHealthClick} disabled={healthLoading}>
            {healthLoading ? "Checking..." : "GET /api/health"}
          </button>
          <span className="muted">from netlify function</span>
        </div>
        <pre className="mono">{health ? jsonPretty(health) : "—"}</pre>
      </section>

      <section>
        <h2>Upload folder -> S3 -> Ingest</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            type="file"
            // @ts-ignore
            webkitdirectory="true"
            multiple
            onChange={handleFolderSelect}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            Limit
            <input
              type="number"
              min={1}
              max={9999}
              value={fileLimit}
              onChange={(e) => setFileLimit(parseInt(e.target.value || "1", 10))}
              style={{ width: 80 }}
              aria-label="Limit number of files to upload"
            />
          </label>
          <button onClick={runUploadAndIngest} disabled={uploading || pickedFiles.length === 0}>
            {uploading ? "Uploading..." : "Start Upload Session + Upload + Ingest"}
          </button>
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <div className="muted">
            Selected: {pickedFiles.length} file(s). Using first {limitedFiles.length}.
          </div>
        </div>

        {limitedFiles.length > 0 && (
          <div className="list" aria-label="Selected files list">
            {limitedFiles.map((f) => {
              // @ts-ignore
              const rel = f.webkitRelativePath || f.name;
              return (
                <div key={rel} className="mono">
                  {rel} ({(f.size / 1024).toFixed(1)} KB)
                </div>
              );
            })}
          </div>
        )}

        <details style={{ marginTop: 8 }} open>
          <summary>Upload logs</summary>
          <pre className="mono">{uploadLog.join("\n") || "—"}</pre>
        </details>

        <details style={{ marginTop: 8 }}>
          <summary>Upload session</summary>
          <pre className="mono">{session ? jsonPretty(session) : "—"}</pre>
        </details>

        <details style={{ marginTop: 8 }}>
          <summary>Ingest response</summary>
          <pre className="mono">{ingest ? jsonPretty(ingest) : "—"}</pre>
        </details>
      </section>

      <section>
        <h2>Search</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g., who knows graph embeddings"
            aria-label="Search query"
          />
          <button onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? "Searching..." : "POST /api/search"}
          </button>
        </div>

        <div>
          {searchRes?.results?.length ? (
            <div>
              {searchRes.results.map((r, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div>
                    <strong>{r.person?.name || r.person?.id}</strong> — score{" "}
                    {typeof r.score === "number" ? r.score.toFixed(3) : String(r.score)}
                  </div>
                  {r.person?.skills?.length ? (
                    <div className="muted">skills: {r.person.skills.join(", ")}</div>
                  ) : null}
                  {r.citations?.length ? (
                    <details style={{ marginTop: 4 }}>
                      <summary>Citations ({r.citations.length})</summary>
                      <div className="mono">{jsonPretty(r.citations.slice(0, 5))}</div>
                    </details>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">No results yet.</div>
          )}
        </div>

        <details style={{ marginTop: 8 }}>
          <summary>Raw response</summary>
          <pre className="mono">{searchRes ? jsonPretty(searchRes) : "—"}</pre>
        </details>
      </section>

      <section>
        <h2>Notes</h2>
        <ul>
          <li>
            Ensure S3 CORS and IAM are configured per{" "}
            <a href="/docs/s3-cors.json" target="_blank" rel="noreferrer">docs/s3-cors.json</a> and{" "}
            <a href="/docs/iam-policy.json" target="_blank" rel="noreferrer">docs/iam-policy.json</a>.
          </li>
          <li>
            The Worker must be reachable at WORKER_INGEST_URL and validate HMAC as spec’d.
          </li>
          <li>
            Large batches may take several minutes end-to-end; start with a single PDF to smoke test.
          </li>
        </ul>
      </section>
    </div>
  );
}