import httpx
import asyncio
async def main():
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get('http://127.0.0.1:8000/api/routes/summary')
            print("Summary:", res.json())
            res2 = await client.get('http://127.0.0.1:8000/api/routes')
            print("Full Routes len:", len(res2.json()))
            
            # Print first route's agents length
            if len(res2.json()) > 0:
                print("Agents in route 1:", len(res2.json()[0].get("agentes", [])))
    except Exception as e:
        print("Error:", e)

asyncio.run(main())
