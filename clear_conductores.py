import requests
import json

SUPABASE_URL = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1"
SUPABASE_KEY = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

def clear_db():
    print("Conectando con Supabase para limpiar todos los conductores y la flota...")
    res = requests.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
    if res.status_code != 200 or not res.json():
        print("Error obteniendo datos")
        return
        
    data = res.json()[0]
    usuarios_db = data.get("usuarios", {})
    
    # 1. Vaciar flota
    usuarios_db["__flota__"] = {}
    print("Flota vaciada.")
        
    # 2. Borrar todos los usuarios cuyo rol sea 'Conductor'
    users_to_delete = []
    for k, v in usuarios_db.items():
        if isinstance(v, dict) and v.get("rol") == "Conductor":
            users_to_delete.append(k)
            
    for k in users_to_delete:
        print(f"Eliminando conductor: {k}")
        del usuarios_db[k]
            
    payload = {"usuarios": usuarios_db}
    
    update_res = requests.patch(
        f"{SUPABASE_URL}/app_state?id=eq.1", 
        headers=HEADERS, 
        json=payload
    )
    if update_res.status_code in [200, 204]:
        print("¡Todos los conductores y la flota han sido eliminados correctamente! Base de datos lista para el nuevo Excel.")
    else:
        print("Error al guardar en Supabase", update_res.text)

if __name__ == "__main__":
    clear_db()
