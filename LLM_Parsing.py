import google.generativeai as genai
import os
from schema_setter import resume_schema

genai.configure(api_key=os.getenv())
model = genai.GenerativeModel("gemini-2.5-flash")

def candidate_resume_parser(filename):
    with open("txt_output/"+ filename, 'r', encoding='utf-8') as file:
        content = file.read()


    prompt = f"""
    Extract the following information from the resume text below and return strictly in JSON format:
    - Name
    - Skills
    - Education
    - Work Experience
    - Projects

    Rules to follow: 
    - Output strict JSON that matches the provided JSON schema
    - Do not invent facts. If unknown, omit the field. 
    - Normalize skill names to canonical single tokens when obvious (e.g. 'Python', 'React', 'AWS')
    - under work experience, include the most relevant key achievements on the resume

    Resume Text:
    {content}
    """

    response = model.generate_content(prompt=prompt, response_schema=resume_schema)

    return response.text

