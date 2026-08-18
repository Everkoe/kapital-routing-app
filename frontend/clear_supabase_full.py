import json
import urllib.request
import urllib.error

url = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1/app_state?id=eq.1"
key = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
    
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode())
        if not data:
            exit(1)
            
        current = data[0]
        lock = current.get("lock", {})
        lock["routes_summary"] = []
        lock["rutas"] = []
        
        payload = {
            "lock": lock,
            "rutas": '[]'
        }
        
        req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
        try:
            with urllib.request.urlopen(req_patch) as patch_res:
                print("DB Cleared successfully. Status:", patch_res.status)
        except urllib.error.HTTPError as e:
            print("Patch HTTPError:", e.code, e.read().decode())
except Exception as e:
    print("Error:", e)
