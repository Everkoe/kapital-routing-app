"""Saca de la fila las fotos de perfil guardadas en base64.

Por qué existe
--------------
Todo el estado vive en una sola fila de `app_state`. Medido sobre la base real:
el bloque de usuarios pesa 571 KB y **484 KB son tres fotos** incrustadas en
base64 —el administrador, el programador y un conductor—. El conductor típico
ocupa 0,6 KB.

Esos 484 KB no encarecen solo el login: cada lectura completa de la aplicación
los arrastra, y una escritura cualquiera obliga antes a bajar la fila entera.

El código ya sube las fotos nuevas al bucket y guarda solo su ruta, pero las que
ya están guardadas siguen dentro. Este script las saca.

Orden de ejecución — importante
-------------------------------
Primero se despliega el frontend que sabe leer una foto desde Storage
(`ImagenGuardada` en las cuatro pantallas que la pintan) y solo después se
ejecuta esto. Al revés, producción seguiría pidiendo `<img src={avatar}>` con
un objeto y mostraría la imagen rota.

Antes de tocar nada guarda una copia de los base64 originales en
`scratch/fotos-perfil-<fecha>.json`, para poder volver atrás.

Es idempotente: una foto que ya es una ruta se deja como está, así que puede
ejecutarse de nuevo si se interrumpe.

Cómo se usa
-----------
    python scripts/migrar_fotos_de_perfil.py --revisar     # solo informa
    python scripts/migrar_fotos_de_perfil.py --ejecutar    # migra de verdad

Desde la raíz del repositorio, con el entorno de `frontend/` y su `.env`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402

# Dónde vive cada foto dentro del usuario. La del vehículo cuelga del perfil del
# conductor; la de perfil, del usuario.
FOTOS = (
    ("avatar", None),
    ("fotoVehiculo", "perfil_conductor"),
)


def _es_base64(valor) -> bool:
    return isinstance(valor, str) and valor.startswith("data:")


def _tipo(base64_url: str) -> str:
    if ";" in base64_url:
        return base64_url[5:base64_url.index(";")]
    return "image/jpeg"


def _extension(tipo: str) -> str:
    return {"image/png": "png", "image/webp": "webp"}.get(tipo, "jpg")


def _contenedor(usuario: dict, dentro_de):
    """El diccionario que guarda la foto, o None si ese usuario no lo tiene."""
    if dentro_de is None:
        return usuario
    anidado = usuario.get(dentro_de)
    return anidado if isinstance(anidado, dict) else None


def _inventario():
    hallazgos = []
    for clave, usuario in backend.usuarios_db.items():
        if str(clave).startswith("__") or not isinstance(usuario, dict):
            continue
        for campo, dentro_de in FOTOS:
            contenedor = _contenedor(usuario, dentro_de)
            if contenedor is None:
                continue
            valor = contenedor.get(campo)
            if _es_base64(valor):
                hallazgos.append((clave, usuario, contenedor, campo, valor))
    return hallazgos


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    grupo.add_argument("--ejecutar", action="store_true", help="Realiza la migracion")
    args = parser.parse_args()

    print("Cargando estado desde Supabase...")
    await backend.reload_db(force=True)

    antes = len(json.dumps(backend.usuarios_db, ensure_ascii=False))
    hallazgos = _inventario()
    peso = sum(len(valor) for *_, valor in hallazgos)

    print(f"\n  fotos en base64          : {len(hallazgos)}")
    for clave, usuario, _c, campo, valor in hallazgos:
        print(f"     {len(valor)/1024:7.1f} KB  {usuario.get('rol') or '?':<22} {campo:<13} {clave[:34]}")
    print(f"\n  ocupan                   : {peso/1024:.1f} KB")
    print(f"  bloque de usuarios       : {antes/1024:.1f} KB")
    print(f"  bloque tras migrar (est.): {(antes-peso)/1024:.1f} KB")

    if not hallazgos:
        print("\nNo queda ninguna foto en base64. Nada que hacer.")
        return 0

    if args.revisar:
        print("\nModo revision: no se escribio nada.")
        return 0

    respaldo = os.path.join(RAIZ, "scratch",
                            f"fotos-perfil-{datetime.now():%Y%m%d-%H%M%S}.json")
    os.makedirs(os.path.dirname(respaldo), exist_ok=True)
    with open(respaldo, "w", encoding="utf-8") as f:
        json.dump([{"usuario": c, "campo": campo, "base64": valor}
                   for c, _u, _cont, campo, valor in hallazgos], f)
    print(f"\nCopia de seguridad: {respaldo}")

    print(f"\nSubiendo {len(hallazgos)} fotos al bucket privado...")
    migradas, fallidas = 0, []
    for clave, usuario, contenedor, campo, valor in hallazgos:
        tipo = _tipo(valor)
        nombre = f"{campo}.{_extension(tipo)}"
        if campo == "avatar":
            ruta = backend._ruta_de_avatar(usuario, nombre)
        else:
            unidad = usuario.get("unidad_id") or clave
            ruta = backend._ruta_de_documento(str(unidad), campo, nombre)
        try:
            await backend.upload_document_to_storage(valor, ruta, tipo)
        except Exception as exc:  # noqa: BLE001 - se informa y se sigue
            fallidas.append((clave, campo, type(exc).__name__))
            continue
        contenedor[campo] = {"name": nombre, "size": len(valor), "type": tipo, "path": ruta}
        migradas += 1
        print(f"   {clave[:34]} / {campo} -> {ruta}")

    if fallidas:
        print(f"\n{len(fallidas)} fotos no se pudieron subir; sus perfiles quedan intactos:")
        for clave, campo, error in fallidas:
            print(f"   {clave} / {campo}: {error}")

    if not migradas:
        print("\nNo se migro ninguna foto. No se persiste nada.")
        return 1

    print(f"\nPersistiendo {migradas} fotos migradas...")
    await backend.persist_users_only()

    await backend.reload_db(force=True)
    despues = len(json.dumps(backend.usuarios_db, ensure_ascii=False))
    print(f"\n  bloque de usuarios: {antes/1024:.1f} KB -> {despues/1024:.1f} KB")
    print(f"  quedan en base64  : {len(_inventario())}")
    return 0 if not fallidas else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
