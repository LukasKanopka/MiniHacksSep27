import os
import sys
import json
import datetime
from pathlib import Path

def iso_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

# Load env from current working dir and repo root
if load_dotenv:
    try:
        load_dotenv()
        load_dotenv(dotenv_path=str(Path(__file__).resolve().parents[2] / ".env"))
    except Exception:
        pass

NEO4J_URI = os.getenv("NEO4J_URI")
NEO4J_USER = os.getenv("NEO4J_USERNAME") or os.getenv("NEO4J_USER")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, AuthError

def _bolt_uri_from_neo4j(uri: str) -> str:
    try:
        from urllib.parse import urlparse, urlunparse
    except Exception:
        return uri.replace("neo4j+s://", "bolt+s://").replace("neo4j://", "bolt://")
    try:
        p = urlparse(uri)
        scheme = p.scheme or ""
        if scheme.startswith("neo4j"):
            new_scheme = "bolt+s" if "+s" in scheme else "bolt"
            p = p._replace(scheme=new_scheme)
            return urlunparse(p)
        return uri
    except Exception:
        return uri

def _to_ssc(uri: str) -> str:
    try:
        from urllib.parse import urlparse, urlunparse
    except Exception:
        return (uri
                .replace("neo4j+s://", "neo4j+ssc://")
                .replace("bolt+s://", "bolt+ssc://")
                .replace("neo4j://", "neo4j+ssc://")
                .replace("bolt://", "bolt+ssc://"))
    try:
        p = urlparse(uri)
        scheme = p.scheme or ""
        if scheme.startswith("neo4j"):
            new_scheme = "neo4j+ssc" if "+s" in scheme or scheme == "neo4j" else "neo4j+ssc"
            p = p._replace(scheme=new_scheme)
            return urlunparse(p)
        if scheme.startswith("bolt"):
            new_scheme = "bolt+ssc" if "+s" in scheme or scheme == "bolt" else "bolt+ssc"
            p = p._replace(scheme=new_scheme)
            return urlunparse(p)
        return uri
    except Exception:
        return uri

def get_driver_with_fallback():
    if not NEO4J_URI or not NEO4J_USER or not NEO4J_PASSWORD:
        print(json.dumps({
            "ts": iso_now(),
            "level": "error",
            "msg": "neo4j_env_incomplete"
        }))
        raise SystemExit(2)
    try:
        d = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        d.verify_connectivity()
        return d
    except ServiceUnavailable as e:
        msg = str(e)
        if "Unable to retrieve routing information" in msg and NEO4J_URI.startswith("neo4j"):
            bolt_uri = _bolt_uri_from_neo4j(NEO4J_URI)
            try:
                d = GraphDatabase.driver(bolt_uri, auth=(NEO4J_USER, NEO4J_PASSWORD))
                d.verify_connectivity()
                print(json.dumps({"ts": iso_now(), "level":"info", "msg":"initdb_fallback_to_bolt", "from": NEO4J_URI, "to": bolt_uri}))
                return d
            except Exception as e2:
                err2 = str(e2)
                print(json.dumps({"ts": iso_now(), "level":"warn", "msg":"initdb_bolt_failed", "error": err2}))
                if "SSLCertVerificationError" in err2 or "certificate verify failed" in err2.lower():
                    ssc_uri = _to_ssc(bolt_uri)
                    try:
                        d = GraphDatabase.driver(ssc_uri, auth=(NEO4J_USER, NEO4J_PASSWORD))
                        d.verify_connectivity()
                        print(json.dumps({"ts": iso_now(), "level":"warn", "msg":"initdb_fallback_to_ssc", "from": bolt_uri, "to": ssc_uri}))
                        return d
                    except Exception as e3:
                        print(json.dumps({"ts": iso_now(), "level":"error", "msg":"initdb_ssc_failed", "error": str(e3)}))
                        raise
                raise
        raise

def load_statements(cypher_path: Path):
    text = cypher_path.read_text(encoding="utf-8")
    statements = []
    current = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue
        current.append(line)
        if line.endswith(";"):
            stmt = " ".join(current)
            if stmt.endswith(";"):
                stmt = stmt[:-1]
            statements.append(stmt.strip())
            current = []
    if current:
        stmt = " ".join(current).strip()
        if stmt:
            statements.append(stmt)
    return statements

def main():
    root = Path(__file__).resolve().parents[1]
    cypher_file = root / "src" / "setup.cypher"
    if not cypher_file.exists():
        print(json.dumps({"ts": iso_now(), "level":"error", "msg":"setup_cypher_missing", "path": str(cypher_file)}))
        raise SystemExit(1)
    stmts = load_statements(cypher_file)
    if not stmts:
        print(json.dumps({"ts": iso_now(), "level":"error", "msg":"no_statements_found"}))
        raise SystemExit(1)

    driver = get_driver_with_fallback()
    applied = 0
    try:
        for i, stmt in enumerate(stmts, start=1):
            try:
                records, summary, keys = driver.execute_query(stmt, database_="neo4j")
                print(json.dumps({
                    "ts": iso_now(),
                    "level": "info",
                    "msg": "cypher_applied",
                    "index": i,
                    "text": (stmt[:140] + ("..." if len(stmt) > 140 else ""))
                }))
                applied += 1
            except Exception as e:
                emsg = str(e)
                # Aura returns ProcedureCallFailed when an equivalent vector index already exists.
                if "EquivalentSchemaRuleAlreadyExistsException" in emsg or "already exists" in emsg:
                    print(json.dumps({
                        "ts": iso_now(),
                        "level": "warn",
                        "msg": "cypher_skipped_equivalent_index",
                        "index": i,
                        "text": (stmt[:140] + ("..." if len(stmt) > 140 else "")),
                        "error": emsg
                    }))
                    continue
                # Some environments may not support db.indexes() shape uniformly; log and re-raise others.
                print(json.dumps({
                    "ts": iso_now(),
                    "level": "error",
                    "msg": "cypher_failed",
                    "index": i,
                    "text": (stmt[:140] + ("..." if len(stmt) > 140 else "")),
                    "error": emsg
                }))
                raise
        print(json.dumps({"ts": iso_now(), "level":"info", "msg":"initdb_done", "count": applied}))
    finally:
        try:
            driver.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()