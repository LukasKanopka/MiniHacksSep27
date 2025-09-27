from neo4j import GraphDatabase
from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

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
