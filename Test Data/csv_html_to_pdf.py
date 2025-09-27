import os, re, sys
import pandas as pd
from pathlib import Path

# ==== CONFIG ====
CSV_PATH = "resumes.csv"           # your CSV file
HTML_COL = "html"                   # column that holds the HTML
NAME_COL = "name"                   # optional: column to name files; set to "" to use row index
OUT_DIR  = "pdf_out"               # output folder
PAGE_SIZE = "A4"               # A4 or Letter
MARGINS = {"top":"0.5in","right":"0.5in","bottom":"0.5in","left":"0.5in"}
# ===============

# minimal HTML shell if fragments are stored
HTML_SHELL = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {{ size: {size}; margin: 0; }}
  body {{ margin: {mt} {mr} {mb} {ml}; font-family: Arial, Helvetica, sans-serif; }}
</style>
</head>
<body>{body}</body>
</html>"""

def slugify(s: str, default="resume"):
    s = re.sub(r"[^\w\s.-]", "", s, flags=re.UNICODE).strip()
    s = re.sub(r"\s+", "_", s)
    return s or default

def ensure_shell(html: str) -> str:
    h = html.strip()
    if "<html" in h.lower() and "</html>" in h.lower():
        return h
    return HTML_SHELL.format(
        size=PAGE_SIZE,
        mt=MARGINS["top"], mr=MARGINS["right"], mb=MARGINS["bottom"], ml=MARGINS["left"],
        body=h
    )

def main():
    df = pd.read_csv(CSV_PATH)
    if HTML_COL not in df.columns:
        raise SystemExit(f"Column '{HTML_COL}' not found. Columns: {list(df.columns)}")

    out = Path(OUT_DIR); out.mkdir(parents=True, exist_ok=True)

    # Lazy import to avoid overhead unless we run
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()

        for i, row in df.iterrows():
            html = str(row[HTML_COL]) if pd.notna(row[HTML_COL]) else ""
            if not html.strip():
                print(f"[skip] row {i}: empty HTML"); continue

            name_part = str(row[NAME_COL]) if NAME_COL and NAME_COL in df.columns and pd.notna(row[NAME_COL]) else f"row_{i}"
            fname = slugify(name_part) + ".pdf"
            html_doc = ensure_shell(html)

            # Load HTML via data URL and print to PDF
            page.goto("data:text/html;charset=utf-8," + html_doc)
            page.pdf(path=str(out / fname), format=PAGE_SIZE, margin=MARGINS)

            print(f"[ok] {fname}")

        browser.close()

if __name__ == "__main__":
    # allow overrides via CLI: csv, html_col, name_col, out_dir
    if len(sys.argv) >= 2: CSV_PATH = sys.argv[1]
    if len(sys.argv) >= 3: HTML_COL = sys.argv[2]
    if len(sys.argv) >= 4: NAME_COL = sys.argv[3]
    if len(sys.argv) >= 5: OUT_DIR  = sys.argv[4]
    main()
