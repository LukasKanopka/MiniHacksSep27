import google.generativeai as genai
import os
from neo4j_app.src.config import GEMINI_APIKEY

genai.configure(api_key=os.getenv(GEMINI_APIKEY))
model = genai.GenerativeModel("gemini-2.5-pro")

def candidate_resume_parser(filename):
    abs_dir = os.getcwd()
    path1 = os.path.join(abs_dir, "txt_output")
    path2 = os.path.join(path1, filename)
    with open(path2, 'r', encoding='utf-8') as file:
        content = file.read()


    prompt = """
    Extract the following information from the resume text below and return strictly in JSON format:
    - Name
    - Skills
    - Education
    - Work Experience
    - Projects

    Rules to follow: 
        Read the following text and return ONLY a single JSON object that matches this exact schema:
        {
            "Name": "string",
            "skills": ["string"],
            "education": ["string"],
            "work experience": ["string"],
            "projects": ["string"]
        }

    - Make sure to keep all quotations properly formatted in the JSON style
    - Output strict JSON that matches the provided JSON schema
    - Do NOT invent facts. If unknown, omit the field. 
    - Normalize skill names to canonical single tokens when obvious (e.g. 'Python', 'React', 'AWS')
    - under work experience, include the most relevant key achievements on the resume

    Resume Text:
    {content}
    """


    response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})

    return response.text

