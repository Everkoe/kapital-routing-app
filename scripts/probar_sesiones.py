"""Prueba el almacén de sesiones contra la base de verdad, y lo deja limpio.

Por qué existe
--------------
Las pruebas del backend usan `SesionesEnMemoria` y un PostgREST simulado:
comprueban la lógica, no que los filtros, la proyección JSON o la función
`ultimos_accesos()` funcionen en Supabase. Ya pasó una vez que todo estaba en
verde y la base rechazaba cada llamada (ver `probar_funciones_plan.py`).

Qué hace
--------
Usa `SesionesEnTabla` —la misma clase que usa el backend, con su misma forma de
pedir— sobre una fila de prueba con un usuario que no existe, recorre todas
las operaciones y la borra al final pase lo que pase. No toca ninguna sesión
real.

Cómo se usa
-----------
    python scripts/probar_sesiones.py

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402
from api import sesiones  # noqa: E402

USUARIO_DE_PRUEBA = "__prueba_sesiones__+comprobacion@kapital.test"


async def main() -> int:
    almacen = backend.almacen_sesiones
    token_hash = sesiones.hash_de_token(secrets.token_urlsafe(32))
    expira = datetime.now(timezone.utc) + timedelta(hours=1)
    fallos = 0

    def comprobar(nombre: str, bien: bool, detalle: object = "") -> None:
        nonlocal fallos
        fallos += not bien
        print(f"{'ok   ' if bien else 'FALLO'} {nombre:26} {detalle}")

    try:
        await almacen.abrir({
            "token_hash": token_hash,
            "usuario": USUARIO_DE_PRUEBA,
            "instantanea": {"rol": "Conductor", "estado": "Activo", "nombre": "Prueba"},
            "expira_en": expira.isoformat(),
        })
        comprobar("abrir", True)

        fila = await almacen.buscar(token_hash)
        comprobar("buscar", bool(fila) and fila.get("usuario") == USUARIO_DE_PRUEBA,
                  fila and sorted(fila))

        await almacen.refrescar(USUARIO_DE_PRUEBA, {"rol": "Conductor", "estado": "Inactivo",
                                                   "nombre": "Prueba"})
        fila = await almacen.buscar(token_hash)
        comprobar("refrescar", fila["instantanea"].get("estado") == "Inactivo",
                  fila["instantanea"].get("estado"))

        accesos = await almacen.ultimos_accesos()
        comprobar("ultimos_accesos", USUARIO_DE_PRUEBA in accesos, accesos.get(USUARIO_DE_PRUEBA))

        recientes = await almacen.inicios_recientes(50)
        propia = next((r for r in recientes if r.get("usuario") == USUARIO_DE_PRUEBA), None)
        comprobar("inicios_recientes", bool(propia) and propia.get("nombre") == "Prueba",
                  propia and {k: propia.get(k) for k in ("nombre", "rol")})

        comprobar("revocar", await almacen.revocar(token_hash) is True)
        comprobar("revocar dos veces", await almacen.revocar(token_hash) is False,
                  "no hay nada abierto que cerrar")
        fila = await almacen.buscar(token_hash)
        comprobar("sigue como registro", bool(fila and fila.get("revocada_en")),
                  fila and fila.get("revocada_en"))

        comprobar("revocar_de sin abiertas", await almacen.revocar_de(USUARIO_DE_PRUEBA) == 0)
    except Exception as fallo:  # noqa: BLE001 - se informa y se limpia igual
        comprobar("sin excepciones", False, f"{type(fallo).__name__}: {fallo}")
    finally:
        # La limpieza va directa, sin pasar por `purgar`, para borrar solo esta fila.
        respuesta = await backend._db_http_request(
            "DELETE",
            f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/sesiones?token_hash=eq.{token_hash}",
            operation="prueba_sesiones_limpiar",
            headers=backend._build_supabase_headers(backend.STORAGE_CONFIG.key, prefer="return=minimal"),
            timeout=10.0,
        )
        print(f"limpieza: {respuesta.status_code}")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
