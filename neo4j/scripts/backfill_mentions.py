import os
import sys
import json
import datetime
import re
from pathlib import Path
from typing import List, Dict, Any, Tuple

def iso_now() -> str:
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

# ------- Connectivity helpers (same fallback logic style as init_db.py) -------

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
            new_scheme = "neo4j+ssc"
            p = p._replace(scheme=new_scheme)
            return urlunparse(p)
        if scheme.startswith("bolt"):
            new_scheme = "bolt+ssc"
            p = p._replace(scheme=new_scheme)
            return urlunparse(p)
        return uri
    except Exception:
        return uri

def get_driver_with_fallback():
    if not NEO4J_URI or not NEO4J_USER or not NEO4J_PASSWORD:
        print(json.dumps({"ts": iso_now(), "level": "error", "msg": "neo4j_env_incomplete"}))
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
                print(json.dumps({"ts": iso_now(), "level":"info", "msg":"backfill_fallback_to_bolt", "from": NEO4J_URI, "to": bolt_uri}))
                return d
            except Exception as e2:
                err2 = str(e2)
                print(json.dumps({"ts": iso_now(), "level":"warn", "msg":"backfill_bolt_failed", "error": err2}))
                if "SSLCertVerificationError" in err2 or "certificate verify failed" in err2.lower():
                    ssc_uri = _to_ssc(bolt_uri)
                    try:
                        d = GraphDatabase.driver(ssc_uri, auth=(NEO4J_USER, NEO4J_PASSWORD))
                        d.verify_connectivity()
                        print(json.dumps({"ts": iso_now(), "level":"warn", "msg":"backfill_fallback_to_ssc", "from": bolt_uri, "to": ssc_uri}))
                        return d
                    except Exception as e3:
                        print(json.dumps({"ts": iso_now(), "level":"error", "msg":"backfill_ssc_failed", "error": str(e3)}))
                        raise
                raise
        raise

# ------- Naive Person Extractor (keep in sync with worker) -------

PERSON_NAME_RE = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z\.]+)+)\b")
STOPWORDS = {
    "The", "And", "For", "With", "From", "Into", "Across", "Between", "Among",
    "Project", "Graph", "Knowledge", "Vector", "Search", "Database", "Engineer",
    "Senior", "Staff", "Manager", "Director", "Company", "Organization"
}
BANNED_TERMS = {
    "computer science", "software engineering", "data structures",
    "advanced algorithms", "network security", "machine learning",
    "google cloud", "magna cum laude", "cum laude"
}
BANNED_SUFFIXES = {"Science", "Engineering", "Algorithms", "Structures", "Security", "Cloud", "Learning", "Laude"}
EMAIL_RE = re.compile(r"\b[\w\.-]+@[\w\.-]+\.\w{2,}\b")
PHONE_RE = re.compile(r"(\+?\d[\d\-\.\s\(\)]{7,}\d)")

def person_id_from_name(name: str) -> str:
    base = name.strip().lower()
    base = re.sub(r"\s+", "-", base)
    base = re.sub(r"[^a-z0-9\-]", "", base)
    base = re.sub(r"-{2,}", "-", base).strip("-")
    return base

def _looks_like_person(parts: List[str]) -> bool:
    if not (2 <= len(parts) <= 4):
        return False
    for p in parts:
        if re.fullmatch(r"[A-Z]\.", p):
            continue
        if not re.fullmatch(r"[A-Z][a-z]+", p):
            return False
        if p in STOPWORDS:
            return False
    if parts[-1] in BANNED_SUFFIXES:
        return False
    return True

def extract_person_names(text: str) -> List[str]:
    if not text:
        return []
    text_lower = text.lower()
    has_contact = bool(EMAIL_RE.search(text) or PHONE_RE.search(text))
    found = set()
    for m in PERSON_NAME_RE.finditer(text):
        cand = m.group(1).strip()
        if cand.lower() in BANNED_TERMS:
            continue
        parts = cand.split()
        if not _looks_like_person(parts):
            continue
        if not has_contact:
            if any(p in BANNED_SUFFIXES for p in parts):
                continue
            if any(len(p) > 20 for p in parts):
                continue
        found.add(cand)
    return sorted(found)

# ------- Backfill logic -------

UPSERT_PERSONS_AND_MENTIONS = """
UNWIND $persons AS p
MERGE (person:Person {id: p.id})
  ON CREATE SET
    person.name = p.name,
    person.createdAt = datetime()
  ON MATCH SET
    person.name = coalesce(person.name, p.name),
    person.updatedAt = datetime()
WITH person
MATCH (c:Chunk {id: $chunkId})
MERGE (c)-[:MENTIONS]->(person)
"""

def fetch_chunk_page(tx, skip: int, limit: int) -> List[Dict[str, Any]]:
    cypher = """
    MATCH (c:Chunk)
    RETURN c.id AS id, c.text AS text
    SKIP $skip LIMIT $limit
    """
    recs = tx.run(cypher, skip=skip, limit=limit)
    out: List[Dict[str, Any]] = []
    for r in recs:
        out.append({"id": r["id"], "text": r["text"]})
    return out

def upsert_mentions(tx, chunk_id: str, persons: List[Dict[str, str]]) -> None:
    tx.run(UPSERT_PERSONS_AND_MENTIONS, chunkId=chunk_id, persons=persons)

def main():
    limit = int(os.getenv("BACKFILL_LIMIT", "500"))
    driver = get_driver_with_fallback()
    processed = 0
    created_links = 0
    try:
        skip = 0
        while True:
            with driver.session(database="neo4j") as session:
                page = session.execute_read(fetch_chunk_page, skip, limit)
            if not page:
                break
            for row in page:
                cid = row.get("id")
                text = row.get("text") or ""
                names = extract_person_names(text)
                if not names:
                    continue
                persons = []
                for nm in names:
                    pid = person_id_from_name(nm)
                    if pid:
                        persons.append({"id": pid, "name": nm})
                if not persons:
                    continue
                with driver.session(database="neo4j") as session:
                    session.execute_write(upsert_mentions, cid, persons)
                created_links += len(persons)
                processed += 1
                if processed % 100 == 0:
                    print(json.dumps({"ts": iso_now(), "level": "info", "msg": "backfill_progress", "processed_chunks": processed, "mentions_upserts": created_links}))
            skip += limit
        print(json.dumps({"ts": iso_now(), "level": "info", "msg": "backfill_done", "processed_chunks": processed, "mentions_upserts": created_links}))
    finally:
        try:
            driver.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()