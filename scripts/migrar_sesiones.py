"""Pasa las sesiones abiertas del índice viejo a la tabla `sesiones`.

Para qué
--------
Hasta el cambio, las sesiones vivían en `app_state.usuarios.__sessions__`. El
código nuevo solo mira la tabla, así que quien tuviera la sesión abierta al
desplegar tendría que volver a entrar. Esto las copia para que no haga falta.

Solo copia las **abiertas**: ni caducadas ni revocadas. Es repetible: una
sesión que ya está en la tabla no se duplica ni se toca. Hay que correrlo
justo después de que el despliegue quede listo —el código viejo sigue abriendo
sesiones en el índice hasta ese momento— y se puede repetir sin miedo.

Cómo se usa
-----------
    python scripts/migrar_sesiones.py             # solo cuenta qué copiaría
    python scripts/migrar_sesiones.py --aplicar   # las copia

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402
from api import sesiones  # noqa: E402


async def leer_indice_y_usuarios() -> tuple:
    respuesta = await backend._db_http_request(
        "GET",
        backend._app_state_url(select="usuarios"),
        operation="migrar_sesiones_leer",
        headers=backend.HEADERS,
        timeout=30.0,
    )
    fila = respuesta.json()[0]
    usuarios = fila.get("usuarios") or {}
    indice = usuarios.get("__sessions__") or {}
    return indice, usuarios


def filas_abiertas(indice: dict, usuarios: dict) -> list:
    ahora = int(time.time())
    filas = []
    for token_hash, entrada in indice.items():
        if not isinstance(entrada, dict) or entrada.get("revoked_at"):
            continue
        if int(entrada.get("expires_at") or 0) <= ahora or len(token_hash) != 64:
            continue
        identifier = entrada.get("identifier")
        if not identifier:
            continue
        usuario = usuarios.get(identifier) if isinstance(usuarios.get(identifier), dict) else {}
        instantanea = {campo: entrada.get(campo) for campo in backend._SESSION_SNAPSHOT_FIELDS}
        instantanea["nombre"] = usuario.get("nombre")
        # Todas las filas con las mismas claves: PostgREST rechaza el lote
        # entero si no («All object keys must match»).
        filas.append({
            "token_hash": token_hash,
            "usuario": identifier,
            "instantanea": instantanea,
            "creada_en": sesiones.iso_de_epoch(entrada.get("created_at") or ahora),
            "expira_en": sesiones.iso_de_epoch(entrada["expires_at"]),
        })
    return filas


async def main() -> int:
    partes = argparse.ArgumentParser(description=__doc__)
    partes.add_argument("--aplicar", action="store_true", help="copiarlas de verdad")
    args = partes.parse_args()

    indice, usuarios = await leer_indice_y_usuarios()
    filas = filas_abiertas(indice, usuarios)
    print(f"En el índice viejo: {len(indice)} entradas, {len(filas)} abiertas.")
    if not filas or not args.aplicar:
        if filas:
            print("Nada copiado. Con --aplicar se copian.")
        return 0

    respuesta = await backend._db_http_request(
        "POST",
        f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/sesiones?on_conflict=token_hash",
        operation="migrar_sesiones_copiar",
        headers=backend._build_supabase_headers(
            backend.STORAGE_CONFIG.key,
            prefer="resolution=ignore-duplicates,return=minimal",
        ),
        timeout=30.0,
        json_payload=filas,
    )
    if respuesta.status_code not in (200, 201, 204):
        print(f"No se pudieron copiar: {respuesta.status_code}")
        return 1
    print(f"Copiadas {len(filas)} (las que ya estaban no se tocan).")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
