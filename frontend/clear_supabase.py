import json
import urllib.request

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
            print("Failed to get DB or empty array")
            exit(1)
            
        current = data[0]
        lock = current.get("lock", {})
        
        print("Old summary len:", len(lock.get("routes_summary", [])))
        print("Old rutas len:", len(lock.get("rutas", [])))
        
        # Clear mock data
        lock["routes_summary"] = []
        lock["rutas"] = []
        
        req_patch = urllib.request.Request(url, data=json.dumps({"lock": lock}).encode(), headers=headers, method="PATCH")
        with urllib.request.urlopen(req_patch) as patch_res:
            print("DB Cleared successfully. Status:", patch_res.status)
except Exception as e:
    print("Error:", e)
