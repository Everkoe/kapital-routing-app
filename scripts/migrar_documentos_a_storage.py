"""Mueve los documentos guardados en base64 a Supabase Storage.

Por qué existe
--------------
Todo el estado vive en una sola fila de `app_state`, y los documentos de los
conductores se guardaban como base64 dentro. La fila llegó a 9,8 MB, y cada
guardado de perfil la reescribe entera: 18,7 s medidos, cuando una función
serverless de Vercel se corta a los 10. El resultado era que «Enviar para
Revisión» fallaba con un mensaje genérico.

El código ya sube los documentos nuevos a un bucket privado y guarda solo su
ruta, pero eso no basta: los documentos ya guardados siguen dentro de la fila y
la mantienen pesada. Este script los saca de una vez.

Qué hace
--------
Recorre todos los usuarios, sube cada documento en base64 al bucket y sustituye
su contenido por `{name, size, type, path}`. Al terminar persiste una sola vez.

Es idempotente: un documento que ya es una ruta se deja como está, así que puede
ejecutarse de nuevo si se interrumpe.

Cómo se usa
-----------
    python scripts/migrar_documentos_a_storage.py --revisar     # solo informa
    python scripts/migrar_documentos_a_storage.py --ejecutar    # migra de verdad

Debe ejecutarse desde la raíz del repositorio, con el entorno de `frontend/`
activo y su `.env` presente: usa el mismo backend que la aplicación.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402


def _es_base64(valor) -> bool:
    if isinstance(valor, str):
        return valor.startswith("data:")
    if isinstance(valor, dict):
        return bool(valor.get("base64"))
    return False


def _contenido(valor) -> str:
    return valor if isinstance(valor, str) else valor.get("base64", "")


def _tipo(valor, clave: str) -> str:
    if isinstance(valor, dict) and valor.get("type"):
        return valor["type"]
    contenido = _contenido(valor)
    if contenido.startswith("data:") and ";" in contenido:
        return contenido[5:contenido.index(";")]
    return "application/octet-stream"


def _nombre(valor, clave: str) -> str:
    if isinstance(valor, dict) and valor.get("name"):
        return valor["name"]
    return f"{clave}.jpg"


def _inventario():
    """Documentos en base64 por usuario, sin cargar nada dos veces."""
    hallazgos = []
    for clave_usuario, usuario in backend.usuarios_db.items():
        if not isinstance(usuario, dict):
            continue
        perfil = usuario.get("perfil_conductor")
        if not isinstance(perfil, dict):
            continue
        unidad = usuario.get("unidad_id") or clave_usuario
        for campo, valor in perfil.items():
            if _es_base64(valor):
                hallazgos.append((usuario, perfil, unidad, campo, valor))
    return hallazgos


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    grupo.add_argument("--ejecutar", action="store_true", help="Realiza la migracion")
    args = parser.parse_args()

    print("Cargando estado desde Supabase...")
    await backend.reload_db(force=True)

    antes = len(json.dumps(backend.usuarios_db, ensure_ascii=False))
    hallazgos = _inventario()
    peso = sum(len(_contenido(v)) for *_, v in hallazgos)

    print(f"\n  usuarios                 : {len(backend.usuarios_db)}")
    print(f"  documentos en base64     : {len(hallazgos)}")
    print(f"  ocupan                   : {peso/1024/1024:.2f} MB")
    print(f"  bloque de usuarios       : {antes/1024/1024:.2f} MB")
    print(f"  bloque tras migrar (est.): {(antes-peso)/1024/1024:.2f} MB")

    if not hallazgos:
        print("\nNo queda ningun documento en base64. Nada que hacer.")
        return 0

    if args.revisar:
        print("\nModo revision: no se escribio nada.")
        return 0

    print(f"\nSubiendo {len(hallazgos)} documentos al bucket privado...")
    migrados, fallidos = 0, []
    for indice, (_usuario, perfil, unidad, campo, valor) in enumerate(hallazgos, 1):
        ruta = backend._ruta_de_documento(str(unidad), campo, _nombre(valor, campo))
        try:
            await backend.upload_document_to_storage(_contenido(valor), ruta, _tipo(valor, campo))
        except Exception as exc:  # noqa: BLE001 - se informa y se sigue
            fallidos.append((unidad, campo, type(exc).__name__))
            continue
        perfil[campo] = {
            "name": _nombre(valor, campo),
            "size": len(_contenido(valor)),
            "type": _tipo(valor, campo),
            "path": ruta,
        }
        migrados += 1
        if indice % 10 == 0 or indice == len(hallazgos):
            print(f"   {indice}/{len(hallazgos)}")

    if fallidos:
        print(f"\n{len(fallidos)} documentos no se pudieron subir; sus perfiles quedan intactos:")
        for unidad, campo, error in fallidos[:10]:
            print(f"   {unidad} / {campo}: {error}")

    if migrados == 0:
        print("\nNo se migro ninguno. No se escribe el estado.")
        return 2

    print(f"\nPersistiendo el estado con {migrados} documentos ya como ruta...")
    await backend.persist_users_only()

    despues = len(json.dumps(backend.usuarios_db, ensure_ascii=False))
    print(f"\nHecho. Bloque de usuarios: {antes/1024/1024:.2f} MB -> {despues/1024/1024:.2f} MB")
    print(f"Reduccion: {(1 - despues/antes)*100:.1f} %")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
