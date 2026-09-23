"""Repara los acentos que se rompieron al importar el histórico.

Qué pasó
--------
La intranet exporta un `.xls` que en realidad es HTML en UTF-8, y **no declara
el juego de caracteres**. Al abrirlo en Excel para volver a guardarlo como
`.xlsx` —el paso que hacía falta antes de que el lector entendiera el archivo
original— Excel asume cp1252, y «Ñ» (bytes C3 91) queda escrito como «Ã» más
U+2018. Ese texto roto se cargó tal cual en `pasajeros` y `servicios_historicos`.

El lector ya no necesita ese paso intermedio y además repara lo que le llegue
roto, así que esto no se va a repetir. Queda arreglar lo ya escrito.

Por qué se puede arreglar sin volver a importar
-----------------------------------------------
Porque no se perdió nada: los bytes siguen ahí, solo se interpretaron mal. Se
recomponen y se vuelven a decodificar como UTF-8. Lo hace `reparar_acentos`,
la misma función que usa el lector, para que no haya dos reglas.

Cómo se usa
-----------
    python scripts/reparar_acentos.py             # solo enseña qué cambiaría
    python scripts/reparar_acentos.py --aplicar   # lo escribe

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Sequence

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402

from api import index as backend  # noqa: E402
from api.historico_intranet import SENAL_MOJIBAKE, reparar_acentos  # noqa: E402

LOTE = 500

# PostgREST no devuelve más de mil filas por petición aunque se le pida un
# límite mayor: hay que pedirlas de mil en mil y parar cuando llegue una tanda
# corta. Pedir 5.000 y dar por terminada la lectura al recibir 1.000 dejaba
# fuera veinte mil servicios sin que nada lo dijera.
PAGINA = 1000

# Tabla -> (clave de conflicto, columnas de texto que pueden venir rotas).
TABLAS = {
    "pasajeros": ("dni", ("nombre", "direccion", "distrito")),
    "servicios_historicos": (
        "fecha_ejecutada,codigo_vehiculo,turno,dni,modalidad",
        ("distrito", "incidencia"),
    ),
}


def _url(recurso: str) -> str:
    return f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/{recurso}"


def _leer(tabla: str, columnas: Sequence[str], clave: str) -> List[Dict[str, Any]]:
    """Las filas de esa tabla, con su clave natural y sus columnas de texto."""
    seleccion = ",".join(dict.fromkeys(list(clave.split(",")) + list(columnas)))
    filas: List[Dict[str, Any]] = []
    while True:
        respuesta = httpx.get(
            _url(tabla), headers=backend.HEADERS, timeout=120.0,
            params={"select": seleccion, "order": clave.split(",")[0],
                    "limit": PAGINA, "offset": len(filas)},
        )
        respuesta.raise_for_status()
        lote = respuesta.json()
        filas.extend(lote)
        if len(lote) < PAGINA:
            return filas


def _rotas(filas: Sequence[Dict[str, Any]], columnas: Sequence[str],
           clave: str) -> List[Dict[str, Any]]:
    """Las filas que cambian, ya reparadas y con su clave para reescribirlas.

    Se escriben **todas** las columnas de texto, no solo las que cambian:
    PostgREST rechaza un lote cuyas filas no tengan las mismas claves
    («All object keys must match»), y reenviar un valor idéntico no hace nada.
    """
    arregladas = []
    for fila in filas:
        reparada = {columna: reparar_acentos(fila.get(columna))
                    for columna in columnas}
        if any(reparada[c] != fila.get(c) for c in columnas):
            arregladas.append({**{c: fila[c] for c in clave.split(",")}, **reparada})
    return arregladas


def _escribir(tabla: str, filas: Sequence[Dict[str, Any]], clave: str) -> None:
    cabeceras = {**backend.HEADERS, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"}
    for inicio in range(0, len(filas), LOTE):
        respuesta = httpx.post(_url(tabla), params={"on_conflict": clave},
                               headers=cabeceras, json=list(filas[inicio:inicio + LOTE]),
                               timeout=120.0)
        if respuesta.status_code not in (200, 201, 204):
            raise SystemExit("%s rechazo el lote: %s %s"
                             % (tabla, respuesta.status_code, respuesta.text[:200]))


def main() -> int:
    analizador = argparse.ArgumentParser(description=__doc__,
                                         formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("--aplicar", action="store_true",
                            help="Escribe los cambios; sin esto solo los enseña")
    argumentos = analizador.parse_args()

    total = 0
    for tabla, (clave, columnas) in TABLAS.items():
        filas = _leer(tabla, columnas, clave)
        arregladas = _rotas(filas, columnas, clave)
        total += len(arregladas)
        print("%-22s %6d filas, %4d con acentos rotos"
              % (tabla, len(filas), len(arregladas)))
        for fila in arregladas[:5]:
            for columna in columnas:
                if columna in fila:
                    print("      %s -> %s" % (columna, fila[columna]))
        if arregladas and argumentos.aplicar:
            _escribir(tabla, arregladas, clave)
            print("      escritas.")

    if total and not argumentos.aplicar:
        print("\nNada escrito. Repite con --aplicar.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
