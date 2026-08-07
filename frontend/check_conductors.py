import urllib.request
import json

url = "https://kapital-routing-app.vercel.app/api/routes/summary"
req = urllib.request.Request(url)
try:
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode())
        print(f"Total routes: {len(data)}")
        if len(data) > 0:
            conductors = set(r.get("conductor") for r in data)
            print(f"Conductors found: {conductors}")
except Exception as e:
    print("Error:", e)
