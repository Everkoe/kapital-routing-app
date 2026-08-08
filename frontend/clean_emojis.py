import json
import urllib.request
import re

url = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1/app_state?id=eq.1"
key = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}

req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as res:
    data = json.loads(res.read().decode())
    current = data[0]
    usuarios_db = current.get("usuarios", {})
    
    # Function to remove emojis
    def remove_emoji(text):
        if not isinstance(text, str):
            return text
        # Simple regex to remove common emoji ranges
        return re.sub(r'[^\w\s,\.\-]', '', text).strip()
    
    # clean usuarios
    for email, user in usuarios_db.items():
        if "nombre" in user:
            user["nombre"] = remove_emoji(user["nombre"])
            
    # clean flota
    flota_db = usuarios_db.get("__flota__", {})
    for placa, data in flota_db.items():
        if "chofer" in data:
            data["chofer"] = remove_emoji(data["chofer"])
            
    usuarios_db["__flota__"] = flota_db
    payload = {"usuarios": usuarios_db}
    
    req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
    with urllib.request.urlopen(req_patch) as patch_res:
        print("Cleaned emojis, status:", patch_res.status)
