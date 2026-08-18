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
    
    # Create 97 dummy items
    summary = []
    for i in range(97):
        summary.append({
            "conductor": f"Test {i}",
            "micro_zona": "Zona",
            "horario": "08:00",
            "count": 15
        })
    usuarios_db["__routes_summary__"] = summary
    
    payload = {"usuarios": usuarios_db}
    req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req_patch) as patch_res:
            print("PATCH status:", patch_res.status)
    except Exception as e:
        print("PATCH Error:", e.code, e.read().decode())
