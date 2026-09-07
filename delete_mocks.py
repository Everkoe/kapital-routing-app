import requests
import json

SUPABASE_URL = "https://mbfmrtntidngzefqjuzq.supabase.co/rest/v1"
HEADERS = {
    "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iZm1ydG50aWRuZ3plZnFqdXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyNTY4NDksImV4cCI6MjA0ODgzMjg0OX0.X-d23D19c6sL0c8z80Ua-j4V65jV8P2m_r0f-9R2-mQ",
    "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iZm1ydG50aWRuZ3plZnFqdXpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjMyNTY4NDksImV4cCI6MjA0ODgzMjg0OX0.X-d23D19c6sL0c8z80Ua-j4V65jV8P2m_r0f-9R2-mQ",
    "Content-Type": "application/json"
}

def clean_mocks():
    print("Conectando con Supabase para limpiar mocks...")
    res = requests.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
    if res.status_code != 200 or not res.json():
        print("Error obteniendo datos")
        return
        
    data = res.json()[0]
    usuarios_db = data.get("usuarios", {})
    
    # 1. Limpiar flota mock (KAP-...)
    flota = usuarios_db.get("__flota__", {})
    keys_to_delete = [k for k in flota.keys() if "KAP-" in k]
    for k in keys_to_delete:
        print(f"Eliminando flota mock: {k}")
        del flota[k]
        
    # 2. Limpiar usuarios mock
    users_to_delete = [k for k in usuarios_db.keys() if "KAP-" in k or "conductor" in k.lower() or "TELEPERFORMANCE" in k]
    for k in users_to_delete:
        if k != "__flota__" and k != "__routes_summary__" and k != "__historial_rutas__" and k != "__lock__":
            print(f"Eliminando usuario mock: {k}")
            del usuarios_db[k]
            
    payload = {"usuarios": usuarios_db}
    
    update_res = requests.patch(
        f"{SUPABASE_URL}/app_state?id=eq.1", 
        headers=HEADERS, 
        json=payload
    )
    if update_res.status_code in [200, 204]:
        print("Mocks eliminados correctamente.")
    else:
        print("Error al guardar en Supabase", update_res.text)

if __name__ == "__main__":
    clean_mocks()
