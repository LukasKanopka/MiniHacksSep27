import os
import time
import hmac
import hashlib
import json
import datetime
from typing import Optional, Tuple, Any, Dict, List

try:
    from fastapi import FastAPI, Request, Header
    from fastapi.responses import JSONResponse
except Exception as e:
    # FastAPI is assumed to be available per project requirements.
    # If not installed, install with:
    #   pip install fastapi uvicorn
    raise

WORKER_SIGNING_SECRET = os.getenv("WORKER_SIGNING_SECRET")
if not WORKER_SIGNING_SECRET:
    # Fail fast at startup to avoid accepting unsigned requests.
    raise RuntimeError("WORKER_SIGNING_SECRET environment variable is required to start the worker HTTP server")

app = FastAPI(title="Worker Webhooks", version="1.0.0")

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

    The signature is computed as hex_lower(HMAC_SHA256(secret, "{timestamp}.{raw_body_bytes}")).
    - Headers:
        X-Timestamp: unix seconds (str)
        X-Signature: hex lowercase digest
    - The comparison uses constant-time equality.

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

def validate_ingest_payload(data: Any) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Minimal validation for /worker/ingest payload.
    Ensures:
      - jobId: non-empty str
      - s3Prefix: str starting with "anon/" and ending with "/"
      - files: non-empty list of items with non-empty "path" and "sha256", and size >= 0
      - options: optional; if present and contains chunkTokens/overlapTokens, they must be integers.
    Returns (job_id, files)
    Raises ValueError on invalid payload with a human-readable message.
    """
    if not isinstance(data, dict):
        raise ValueError("body must be a JSON object")
    job_id = data.get("jobId")
    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("jobId must be a non-empty string")
    s3_prefix = data.get("s3Prefix")
    if not isinstance(s3_prefix, str) or not s3_prefix.startswith("anon/") or not s3_prefix.endswith("/"):
        raise ValueError('s3Prefix must be a string starting with "anon/" and ending with "/"')
    files = data.get("files")
    if not isinstance(files, list) or len(files) == 0:
        raise ValueError("files must be a non-empty list")
    for i, f in enumerate(files):
        if not isinstance(f, dict):
            raise ValueError(f"files[{i}] must be an object")
        path = f.get("path")
        sha256 = f.get("sha256")
        size = f.get("size")
        if not isinstance(path, str) or not path.strip():
            raise ValueError(f"files[{i}].path must be a non-empty string")
        if not isinstance(sha256, str) or not sha256.strip():
            raise ValueError(f"files[{i}].sha256 must be a non-empty string")
        if not isinstance(size, (int, float)) or size < 0:
            raise ValueError(f"files[{i}].size must be a number >= 0")
    options = data.get("options")
    if options is not None:
        if not isinstance(options, dict):
            raise ValueError("options must be an object when provided")
        for key in ("chunkTokens", "overlapTokens"):
            if key in options and not isinstance(options[key], int):
                raise ValueError(f"options.{key} must be an integer when provided")
    return job_id, files

def validate_finalize_payload(data: Any) -> str:
    """
    Minimal validation for /worker/finalize payload.
    Ensures:
      - jobId: non-empty str
      - summary: object with numeric fields: documents, chunks, errors
    Returns job_id.
    Raises ValueError on invalid payload.
    """
    if not isinstance(data, dict):
        raise ValueError("body must be a JSON object")
    job_id = data.get("jobId")
    if not isinstance(job_id, str) or not job_id.strip():
        raise ValueError("jobId must be a non-empty string")
    summary = data.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("summary must be an object")
    for key in ("documents", "chunks", "errors"):
        val = summary.get(key)
        if not isinstance(val, (int, float)):
            raise ValueError(f"summary.{key} must be a number")
    return job_id

@app.post("/worker/ingest")
async def ingest_webhook(
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
        job_id, files = validate_ingest_payload(data)
    except ValueError as ve:
        return respond_json({"code": "invalid_request", "message": str(ve)}, 400, x_correlation_id)
    print(json.dumps({
        "ts": iso_now(),
        "level": "info",
        "msg": "ingest_webhook_accept",
        "correlationId": x_correlation_id,
        "jobId": job_id,
        "fileCount": len(files),
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

# Note:
# The previous script-oriented usage in this module was replaced by a FastAPI app exposing:
#   - POST /worker/ingest
#   - POST /worker/finalize
# Ingestion processing is intentionally not implemented here per scope.