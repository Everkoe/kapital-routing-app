# api/index.py
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Body
import math
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Dict, Any, List, Optional

import httpx
import json
import random
import os
from datetime import datetime
import base64
from dotenv import load_dotenv

load_dotenv()



# Configuración de Gemini AI Copilot (Usando REST puro para ahorrar espacio en Vercel)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Eres 'Kapital Copilot', el asistente virtual experto en logística de la aplicación B2B 'Kapital Routing'.
Tu objetivo es ayudar al usuario (el Programador de rutas o despachador logístico) a utilizar la plataforma
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
board_lock: Dict[str, Any] = {}
routes_summary: List[Dict[str, Any]] = []  # Compact summary for GerentePortal
notifications_db: List[Dict[str, Any]] = [] # Real-time events

db_loaded = False

def _build_routes_summary(routes: list) -> list:
    """Build a compact route summary (no agent details) for GerentePortal."""
    return [
        {
            "conductor": r.get("conductor", "SIN ASIGNAR"),
            "micro_zona": r.get("micro_zona", ""),
            "horario": r.get("horario", ""),
            "count": len(r.get("agentes", [])),
        }
        for r in routes
    ]

async def ensure_db_loaded():
    global db_loaded, rutas_estado_actual, usuarios_db, conductores_db, historial_rutas, board_lock, routes_summary
    if db_loaded:
        return
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
            if res.status_code == 200 and len(res.json()) > 0:
                data = res.json()[0]
                usuarios_db = data.get("usuarios", {})
                routes_summary = usuarios_db.pop("__routes_summary__", [])
                rutas_estado_actual = data.get("rutas", [])
                historial_rutas = data.get("historial", [])
                board_lock = data.get("lock", {}) or {}
                flota = data.get("flota", {})
                if not flota:
                    flota = {
                        "KAP-001": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Juan Pérez", "soat": "2027-01-15", "revision": "2027-02-10", "atu": "2027-03-20", "licencia": "2028-05-10"},
                        "KAP-002": {"capacidad": 15, "tipo": "Sprinter", "chofer": "Carlos Gómez", "soat": "2026-08-05", "revision": "2026-11-20", "atu": "2026-12-01", "licencia": "2027-04-15"},
                        "KAP-003": {"capacidad": 10, "tipo": "Van", "chofer": "Luis Ramírez", "soat": "2027-05-10", "revision": "2026-09-15", "atu": "2026-10-30", "licencia": "2029-01-20"},
                        "KAP-004": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Miguel Torres", "soat": "2026-10-01", "revision": "2027-01-05", "atu": "2026-06-15", "licencia": "2028-11-10"}
                    }
                conductores_db = flota
                if "TELEPERFORMANCE" not in usuarios_db:
                    usuarios_db["TELEPERFORMANCE"] = {
                        "identifier": "TELEPERFORMANCE",
                        "password": "1234",
                        "nombre": "Cliente Teleperformance",
                        "rol": "Cliente",
                        "empresa_id": "TELEPERFORMANCE",
                        "estado": "Activo"
                    }

                db_loaded = True
    except Exception as e:
        print(f"Error loading from Supabase: {e}")


async def reload_db():
    global rutas_estado_actual, usuarios_db, conductores_db, historial_rutas, db_loaded, board_lock, routes_summary, notifications_db
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(f"{SUPABASE_URL}/app_state?id=eq.1", headers=HEADERS)
            if res.status_code == 200 and len(res.json()) > 0:
                data = res.json()[0]
                usuarios_db = data.get("usuarios", {})
                routes_summary = usuarios_db.pop("__routes_summary__", [])
                historial_rutas = usuarios_db.pop("__historial_rutas__", [])
                board_lock = usuarios_db.pop("__lock__", {})
                flota_db = usuarios_db.pop("__flota__", None)
                if flota_db is not None:
                    conductores_db = flota_db
                rutas_estado_actual = data.get("rutas", [])
                
                # Cargar notificaciones
                notifications_db = usuarios_db.pop("__notifications__", [])
                
                if "TELEPERFORMANCE" not in usuarios_db:
                    usuarios_db["TELEPERFORMANCE"] = {
                        "identifier": "TELEPERFORMANCE",
                        "password": "1234",
                        "nombre": "Cliente Teleperformance",
                        "rol": "Cliente",
                        "empresa_id": "TELEPERFORMANCE",
                        "estado": "Activo"
                    }
                
                db_loaded = True
    except Exception as e:
        print(f"Error loading from Supabase in reload: {e}")

async def upload_evidence_to_supabase(base64_str: str, filename: str) -> str:
    """Sube una imagen Base64 al bucket 'evidencias' de Supabase Storage."""
    try:
        if "," in base64_str:
            _, base64_str = base64_str.split(",", 1)
        file_data = base64.b64decode(base64_str)
        
        # SUPABASE_URL es "https://[...].supabase.co/rest/v1"
        storage_url = SUPABASE_URL.replace("/rest/v1", "") + f"/storage/v1/object/evidencias/{filename}"
        
        hdrs = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "image/jpeg"
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(storage_url, headers=hdrs, content=file_data)
            if res.status_code in [200, 201]:
                public_url = SUPABASE_URL.replace("/rest/v1", "") + f"/storage/v1/object/public/evidencias/{filename}"
                return public_url
            else:
                print(f"Supabase Storage Upload Failed! Status: {res.status_code}, Body: {res.text}")
                return None
    except Exception as e:
        print(f"Error en upload_evidence_to_supabase: {e}")
        return ""

async def persist():
    try:
        payload = {
            "id": 1,
            "usuarios": {
                **usuarios_db,
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
            if res.status_code not in [200, 204]:
                print(f"Supabase persist FAILED: {res.status_code} - {res.text[:200]}")
    except Exception as e:
        print(f"Error saving to Supabase: {e}")

async def persist_users_only():
    """Lightweight persist — only saves the usuarios dict. Use for user management actions."""
    try:
        payload = {
            "id": 1,
            "usuarios": {
                **usuarios_db,
                "__routes_summary__": routes_summary,
                "__historial_rutas__": historial_rutas,
                "__lock__": board_lock,
                "__flota__": conductores_db
            }
        }
        hdrs = {**HEADERS, "Prefer": "return=minimal"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.patch(f"{SUPABASE_URL}/app_state?id=eq.1", headers=hdrs, json=payload)
            if res.status_code not in [200, 204]:
                print(f"Supabase persist_users FAILED: {res.status_code} - {res.text[:200]}")
    except Exception as e:
        print(f"Error saving users to Supabase: {e}")

async def persist_routes_summary(summary: list):
    """Persist ONLY the compact routes summary inside the lock column.
    Very small payload (~30KB) — always succeeds even with 2000+ agents."""
    global board_lock, routes_summary
    routes_summary = summary
    board_lock["routes_summary"] = summary
    try:
        payload = {
            "id": 1, 
            "usuarios": {
                **usuarios_db,
                "__routes_summary__": routes_summary,
                "__historial_rutas__": historial_rutas,
                "__lock__": board_lock,
                "__flota__": conductores_db
            }
        }
        hdrs = {**HEADERS, "Prefer": "return=minimal"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.patch(f"{SUPABASE_URL}/app_state?id=eq.1", headers=hdrs, json=payload)
            if res.status_code not in [200, 204]:
                print(f"Supabase persist_routes_summary FAILED: {res.status_code} - {res.text[:200]}")
            else:
                print(f"Routes summary saved: {len(summary)} routes")
    except Exception as e:
        print(f"Error saving routes summary: {e}")

# --- Metadata y Configuración de la App ---
description = "Backend para Kapital Routing, con autenticación y lógica de negocio avanzada."
app = FastAPI(title="Kapital Routing Backend (JSON DB + Polling)", version="2.0")

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
    identifier: str
    password: str
    nombre: str
    rol: str
    telefono: Optional[str] = None
    unidad_id: Optional[str] = None
    empresa_id: Optional[str] = None
    avatar: Optional[str] = None

class UsuarioLogin(BaseModel):
    identifier: str
    password: str



class EmergencyRequest(BaseModel):
    conductor_id: str
    tipo_emergencia: str
    horario: str

class FlotaRegistro(BaseModel):
    placa: str
    capacidad: int
    tipo: str
    chofer: str
    soat: str
    revision: str
    atu: str
    licencia: str
    telefono: Optional[str] = None
    soat_doc: Optional[str] = None
    revision_doc: Optional[str] = None
    atu_doc: Optional[str] = None
    licencia_doc: Optional[str] = None

class ChatMessagePayload(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessagePayload] = []

class UsuarioUpdate(BaseModel):
    identifier: str
    nombre: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None
    avatar: Optional[str] = None
    fotoVehiculo: Optional[str] = None
    unidad_id: Optional[str] = None
    rol: Optional[str] = None

class DriverProfilePayload(BaseModel):
    email: str
    perfilData: dict

class BulkActionPayload(BaseModel):
    admin_email: str
    target_emails: List[str]
    action: str # "approve", "reject", "delete", "deactivate"

class DriverDocReviewPayload(BaseModel):
    admin_email: str
    conductor_email: str
    campo: str          # e.g. "dniScaneado", "licenciaConducir"
    estado: str         # "aprobado" | "rechazado"
    nota: Optional[str] = None

class DriverNotifyPayload(BaseModel):
    admin_email: str
    conductor_email: str
    mensaje: str

# --- Endpoints de Autenticación y Verificación ---

@app.get("/api/notifications")
async def get_notifications(last_id: int = 0):
    await reload_db()
    new_notifs = [n for n in notifications_db if n.get("id", 0) > last_id]
    return new_notifs

@app.post("/api/notifications")
async def add_notification(notif: dict):
    await reload_db()
    new_id = len(notifications_db) + 1
    new_notif = {
        "id": new_id,
        "title": notif.get("title", "Notificación"),
        "message": notif.get("message", ""),
        "type": notif.get("type", "info"),
        "timestamp": datetime.now().isoformat()
    }
    notifications_db.append(new_notif)
    
    # Keep only the last 50 notifications
    if len(notifications_db) > 50:
        notifications_db.pop(0)
        
    await persist_users_only()
    return new_notif



@app.post("/api/auth/register")
async def register_user(usuario: UsuarioRegistro):
    await reload_db()

    # Validaciones básicas para evitar 500
    if not usuario.identifier or not usuario.identifier.strip():
        raise HTTPException(status_code=400, detail="El identificador (DNI o Correo) no puede estar vacío.")
    if not usuario.nombre or not usuario.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío.")
    if not usuario.password or len(usuario.password) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")
    if usuario.rol == "Conductor" and (not usuario.unidad_id or not usuario.unidad_id.strip()):
        raise HTTPException(status_code=400, detail="Los conductores deben proporcionar un ID de unidad.")

    identifier_clean = usuario.identifier.strip()
    if identifier_clean in usuarios_db:
        raise HTTPException(status_code=400, detail="El usuario ya está registrado.")
    
    ROLES_VALIDOS = ["Programador de rutas", "Administración", "Conductor", "Gerente de Operaciones", "Cliente"]
    rol_solicitado = usuario.rol if usuario.rol in ROLES_VALIDOS else "Programador de rutas"
    
    # Si es el primer usuario, se aprueba automáticamente como Admin
    estado = "Activo" if len(usuarios_db) == 0 else "Pendiente"
    
    nuevo_usuario = {
        "identifier": identifier_clean,
        "email": identifier_clean if usuario.rol != 'Conductor' else None,
        "dni": identifier_clean if usuario.rol == 'Conductor' else None,
        "password": usuario.password,
        "nombre": usuario.nombre.strip(),
        "rol": "Administración" if len(usuarios_db) == 0 else rol_solicitado,
        "telefono": usuario.telefono,
        "unidad_id": usuario.unidad_id.strip() if usuario.unidad_id else None,
        "empresa_id": usuario.empresa_id,
        "avatar": usuario.avatar,
        "estado": estado
    }
    usuarios_db[identifier_clean] = nuevo_usuario
    
    if rol_solicitado == "Conductor" and usuario.unidad_id:
        if usuario.unidad_id not in conductores_db:
            conductores_db[usuario.unidad_id] = {
                "capacidad": 15, "tipo": "Sprinter", "chofer": usuario.nombre,
                "soat": "2027-01-01", "revision": "2027-01-01", "atu": "2027-01-01", "licencia": "2027-01-01"
            }
            
    # Add notification for new registration
    if rol_solicitado == "Conductor":
        notifications_db.append({
            "id": len(notifications_db) + 1,
            "title": "Nuevo Conductor",
            "message": f"{usuario.nombre} se ha registrado y está en lista de espera.",
            "type": "success",
            "timestamp": datetime.now().isoformat()
        })
            
    await persist_users_only()
    return {"message": "Usuario registrado exitosamente.", "estado": estado}


@app.post("/api/auth/login")
async def login_user(usuario: UsuarioLogin):
    await reload_db()
    user_in_db = usuarios_db.get(usuario.identifier)
    if not user_in_db or user_in_db["password"] != usuario.password:
        raise HTTPException(status_code=401, detail="Credenciales inválidas.")
    
    # Verificar si está pendiente de aprobación
    if user_in_db.get("estado", "Activo") == "Pendiente":
        raise HTTPException(status_code=403, detail="Tu cuenta está pendiente de aprobación por Administración.")

    # Registrar última conexión
    user_in_db["last_login"] = datetime.now().isoformat()
    await persist_users_only()

    
    return {
        "identifier": user_in_db.get("identifier", usuario.identifier),
        "email": user_in_db.get("email"),
        "dni": user_in_db.get("dni"),
        "nombre": user_in_db.get("nombre", "Usuario"),
        "rol": user_in_db.get("rol", "Usuario"),
        "unidad_id": user_in_db.get("unidad_id"),
        "empresa_id": user_in_db.get("empresa_id"),
        "avatar": user_in_db.get("avatar"),
        "estado": user_in_db.get("estado", "Activo"),
        "profileComplete": "perfil_conductor" in user_in_db
    }

@app.get("/api/user/profile")
async def get_profile(email: str):
    await reload_db()
    user = usuarios_db.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    return {
        "email": user["email"],
        "nombre": user["nombre"],
        "rol": user["rol"],
        "unidad_id": user.get("unidad_id"),
        "empresa_id": user.get("empresa_id"),
        "avatar": user.get("avatar"),
        "estado": user.get("estado", "Activo"),
        "profileComplete": "perfil_conductor" in user
    }

@app.put("/api/user/profile")
async def update_profile(update_data: UsuarioUpdate):
    await reload_db()
    user = usuarios_db.get(update_data.identifier)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    # Validar password actual si se intenta cambiar la password
    if update_data.new_password:
        if user["password"] != update_data.current_password:
            raise HTTPException(status_code=401, detail="Contraseña actual incorrecta.")
        user["password"] = update_data.new_password

    if update_data.nombre: user["nombre"] = update_data.nombre
    if update_data.avatar: user["avatar"] = update_data.avatar
    if update_data.fotoVehiculo:
        if "perfil_conductor" not in user:
            user["perfil_conductor"] = {}
        user["perfil_conductor"]["fotoVehiculo"] = update_data.fotoVehiculo
    if update_data.unidad_id: user["unidad_id"] = update_data.unidad_id
    if update_data.rol: user["rol"] = update_data.rol

    await persist_users_only()
    return {
        "identifier": user.get("identifier", update_data.identifier),
        "email": user.get("email"),
        "dni": user.get("dni"),
        "perfil_conductor": user.get("perfil_conductor", {}),
        "nombre": user.get("nombre", "Usuario"),
        "rol": user.get("rol", "Usuario"),
        "unidad_id": user.get("unidad_id"),
        "empresa_id": user.get("empresa_id"),
        "avatar": user.get("avatar"),
        "estado": user.get("estado", "Activo"),
        "profileComplete": "perfil_conductor" in user
    }

# --- Endpoints de Administración (Aprobación de Usuarios) ---
@app.get("/api/admin/users")
async def get_all_users(email: str):
    await reload_db()
    req_user = usuarios_db.get(email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado. Se requiere rol de Administración.")
    
    # Devolver lista de usuarios sin contraseñas
    lista_usuarios = []
    for k, v in usuarios_db.items():
        lista_usuarios.append({
            "email": v.get("identifier", k),
            "nombre": v.get("nombre", "Usuario"),
            "rol": v.get("rol", "Usuario"),
            "estado": v.get("estado", "Activo"),
            "perfil_conductor": v.get("perfil_conductor", None),
            "last_login": v.get("last_login", None),
            "avatar": v.get("avatar", None)
        })
    return {"usuarios": lista_usuarios}

@app.post("/api/admin/users/bulk")
async def bulk_users_action(payload: BulkActionPayload):
    await reload_db()
    req_user = usuarios_db.get(payload.admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    
    for target in payload.target_emails:
        if target in usuarios_db:
            if payload.action == "approve":
                usuarios_db[target]["estado"] = "Activo"
            elif payload.action in ["reject", "deactivate"]:
                usuarios_db[target]["estado"] = "Rechazado"
            elif payload.action == "delete":
                del usuarios_db[target]
                
    await persist_users_only()
    return {"message": f"Acción '{payload.action}' aplicada a {len(payload.target_emails)} usuarios."}

@app.put("/api/admin/users/approve/{target_email}")
async def approve_user(target_email: str, admin_email: str):
    await reload_db()
    req_user = usuarios_db.get(admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    
    if target_email not in usuarios_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        
    usuarios_db[target_email]["estado"] = "Activo"
    await persist_users_only()
    return {"message": f"Usuario {target_email} aprobado exitosamente."}

@app.delete("/api/admin/users/reject/{target_email}")
async def reject_user(target_email: str, admin_email: str):
    await reload_db()
    req_user = usuarios_db.get(admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    
    if target_email not in usuarios_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        
    del usuarios_db[target_email]
    await persist_users_only()
    return {"message": f"Usuario {target_email} rechazado y eliminado."}

@app.post("/api/admin/driver/review")
async def review_driver_doc(payload: DriverDocReviewPayload):
    """Admin marca un documento individual del conductor como aprobado o rechazado."""
    await reload_db()
    req_user = usuarios_db.get(payload.admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")

    conductor = usuarios_db.get(payload.conductor_email)
    if not conductor:
        raise HTTPException(status_code=404, detail="Conductor no encontrado.")

    if "perfil_conductor" not in conductor:
        conductor["perfil_conductor"] = {}

    if "revision_docs" not in conductor["perfil_conductor"]:
        conductor["perfil_conductor"]["revision_docs"] = {}

    conductor["perfil_conductor"]["revision_docs"][payload.campo] = {
        "estado": payload.estado,
        "nota": payload.nota or "",
        "revisado_por": req_user.get("nombre", payload.admin_email),
        "fecha": __import__('datetime').datetime.now().isoformat()
    }

    # Update global driver state based on all doc reviews
    revisiones = conductor["perfil_conductor"]["revision_docs"]
    if any(v["estado"] == "rechazado" for v in revisiones.values()):
        conductor["estado"] = "Documentos Observados"
    elif len(revisiones) > 0 and all(v["estado"] == "aprobado" for v in revisiones.values()):
        conductor["estado"] = "Activo"

    await persist_users_only()
    return {
        "message": f"Documento '{payload.campo}' marcado como {payload.estado}.",
        "estado_conductor": conductor["estado"],
        "revision_docs": conductor["perfil_conductor"]["revision_docs"]
    }

@app.post("/api/admin/driver/notify")
async def notify_driver(payload: DriverNotifyPayload):
    """Admin envía un aviso interno al conductor."""
    await reload_db()
    req_user = usuarios_db.get(payload.admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")

    conductor = usuarios_db.get(payload.conductor_email)
    if not conductor:
        raise HTTPException(status_code=404, detail="Conductor no encontrado.")

    notif_id = int(__import__('time').time() * 1000)
    notifications_db.append({
        "id": notif_id,
        "tipo": "aviso_admin",
        "titulo": "⚠️ Revisión de documentos",
        "mensaje": payload.mensaje,
        "para": payload.conductor_email,
        "de": req_user.get("nombre", payload.admin_email),
        "fecha": __import__('datetime').datetime.now().isoformat(),
        "leido": False
    })
    await persist_users_only()
    return {"message": "Aviso enviado al conductor exitosamente.", "notif_id": notif_id}

@app.post("/api/driver/onboarding")
async def driver_onboarding(payload: DriverProfilePayload):
    await reload_db()
    user = usuarios_db.get(payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    if user.get("rol") != "Conductor":
        raise HTTPException(status_code=403, detail="El usuario no es un conductor.")
        
    user["perfil_conductor"] = payload.perfilData
    user["estado"] = "Pendiente Revisión"
    
    if payload.perfilData.get("nombres"):
        user["nombre"] = payload.perfilData.get("nombres")
    
    await persist_users_only()
    return {"message": "Perfil enviado para revisión exitosamente", "estado": "Pendiente Revisión"}

class MarkReadPayload(BaseModel):
    notif_id: int

@app.get("/api/conductor/notifications")
async def get_conductor_notifications(email: str):
    await reload_db()
    user_notifs = [n for n in notifications_db if n.get("para") == email]
    # Sort newest first
    user_notifs.sort(key=lambda x: x.get("fecha", ""), reverse=True)
    return user_notifs

@app.post("/api/conductor/notifications/mark-read")
async def mark_notification_read(payload: MarkReadPayload):
    await reload_db()
    for n in notifications_db:
        if n.get("id") == payload.notif_id:
            n["leido"] = True
            await persist_users_only()
            return {"message": "Marcado como leído."}
    raise HTTPException(status_code=404, detail="Notificación no encontrada.")

class ResubmitDocsPayload(BaseModel):
    email: str
    docs: Dict[str, Any]

@app.post("/api/conductor/resubmit-docs")
async def resubmit_driver_docs(payload: ResubmitDocsPayload):
    await reload_db()
    user = usuarios_db.get(payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="Conductor no encontrado.")
    
    perfil = user.get("perfil_conductor")
    if not perfil:
        raise HTTPException(status_code=400, detail="El conductor no tiene perfil configurado.")
        
    revision_docs = perfil.get("revision_docs", {})
    
    # Update only the provided documents
    for k, v in payload.docs.items():
        perfil[k] = v
        # Reset the status of this specific document back to pending
        if k in revision_docs:
            revision_docs[k]["estado"] = "pendiente"
            
    # Check if there are any remaining rejected documents
    has_rejected = any(rev.get("estado") == "rechazado" for rev in revision_docs.values())
    
    if not has_rejected:
        user["estado"] = "Pendiente Revisión"
    
    await persist_users_only()
    return {"message": "Documentos actualizados exitosamente", "estado": user["estado"]}

# --- Lógica de Negocio y Endpoints de Rutas ---


@app.get("/api/flota")
async def get_flota_status():
    await reload_db()
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


# K-Means nativo y ligero para evitar que Vercel explote por límite de tamaño (250MB)
def native_kmeans(points, k, max_iters=10):
    if len(points) <= k:
        return list(range(len(points)))
        
    import random
    # Inicializar centroides al azar
    centroids = random.sample(points, k)
    labels = []
    
    for _ in range(max_iters):
        labels = []
        clusters = [[] for _ in range(k)]
        
        # Asignar cada punto al centroide más cercano
        for pt in points:
            dists = [math.hypot(pt[0] - c[0], pt[1] - c[1]) for c in centroids]
            best_k = dists.index(min(dists))
            labels.append(best_k)
            clusters[best_k].append(pt)
            
        # Recalcular centroides
        new_centroids = []
        for i in range(k):
            if not clusters[i]:
                new_centroids.append(centroids[i])
            else:
                avg_lat = sum(p[0] for p in clusters[i]) / len(clusters[i])
                avg_lng = sum(p[1] for p in clusters[i]) / len(clusters[i])
                new_centroids.append((avg_lat, avg_lng))
                
        if new_centroids == centroids:
            break
        centroids = new_centroids
        
    return labels



@app.get("/api/routes")
async def get_routes():
    await reload_db()
    return rutas_estado_actual

@app.get("/api/routes/summary")
async def get_routes_summary():
    """Returns compact route summary for GerentePortal (no agent details, just counts)."""
    await reload_db()
    if routes_summary:
        return routes_summary
    # Fallback: build summary from full routes if available
    if rutas_estado_actual:
        return _build_routes_summary(rutas_estado_actual)
    return []

@app.post("/api/routes/publish")
async def publish_routes_summary(rutas: list = Body(...)):
    await ensure_db_loaded()
    summary = _build_routes_summary(rutas)
    
    # Inline the persist logic to catch the exact error and return it
    global usuarios_db
    usuarios_to_save = dict(usuarios_db)
    usuarios_to_save["__routes_summary__"] = summary
    payload = {"usuarios": usuarios_to_save}
    try:
        async with httpx.AsyncClient() as client:
            hdrs = dict(HEADERS)
            res = await client.patch(f"{SUPABASE_URL}/app_state?id=eq.1", headers=hdrs, json=payload)
            if res.status_code not in (200, 204):
                return {"message": f"Error Supabase: {res.text}", "total_routes": 0}
    except Exception as e:
        return {"message": f"Exception: {str(e)}", "total_routes": 0}

    return {"message": f"Publicado: {len(summary)} rutas al panel del Gerente.", "total_routes": len(summary)}


@app.post("/api/routes")
async def update_routes(rutas: list = Body(...)):
    global rutas_estado_actual
    rutas_estado_actual = rutas
    await persist()
    return {"message": "Rutas actualizadas sincronizadas", "rutas": rutas_estado_actual}

@app.post("/api/assign-routes/")
async def assign_routes_from_excel(
    file: UploadFile = File(...),
    fecha: str = Form(""),
    hora: str = Form(""),
    sentido: str = Form(""),
    sede: str = Form("")
):
    global rutas_estado_actual
    await reload_db()

    try:
        disponibilidad_conductores = {conductor_id: [] for conductor_id in conductores_db.keys()}
        # Leer todo como texto para evitar que Pandas convierta fechas a '2026-08-03' en lugar de '3/08/2026'
        df = pd.read_excel(file.file, dtype=str)
        
        # Limpiar nombres de columnas
        df.columns = df.columns.str.strip()
        
        # Filtrar el DataFrame según los parámetros
        # En el excel las columnas suelen tener un punto al final "FECHA.", "HORA.", "SENTIDO.", "SEDE."
        # Nos aseguramos de manejar si tienen el punto o no.
        def col_name(name):
            return name + "." if name + "." in df.columns else name
            
        c_fecha = col_name("FECHA")
        c_hora = col_name("HORA")
        c_sentido = col_name("SENTIDO")
        c_sede = col_name("SEDE")
        
        # Filtrar (convertimos a str para asegurar la comparacion correcta, quitando .0 de horas como 00:00:00)
        df[c_fecha] = df[c_fecha].astype(str).str.strip()
        df[c_hora] = df[c_hora].astype(str).str.strip()
        df[c_sentido] = df[c_sentido].astype(str).str.strip()
        df[c_sede] = df[c_sede].astype(str).str.strip()
        
        # Hacemos match parcial o exacto
        df_filtered = df[
            (df[c_fecha].str.contains(fecha, na=False, case=False)) &
            (df[c_hora].str.contains(hora, na=False, case=False)) &
            (df[c_sentido].str.contains(sentido, na=False, case=False)) &
            (df[c_sede].str.contains(sede, na=False, case=False))
        ].copy()
        
        if df_filtered.empty:
            fechas_demo = df[c_fecha].dropna().unique()[:3].tolist() if c_fecha in df.columns else []
            horas_demo = df[c_hora].dropna().unique()[:3].tolist() if c_hora in df.columns else []
            sentidos_demo = df[c_sentido].dropna().unique()[:3].tolist() if c_sentido in df.columns else []
            sedes_demo = df[c_sede].dropna().unique()[:3].tolist() if c_sede in df.columns else []
            
            debug_info = f"Columnas: {list(df.columns)}. Fechas detectadas: {fechas_demo}. Horas detectadas: {horas_demo}. Sentidos detectadas: {sentidos_demo}. Sedes detectadas: {sedes_demo}."
            raise HTTPException(status_code=400, detail=f"No se encontraron pasajeros para estos filtros. INFO DEL EXCEL: {debug_info}")
            
        # Parsear coordenadas de forma segura
        c_coord = col_name("COORDENADAS")
        def parse_coord(val):
            try:
                parts = str(val).split(',')
                if len(parts) >= 2:
                    return float(parts[0].strip()), float(parts[1].strip())
            except:
                pass
            return -12.046374, -77.042793 # Default to Lima Center if dirty data

        parsed = df_filtered[c_coord].apply(parse_coord)
        df_filtered['lat'] = [p[0] for p in parsed]
        df_filtered['lng'] = [p[1] for p in parsed]
        
        rutas_generadas = []
        c_distrito = col_name("DISTRITO")
        c_dni = col_name("DNI")
        c_nombres = col_name("NOMBRES")
        c_dir = col_name("DIRECCION")
        c_emp = col_name("PROVEEDOR")
        
        # Agrupar por distrito para aplicar KMeans
        for distrito, grupo in df_filtered.groupby(c_distrito):
            n_pasajeros = len(grupo)
            k_clusters = math.ceil(n_pasajeros / 15.0)
            
            # KMeans nativo
            coords = list(zip(grupo['lat'], grupo['lng']))
            if k_clusters > 1 and len(coords) >= k_clusters:
                labels = native_kmeans(coords, k_clusters)
                grupo['cluster'] = labels
            else:
                grupo['cluster'] = 0
                
            # Por cada cluster dentro del distrito, intentamos buscar un vehiculo
            for cluster_id, subgrupo in grupo.groupby('cluster'):
                agentes_grupo = subgrupo.to_dict('records')
                
                while agentes_grupo:
                    conductor_encontrado = False
                    
                    # Intentar buscar un conductor disponible
                    for conductor_id, horarios_ocupados in disponibilidad_conductores.items():
                        capacidad_actual = sum(len(r['agentes']) for r in rutas_generadas if r['conductor'] == conductor_id)
                        
                        if hora not in horarios_ocupados and capacidad_actual < conductores_db[conductor_id]["capacidad"]:
                            espacio_disponible = conductores_db[conductor_id]["capacidad"] - capacidad_actual
                            agentes_a_asignar = agentes_grupo[:espacio_disponible]
                            
                            agentes_format = []
                            for ag in agentes_a_asignar:

                                agentes_format.append({
                                    "id": str(ag[c_dni]), 
                                    "nombre": str(ag.get(c_nombres, "Desconocido")),
                                    "direccion": str(ag.get(c_dir, "")),
                                    "lat": float(ag['lat']),
                                    "lng": float(ag['lng']),
                                    "empresa": str(ag.get(c_emp, "KAPITAL"))
                                })

                            ruta_existente = next((r for r in rutas_generadas if r["conductor"] == conductor_id and r["micro_zona"] == distrito and r["horario"] == hora), None)
                            if ruta_existente:
                                ruta_existente["agentes"].extend(agentes_format)
                            else:
                                rutas_generadas.append({"conductor": conductor_id, "micro_zona": distrito, "horario": hora, "agentes": agentes_format})
                                
                            disponibilidad_conductores[conductor_id].append(hora)
                            agentes_grupo = agentes_grupo[len(agentes_a_asignar):]
                            conductor_encontrado = True
                            break
                            
                    # Si no hay vehiculos, ponerlos en reten
                    if not conductor_encontrado:
                        agentes_format = []
                        for ag in agentes_grupo:
                            agentes_format.append({
                                "id": str(ag[c_dni]), 
                                "nombre": str(ag.get(c_nombres, "Desconocido")),
                                "direccion": str(ag.get(c_dir, "")),
                                "lat": float(ag['lat']),
                                "lng": float(ag['lng']),
                                "empresa": str(ag.get(c_emp, "KAPITAL"))
                            })
                        rutas_generadas.append({"conductor": "SIN ASIGNAR", "micro_zona": distrito, "horario": hora, "agentes": agentes_format})
                        break
                        
        rutas_estado_actual = rutas_generadas
        
        # Guardar automáticamente el resumen para que el Gerente vea la nueva data al instante
        # sin importar si persist() completo falla por tamaño.
        summary = _build_routes_summary(rutas_estado_actual)
        await persist_routes_summary(summary)
        
        await persist()
        return rutas_estado_actual
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error en el procesamiento AI del backend: {str(e)}")

@app.post("/api/emergency-reassign/")
async def emergency_reassign(request: EmergencyRequest):
    await reload_db()
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
    evidencia_foto: Optional[str] = None

@app.get("/api/mis-rutas/{conductor_id}")
async def mis_rutas(conductor_id: str):
    await reload_db()
    mis_rutas_asignadas = [r for r in rutas_estado_actual if r["conductor"] == conductor_id]
    return mis_rutas_asignadas

@app.post("/api/actualizar-pasajero")
async def actualizar_pasajero(data: EstadoPasajeroUpdate):
    await reload_db()
    ruta = next((r for r in rutas_estado_actual if r["conductor"] == data.conductor_id and r["horario"] == data.horario), None)
    if ruta:
        agente = next((a for a in ruta["agentes"] if a["id"] == data.agente_id), None)
        if agente:
            agente["estado"] = data.estado
            
            # Guardar evidencia en Supabase Storage si existe
            if data.evidencia_foto:
                try:
                    filename = f"evidencia_{data.agente_id}_{int(datetime.now().timestamp())}.jpg"
                    public_url = await upload_evidence_to_supabase(data.evidencia_foto, filename)
                    if public_url:
                        agente["evidencia_foto_url"] = public_url
                except Exception as e:
                    print(f"Error guardando evidencia: {e}")
            
            await persist()
            return {"message": "Estado del pasajero actualizado exitosamente."}
    raise HTTPException(status_code=404, detail="Ruta o agente no encontrado")

@app.get("/api/cliente/rutas/{empresa_id}")
async def get_rutas_cliente(empresa_id: str):
    await reload_db()
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

@app.get("/api/conductor/info/{unidad_id}")
async def get_conductor_info(unidad_id: str):
    await reload_db()
    
    conductor_user = None
    for k, v in usuarios_db.items():
        if v.get("unidad_id") == unidad_id and v.get("rol") == "Conductor":
            conductor_user = v
            break
            
    flota_info = conductores_db.get(unidad_id, {})
    
    if not conductor_user and not flota_info:
        raise HTTPException(status_code=404, detail="Conductor/Unidad no encontrada")
        
    return {
        "unidad_id": unidad_id,
        "usuario": {
            "nombre": conductor_user.get("nombre") if conductor_user else flota_info.get("chofer", "Desconocido"),
            "email": conductor_user.get("email") if conductor_user else "",
            "avatar": conductor_user.get("avatar") if conductor_user else None,
            "perfil_conductor": conductor_user.get("perfil_conductor") if conductor_user else None
        },
        "flota": flota_info
    }


@app.post("/api/flota")
async def add_flota(flota: FlotaRegistro):
    await reload_db()
    global conductores_db
    conductores_db[flota.placa] = {
        "capacidad": flota.capacidad,
        "tipo": flota.tipo,
        "chofer": flota.chofer,
        "soat": flota.soat,
        "revision": flota.revision,
        "atu": flota.atu,
        "licencia": flota.licencia,
        "telefono": flota.telefono
    }
    await persist()
    return {"message": "Unidad agregada exitosamente", "flota": conductores_db}

@app.put("/api/flota/{placa}")
async def update_flota(placa: str, flota: FlotaRegistro):
    await reload_db()
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
        "licencia": flota.licencia,
        "telefono": flota.telefono
    }
    await persist()
    return {"message": "Unidad actualizada", "flota": conductores_db}

@app.delete("/api/flota/{placa}")
async def delete_flota(placa: str):
    await reload_db()
    global conductores_db
    if placa in conductores_db:
        del conductores_db[placa]
        await persist()
        return {"message": "Unidad eliminada", "flota": conductores_db}
    raise HTTPException(status_code=404, detail="Unidad no encontrada")

import asyncio

JSON_PE_TOKEN = os.environ.get("JSON_PE_TOKEN", "0cea1f04743e822b1605856b5ca5e1c3912f5bcb228e661aa8878bc8da36")

@app.get("/api/verify/soat/{placa}")
async def verify_soat(placa: str):
    """Verifica el SOAT de un vehículo. Implementa caché en memoria para evitar consumir
    créditos de json.pe en consultas repetidas."""
    await reload_db()
    placa_limpia = placa.replace("-", "").strip()

    # --- CORTAFUEGOS: Buscar caché en usuarios_db ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        # Normalizar placa al comparar
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            cached = perfil.get("validacion_soat")
            if cached and cached.get("valido") is not None:
                # ¡Caché HIT! Retornar sin gastar créditos.
                return {**cached, "fuente": "cache"}
            break  # Conductor encontrado pero sin caché, salir del loop.

    # --- CACHÉ MISS: Llamar a json.pe ---
    result = None
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.json.pe/api/soat",
                headers={"Authorization": f"Bearer {JSON_PE_TOKEN}", "Content-Type": "application/json"},
                json={"placa": placa_limpia},
                timeout=10.0
            )
            if res.status_code == 200:
                data = res.json()
                if data.get("success"):
                    info = data.get("data", {})
                    fecha_fin_str = info.get("fecha_fin")
                    valido = True
                    mensaje = f"SOAT VIGENTE ({info.get('nombre_compania')})"
                    if fecha_fin_str:
                        try:
                            vencimiento = datetime.strptime(fecha_fin_str, "%d/%m/%Y")
                            if vencimiento < datetime.now():
                                valido = False
                                mensaje = "SOAT VENCIDO"
                        except:
                            pass
                    result = {
                        "valido": valido,
                        "mensaje": mensaje,
                        "compania": info.get("nombre_compania", "Desconocida"),
                        "fechaVencimiento": fecha_fin_str,
                        "fuente": "api"
                    }
    except Exception as e:
        print("JSON.PE SOAT Error:", e)

    # --- FALLBACK: Si la API falló o no retornó datos útiles ---
    if result is None:
        await asyncio.sleep(0.5)
        if "XXX" in placa.upper():
            result = {"valido": False, "mensaje": "SOAT vencido (Simulación/Fallback)", "fechaVencimiento": None, "fuente": "fallback"}
        else:
            result = {"valido": True, "mensaje": "SOAT VIGENTE (Fallback)", "compania": "La Positiva", "fechaVencimiento": "2027-12-31", "fuente": "fallback"}

    # --- GUARDAR en caché (memoria + Supabase) ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            user["perfil_conductor"]["validacion_soat"] = result
            await persist()  # persist() completo para sobrevivir reinicio de Vercel
            break

    return result


@app.get("/api/verify/citv/{placa}")
async def verify_citv(placa: str):
    """Verifica la Revisión Técnica (CITV) con caché en memoria."""
    await reload_db()
    placa_limpia = placa.replace("-", "").strip()

    # --- CORTAFUEGOS: Buscar caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            cached = perfil.get("validacion_citv")
            if cached and cached.get("valido") is not None:
                return {**cached, "fuente": "cache"}
            break

    # --- CITV: json.pe no provee este dato, usamos simulación inteligente ---
    await asyncio.sleep(0.5)
    if "XXX" in placa.upper():
        result = {"valido": False, "mensaje": "Revisión Técnica vencida (Simulación)", "fechaVencimiento": None, "fuente": "simulacion"}
    else:
        result = {
            "valido": True,
            "mensaje": "CITV VIGENTE (Simulación activa)",
            "centro": "Farenet",
            "fechaVencimiento": "2027-10-15",
            "fuente": "simulacion"
        }

    # --- GUARDAR en caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            user["perfil_conductor"]["validacion_citv"] = result
            await persist()
            break

    return result


@app.get("/api/verify/licencia/{doc}")
async def verify_licencia(doc: str):
    """Verifica la licencia de un conductor con caché en memoria."""
    await reload_db()
    doc_limpio = doc.strip()

    # --- CORTAFUEGOS: Buscar caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        doc_perfil = (perfil.get("numDoc") or "").strip()
        if doc_perfil == doc_limpio:
            cached = perfil.get("validacion_licencia")
            if cached and cached.get("valido") is not None:
                return {**cached, "fuente": "cache"}
            break

    # --- CACHÉ MISS: Llamar a json.pe ---
    result = None
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.json.pe/api/licencia",
                headers={"Authorization": f"Bearer {JSON_PE_TOKEN}", "Content-Type": "application/json"},
                json={"dni": doc_limpio},
                timeout=10.0
            )
            if res.status_code == 200:
                data = res.json()
                if data.get("success"):
                    info = data.get("data", {})
                    lic_info = info.get("licencia", {})
                    estado = lic_info.get("estado", "")
                    valido = estado.upper() == "VIGENTE"
                    result = {
                        "valido": valido,
                        "mensaje": f"LICENCIA {estado} ({lic_info.get('restricciones', '')})",
                        "claseCategoria": lic_info.get("categoria", ""),
                        "fechaVencimiento": lic_info.get("fecha_vencimiento", ""),
                        "fechaEmision": lic_info.get("fecha_emision", ""),
                        "restricciones": lic_info.get("restricciones", ""),
                        "fuente": "api"
                    }
    except Exception as e:
        print("JSON.PE Licencia Error:", e)

    # --- FALLBACK ---
    if result is None:
        await asyncio.sleep(0.5)
        if doc_limpio.startswith("000"):
            result = {"valido": False, "mensaje": "Licencia Retenida (Simulación/Fallback)", "claseCategoria": None, "fuente": "fallback"}
        else:
            result = {
                "valido": True,
                "mensaje": "LICENCIA VIGENTE (Fallback)",
                "claseCategoria": "A-IIb",
                "fechaVencimiento": "2028-05-20",
                "fuente": "fallback"
            }

    # --- GUARDAR en caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        doc_perfil = (perfil.get("numDoc") or "").strip()
        if doc_perfil == doc_limpio:
            user["perfil_conductor"]["validacion_licencia"] = result
            await persist()
            break

    return result

@app.post("/api/clear-routes")
async def clear_routes():
    await reload_db()
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

@app.post("/api/save-history")
async def save_history():
    await reload_db()
    global rutas_estado_actual, historial_rutas
    from datetime import datetime
    if rutas_estado_actual:
        fecha_hoy = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        registro_historial = {
            "fecha": fecha_hoy,
            "rutas": rutas_estado_actual
        }
        historial_rutas.append(registro_historial)
        await persist()
        return {"message": "Rutas guardadas en el historial"}
    return {"message": "No hay rutas para guardar"}


@app.get("/api/reportes")
async def get_reportes():
    await reload_db()
    global historial_rutas
    return {"historial": historial_rutas}

# --- AI Copilot Chat Route (REST API) ---
@app.post("/api/chat")
async def chat_with_copilot(req: ChatRequest):
    await reload_db()
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={GEMINI_API_KEY}"
        
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
            return {"error": True, "detail": f"Status {resp.status_code} - API msg: {resp.text}"}
            
    except Exception as e:
        return {"error": True, "detail": f"Python Exception: {str(e)}"}
