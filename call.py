from findperson import get_people_by_project
from findperson import get_people_by_education
from findperson import get_people_by_work_experience
from findperson import get_skill_people
from neo4j import GraphDatabase
from neo4j_app.src.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
import os
import shutil
from schema_neo4j import main as func1

def main():

    print("=========================================")
    print("  Hello, welcome to SkillPoint CMD!")
    print("=========================================")

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    while True:
        print("\nWhat would you like to do?")
        print("1. Upload a PDF folder")
        print("2. Search for an employee with skill")
        print("3. Search for an employee with work experience")
        print("4. Search for an employee with project")
        print("5. Search for an employee with education")
        print("q. Quit")
        choice = input("Enter your choice: ").strip().lower()

        if choice == "1":
            string = input("Enter Abs_directory of root folder of pdfs")
            abs_dir = os.getcwd()
            path1 = os.path.join(abs_dir, "final pdfs")
            copy_pdfs(string, path1)
            func1()
        elif choice == "2":
            string = input("Enter Skill: ")
            p = get_skill_people(driver, string)
            print("The employees you are looking for are: ")
            for i in range(len(p)):
                print(p[i])
        elif choice == "3":
            string = print("Enter work experience: ")
            p = get_people_by_work_experience(driver, string)
            print("The employees you are looking for are: ")
            for i in range(len(p)):
                print(p[i])
        elif choice == "4":
            string = print("Enter project: ")
            p = get_people_by_project(driver, string)
            print("The employees you are looking for are: ")
            for i in range(len(p)):
                print(p[i])
        elif choice == "5":
            string = print("Enter education: ")
            p = get_people_by_education(driver, string)
            print("The employees you are looking for are: ")
            for i in range(len(p)):
                print(p[i])
        elif choice == "q":
            print("Goodbye!")
            break
        else:
            print("Invalid choice, please try again.")

def copy_pdfs(src_dir, dst_dir):
    # Make sure both paths are absolute
    src_dir = os.path.abspath(src_dir)
    dst_dir = os.path.abspath(dst_dir)

    if not os.path.isdir(src_dir):
        raise ValueError(f"Source directory does not exist: {src_dir}")
    os.makedirs(dst_dir, exist_ok=True)  # Create destination if it doesn't exist

    for filename in os.listdir(src_dir):
        if filename.lower().endswith(".pdf"):
            src_path = os.path.join(src_dir, filename)
            dst_path = os.path.join(dst_dir, filename)
            shutil.copy2(src_path, dst_path)  # copy2 preserves metadata
            print(f"Copied: {src_path} -> {dst_path}")

if __name__ == "__main__":
    main()