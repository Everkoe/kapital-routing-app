# api/index.py
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Dict, Any, List

# --- Estado Global en Memoria ---
rutas_estado_actual: List[Dict[str, Any]] = []
usuarios_db: Dict[str, Dict[str, Any]] = {}

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

# --- Modelos de Datos Pydantic ---
class UsuarioRegistro(BaseModel):
    email: EmailStr
    password: str
    nombre: str
    rol: str

class UsuarioLogin(BaseModel):
    email: EmailStr
    password: str

class EmergencyRequest(BaseModel):
    conductor_id: str
    tipo_emergencia: str
    horario: str

# --- Endpoints de Autenticación ---
@app.post("/auth/register")
async def register_user(usuario: UsuarioRegistro):
    if usuario.email in usuarios_db:
        raise HTTPException(status_code=400, detail="El correo electrónico ya está registrado.")
    
    usuarios_db[usuario.email] = {
        "email": usuario.email,
        "password": usuario.password,
        "nombre": usuario.nombre,
        "rol": usuario.rol
    }
    return {"message": "Usuario registrado exitosamente."}

@app.post("/auth/login")
async def login_user(usuario: UsuarioLogin):
    user_in_db = usuarios_db.get(usuario.email)
    if not user_in_db or user_in_db["password"] != usuario.password:
        raise HTTPException(status_code=401, detail="Credenciales inválidas.")
    
    return {
        "email": user_in_db["email"],
        "nombre": user_in_db["nombre"],
        "rol": user_in_db["rol"]
    }

# --- Lógica de Negocio y Endpoints de Rutas ---
conductores_db: Dict[str, Dict[str, Any]] = {
    "KAP-001": {"capacidad": 12}, "KAP-002": {"capacidad": 15}, "KAP-003": {"capacidad": 10},
    "KAP-004": {"capacidad": 12}, "KAP-005": {"capacidad": 15},
}

def get_micro_zona(direccion: str) -> str:
    direccion = direccion.lower()
    if "comas" in direccion: return "Comas 1" if "universitaria" in direccion else "Comas 2"
    if "callao" in direccion: return "Callao 1"
    if "surco" in direccion: return "Surco Sur"
    if "san miguel" in direccion: return "San Miguel Centro"
    return "Zona General"

@app.post("/assign-routes/")
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
                        ruta_existente = next((r for r in rutas_generadas if r["conductor"] == conductor_id and r["micro_zona"] == zona and r["horario"] == horario), None)
                        if ruta_existente:
                            ruta_existente["agentes"].extend([{"id": ag["ID Agente"], "direccion": ag["Dirección/Distrito"]} for ag in agentes_a_asignar])
                        else:
                            rutas_generadas.append({"conductor": conductor_id, "micro_zona": zona, "horario": horario, "agentes": [{"id": ag["ID Agente"], "direccion": ag["Dirección/Distrito"]} for ag in agentes_a_asignar]})
                        disponibilidad_conductores[conductor_id].append(horario)
                        agentes_grupo = agentes_grupo[len(agentes_a_asignar):]
                        conductor_encontrado = True
                        break
                if not conductor_encontrado:
                    rutas_generadas.append({"conductor": "SIN ASIGNAR", "micro_zona": zona, "horario": horario, "agentes": [{"id": ag["ID Agente"], "direccion": ag["Dirección/Distrito"]} for ag in agentes_grupo]})
                    break
        rutas_estado_actual = rutas_generadas
        return rutas_estado_actual
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en el procesamiento del backend: {str(e)}")

@app.post("/emergency-reassign/")
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
        return {"message": f"Baja Total procesada. Todas las rutas de {request.conductor_id} han sido reasignadas.", "rutas_actualizadas": rutas_estado_actual, "rescatista_id": rescatista_id or "N/A"}
    else:
        ruta_afectada_idx, ruta_afectada = next(((i, r) for i, r in enumerate(rutas_estado_actual) if r["conductor"] == request.conductor_id and r["horario"] == request.horario), (None, None))
        if ruta_afectada is None: raise HTTPException(status_code=404, detail=f"No se encontró la ruta para '{request.conductor_id}' a las {request.horario}.")
        rescatista = next((r for r in rutas_estado_actual if r["micro_zona"] == ruta_afectada["micro_zona"] and r["horario"] == ruta_afectada["horario"] and r["conductor"] != request.conductor_id), None)
        if rescatista is None: raise HTTPException(status_code=400, detail=f"No se encontró un rescatista en la zona '{ruta_afectada['micro_zona']}' para el horario de las {request.horario}.")
        rescatista["agentes"].extend(ruta_afectada["agentes"])
        del rutas_estado_actual[ruta_afectada_idx]
        return {"message": f"Falla Temporal procesada. La ruta de las {request.horario} de {request.conductor_id} ha sido reasignada a {rescatista['conductor']}.", "rutas_actualizadas": rutas_estado_actual, "rescatista_id": rescatista["conductor"]}
