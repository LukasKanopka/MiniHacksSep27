from LLM_Parsing import candidate_resume_parser
from pdf_to_txt import pdf_to_text
import os
from neo4j import GraphDatabase
from .neo4j.src.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

def main():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    os.system("python pdf_to_txt.py")

    abs_dir = os.getcwd()

    file_names = os.listdir(abs_dir)

    for i in range(len(file_names)):
        bang = candidate_resume_parser(file_names[i])

        with driver.session() as session:
            for person in bang:
                session.write_transaction(create_person, person)


def create_person(tx, person):
    name = person.get("Name")
    
    # Merge and connect skills
    for skill in person.get("skills", []):
        tx.run("""
            MERGE (s:Skill {name: $skill})
            WITH s
            MATCH (p:Person {name: $name})
            MERGE (p)-[:HAS_SKILL]->(s)
        """, skill=skill, name=name)
    
    # Merge and connect education
    for edu in person.get("education", []):
        tx.run("""
            MERGE (e:Education {name: $edu})
            WITH e
            MATCH (p:Person {name: $name})
            MERGE (p)-[:HAS_EDUCATION]->(e)
        """, edu=edu, name=name)
    
    # Merge and connect work experience
    for work in person.get("work experience", []):
        tx.run("""
            MERGE (w:WorkExperience {name: $work})
            WITH w
            MATCH (p:Person {name: $name})
            MERGE (p)-[:HAS_WORK_EXPERIENCE]->(w)
        """, work=work, name=name)
    
    # Merge and connect projects
    for project in person.get("projects", []):
        tx.run("""
            MERGE (proj:Project {name: $project})
            WITH proj
            MATCH (p:Person {name: $name})
            MERGE (p)-[:HAS_PROJECT]->(proj)
        """, project=project, name=name)

if __name__ == "__main__":
    main()