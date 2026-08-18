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

payload = {"rutas": []}

req_patch = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="PATCH")
try:
    with urllib.request.urlopen(req_patch) as patch_res:
        print("Rutas cleared successfully. Status:", patch_res.status)
except urllib.error.HTTPError as e:
    print("Patch HTTPError:", e.code, e.read().decode())
