import os
import fitz  # PyMuPDF

# -------- SETTINGS --------
INPUT_DIR = "final pdfs"        # Folder with your PDF files
OUTPUT_DIR = "txt_output" # Folder to save the raw text
os.makedirs(OUTPUT_DIR, exist_ok=True)

# -------- FUNCTION TO EXTRACT TEXT --------
def pdf_to_text(pdf_path):
    text = ""
    try:
        doc = fitz.open(pdf_path)
        for page in doc:
            text += page.get_text()
    except Exception as e:
        print(f"Error reading {pdf_path}: {e}")
    return text

# -------- LOOP THROUGH ALL PDF FILES --------
for filename in os.listdir(INPUT_DIR):
    if filename.lower().endswith(".pdf"):
        pdf_path = os.path.join(INPUT_DIR, filename)
        raw_text = pdf_to_text(pdf_path)
        text_filename = os.path.splitext(filename)[0] + ".txt"
        text_path = os.path.join(OUTPUT_DIR, text_filename)
        with open(text_path, "w", encoding="utf-8") as f:
            f.write(raw_text)
        print(f"Converted {filename} -> {text_filename}")

print("All PDFs have been converted to text!")
