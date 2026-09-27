"""Prueba el tope de intentos contra la base de verdad, y lo deja limpio.

Usa `IntentosEnTabla` —la clase del backend, con su misma forma de pedir—
sobre una clave inventada: anota dos fallos, comprueba que se cuentan, los
olvida y comprueba que no queda nada. No toca ningún intento real.

    python scripts/probar_intentos.py

Desde la raíz del repositorio, con el entorno de `frontend/` y la 009 aplicada.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402
from api import intentos_acceso  # noqa: E402


async def main() -> int:
    almacen = backend.almacen_intentos
    clave = intentos_acceso.clave_de(f"__prueba_intentos__{secrets.token_hex(4)}")
    origen = intentos_acceso.origen_de({}, f"prueba-{secrets.token_hex(4)}")
    fallos = 0

    def comprobar(nombre: str, bien: bool, detalle: object = "") -> None:
        nonlocal fallos
        fallos += not bien
        print(f"{'ok   ' if bien else 'FALLO'} {nombre:22} {detalle}")

    try:
        comprobar("sin intentos", await almacen.fallidos(clave, origen) == {"cuenta": 0, "origen": 0})
        await almacen.anotar(clave, origen)
        await almacen.anotar(clave, origen)
        cuenta = await almacen.fallidos(clave, origen)
        comprobar("se cuentan", cuenta == {"cuenta": 2, "origen": 2}, cuenta)
        await almacen.olvidar(clave)
        cuenta = await almacen.fallidos(clave, origen)
        comprobar("olvidar la cuenta", cuenta["cuenta"] == 0, cuenta)
    except Exception as fallo:  # noqa: BLE001 - se informa y se limpia igual
        comprobar("sin excepciones", False, f"{type(fallo).__name__}: {fallo}")
    finally:
        # Por si la prueba se cortó antes de olvidar: nada de este origen inventado queda.
        respuesta = await backend._db_http_request(
            "DELETE",
            f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/intentos_acceso?origen=eq.{origen}",
            operation="prueba_intentos_limpiar",
            headers=backend._build_supabase_headers(backend.STORAGE_CONFIG.key, prefer="return=minimal"),
            timeout=10.0,
        )
        print(f"limpieza: {respuesta.status_code}")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
