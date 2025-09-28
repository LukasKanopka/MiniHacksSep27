
import os
import time
import hmac
import hashlib
import json
import datetime
import mimetypes
import re
from pathlib import Path
from typing import Optional, Tuple, Any, Dict, List
from dotenv import load_dotenv
# Load env from CWD and repo root for local dev before reading any env vars
try:
    load_dotenv()
    load_dotenv(dotenv_path=str(Path(__file__).resolve().parents[2] / ".env"))
except Exception:
    pass

try:
    from fastapi import FastAPI, Request, Header, BackgroundTasks
    from fastapi.responses import JSONResponse
except Exception:
    # FastAPI is assumed to be available per project requirements.
    # If not installed, install with:
    #   pip install fastapi uvicorn
    raise

# Worker HMAC (required for accepting Function webhooks)
WORKER_SIGNING_SECRET = os.getenv("WORKER_SIGNING_SECRET")
if not WORKER_SIGNING_SECRET:
    raise RuntimeError("WORKER_SIGNING_SECRET environment variable is required to start the worker HTTP server")

# Local dev ingestion: prefer local dataset over S3 for MVP
# Base directory for local files; default to "<repo_root>/Test Data"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
WORKER_LOCAL_DATA_DIR = Path(os.getenv("WORKER_LOCAL_DATA_DIR", str(PROJECT_ROOT / "Test Data")))

# OpenRouter (embeddings)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
OPENROUTER_EMBED_MODEL = os.getenv("OPENROUTER_EMBED_MODEL", "openai/text-embedding-3-small")
NETLIFY_SITE_URL = os.getenv("NETLIFY_SITE_URL")  # used for HTTP-Referer header (recommended)

# Chunking parameters (tokens are approx chars/4)
DEFAULT_CHUNK_TOKENS = 600
DEFAULT_OVERLAP_TOKENS = 80
DEFAULT_MIN_TOKENS = 80
TOKEN_CHAR_RATIO = 4  # heuristic: ~4 chars per token

# Supported text file extensions for MVP
SUPPORTED_TEXT_EXTS = {".txt", ".md", ".csv", ".pdf"}

# --- Naive Person Extraction (MVP, tightened) ---
# Detect "Proper Case" multi-word names and normalize to stable ids
PERSON_NAME_RE = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)+)\b")

# Common stopwords to exclude obviously non-person phrases (per-token)
STOPWORDS = {
    "The", "And", "For", "With", "From", "Into", "Across", "Between", "Among",
    "Project", "Graph", "Knowledge", "Vector", "Search", "Database", "Engineer",
    "Senior", "Staff", "Manager", "Director", "Company", "Organization"
}

# Terms/suffixes that are NOT person names (case-insensitive comparisons)
BANNED_TERMS = {
    "computer science", "software engineering", "data structures",
    "advanced algorithms", "network security", "machine learning",
    "google cloud", "magna cum laude", "cum laude"
}
BANNED_SUFFIXES = {"Science", "Engineering", "Algorithms", "Structures", "Security", "Cloud", "Learning", "Laude"}

# Contact hints typical in resumes
EMAIL_RE = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w{2,}\b")
PHONE_RE = re.compile(r"(\+?\d[\d\-\.\s\(\)]{7,}\d)")

def _person_id_from_name(name: str) -> str:
    base = name.strip().lower()
    base = re.sub(r"\s+", "-", base)
    base = re.sub(r"[^a-z0-9\-]", "", base)
    base = re.sub(r"-{2,}", "-", base).strip("-")
    return base

def _looks_like_person(parts: list[str]) -> bool:
    # 2–4 tokens, tokens like "John" or "Q." (allow middle initials)
    if not (2 <= len(parts) <= 4):
        return False
    for p in parts:
        if re.fullmatch(r"[A-Z]\.", p):  # middle initial
            continue
        if not re.fullmatch(r"[A-Z][a-z]+", p):
            return False
        if p in STOPWORDS:
            return False
    # Avoid common subject/degree suffixes
    if parts[-1] in BANNED_SUFFIXES:
        return False
    return True

def extract_person_names(text: str) -> list[str]:
    if not text:
        return []
    text_lower = text.lower()
    has_contact = bool(EMAIL_RE.search(text) or PHONE_RE.search(text))
    found = set()

    for m in PERSON_NAME_RE.finditer(text):
        cand = m.group(1).strip()
        cand_lower = cand.lower()
        # Exclude known non-person phrases
        if cand_lower in BANNED_TERMS:
            continue

        parts = cand.split()
        if not _looks_like_person(parts):
            continue

        # If no contact info in this chunk, be stricter: ignore obvious non-names
        # e.g., single-word capitals are filtered above; here we exclude if any token is common subject keyword
        if not has_contact:
            if any(p in BANNED_SUFFIXES for p in parts):
                continue
            # Exclude if any token is unusually long (likely a compound/subject)
            if any(len(p) > 20 for p in parts):
                continue

        found.add(cand)

    # Return deterministic order
    return sorted(found)

app = FastAPI(title="Worker Webhooks", version="1.0.0")

# Verify Neo4j connectivity at startup to surface routing/auth issues early
@app.on_event("startup")
def _startup_check_neo4j():
    try:
        from .db import verify_connectivity
        verify_connectivity()
    except Exception:
        # Keep server running; background ingestion will log detailed errors too
        pass

    # Also log whether PyMuPDF is available for PDF extraction
    try:
        import fitz  # type: ignore
        print(json.dumps({
            "ts": iso_now(),
            "level": "info",
            "msg": "pymupdf_present"
        }))
    except Exception as e:
        print(json.dumps({
            "ts": iso_now(),
            "level": "warn",
            "msg": "pymupdf_missing",
            "error": str(e),
            "hint": "Install PyMuPDF (pip install pymupdf) in the SAME Python environment running the worker."
        }))

SKEW_SECONDS = 300  # +/- 5 minutes


def iso_now() -> str:
    """Return current time in ISO8601 UTC with timezone."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def respond_json(payload: Dict[str, Any], status: int, correlation_id: Optional[str]) -> JSONResponse:
    headers = {}
    if correlation_id:
        headers["x-correlation-id"] = correlation_id
    return JSONResponse(content=payload, status_code=status, headers=headers)


def verify_hmac(x_timestamp: Optional[str], x_signature: Optional[str], body: bytes, secret: str, skew_seconds: int = SKEW_SECONDS) -> Tuple[bool, str]:
    """
    Verify webhook authenticity using HMAC-SHA256.

    Signature = hex_lower(HMAC_SHA256(secret, "{timestamp}.{raw_body_bytes}"))

    Returns (ok, error_code) where error_code is one of:
      "invalid timestamp", "invalid signature", "" (empty string when ok).
    """
    if not x_timestamp:
        return False, "invalid timestamp"
    try:
        ts = int(x_timestamp)
    except Exception:
        return False, "invalid timestamp"
    now = int(time.time())
    if abs(now - ts) > skew_seconds:
        return False, "invalid timestamp"
    if not x_signature:
        return False, "invalid signature"
    data = x_timestamp.encode("utf-8") + b"." + body
    expected = hmac.new(secret.encode("utf-8"), data, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(x_signature.lower(), expected):
        return False, "invalid signature"
    return True, ""


def read_local_text(base_dir: Path, relative_path: str) -> Optional[str]:
    """
    Read a supported text file from local dataset. Returns text or None if unsupported/missing.
    Supported: .txt, .md, .csv (CSV joined by spaces per row)
    """
    # Normalize and prevent path traversal
    rel = Path(relative_path.lstrip("/")).as_posix()
    full = (base_dir / rel).resolve()
    try:
        full.relative_to(base_dir.resolve())
    except Exception:
        return None

    ext = full.suffix.lower()
    if ext not in SUPPORTED_TEXT_EXTS:
        return None
    if not full.exists() or not full.is_file():
        return None

    try:
        if ext in {".txt", ".md"}:
            return full.read_text(encoding="utf-8", errors="ignore")
        elif ext == ".csv":
            import csv
            rows: List[str] = []
            with full.open("r", encoding="utf-8", errors="ignore", newline="") as f:
                reader = csv.reader(f)
                for row in reader:
                    rows.append(" ".join([c for c in row if c]))
            return "\n".join(rows)
        elif ext == ".pdf":
            # Lightweight local PDF text extraction via PyMuPDF
            try:
                import fitz  # type: ignore
            except Exception as e:
                # Instrumentation to surface missing dependency during ingestion
                try:
                    print(json.dumps({
                        "ts": iso_now(),
                        "level": "error",
                        "msg": "pdf_extract_fitz_missing",
                        "path": str(full),
                        "error": str(e),
                        "hint": "Install PyMuPDF (pip install pymupdf) in the SAME Python environment running the worker."
                    }))
                except Exception:
                    pass
                return None
            text_chunks: List[str] = []
            with fitz.open(str(full)) as doc:
                for page in doc:
                    text_chunks.append(page.get_text("text"))
            return "\n".join([t for t in text_chunks if t])
    except Exception:
        return None
    return None


def simple_chunk(text: str, chunk_tokens: int, overlap_tokens: int, min_tokens: int) -> List[Dict[str, Any]]:
    """
    Simple char-window chunking using token-to-char heuristic.
    Returns list of dicts: {text, order, tokens}
    """
    if not text:
        return []
    window = max(chunk_tokens * TOKEN_CHAR_RATIO, min_tokens * TOKEN_CHAR_RATIO)
    overlap = max(overlap_tokens * TOKEN_CHAR_RATIO, 0)
    start = 0
    chunks: List[Dict[str, Any]] = []
    order = 0
    N = len(text)
    while start < N:
        end = min(N, start + window)
        piece = text[start:end]
        # trim piece boundaries
        piece = piece.strip()
        if piece:
            est_tokens = max(1, len(piece) // TOKEN_CHAR_RATIO)
            if est_tokens >= min_tokens:
                chunks.append({"text": piece, "order": order, "tokens": est_tokens})
                order += 1
        if end == N:
            break
        start = end - overlap if end - overlap > start else end
    return chunks


def guess_mime(path: str) -> str:
    mt, _ = mimetypes.guess_type(path)
    return mt or "text/plain"


def sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha1_hex(b: bytes) -> str:
    return hashlib.sha1(b).hexdigest()


def openrouter_embed(texts: List[str], correlation_id: Optional[str]) -> List[List[float]]:
    """
    Call OpenRouter embeddings endpoint with a batch of texts.
    Returns list of embedding vectors. On error, returns empty list.
    """
    if not OPENROUTER_API_KEY:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "embed_missing_api_key"}))
        return []
    try:
        import httpx  # type: ignore
    except Exception:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "embed_httpx_not_installed"}))
        return []

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "X-Title": "find-right-people-worker",
    }
    if NETLIFY_SITE_URL:
        headers["HTTP-Referer"] = NETLIFY_SITE_URL
    if correlation_id:
        headers["x-correlation-id"] = correlation_id

    payload = {
        "model": OPENROUTER_EMBED_MODEL,
        "input": texts,
    }

    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(f"{OPENROUTER_BASE_URL}/embeddings", headers=headers, json=payload)
            if resp.status_code // 100 != 2:
                print(json.dumps({
                    "ts": iso_now(), "level": "error", "msg": "embed_failed",
                    "status": resp.status_code, "body": resp.text[:500]
                }))
                return []
            data = resp.json()
            out: List[List[float]] = []
            for item in data.get("data", []):
                emb = item.get("embedding")
                if isinstance(emb, list):
                    out.append(emb)
            return out
    except Exception as e:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "embed_exception", "error": str(e)}))
        return []


def openai_embed(texts: List[str], correlation_id: Optional[str]) -> List[List[float]]:
    """
    Call OpenAI embeddings endpoint with a batch of texts.
    Returns list of embedding vectors. On error, returns empty list.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
    if not api_key:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "openai_embed_missing_api_key"}))
        return []
    try:
        import httpx  # type: ignore
    except Exception:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "openai_httpx_not_installed"}))
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if correlation_id:
        headers["x-correlation-id"] = correlation_id

    payload = {
        "model": model,
        "input": texts,
    }

    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post("https://api.openai.com/v1/embeddings", headers=headers, json=payload)
            if resp.status_code // 100 != 2:
                print(json.dumps({
                    "ts": iso_now(), "level": "error", "msg": "openai_embed_failed",
                    "status": resp.status_code, "body": resp.text[:500]
                }))
                return []
            data = resp.json()
            out: List[List[float]] = []
            for item in data.get("data", []):
                emb = item.get("embedding")
                if isinstance(emb, list):
                    out.append(emb)
            return out
    except Exception as e:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "openai_embed_exception", "error": str(e)}))
        return []


def process_job(job_id: str, base_dir: Path, files: List[Dict[str, Any]], options: Dict[str, Any], correlation_id: Optional[str]) -> None:
    """
    Background processing:
    - Read local files (TXT/MD/CSV) from base_dir/p.path
    - Chunk text
    - Embed chunks (batch up to 64 sequentially)
    - Upsert Document and Chunks into Neo4j
    """
    from .db import upsert_document, upsert_chunk  # lazy import to avoid early driver init in web path

    chunk_tokens = int(options.get("chunkTokens") or DEFAULT_CHUNK_TOKENS)
    overlap_tokens = int(options.get("overlapTokens") or DEFAULT_OVERLAP_TOKENS)
    min_tokens = int(options.get("minTokens") or DEFAULT_MIN_TOKENS)

    total_docs = 0
    total_chunks = 0

    for f in files:
        rel_path = f.get("path") or ""
        text = read_local_text(base_dir, rel_path)
        if not text:
            # Unsupported or missing; skip
            print(json.dumps({
                "ts": iso_now(), "level": "warn", "msg": "file_skip",
                "correlationId": correlation_id, "path": rel_path
            }))
            continue
        else:
            print(json.dumps({
                "ts": iso_now(), "level": "info", "msg": "file_text_loaded",
                "correlationId": correlation_id, "path": rel_path, "bytes": len(text.encode("utf-8", errors="ignore"))
            }))

        # Document id: sha256 of raw bytes (deterministic)
        raw = text.encode("utf-8", errors="ignore")
        doc_id = sha256_hex(raw)
        mime = guess_mime(rel_path)
        upsert_document(doc_id=doc_id, path=rel_path, mime=mime, bytes_count=len(raw), status="processing")

        # Chunk
        chunks = simple_chunk(text, chunk_tokens, overlap_tokens, min_tokens)
        if not chunks:
            # Mark empty but ingested
            upsert_document(doc_id=doc_id, path=rel_path, mime=mime, bytes_count=len(raw), status="ingested")
            total_docs += 1
            continue

        # Embed in batches (size 64)
        batch_size = 64
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            embeds = openai_embed([c["text"] for c in batch], correlation_id)
            # If embeddings failed, skip these chunks
            if len(embeds) != len(batch):
                print(json.dumps({
                    "ts": iso_now(), "level": "error", "msg": "embed_batch_mismatch",
                    "expected": len(batch), "got": len(embeds)
                }))
                continue
            # Upsert each chunk
            for c, emb in zip(batch, embeds):
                # Chunk id: sha1 of normalized text
                chunk_id = sha1_hex((doc_id + "|" + str(c["order"]) + "|" + c["text"]).encode("utf-8"))
                upsert_chunk(
                    chunk_id=chunk_id,
                    doc_id=doc_id,
                    text=c["text"],
                    embedding=emb,
                    order=int(c["order"]),
                    tokens=int(c["tokens"]),
                    section=None,
                    page=None,
                )

                # Naive entity extraction (Persons) and MENTIONS upsert
                names = extract_person_names(c["text"])
                if names:
                    persons: List[Dict[str, Any]] = []
                    for nm in names:
                        pid = _person_id_from_name(nm)
                        if pid:
                            persons.append({"id": pid, "name": nm})
                    if persons:
                        try:
                            from .db import upsert_persons_and_mentions  # lazy import to avoid early driver init
                            upsert_persons_and_mentions(chunk_id, persons)
                        except Exception as e:
                            print(json.dumps({
                                "ts": iso_now(), "level": "error", "msg": "mentions_upsert_failed",
                                "correlationId": correlation_id, "chunkId": chunk_id, "error": str(e)
                            }))

                total_chunks += 1

        # Mark document ingested
        upsert_document(doc_id=doc_id, path=rel_path, mime=mime, bytes_count=len(raw), status="ingested")
        total_docs += 1

    print(json.dumps({
        "ts": iso_now(),
        "level": "info",
        "msg": "ingest_job_done",
        "correlationId": correlation_id,
        "jobId": job_id,
        "documents": total_docs,
        "chunks": total_chunks,
        "errors": 0  # basic MVP does not count per-file errors
    }))


def validate_ingest_payload(data: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Minimal validation for ingest payload in local/dev mode.
    Expects: { "jobId": str, "files": [ { "path": str }, ... ] }
    Returns: (job_id, files_slim)
    """
    job_id = str(data.get("jobId") or "").strip()
    files = data.get("files") or []
    if not job_id:
        raise ValueError("jobId is required")
    if not isinstance(files, list) or len(files) == 0:
        raise ValueError("files must be a non-empty list")

    norm_files: List[Dict[str, Any]] = []
    for f in files:
        p = (f or {}).get("path")
        if not isinstance(p, str) or not p.strip():
            raise ValueError("file.path must be a non-empty string")
        norm_files.append({"path": p.strip()})
    return job_id, norm_files


def validate_finalize_payload(data: Dict[str, Any]) -> str:
    """
    Minimal validation for finalize payload.
    Expects: { "jobId": str, "summary": any }
    Returns: job_id
    """
    job_id = str(data.get("jobId") or "").strip()
    if not job_id:
        raise ValueError("jobId is required")
    if "summary" not in data:
        raise ValueError("summary is required")
    return job_id


@app.post("/worker/ingest")
async def ingest_webhook(
    request: Request,
    x_timestamp: Optional[str] = Header(None, alias="X-Timestamp"),
    x_signature: Optional[str] = Header(None, alias="X-Signature"),
    x_correlation_id: Optional[str] = Header(None, alias="x-correlation-id"),
    background_tasks: BackgroundTasks = None,
):
    body = await request.body()
    ok, err = verify_hmac(x_timestamp, x_signature, body, WORKER_SIGNING_SECRET)
    if not ok:
        return respond_json({"code": "unauthorized", "message": err}, 401, x_correlation_id)
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        return respond_json({"code": "invalid_request", "message": "invalid JSON"}, 400, x_correlation_id)
    try:
        job_id, files = validate_ingest_payload(data)
    except ValueError as ve:
        return respond_json({"code": "invalid_request", "message": str(ve)}, 400, x_correlation_id)

    # Local-mode: ignore s3Prefix and use WORKER_LOCAL_DATA_DIR
    options = data.get("options") or {}

    if background_tasks is not None:
        background_tasks.add_task(process_job, job_id, WORKER_LOCAL_DATA_DIR, files, options, x_correlation_id)

    print(json.dumps({
        "ts": iso_now(),
        "level": "info",
        "msg": "ingest_webhook_accept",
        "correlationId": x_correlation_id,
        "jobId": job_id,
        "fileCount": len(files),
        "baseDir": str(WORKER_LOCAL_DATA_DIR),
    }))
    return respond_json({"jobId": job_id, "status": "processing"}, 202, x_correlation_id)


@app.post("/worker/finalize")
async def finalize_job(
    request: Request,
    x_timestamp: Optional[str] = Header(None, alias="X-Timestamp"),
    x_signature: Optional[str] = Header(None, alias="X-Signature"),
    x_correlation_id: Optional[str] = Header(None, alias="x-correlation-id"),
):
    body = await request.body()
    ok, err = verify_hmac(x_timestamp, x_signature, body, WORKER_SIGNING_SECRET)
    if not ok:
        return respond_json({"code": "unauthorized", "message": err}, 401, x_correlation_id)
    try:
        data = json.loads(body.decode("utf-8"))
    except Exception:
        return respond_json({"code": "invalid_request", "message": "invalid JSON"}, 400, x_correlation_id)
    try:
        job_id = validate_finalize_payload(data)
    except ValueError as ve:
        return respond_json({"code": "invalid_request", "message": str(ve)}, 400, x_correlation_id)
    summary = data["summary"]
    print(json.dumps({
        "ts": iso_now(),
        "level": "info",
        "msg": "ingest_finalize_ok",
        "correlationId": x_correlation_id,
        "jobId": job_id,
        "summary": summary,
    }))
    return respond_json({"status": "ok"}, 200, x_correlation_id)