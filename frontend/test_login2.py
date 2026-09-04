import sys
import os
import asyncio

# Add frontend dir to sys.path
sys.path.append(os.path.abspath('.'))

from api.index import reload_db, usuarios_db

async def run():
    await reload_db()
    print(f"Total users in DB: {len(usuarios_db)}")
    print(f"Keys: {list(usuarios_db.keys())[:20]}")

asyncio.run(run())
