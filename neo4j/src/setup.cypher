// Requires Neo4j AuraDB 5.28+ for native vector indexes
// One-time initialization script for constraints, property index, and vector index

CREATE CONSTRAINT person_id IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE;
CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE INDEX chunk_order IF NOT EXISTS FOR (c:Chunk) ON (c.order);

CALL db.index.vector.createNodeIndex('chunk_embedding_idx','Chunk','embedding',1536,'cosine');