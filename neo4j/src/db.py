from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, AuthError
from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
import json
import datetime

_driver = None

def _iso_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def _bolt_uri_from_neo4j(uri: str) -> str:
    """
    Build a bolt scheme URI from a neo4j scheme URI, preserving host and path.
    Used as a fallback when routing table retrieval fails in certain networks.
    """
    try:
        from urllib.parse import urlparse, urlunparse
    except Exception:
        # Fallback string replace if urllib.parse is unavailable
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
    """
    Convert URI scheme to '+ssc' variant (relaxed TLS verification).
    - neo4j+s -> neo4j+ssc
    - bolt+s -> bolt+ssc
    - neo4j   -> neo4j+ssc
    - bolt    -> bolt+ssc
    """
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

def get_driver():
    global _driver
    if _driver is None:
        if not NEO4J_URI or not NEO4J_USER or not NEO4J_PASSWORD:
            print(json.dumps({
                "ts": _iso_now(),
                "level": "error",
                "msg": "neo4j_env_incomplete",
                "NEO4J_URI": NEO4J_URI,
                "NEO4J_USER_set": bool(NEO4J_USER),
                "NEO4J_PASSWORD_set": bool(NEO4J_PASSWORD)
            }))
            raise RuntimeError("Neo4j environment variables are not fully set")
        primary_uri = NEO4J_URI
        try:
            # Try standard Aura routing first
            _driver = GraphDatabase.driver(primary_uri, auth=(NEO4J_USER, NEO4J_PASSWORD))
            _driver.verify_connectivity()
        except ServiceUnavailable as e:
            msg = str(e)
            # Some networks/firewalls block routing-table fetch on 7687; fall back to bolt (no routing)
            if primary_uri and primary_uri.startswith("neo4j") and "Unable to retrieve routing information" in msg:
                bolt_uri = _bolt_uri_from_neo4j(primary_uri)
                try:
                    tmp = GraphDatabase.driver(bolt_uri, auth=(NEO4J_USER, NEO4J_PASSWORD))
                    tmp.verify_connectivity()
                    print(json.dumps({
                        "ts": _iso_now(),
                        "level": "info",
                        "msg": "neo4j_driver_fallback_to_bolt",
                        "from": primary_uri,
                        "to": bolt_uri
                    }))
                    _driver = tmp
                except Exception as e2:
                    err2 = str(e2)
                    print(json.dumps({
                        "ts": _iso_now(),
                        "level": "error",
                        "msg": "neo4j_driver_fallback_failed",
                        "from": primary_uri,
                        "to": bolt_uri,
                        "error": err2
                    }))
                    # If certificate verification fails (common with TLS interception), try +ssc variant
                    if "SSLCertVerificationError" in err2 or "certificate verify failed" in err2.lower():
                        try:
                            ssc_uri = _to_ssc(bolt_uri)
                            tmp2 = GraphDatabase.driver(ssc_uri, auth=(NEO4J_USER, NEO4J_PASSWORD))
                            tmp2.verify_connectivity()
                            print(json.dumps({
                                "ts": _iso_now(),
                                "level": "warn",
                                "msg": "neo4j_driver_fallback_to_ssc",
                                "from": bolt_uri,
                                "to": ssc_uri,
                                "note": "Using relaxed TLS verification due to SSL interception; prefer strict TLS by allowlisting *.databases.neo4j.io:7687."
                            }))
                            _driver = tmp2
                        except Exception as e3:
                            print(json.dumps({
                                "ts": _iso_now(),
                                "level": "error",
                                "msg": "neo4j_driver_ssc_failed",
                                "from": bolt_uri,
                                "to": ssc_uri if 'ssc_uri' in locals() else None,
                                "error": str(e3)
                            }))
                            raise
                    else:
                        raise
            else:
                raise
    return _driver

def verify_connectivity():
    try:
        d = get_driver()
        d.verify_connectivity()
        records, _, _ = d.execute_query("RETURN 1 AS ok", database_="neo4j")
        print(json.dumps({
            "ts": _iso_now(),
            "level": "info",
            "msg": "neo4j_connectivity_ok",
            "uri": NEO4J_URI,
            "ok": records[0]["ok"] if records else None
        }))
    except ServiceUnavailable as e:
        print(json.dumps({
            "ts": _iso_now(),
            "level": "error",
            "msg": "neo4j_routing_failure",
            "uri": NEO4J_URI,
            "hint": "For AuraDB use neo4j+s://<id>.databases.neo4j.io. Ensure the database is running and network/DNS to *.databases.neo4j.io:7687 is allowed.",
            "error": str(e)
        }))
        raise
    except AuthError as e:
        print(json.dumps({
            "ts": _iso_now(),
            "level": "error",
            "msg": "neo4j_auth_error",
            "uri": NEO4J_URI,
            "error": str(e)
        }))
        raise
    except Exception as e:
        print(json.dumps({
            "ts": _iso_now(),
            "level": "error",
            "msg": "neo4j_connectivity_exception",
            "uri": NEO4J_URI,
            "error": str(e)
        }))
        raise

def clear_db():
    query = "MATCH (n) DETACH DELETE n"
    get_driver().execute_query(query, database_="neo4j")

def create_example_graph():
    query = """
    CREATE (a:Person {name: $name})
    CREATE (b:Person {name: $friend})
    CREATE (a)-[:KNOWS]->(b)
    """
    get_driver().execute_query(query, name="Alice", friend="David", database_="neo4j")

def get_people():
    query = """
    MATCH (p:Person)-[:KNOWS]->(:Person)
    RETURN p.name AS name
    """
    records, _, _ = get_driver().execute_query(query, database_="neo4j")
    return [r["name"] for r in records]

def close():
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


# Ingestion upsert helpers (Documents, Chunks)
def upsert_document(doc_id: str, path: str, mime: str | None = None, bytes_count: int | None = None, status: str | None = None):
    """
    Upsert a Document node by id with optional metadata.
    - Sets createdAt on create, updatedAt on update
    - Status defaults to 'pending' if not provided on create
    """
    query = """
    MERGE (d:Document {id: $docId})
      ON CREATE SET
        d.path = $path,
        d.mime = $mime,
        d.bytes = $bytes,
        d.createdAt = datetime(),
        d.status = coalesce($status, 'pending')
      ON MATCH SET
        d.path = coalesce($path, d.path),
        d.mime = coalesce($mime, d.mime),
        d.bytes = coalesce($bytes, d.bytes),
        d.updatedAt = datetime(),
        d.status = coalesce($status, d.status)
    RETURN d.id AS id
    """
    get_driver().execute_query(
        query,
        docId=doc_id,
        path=path,
        mime=mime,
        bytes=bytes_count,
        status=status,
        database_="neo4j",
    )


def upsert_chunk(chunk_id: str, doc_id: str, text: str, embedding: list[float], order: int, tokens: int, section: str | None = None, page: int | None = None):
    """
    Upsert a Chunk node and connect it to its Document via CHUNK_OF.
    Overwrites mutable fields on update for idempotency.
    """
    query = """
    MERGE (c:Chunk {id: $chunkId})
      ON CREATE SET
        c.text = $text,
        c.embedding = $embedding,
        c.`order` = $order,
        c.tokens = $tokens,
        c.section = $section,
        c.page = $page,
        c.createdAt = datetime()
      ON MATCH SET
        c.text = $text,
        c.embedding = $embedding,
        c.`order` = $order,
        c.tokens = $tokens,
        c.section = $section,
        c.page = $page,
        c.updatedAt = datetime()
    WITH c
    MATCH (d:Document {id: $docId})
    MERGE (c)-[:CHUNK_OF]->(d)
    RETURN c.id AS id
    """
    get_driver().execute_query(
        query,
        chunkId=chunk_id,
        docId=doc_id,
        text=text,
        embedding=embedding,
        order=order,
        tokens=tokens,
        section=section,
        page=page,
        database_="neo4j",
    )


def upsert_mentions(chunk_id: str, person_ids: list[str] | None = None):
    """
    Optional helper to attach MENTIONS from a Chunk to Person nodes by id.
    No-op if person_ids is empty or None.
    """
    if not person_ids:
        return
    query = """
    MATCH (c:Chunk {id: $chunkId})
    UNWIND $pids AS pid
    MATCH (p:Person {id: pid})
    MERGE (c)-[:MENTIONS]->(p)
    """
    get_driver().execute_query(query, chunkId=chunk_id, pids=person_ids, database_="neo4j")


def upsert_persons_and_mentions(chunk_id: str, persons: list[dict] | None = None):
    """
    Upsert Person nodes (by id) and attach MENTIONS from a Chunk.
    'persons' is a list of dicts: [{ "id": "...", "name": "Display Name" }, ...]
    No-op if persons is empty or None.
    """
    if not persons:
        return
    query = """
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
    get_driver().execute_query(query, chunkId=chunk_id, persons=persons, database_="neo4j")

def upsert_persons_and_mentions(chunk_id: str, persons: list[dict] | None = None):
    """
    Upsert Person nodes (by id) and attach MENTIONS from a Chunk.
    'persons' is a list of dicts: [{ "id": "...", "name": "Display Name" }, ...]
    No-op if persons is empty or None.
    """
    if not persons:
        return
    query = """
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
    get_driver().execute_query(query, chunkId=chunk_id, persons=persons, database_="neo4j")