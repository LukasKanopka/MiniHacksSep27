import os
import json
import datetime
from pathlib import Path

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
from neo4j.exceptions import ServiceUnavailable

# --- connectivity fallback used in other scripts ---

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
            p = p._replace(scheme="neo4j+ssc")
            return urlunparse(p)
        if scheme.startswith("bolt"):
            p = p._replace(scheme="bolt+ssc")
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
            bolt = _bolt_uri_from_neo4j(NEO4J_URI)
            try:
                d = GraphDatabase.driver(bolt, auth=(NEO4J_USER, NEO4J_PASSWORD))
                d.verify_connectivity()
                print(json.dumps({"ts": iso_now(), "level": "info", "msg": "cleanup_fallback_to_bolt", "from": NEO4J_URI, "to": bolt}))
                return d
            except Exception as e2:
                em = str(e2)
                print(json.dumps({"ts": iso_now(), "level": "warn", "msg": "cleanup_bolt_failed", "error": em}))
                if "certificate" in em.lower() or "ssl" in em.lower() or "verify" in em.lower():
                    ssc = _to_ssc(bolt)
                    d = GraphDatabase.driver(ssc, auth=(NEO4J_USER, NEO4J_PASSWORD))
                    d.verify_connectivity()
                    print(json.dumps({"ts": iso_now(), "level": "warn", "msg": "cleanup_fallback_to_ssc", "from": bolt, "to": ssc}))
                    return d
                raise
        raise

# --- cleanup logic ---

BANNED_TERMS = [
    "computer science", "software engineering", "data structures",
    "advanced algorithms", "network security", "machine learning",
    "google cloud", "magna cum laude", "cum laude"
]

BANNED_SUFFIXES = ["Science", "Engineering", "Algorithms", "Structures", "Security", "Cloud", "Learning", "Laude"]

CLEANUP_CYPHER = """
// Delete Persons that are clearly not real person names, with safe heuristics
CALL {
  WITH $banned AS banned, $suffixes AS suff
  MATCH (p:Person)
  WITH p, split(coalesce(p.name," "), " ") AS parts, toLower(coalesce(p.name,"")) AS lname
  WHERE p.name IS NULL
     OR size(parts) < 2 OR size(parts) > 4
     OR lname IN banned
     OR (size(parts) >= 1 AND parts[-1] IN suff)
     OR any(x IN parts WHERE size(x) > 20)
  WITH collect(p) AS bad
  RETURN bad
}
CALL {
  WITH bad
  UNWIND bad AS pp
  DETACH DELETE pp
} IN TRANSACTIONS OF 1000 ROWS
RETURN 0 AS ok
"""

def main():
    driver = get_driver_with_fallback()
    try:
        with driver.session(database="neo4j") as session:
            pre = session.run("MATCH (p:Person) RETURN count(p) AS c").single()["c"]
            mpre = session.run("MATCH (:Chunk)-[r:MENTIONS]->(:Person) RETURN count(r) AS c").single()["c"]
            print(json.dumps({"ts": iso_now(), "level": "info", "msg": "cleanup_pre_counts", "persons": pre, "mentions": mpre}))

            session.run(CLEANUP_CYPHER, banned=BANNED_TERMS, suffixes=BANNED_SUFFIXES)

            post = session.run("MATCH (p:Person) RETURN count(p) AS c").single()["c"]
            mpost = session.run("MATCH (:Chunk)-[r:MENTIONS]->(:Person) RETURN count(r) AS c").single()["c"]
            print(json.dumps({"ts": iso_now(), "level": "info", "msg": "cleanup_post_counts", "persons": post, "mentions": mpost, "deleted_persons": pre - post}))
    finally:
        try:
            driver.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()