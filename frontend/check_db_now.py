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
    if "__routes_summary__" in usuarios_db:
        summary = usuarios_db["__routes_summary__"]
        print(f"Summary exists! len: {len(summary)}")
        if len(summary) > 0:
            print("First item:", summary[0])
    else:
        print("Summary DOES NOT EXIST in Supabase")
