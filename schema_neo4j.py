from LLM_Parsing import candidate_resume_parser
from LLM_Parsing import candidate_text_maker
from pdf_to_txt import pdf_to_text
import os
import re
from neo4j import GraphDatabase
from neo4j_app.src.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
import json

def main():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    os.system("python pdf_to_txt.py")

    abs_dir = os.getcwd()
    new_path = os.path.join(abs_dir, "txt_output")

    file_names = os.listdir(new_path)

    #file_names = ["Aaron_Brown.pdf", "Aaron_Edwards.pdf", "Aaron_Erickson.pdf"]

    bang = ""

    for i in range(len(file_names)):
        bang = candidate_text_maker(file_names[i], bang)

#        with driver.session() as session:
#            session.write_transaction(create_person, bang)
#        
#    driver.close()

    jsonLongList = candidate_resume_parser(bang)

    print(jsonLongList)

    jsonLongList = jsonLongList.strip()
    if jsonLongList.startswith('[') and jsonLongList.endswith(']'):
        jsonLongList = jsonLongList[1:-1]  # remove first and last character

    # Step 2: Split the string into individual JSON objects

    parts = re.split(r'},\s*{', jsonLongList)

    # Step 3: Fix the braces for each chunk
    parts = [parts[0] + '}'] + ['{' + p + '}' for p in parts[1:-1]] + ['{' + parts[-1]]

    for i in range(len(parts)):
        with driver.session() as session:
            session.write_transaction(create_person, parts[i])
    
    driver.close()

def create_person(tx, data):
    print(data)
    person = json.loads(data)
    #print(data)
    name = person.get("Name")

    if not name:
        print("No name found, skipping")
        return

    # Create or merge the Person node first
    tx.run("MERGE (p:Person {name: $name})", name=name)
    
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