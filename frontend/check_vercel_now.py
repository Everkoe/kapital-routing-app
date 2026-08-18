import json
import urllib.request
url = "https://kapital-routing-app.vercel.app/api/routes/summary"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as res:
    data = json.loads(res.read().decode())
    print("Summary length from Vercel API:", len(data))
    if len(data) > 0:
        print("First item:", data[0])
