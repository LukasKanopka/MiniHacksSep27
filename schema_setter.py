from google.generativeai import Schema

resume_schema = Schema(
    properties={
        "Name": {"type": "string"},
        "skills": {"type": "array", "items": {"type": "string"}},
        "education": {"type": "array", "items": {"type": "string"}},
        "work experience": {"type": "array", "items": {"type": "string"}},
        "projects": {"type": "array", "items": {"type": "string"}}
    },
    required=["Name", "skills", "education", "work experience", "projects"]
)
