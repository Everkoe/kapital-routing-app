import httpx, os, asyncio
async def f():
    token = os.environ.get('JSON_PE_TOKEN', '0cea1f04743e822b1605856b5ca5e1c3912f5bcb228e661aa8878bc8da36')
    try:
        res = await httpx.AsyncClient(timeout=30.0).post('https://api.json.pe/api/licencia', headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}, json={'dni':'74538840'})
        print(res.text)
    except Exception as e:
        print(e)
asyncio.run(f())
