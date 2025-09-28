import os, hmac, hashlib, time, json
import httpx

WORKER_URL = "http://127.0.0.1:8000/worker/ingest"
SECRET = "password"  # must match WORKER_SIGNING_SECRET in your env
TS = str(int(time.time()))
body = {
"jobId": f"job_local_{TS}",
"files": [ { "path": "Aaron_Brown.pdf" } ],
"options": { "chunkTokens": 600, "overlapTokens": 80 }
}
raw = json.dumps(body)
sig = hmac.new(SECRET.encode(), (TS + "." + raw).encode(), hashlib.sha256).hexdigest()

headers = {
"Content-Type": "application/json",
"X-Timestamp": TS,
"X-Signature": sig,
"x-correlation-id": "local-test-1",
}

with httpx.Client(timeout=60) as c:
    r = c.post(WORKER_URL, headers=headers, content=raw)
    print("Status:", r.status_code)
    print(r.text)