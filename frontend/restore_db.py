import json
import asyncio
import os
import sys

sys.path.append(os.path.abspath('.'))

from api.index import SUPABASE_URL, HEADERS, reload_db, usuarios_db, routes_summary, historial_rutas, board_lock, conductores_db, notifications_db, rutas_estado_actual
import httpx

async def restore_backup():
    await reload_db() # loads the empty or corrupted state
    
    with open('api/database.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        backup_users = data.get('usuarios_db', {})
    
    # Let's ensure admin exists, just in case
    if 'admin@kapital.com' not in backup_users:
        backup_users['admin@kapital.com'] = {
            "identifier": "admin@kapital.com",
            "email": "admin@kapital.com",
            "password": "admin",
            "nombre": "Administrador",
            "rol": "Administrador",
            "empresa_id": "ADMIN"
        }
    if '74538840' not in backup_users:
        backup_users['74538840'] = {
            "identifier": "74538840",
            "email": "conductor@kapital.com",
            "dni": "74538840",
            "password": "conductor",
            "nombre": "Conductor Prueba",
            "rol": "Conductor",
            "estado": "Activo",
            "perfil_conductor": {
                "placa": "AK123"
            }
        }
        
    print(f"Restoring {len(backup_users)} users from backup/mock...")
    
    payload = {
        "id": 1,
        "usuarios": {
            **backup_users,
            "__routes_summary__": routes_summary,
            "__historial_rutas__": historial_rutas,
            "__lock__": board_lock,
            "__flota__": conductores_db,
            "__notifications__": notifications_db
        },
        "rutas": rutas_estado_actual,
    }
    hdrs = {**HEADERS, "Prefer": "return=minimal"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.patch(f"{SUPABASE_URL}/app_state?id=eq.1", headers=hdrs, json=payload)
        if res.status_code in [200, 204]:
            print("Successfully restored to Supabase.")
        else:
            print(f"Failed to restore: {res.status_code} - {res.text}")

asyncio.run(restore_backup())
