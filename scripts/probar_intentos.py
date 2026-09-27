"""Prueba el tope de intentos contra la base de verdad, y lo deja limpio.

Usa `IntentosEnTabla` —la clase del backend, con su misma forma de pedir—
sobre una clave y un origen inventados: registra intentos, comprueba que se
cuentan por cuenta, por cuenta y origen y por origen, que una ráfaga
simultánea no se salta la cuenta, y los olvida. No toca ningún intento real.

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

RAFAGA = 20


async def main() -> int:
    almacen = backend.almacen_intentos
    clave = intentos_acceso.clave_de(f"__prueba_intentos__{secrets.token_hex(4)}")
    origen = intentos_acceso.origen_de({}, f"prueba-{secrets.token_hex(4)}")
    otro_origen = intentos_acceso.origen_de({}, f"prueba-{secrets.token_hex(4)}")
    fallos = 0

    def comprobar(nombre: str, bien: bool, detalle: object = "") -> None:
        nonlocal fallos
        fallos += not bien
        print(f"{'ok   ' if bien else 'FALLO'} {nombre:28} {detalle}")

    try:
        cuenta = await almacen.registrar(clave, origen)
        comprobar("el primero se cuenta", cuenta == {"cuenta": 1, "cuenta_origen": 1, "origen": 1}, cuenta)
        cuenta = await almacen.registrar(clave, otro_origen)
        comprobar("desde otro origen", cuenta == {"cuenta": 2, "cuenta_origen": 1, "origen": 1}, cuenta)

        # Una ráfaga a la vez: cada uno tiene que ver su propio número, sin repetirse.
        cuentas = await asyncio.gather(*(almacen.registrar(clave, origen) for _ in range(RAFAGA)))
        vistos = sorted(c["cuenta"] for c in cuentas)
        comprobar("ráfaga sin saltarse cuentas", vistos == list(range(3, 3 + RAFAGA)),
                  f"{vistos[0]}…{vistos[-1]}")

        await almacen.olvidar(clave)
        cuenta = await almacen.registrar(clave, origen)
        comprobar("olvidar deja a cero", cuenta["cuenta"] == 1, cuenta)
    except Exception as fallo:  # noqa: BLE001 - se informa y se limpia igual
        comprobar("sin excepciones", False, f"{type(fallo).__name__}: {fallo}")
    finally:
        await almacen.olvidar(clave)
        for o in (origen, otro_origen):
            await backend._db_http_request(
                "DELETE",
                f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/intentos_acceso?origen=eq.{o}",
                operation="prueba_intentos_limpiar",
                headers=backend._build_supabase_headers(backend.STORAGE_CONFIG.key, prefer="return=minimal"),
                timeout=10.0,
            )
        print("limpieza hecha")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
