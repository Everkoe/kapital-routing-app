import urllib.request
url = "https://kapital-routing-app.vercel.app/api/routes/summary"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as res:
    data = res.read().decode()
    print("Summary length from Vercel API:", len(data))
    print(data[:200])
