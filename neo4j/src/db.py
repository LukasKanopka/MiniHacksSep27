from neo4j import GraphDatabase
from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

def clear_db():
    query = "MATCH (n) DETACH DELETE n"
    driver.execute_query(query, database_="neo4j")

def create_example_graph():
    query = """
    CREATE (a:Person {name: $name})
    CREATE (b:Person {name: $friend})
    CREATE (a)-[:KNOWS]->(b)
    """
    driver.execute_query(query, name="Alice", friend="David", database_="neo4j")

def get_people():
    query = """
    MATCH (p:Person)-[:KNOWS]->(:Person)
    RETURN p.name AS name
    """
    records, _, _ = driver.execute_query(query, database_="neo4j")
    return [r["name"] for r in records]

def close():
    driver.close()


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
    driver.execute_query(
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
    driver.execute_query(
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
    driver.execute_query(query, chunkId=chunk_id, pids=person_ids, database_="neo4j")