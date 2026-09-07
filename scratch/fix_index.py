import os
import re

file_path = "c:/Users/VDLP/kapital-routing-app/frontend/api/index.py"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

helper_code = """
def get_user_by_identifier(identifier: str):
    if not identifier: return None
    identifier_clean = identifier.strip()
    user = usuarios_db.get(identifier_clean)
    if user: return user
    for k, v in usuarios_db.items():
        if k.lower() == identifier_clean.lower():
            return v
        perfil = v.get("perfil_conductor", {})
        if perfil and perfil.get("numDoc") == identifier_clean:
            return v
    return None

"""

# 1. Insert helper before login_user
content = content.replace("@app.post(\"/api/auth/login\")", helper_code + "@app.post(\"/api/auth/login\")")

# 2. Refactor login_user
old_login_lookup = """    identifier_clean = usuario.identifier.strip()
    user_in_db = usuarios_db.get(identifier_clean)
    if not user_in_db:
        for k, v in usuarios_db.items():
            if k.lower() == identifier_clean.lower():
                user_in_db = v
                break
            # Check if DNI matches
            perfil = v.get("perfil_conductor", {})
            if perfil and perfil.get("numDoc") == identifier_clean:
                user_in_db = v
                break"""
new_login_lookup = "    user_in_db = get_user_by_identifier(usuario.identifier)"
content = content.replace(old_login_lookup, new_login_lookup)

# 3. Refactor change_password
old_cp_lookup = """    identifier_clean = req.identifier.strip()
    user_in_db = usuarios_db.get(identifier_clean)
    if not user_in_db:
        for k, v in usuarios_db.items():
            if k.lower() == identifier_clean.lower():
                user_in_db = v
                break
            perfil = v.get("perfil_conductor", {})
            if perfil and perfil.get("numDoc") == identifier_clean:
                user_in_db = v
                break"""
new_cp_lookup = "    user_in_db = get_user_by_identifier(req.identifier)"
content = content.replace(old_cp_lookup, new_cp_lookup)

# 4. Refactor get_profile
content = content.replace("user = usuarios_db.get(email)", "user = get_user_by_identifier(email)")
content = content.replace("user = usuarios_db.get(update_data.identifier)", "user = get_user_by_identifier(update_data.identifier)")
content = content.replace("user = usuarios_db.get(payload.email)", "user = get_user_by_identifier(payload.email)")
content = content.replace("conductor = usuarios_db.get(payload.conductor_email)", "conductor = get_user_by_identifier(payload.conductor_email)")

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Modifications applied.")
