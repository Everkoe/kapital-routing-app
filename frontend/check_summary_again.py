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
    
    # Let's see if __routes_summary__ exists in Supabase right now
    if "__routes_summary__" in usuarios_db:
        print("Summary exists! len:", len(usuarios_db["__routes_summary__"]))
    else:
        print("Summary DOES NOT EXIST in Supabase")
