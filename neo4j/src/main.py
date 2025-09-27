from . import db

if __name__ == "__main__":
    db.create_example_graph()
    print("People who know someone:", db.get_people())
    db.close()
