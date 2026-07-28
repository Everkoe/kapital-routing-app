# api/index.py
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Dict, Any, List, Optional

import httpx
import json
import random
# Configuración de Gemini AI Copilot (Usando REST puro para ahorrar espacio en Vercel)
import os
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Eres 'Kapital Copilot', el asistente virtual experto en logística de la aplicación B2B 'Kapital Routing'.
Tu objetivo es ayudar al usuario (el administrador o despachador logístico) a utilizar la plataforma.
Reglas del negocio que debes conocer:
- Las unidades (Vans o Sprinters) tienen una capacidad MÁXIMA de 15 pasajeros.
- Los usuarios pueden subir un Excel con la base de datos de los pasajeros a enrutar (ID, Nombres, Turno, Dirección, Zona).
- La app tiene una función de "Arrastrar y Soltar" (Drag and Drop) para reasignar pasajeros entre unidades.
- La app muestra gráficos de "Carga por Unidad" y "Eficiencia Global".
Responde siempre de manera concisa, profesional, y directa (sin introducciones robóticas). Usa viñetas si es necesario."""

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
conductores_db: Dict[str, Dict[str, Any]] = {}
historial_rutas: List[Dict[str, Any]] = []

def load_db():
    global rutas_estado_actual, usuarios_db, conductores_db, historial_rutas
    try:
        with httpx.Client() as client:
            res = client.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
            if res.status_code == 200 and len(res.json()) > 0:
                data = res.json()[0]
                usuarios_db = data.get("usuarios", {})
                rutas_estado_actual = data.get("rutas", [])
                historial_rutas = data.get("historial", [])
                flota = data.get("flota", {})
                if not flota:
                    flota = {
                        "KAP-001": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Juan Pérez", "soat": "2027-01-15", "revision": "2027-02-10", "atu": "2027-03-20", "licencia": "2028-05-10"},
                        "KAP-002": {"capacidad": 15, "tipo": "Sprinter", "chofer": "Carlos Gómez", "soat": "2026-08-05", "revision": "2026-11-20", "atu": "2026-12-01", "licencia": "2027-04-15"},
                        "KAP-003": {"capacidad": 10, "tipo": "Van", "chofer": "Luis Ramírez", "soat": "2027-05-10", "revision": "2026-09-15", "atu": "2026-10-30", "licencia": "2029-01-20"},
                        "KAP-004": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Miguel Torres", "soat": "2026-10-01", "revision": "2027-01-05", "atu": "2026-06-15", "licencia": "2028-11-10"}
                    }
                conductores_db = flota
    except Exception as e:
        print(f"Error loading from Supabase: {e}")

load_db()

async def persist():
    try:
        payload = {
            "id": 1,
            "usuarios": usuarios_db,
            "rutas": rutas_estado_actual,
            "historial": historial_rutas,
            "flota": conductores_db
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
    empresa_id: Optional[str] = None

class UsuarioLogin(BaseModel):
    email: EmailStr
    password: str

class EmergencyRequest(BaseModel):
    conductor_id: str
    tipo_emergencia: str
    horario: str

class FlotaRegistro(BaseModel):
    placa: str

class ChatMessagePayload(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessagePayload] = []
    capacidad: int
    tipo: str
    chofer: str
    soat: str
    revision: str
    atu: str
    licencia: str

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
        "unidad_id": usuario.unidad_id,
        "empresa_id": usuario.empresa_id
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
        "empresa_id": user_in_db.get("empresa_id"),
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
                                "lng": lng,
                                "empresa": random.choice(["GLOBO_AZUL", "BANCO_ANDINO"])
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
                        agentes_format.append({"id": ag["ID Agente"], "direccion": ag["Dirección/Distrito"], "lat": lat, "lng": lng, "empresa": random.choice(["GLOBO_AZUL", "BANCO_ANDINO"])})
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
            return {"message": "Estado del pasajero actualizado exitosamente."}
    raise HTTPException(status_code=404, detail="Ruta o agente no encontrado")

@app.get("/api/cliente/rutas/{empresa_id}")
async def get_rutas_cliente(empresa_id: str):
    global rutas_estado_actual
    try:
        rutas_filtradas = []
        for ruta in rutas_estado_actual:
            agentes_empresa = [ag for ag in ruta.get("agentes", []) if ag.get("empresa") == empresa_id.upper()]
            if agentes_empresa:
                ruta_copy = ruta.copy()
                ruta_copy["agentes"] = agentes_empresa
                rutas_filtradas.append(ruta_copy)
        return rutas_filtradas
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener rutas del cliente: {str(e)}")

@app.post("/api/flota")
async def add_flota(flota: FlotaRegistro):
    global conductores_db
    conductores_db[flota.placa] = {
        "capacidad": flota.capacidad,
        "tipo": flota.tipo,
        "chofer": flota.chofer,
        "soat": flota.soat,
        "revision": flota.revision,
        "atu": flota.atu,
        "licencia": flota.licencia
    }
    await persist()
    return {"message": "Unidad agregada exitosamente", "flota": conductores_db}

@app.put("/api/flota/{placa}")
async def update_flota(placa: str, flota: FlotaRegistro):
    global conductores_db
    if placa not in conductores_db:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    conductores_db[placa] = {
        "capacidad": flota.capacidad,
        "tipo": flota.tipo,
        "chofer": flota.chofer,
        "soat": flota.soat,
        "revision": flota.revision,
        "atu": flota.atu,
        "licencia": flota.licencia
    }
    await persist()
    return {"message": "Unidad actualizada", "flota": conductores_db}

@app.delete("/api/flota/{placa}")
async def delete_flota(placa: str):
    global conductores_db
    if placa in conductores_db:
        del conductores_db[placa]
        await persist()
        return {"message": "Unidad eliminada", "flota": conductores_db}
    raise HTTPException(status_code=404, detail="Unidad no encontrada")

@app.post("/api/clear-routes")
async def clear_routes():
    global rutas_estado_actual, historial_rutas
    from datetime import datetime
    if rutas_estado_actual:
        fecha_hoy = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        registro_historial = {
            "fecha": fecha_hoy,
            "rutas": rutas_estado_actual
        }
        historial_rutas.append(registro_historial)
    rutas_estado_actual = []
    await persist()
    return {"message": "Rutas archivadas y tablero limpiado"}

@app.get("/api/reportes")
async def get_reportes():
    global historial_rutas
    return {"historial": historial_rutas}

# --- AI Copilot Chat Route (REST API) ---
@app.post("/api/chat")
async def chat_with_copilot(req: ChatRequest):
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={GEMINI_API_KEY}"
        
        contents = []
        for msg in req.history:
            role = 'model' if msg.role == 'assistant' else 'user'
            contents.append({
                "role": role,
                "parts": [{"text": msg.text}]
            })
            
        # Add current user message with system prompt if no history
        user_text = req.message
        if not req.history:
            user_text = f"Instrucciones internas: {SYSTEM_PROMPT}\n\nPregunta del usuario: {req.message}"
            
        contents.append({
            "role": "user",
            "parts": [{"text": user_text}]
        })
        
        payload = {
            "contents": contents
        }
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=30.0)
            
        if resp.status_code == 200:
            data = resp.json()
            reply = data["candidates"][0]["content"]["parts"][0]["text"]
            return {"response": reply}
        else:
            print("Gemini API error:", resp.text)
            raise Exception("API status no 200")
            
    except Exception as e:
        print(f"Error in Gemini chat: {e}")
        raise HTTPException(status_code=500, detail="Error comunicándose con el asistente de Inteligencia Artificial.")
