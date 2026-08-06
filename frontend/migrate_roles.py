import json
import urllib.request

url = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1/app_state?id=eq.1"
key = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}
req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as res:
    data = json.loads(res.read().decode())
    current = data[0]
    usuarios_db = current.get("usuarios", {})
    
    # Update roles
    changed = False
    for email, user_data in usuarios_db.items():
        if isinstance(user_data, dict) and user_data.get("rol") == "Administrador":
            user_data["rol"] = "Programador de rutas"
            changed = True
            
    if changed:
        payload = {"usuarios": usuarios_db}
        req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
        with urllib.request.urlopen(req_patch) as patch_res:
            print("DB Migration status:", patch_res.status)
    else:
        print("No users needed updating.")
