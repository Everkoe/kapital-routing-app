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
    flota_db = current.get("flota", {})
    
    # Clean up old test data in flota (anything starting with K- or KV-)
    keys_to_delete = [k for k in flota_db.keys() if k.startswith("K-") or k.startswith("KV-") or k.startswith("TEST-")]
    for k in keys_to_delete:
        del flota_db[k]

    changed = False
    for email, user in usuarios_db.items():
        if email.endswith("@test.com"):
            placa = user.get("vehiculo")
            if placa:
                flota_db[placa] = {
                    "capacidad": user.get("capacidad", 15),
                    "tipo": "Van" if "KV" in placa else "Auto",
                    "chofer": user.get("nombre", placa),
                    "soat": "2026-12-31",
                    "revision": "2026-12-31",
                    "atu": "2026-12-31",
                    "licencia": "2026-12-31"
                }
                changed = True
                
    if changed:
        payload = {"flota": flota_db}
        req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
        with urllib.request.urlopen(req_patch) as patch_res:
            print("Synced users to flota, status:", patch_res.status)
    else:
        print("No flota needed updating.")
