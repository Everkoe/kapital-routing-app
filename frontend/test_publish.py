import json
import urllib.request

url = "https://kapital-routing-app.vercel.app/api/routes/publish"
req = urllib.request.Request(url, data=json.dumps([]).encode(), headers={"Content-Type": "application/json"}, method="POST")
with urllib.request.urlopen(req) as res:
    print(res.read().decode())
