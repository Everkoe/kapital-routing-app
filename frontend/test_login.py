import sys
import os
import asyncio

# Add frontend dir to sys.path
sys.path.append(os.path.abspath('.'))

from api.index import reload_db, usuarios_db

async def run():
    await reload_db()
    admin = usuarios_db.get('admin@kapital.com')
    if admin:
        print(f"Admin found! Password: {admin.get('password')}")
    else:
        print("Admin NOT found!")
    
    cond = usuarios_db.get('74538840')
    if cond:
        print(f"Cond found! Password: {cond.get('password')}")
    else:
        print("Conductor 74538840 NOT found!")

asyncio.run(run())
