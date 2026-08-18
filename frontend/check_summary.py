import json
import urllib.request
url = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1/app_state?id=eq.1"
key = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
headers = {"apikey": key, "Authorization": f"Bearer {key}"}
req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req) as res:
    data = json.loads(res.read().decode())
    if data:
        u = data[0].get("usuarios", {})
        print("__routes_summary__ in usuarios:", "__routes_summary__" in u)
        if "__routes_summary__" in u:
            print("len:", len(u["__routes_summary__"]))
