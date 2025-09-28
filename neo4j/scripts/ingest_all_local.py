import os
import sys
import time
import json
import hmac
import hashlib
from pathlib import Path
from typing import List, Optional

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

try:
    import httpx
except Exception:
    httpx = None


SUPPORTED_EXTS = {".txt", ".md", ".csv", ".pdf"}  # keep in sync with worker [read_local_text()] in neo4j/src/main.py


def log(level: str, msg: str, **extra):
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "level": level, "msg": msg}
    if extra:
        rec.update(extra)
    print(json.dumps(rec))


def load_env():
    if load_dotenv:
        try:
            load_dotenv()  # CWD
            load_dotenv(dotenv_path=str(Path(__file__).resolve().parents[2] / ".env"))
        except Exception:
            pass
    env = os.environ
    return {
        "WORKER_INGEST_URL": env.get("WORKER_INGEST_URL", "http://127.0.0.1:8000/worker/ingest"),
        "WORKER_SIGNING_SECRET": env.get("WORKER_SIGNING_SECRET", ""),
        "WORKER_LOCAL_DATA_DIR": env.get("WORKER_LOCAL_DATA_DIR") or str(Path(__file__).resolve().parents[2] / "Test Data"),
    }


def hmac_headers(secret: str, body: bytes) -> dict:
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode("utf-8"), (ts + "." + body.decode("utf-8")).encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "Content-Type": "application/json",
        "X-Timestamp": ts,
        "X-Signature": sig,
        "x-correlation-id": "ingest-all-local-1",
    }


def find_files(base_dir: Path, exts: Optional[set] = None) -> List[str]:
    exts = exts or SUPPORTED_EXTS
    out: List[str] = []
    base_dir = base_dir.resolve()
    for p in base_dir.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix.lower() in exts:
            try:
                rel = p.relative_to(base_dir).as_posix()
            except Exception:
                continue
            out.append(rel)
    return sorted(out)


def post_ingest(url: str, secret: str, files: List[str], chunk_tokens: int = 600, overlap_tokens: int = 80) -> int:
    if httpx is None:
        print("httpx is not installed. Install with: python3 -m pip install httpx")
        return 1

    ts_id = int(time.time())
    job_id = f"job_local_{ts_id}"
    body = {
        "jobId": job_id,
        "files": [{"path": p} for p in files],
        "options": {"chunkTokens": chunk_tokens, "overlapTokens": overlap_tokens},
    }
    raw = json.dumps(body)
    headers = hmac_headers(secret, raw.encode("utf-8"))

    log("info", "posting_ingest", url=url, jobId=job_id, fileCount=len(files))
    try:
        with httpx.Client(timeout=60) as c:
            r = c.post(url, headers=headers, content=raw)
            print("Status:", r.status_code)
            print(r.text)
            if r.status_code // 100 != 2:
                log("error", "ingest_post_failed", status=r.status_code, body=r.text[:500])
                return 2
    except Exception as e:
        log("error", "ingest_post_exception", error=str(e))
        return 3
    return 0


def main():
    cfg = load_env()
    url = cfg["WORKER_INGEST_URL"]
    secret = cfg["WORKER_SIGNING_SECRET"]
    base = Path(cfg["WORKER_LOCAL_DATA_DIR"])

    if not secret:
        log("error", "missing_WORKER_SIGNING_SECRET")
        sys.exit(2)
    if not base.exists() or not base.is_dir():
        log("error", "missing_or_invalid_base_dir", path=str(base))
        sys.exit(2)

    files = find_files(base)
    if not files:
        log("warn", "no_supported_files_found", base=str(base), exts=list(SUPPORTED_EXTS))
        sys.exit(0)

    # Batch all files in one webhook (worker processes sequentially in background)
    rc = post_ingest(url, secret, files)
    sys.exit(rc)


if __name__ == "__main__":
    main()