"""Vuelve a apuntar a los documentos que siguen en el bucket pero perdieron su ruta.

Por qué existe
--------------
El formulario de alta reconstruía cada documento ya guardado a partir de
`name`, `size` y `type`, y en el camino perdía `path`. Al reenviar el perfil,
esa ficha vacía sustituía al documento bueno. El archivo nunca se borró —sigue
en el bucket— pero el perfil dejó de saber dónde estaba, así que la pantalla
decía «Documento no disponible».

El fallo está corregido en el formulario y el backend ya rechaza una ficha sin
ruta que pise un documento con ruta. Este script arregla lo que se perdió antes
de esa corrección.

Cómo lo hace
------------
La ruta de un documento es predecible: `<carpeta>/<campo>.<extensión>`. Para
cada ficha huérfana se busca en el bucket un objeto con ese campo dentro de
alguna de las carpetas del conductor, y si existe se vuelve a enlazar. Lo que
no aparece se deja intacto y se informa: sin archivo no hay nada que reenlazar.

Cómo se usa
-----------
    python scripts/reenlazar_documentos.py --revisar     # solo informa
    python scripts/reenlazar_documentos.py --ejecutar    # reenlaza

Debe ejecutarse desde la raíz del repositorio, con el entorno de `frontend/`
activo y su `.env` presente: usa el mismo backend que la aplicación.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from typing import Any, Dict, List, Tuple

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402

from api import index as backend  # noqa: E402


async def _objetos_de(carpeta: str) -> Dict[str, str]:
    """Nombre de archivo por campo, para los objetos que hay en esa carpeta."""
    cabeceras = backend._build_supabase_headers(backend.STORAGE_CONFIG.key)
    async with httpx.AsyncClient(timeout=20.0) as cliente:
        respuesta = await cliente.post(
            f"{backend._storage_base_url()}/object/list/{backend.DOCUMENTS_BUCKET}",
            headers=cabeceras,
            json={"prefix": f"{carpeta}/", "limit": 1000},
        )
    if respuesta.status_code != 200:
        return {}
    por_campo = {}
    for objeto in respuesta.json():
        nombre = objeto.get("name") or ""
        if "." in nombre:
            por_campo[nombre.rsplit(".", 1)[0]] = nombre
    return por_campo


def _huerfanos(perfil: Dict[str, Any]) -> List[str]:
    """Campos con ficha de archivo pero sin nada que apunte a él."""
    return [
        campo for campo, valor in perfil.items()
        if backend._es_cascara(valor)
    ]


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    grupo.add_argument("--ejecutar", action="store_true", help="Reenlaza los documentos")
    args = parser.parse_args()

    print("Cargando estado desde Supabase...")
    await backend.reload_db(force=True)

    afectados: List[Tuple[str, Dict[str, Any], List[str]]] = []
    for clave, usuario in backend.usuarios_db.items():
        if not isinstance(usuario, dict):
            continue
        perfil = usuario.get("perfil_conductor")
        if not isinstance(perfil, dict):
            continue
        sueltos = _huerfanos(perfil)
        if sueltos:
            afectados.append((clave, usuario, sueltos))

    total = sum(len(s) for _, _, s in afectados)
    print(f"\n  conductores con documentos sin ruta : {len(afectados)}")
    print(f"  documentos sin ruta                 : {total}")
    if not afectados:
        print("\nNada que reenlazar.")
        return 0

    reenlazables, perdidos = [], []
    cache: Dict[str, Dict[str, str]] = {}
    for clave, usuario, sueltos in afectados:
        for carpeta in backend._carpetas_del_actor(usuario):
            if carpeta not in cache:
                cache[carpeta] = await _objetos_de(carpeta)
        for campo in sueltos:
            encontrado = None
            for carpeta in backend._carpetas_del_actor(usuario):
                nombre = cache.get(carpeta, {}).get(campo)
                if nombre:
                    encontrado = f"{carpeta}/{nombre}"
                    break
            if encontrado:
                reenlazables.append((clave, usuario, campo, encontrado))
            else:
                perdidos.append((clave, campo))

    print(f"  con archivo todavía en el bucket    : {len(reenlazables)}")
    print(f"  sin archivo (hay que volver a subir): {len(perdidos)}")
    for clave, campo in perdidos[:10]:
        print(f"     {clave} / {campo}")

    if args.revisar:
        print("\nPrimeros reenlaces que se aplicarían:")
        for clave, _usuario, campo, ruta in reenlazables[:15]:
            print(f"   {clave:<14} {campo:<28} -> {ruta}")
        print("\nModo revisión: no se escribió nada.")
        return 0

    if not reenlazables:
        print("\nNo hay ningún archivo que reenlazar. No se escribe el estado.")
        return 2

    for _clave, usuario, campo, ruta in reenlazables:
        usuario["perfil_conductor"][campo]["path"] = ruta

    print(f"\nPersistiendo {len(reenlazables)} reenlaces...")
    await backend.persist_users_only()
    print("Hecho.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
