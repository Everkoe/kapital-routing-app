"""Sustituye los correos inventados de los conductores por los reales del Excel.

Por qué existe
--------------
Los 108 conductores que se importaron del Excel no traían correo, así que se
les generó uno a partir del apellido: `de.los@kapital.com`. Ese correo no
existe —nadie lo lee, nadie puede recuperar una contraseña con él— y además
quedó como clave de la cuenta en `usuarios`.

Este script no toca esa clave. Renombrarla sería migrar la cuenta entera, sus
sesiones y sus referencias. Lo que hace es guardar el correo real al lado, que
es lo que la aplicación muestra y lo que `get_user_by_identifier` reconoce para
iniciar sesión. La clave vieja se queda como un identificador interno.

Qué espera del Excel
--------------------
Una fila por conductor, con una columna de correos y una columna para
identificarlo: el padrón (`K-027`, `KV-211`) o el DNI. Los nombres de las
columnas no importan: el script las detecta por su contenido y dice cuáles
eligió antes de escribir nada. Si se equivoca, se le indican a mano con
`--columna-correo` y `--columna-clave`.

Cómo se usa
-----------
    python scripts/actualizar_correos.py correos.xlsx --revisar    # solo informa
    python scripts/actualizar_correos.py correos.xlsx --ejecutar   # aplica

Debe ejecutarse desde la raíz del repositorio, con el entorno de `frontend/`
activo y su `.env` presente: usa el mismo backend que la aplicación.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import pandas as pd  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from api import index as backend  # noqa: E402

# Un padrón es `K-027` o `KV-211`; un DNI peruano son ocho dígitos. Sirven para
# reconocer la columna que identifica al conductor sin depender del encabezado.
_PADRON = re.compile(r"^K[A-Z]?[\s-]*\d{2,4}$", re.IGNORECASE)
_DNI = re.compile(r"^\d{8}$")


def _texto(valor: Any) -> str:
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return ""
    return str(valor).strip()


def _proporcion(serie, predicado) -> float:
    valores = [_texto(v) for v in serie]
    presentes = [v for v in valores if v]
    if not presentes:
        return 0.0
    return sum(1 for v in presentes if predicado(v)) / len(presentes)


def _elegir_columnas(hoja: pd.DataFrame) -> Tuple[Optional[str], Optional[str]]:
    """Columna de correos y columna que identifica al conductor."""
    correo = max(
        hoja.columns,
        key=lambda c: _proporcion(hoja[c], lambda v: bool(backend.correo_normalizado(v))),
        default=None,
    )
    if correo is not None and _proporcion(hoja[correo], lambda v: bool(backend.correo_normalizado(v))) < 0.5:
        correo = None

    def parece_clave(valor: str) -> bool:
        return bool(_PADRON.match(valor) or _DNI.match(valor))

    candidatas = [c for c in hoja.columns if c != correo]
    clave = max(candidatas, key=lambda c: _proporcion(hoja[c], parece_clave), default=None)
    if clave is not None and _proporcion(hoja[clave], parece_clave) < 0.5:
        clave = None
    return correo, clave


def _indice_de_conductores() -> Dict[str, Dict[str, Any]]:
    """Conductor por padrón y por DNI, ambos en mayúsculas."""
    indice: Dict[str, Dict[str, Any]] = {}
    for clave, usuario in backend.usuarios_db.items():
        if not isinstance(usuario, dict) or usuario.get("rol") != "Conductor":
            continue
        perfil = usuario.get("perfil_conductor")
        perfil = perfil if isinstance(perfil, dict) else {}
        for identificador in (usuario.get("unidad_id"), perfil.get("numDoc"), usuario.get("dni"), clave):
            texto = _texto(identificador).upper()
            if texto:
                indice.setdefault(texto, usuario)
    return indice


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("excel", help="Archivo .xlsx con los correos reales")
    parser.add_argument("--hoja", default=0, help="Hoja del Excel (nombre o número); por defecto la primera")
    parser.add_argument("--columna-correo", default=None, help="Fuerza la columna de correos")
    parser.add_argument("--columna-clave", default=None, help="Fuerza la columna de padrón o DNI")
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    grupo.add_argument("--ejecutar", action="store_true", help="Aplica los cambios")
    args = parser.parse_args()

    hoja_pedida: Any = args.hoja
    if isinstance(hoja_pedida, str) and hoja_pedida.isdigit():
        hoja_pedida = int(hoja_pedida)
    hoja = pd.read_excel(args.excel, sheet_name=hoja_pedida, dtype=object)
    hoja.columns = [_texto(c) for c in hoja.columns]

    detectada_correo, detectada_clave = _elegir_columnas(hoja)
    columna_correo = args.columna_correo or detectada_correo
    columna_clave = args.columna_clave or detectada_clave

    print(f"Archivo  : {args.excel}  ({len(hoja)} filas)")
    print(f"Columnas : {list(hoja.columns)}")
    print(f"  correo -> {columna_correo!r}")
    print(f"  clave  -> {columna_clave!r}")
    if not columna_correo or not columna_clave:
        print("\nNo se reconocieron las columnas. Indícalas con --columna-correo y --columna-clave.")
        return 2

    print("\nCargando estado desde Supabase...")
    await backend.reload_db(force=True)
    indice = _indice_de_conductores()
    print(f"  conductores en la base: {len(set(id(u) for u in indice.values()))}")

    aplicables: List[Tuple[str, Dict[str, Any], str]] = []
    sin_conductor: List[str] = []
    correo_invalido: List[Tuple[str, str]] = []
    sin_cambio: List[str] = []

    for _, fila in hoja.iterrows():
        clave = _texto(fila[columna_clave]).upper()
        correo = backend.correo_normalizado(fila[columna_correo])
        if not clave and not correo:
            continue
        if not correo:
            correo_invalido.append((clave, _texto(fila[columna_correo])))
            continue
        usuario = indice.get(clave)
        if usuario is None:
            sin_conductor.append(clave)
            continue
        if _texto(usuario.get("email")).lower() == correo:
            sin_cambio.append(clave)
            continue
        aplicables.append((clave, usuario, correo))

    print(f"\n  por actualizar      : {len(aplicables)}")
    print(f"  ya estaban al día   : {len(sin_cambio)}")
    print(f"  sin conductor       : {len(sin_conductor)}  {sin_conductor[:8]}")
    print(f"  correo ilegible     : {len(correo_invalido)}  {correo_invalido[:5]}")

    if args.revisar:
        print("\nPrimeros cambios que se aplicarían:")
        for clave, usuario, correo in aplicables[:15]:
            print(f"   {clave:<12} {_texto(usuario.get('email')) or '(sin correo)':<34} -> {correo}")
        print("\nModo revisión: no se escribió nada.")
        return 0

    if not aplicables:
        print("\nNada que aplicar.")
        return 0

    aplicados, rechazados = 0, []
    for clave, usuario, correo in aplicables:
        try:
            backend.asignar_correo(usuario, correo)
        except HTTPException as exc:
            rechazados.append((clave, correo, exc.detail))
            continue
        aplicados += 1

    if rechazados:
        print(f"\n{len(rechazados)} filas rechazadas (el resto sí se aplica):")
        for clave, correo, motivo in rechazados[:10]:
            print(f"   {clave} / {correo}: {motivo}")

    if aplicados == 0:
        print("\nNo se aplicó ninguno. No se escribe el estado.")
        return 2

    print(f"\nPersistiendo {aplicados} correos...")
    await backend.persist_users_only()
    print("Hecho.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
