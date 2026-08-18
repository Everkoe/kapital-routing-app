import json
import urllib.request
import hashlib

url = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1/app_state?id=eq.1"
key = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as res:
    data = json.loads(res.read().decode())
    current = data[0]
    usuarios_db = current.get("usuarios", {})
    
    # Generate 67 fake drivers
    for i in range(1, 68):
        email = f"conductor{i}@test.com"
        usuarios_db[email] = {
            "nombre": f"Conductor Prueba {i}",
            "email": email,
            "password": hash_password("123456"),
            "rol": "Conductor",
            "estado": "Aprobado",
            "vehiculo": f"TEST-{100+i}",
            "capacidad": 15,
            "zona": "Norte"
        }

    # Save back to Supabase
    payload = {"usuarios": usuarios_db}
    req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
    with urllib.request.urlopen(req_patch) as patch_res:
        print("Fake drivers added, status:", patch_res.status)
