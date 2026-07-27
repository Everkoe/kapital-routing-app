# api/index.py
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Dict, Any, List, Optional

import httpx
import json
import random

SUPABASE_URL = "https://pkyezkdssyrbwxhldsay.supabase.co/rest/v1"
SUPABASE_KEY = "sb_publishable_EAqFBKHuDkoN7WqxeoGcMA_Iv0qEM0o"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

# --- Estado Global en Memoria ---
rutas_estado_actual: List[Dict[str, Any]] = []
usuarios_db: Dict[str, Dict[str, Any]] = {}

def load_db():
    global rutas_estado_actual, usuarios_db
    try:
        with httpx.Client() as client:
            res = client.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
            if res.status_code == 200 and len(res.json()) > 0:
                data = res.json()[0]
                usuarios_db = data.get("usuarios", {})
                rutas_estado_actual = data.get("rutas", [])
    except Exception as e:
        print(f"Error loading from Supabase: {e}")

load_db()

async def persist():
    try:
        payload = {
            "id": 1,
            "usuarios": usuarios_db,
            "rutas": rutas_estado_actual
        }
        async with httpx.AsyncClient() as client:
            await client.patch(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS, json=payload)
    except Exception as e:
        print(f"Error saving to Supabase: {e}")

# --- Metadata y Configuración de la App ---
description = "Backend para Kapital Routing, con autenticación y lógica de negocio avanzada."
app = FastAPI(title="Kapital Routing API (B2B)", description=description, version="5.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Ruta de Prueba ---
@app.get("/api")
def read_root():
    return {"status": "Kapital Routing API is running!"}

# --- Modelos de Datos Pydantic ---
class UsuarioRegistro(BaseModel):
    email: EmailStr
    password: str
    nombre: str
    rol: str
    unidad_id: Optional[str] = None

class UsuarioLogin(BaseModel):
    email: EmailStr
    password: str

class EmergencyRequest(BaseModel):
    conductor_id: str
    tipo_emergencia: str
    horario: str

class UsuarioUpdate(BaseModel):
    email: EmailStr
    nombre: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None
    avatar: Optional[str] = None
    unidad_id: Optional[str] = None

# --- Endpoints de Autenticación ---
@app.post("/api/auth/register")
async def register_user(usuario: UsuarioRegistro):
    if usuario.email in usuarios_db:
        raise HTTPException(status_code=400, detail="El correo electrónico ya está registrado.")
    
    usuarios_db[usuario.email] = {
        "email": usuario.email,
        "password": usuario.password,
        "nombre": usuario.nombre,
        "rol": usuario.rol,
        "unidad_id": usuario.unidad_id
    }
    await persist()
    return {"message": "Usuario registrado exitosamente."}

@app.post("/api/auth/login")
async def login_user(usuario: UsuarioLogin):
    user_in_db = usuarios_db.get(usuario.email)
    if not user_in_db or user_in_db["password"] != usuario.password:
        raise HTTPException(status_code=401, detail="Credenciales inválidas.")
    
    return {
        "email": user_in_db["email"],
        "nombre": user_in_db["nombre"],
        "rol": user_in_db["rol"],
        "unidad_id": user_in_db.get("unidad_id"),
        "avatar": user_in_db.get("avatar")
    }

@app.put("/api/user/profile")
async def update_profile(update_data: UsuarioUpdate):
    user_in_db = usuarios_db.get(update_data.email)
    if not user_in_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    if update_data.new_password:
        if user_in_db.get("password") != update_data.current_password:
            raise HTTPException(status_code=401, detail="Contraseña actual incorrecta.")
        user_in_db["password"] = update_data.new_password
        
    if update_data.nombre:
        user_in_db["nombre"] = update_data.nombre
        
    if update_data.avatar:
        user_in_db["avatar"] = update_data.avatar
        
    if update_data.unidad_id is not None:
        user_in_db["unidad_id"] = update_data.unidad_id
        
    await persist()
    return {
        "email": user_in_db["email"],
        "nombre": user_in_db["nombre"],
        "rol": user_in_db["rol"],
        "unidad_id": user_in_db.get("unidad_id"),
        "avatar": user_in_db.get("avatar")
    }

# --- Lógica de Negocio y Endpoints de Rutas ---
conductores_db: Dict[str, Dict[str, Any]] = {
    "KAP-001": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Juan Pérez", "soat": "2027-01-15", "revision": "2027-02-10", "atu": "2027-03-20", "licencia": "2028-05-10"},
    "KAP-002": {"capacidad": 15, "tipo": "Sprinter", "chofer": "Carlos Gómez", "soat": "2026-08-05", "revision": "2026-11-20", "atu": "2026-12-01", "licencia": "2027-04-15"},
    "KAP-003": {"capacidad": 10, "tipo": "Van", "chofer": "Luis Ramírez", "soat": "2027-05-10", "revision": "2026-09-15", "atu": "2026-10-30", "licencia": "2029-01-20"},
    "KAP-004": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Miguel Torres", "soat": "2026-10-01", "revision": "2027-01-05", "atu": "2026-06-15", "licencia": "2028-11-10"},
    "KAP-005": {"capacidad": 15, "tipo": "Sprinter", "chofer": "José Castro", "soat": "2026-12-15", "revision": "2027-03-10", "atu": "2027-04-05", "licencia": "2026-07-20"},
    "KAP-006": {"capacidad": 1, "tipo": "Moto (Courier)", "chofer": "Andrés Silva", "soat": "2027-06-01", "revision": "2027-06-01", "atu": "2027-06-01", "licencia": "2029-10-15"},
    "KAP-007": {"capacidad": 4, "tipo": "Auto (Remisse)", "chofer": "Roberto Díaz", "soat": "2027-08-20", "revision": "2027-09-15", "atu": "2027-10-10", "licencia": "2030-02-28"},
}

@app.get("/api/flota")
async def get_flota_status():
    # Convertimos el diccionario a una lista de objetos para el frontend
    flota_list = []
    for placa, data in conductores_db.items():
        flota_list.append({"placa": placa, **data})
    return {"flota": flota_list}

def get_micro_zona(direccion: str) -> str:
    direccion = direccion.lower()
    if "comas" in direccion: return "Comas 1" if "universitaria" in direccion else "Comas 2"
    if "callao" in direccion: return "Callao 1"
    if "surco" in direccion: return "Surco Sur"
    if "san miguel" in direccion: return "San Miguel Centro"
    return "Zona General"

def get_coordenadas_simuladas(zona: str):
    base_lat = -12.0464
    base_lng = -77.0428
    if "Comas" in zona:
        base_lat, base_lng = -11.9300, -77.0460
    elif "Callao" in zona:
        base_lat, base_lng = -12.0500, -77.1200
    elif "Surco" in zona:
        base_lat, base_lng = -12.1300, -76.9900
    elif "San Miguel" in zona:
        base_lat, base_lng = -12.0800, -77.0800
        
    # Reducimos el offset de 0.02 a 0.005 para evitar que caigan al mar (San Miguel/Callao)
    return base_lat + random.uniform(-0.005, 0.005), base_lng + random.uniform(-0.005, 0.005)

@app.post("/api/assign-routes/")
async def assign_routes(file: UploadFile = File(...)):
    global rutas_estado_actual
    try:
        disponibilidad_conductores = {conductor_id: [] for conductor_id in conductores_db.keys()}
        df = pd.read_excel(file.file)
        df["Micro-Zona"] = df["Dirección/Distrito"].apply(get_micro_zona)
        rutas_generadas = []
        for (zona, horario), grupo in df.groupby(["Micro-Zona", "Horario Turno"]):
            agentes_grupo = grupo.to_dict('records')
            while agentes_grupo:
                conductor_encontrado = False
                for conductor_id, horarios_ocupados in disponibilidad_conductores.items():
                    capacidad_actual = sum(len(r['agentes']) for r in rutas_generadas if r['conductor'] == conductor_id)
                    if horario not in horarios_ocupados and capacidad_actual < conductores_db[conductor_id]["capacidad"]:
                        espacio_disponible = conductores_db[conductor_id]["capacidad"] - capacidad_actual
                        agentes_a_asignar = agentes_grupo[:espacio_disponible]
                        
                        agentes_format = []
                        for ag in agentes_a_asignar:
                            lat, lng = get_coordenadas_simuladas(zona)
                            agentes_format.append({
                                "id": ag["ID Agente"], 
                                "direccion": ag["Dirección/Distrito"],
                                "lat": lat,
                                "lng": lng
                            })

                        ruta_existente = next((r for r in rutas_generadas if r["conductor"] == conductor_id and r["micro_zona"] == zona and r["horario"] == horario), None)
                        if ruta_existente:
                            ruta_existente["agentes"].extend(agentes_format)
                        else:
                            rutas_generadas.append({"conductor": conductor_id, "micro_zona": zona, "horario": horario, "agentes": agentes_format})
                        disponibilidad_conductores[conductor_id].append(horario)
                        agentes_grupo = agentes_grupo[len(agentes_a_asignar):]
                        conductor_encontrado = True
                        break
                if not conductor_encontrado:
                    agentes_format = []
                    for ag in agentes_grupo:
                        lat, lng = get_coordenadas_simuladas(zona)
                        agentes_format.append({"id": ag["ID Agente"], "direccion": ag["Dirección/Distrito"], "lat": lat, "lng": lng})
                    rutas_generadas.append({"conductor": "SIN ASIGNAR", "micro_zona": zona, "horario": horario, "agentes": agentes_format})
                    break
        rutas_estado_actual = rutas_generadas
        await persist()
        return rutas_estado_actual
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en el procesamiento del backend: {str(e)}")

@app.post("/api/emergency-reassign/")
async def emergency_reassign(request: EmergencyRequest):
    global rutas_estado_actual
    if request.horario == "Todos los turnos" or request.tipo_emergencia == "Baja Total (Siniestro)":
        rutas_afectadas = [r for r in rutas_estado_actual if r["conductor"] == request.conductor_id]
        if not rutas_afectadas: raise HTTPException(status_code=404, detail=f"Conductor '{request.conductor_id}' no encontrado.")
        rescatista_id = None
        for ruta in rutas_afectadas:
            rescatista = next((r for r in rutas_estado_actual if r["micro_zona"] == ruta["micro_zona"] and r["horario"] == ruta["horario"] and r["conductor"] != request.conductor_id), None)
            if rescatista:
                rescatista["agentes"].extend(ruta["agentes"])
                rescatista_id = rescatista["conductor"]
        rutas_estado_actual = [r for r in rutas_estado_actual if r["conductor"] != request.conductor_id]
        await persist()
        return {"message": f"Baja Total procesada. Todas las rutas de {request.conductor_id} han sido reasignadas.", "rutas_actualizadas": rutas_estado_actual, "rescatista_id": rescatista_id or "N/A"}
    else:
        ruta_afectada_idx, ruta_afectada = next(((i, r) for i, r in enumerate(rutas_estado_actual) if r["conductor"] == request.conductor_id and r["horario"] == request.horario), (None, None))
        if ruta_afectada is None: raise HTTPException(status_code=404, detail=f"No se encontró la ruta para '{request.conductor_id}' a las {request.horario}.")
        rescatista = next((r for r in rutas_estado_actual if r["micro_zona"] == ruta_afectada["micro_zona"] and r["horario"] == ruta_afectada["horario"] and r["conductor"] != request.conductor_id), None)
        if rescatista is None: raise HTTPException(status_code=400, detail=f"No se encontró un rescatista en la zona '{ruta_afectada['micro_zona']}' para el horario de las {request.horario}.")
        rescatista["agentes"].extend(ruta_afectada["agentes"])
        del rutas_estado_actual[ruta_afectada_idx]
        await persist()
        return {"message": f"Falla Temporal procesada. La ruta de las {request.horario} de {request.conductor_id} ha sido reasignada a {rescatista['conductor']}.", "rutas_actualizadas": rutas_estado_actual, "rescatista_id": rescatista["conductor"]}

class EstadoPasajeroUpdate(BaseModel):
    conductor_id: str
    horario: str
    agente_id: str
    estado: str # "Recogido" u otro

@app.get("/api/mis-rutas/{conductor_id}")
async def mis_rutas(conductor_id: str):
    mis_rutas_asignadas = [r for r in rutas_estado_actual if r["conductor"] == conductor_id]
    return mis_rutas_asignadas

@app.post("/api/actualizar-pasajero")
async def actualizar_pasajero(data: EstadoPasajeroUpdate):
    ruta = next((r for r in rutas_estado_actual if r["conductor"] == data.conductor_id and r["horario"] == data.horario), None)
    if ruta:
        agente = next((a for a in ruta["agentes"] if a["id"] == data.agente_id), None)
        if agente:
            agente["estado"] = data.estado
            await persist()
            return {"message": "Estado actualizado"}
    raise HTTPException(status_code=404, detail="Ruta o agente no encontrado")
