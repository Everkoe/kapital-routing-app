import json
import urllib.request
import hashlib

url = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1/app_state?id=eq.1"
key = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

k_list = [
    "K-027", "K-142", "K-163", "K-170", "K-193", "K-194", "K-207", "K-210", 
    "K-215", "K-218", "K-222", "K-223", "K-232", "K-235", "K-237", "K-240", 
    "K-244", "K-246", "K-247"
]

kv_list = [
    "KV-013", "KV-023", "KV-026", "KV-073", "KV-076", "KV-079", "KV-093", "KV-098", 
    "KV-114", "KV-131", "KV-141", "KV-142", "KV-143", "KV-145", "KV-154", "KV-158", 
    "KV-160", "KV-162", "KV-167", "KV-169", "KV-170", "KV-172", "KV-174", "KV-175", 
    "KV-177", "KV-178", "KV-180", "KV-187", "KV-193", "KV-194", "KV-200", "KV-201", 
    "KV-204", "KV-208", "KV-210", "KV-211", "KV-212", "KV-214", "KV-215", "KV-218", 
    "KV-219", "KV-221", "KV-222", "KV-224", "KV-227", "KV-228", "KV-229"
]

req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as res:
    data = json.loads(res.read().decode())
    current = data[0]
    usuarios_db = current.get("usuarios", {})
    
    # 1. Remove the old generic fake drivers
    keys_to_delete = [k for k in usuarios_db.keys() if k.endswith("@test.com")]
    for k in keys_to_delete:
        del usuarios_db[k]
        
    # 2. Add the real K vehicles (capacity 4)
    for code in k_list:
        email = f"{code.lower()}@test.com"
        usuarios_db[email] = {
            "nombre": f"Conductor {code}",
            "email": email,
            "password": hash_password("123456"),
            "rol": "Conductor",
            "estado": "Aprobado",
            "vehiculo": code,
            "capacidad": 4,
            "zona": "Norte"
        }

    # 3. Add the real KV vehicles (capacity 15 default for Vans)
    for code in kv_list:
        email = f"{code.lower()}@test.com"
        usuarios_db[email] = {
            "nombre": f"Conductor {code}",
            "email": email,
            "password": hash_password("123456"),
            "rol": "Conductor",
            "estado": "Aprobado",
            "vehiculo": code,
            "capacidad": 15,
            "zona": "Norte"
        }

    # Save back to Supabase
    payload = {"usuarios": usuarios_db}
    req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
    with urllib.request.urlopen(req_patch) as patch_res:
        print("Updated realistic fleet, status:", patch_res.status)
