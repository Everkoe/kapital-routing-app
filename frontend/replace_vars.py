import os

file_path = "c:/Users/VDLP/kapital-routing-app/frontend/src/GerentePortal.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("var(--bg-primary,#0f1117)", "var(--kapital-bg)")
content = content.replace("var(--bg-primary)", "var(--kapital-bg)")
content = content.replace("var(--bg-secondary)", "var(--kapital-card-bg)")
content = content.replace("var(--text-primary)", "var(--kapital-text-primary)")
content = content.replace("var(--text-secondary)", "var(--kapital-text-secondary)")
content = content.replace("var(--border-color)", "var(--kapital-border)")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Variables replaced successfully.")
