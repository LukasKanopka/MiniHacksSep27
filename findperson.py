from neo4j import GraphDatabase
from neo4j_app.src.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

def get_skill_people(driver, skill_name):
    with driver.session() as session:
        query = """
        MATCH (p:Person)-[:HAS_SKILL]->(s:Skill {name: $skill_name})
        RETURN p
        """
        result = session.run(query, skill_name=skill_name)
        # Convert nodes to dictionaries
        people = [record["p"]._properties for record in result]
        return people
    
def get_people_by_work_experience(driver, work_name):
    with driver.session() as session:
        query = """
        MATCH (p:Person)-[:HAS_WORK_EXPERIENCE]->(w:WorkExperience {name: $work_name})
        RETURN p
        """
        result = session.run(query, work_name=work_name)
        people = [record["p"]._properties for record in result]
        return people

def get_people_by_education(driver, edu_name):
    with driver.session() as session:
        query = """
        MATCH (p:Person)-[:HAS_EDUCATION]->(e:Education {name: $edu_name})
        RETURN p
        """
        result = session.run(query, edu_name=edu_name)
        people = [record["p"]._properties for record in result]
        return people

def get_people_by_project(driver, project_name):
    with driver.session() as session:
        query = """
        MATCH (p:Person)-[:HAS_PROJECT]->(proj:Project {name: $project_name})
        RETURN p
        """
        result = session.run(query, project_name=project_name)
        people = [record["p"]._properties for record in result]
        return people

#def main():
 #   # Connect to Neo4j AuraDB
  #  driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    
  #  skill_to_search = "XXX"  # example skill
  #  people_with_skill = get_skill_people(driver, skill_to_search)
    
  #  print(f"People with skill '{skill_to_search}':")
  #  for person in people_with_skill:
  #      print(person)
    
  #  driver.close()
