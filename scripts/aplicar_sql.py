"""Aplica un archivo de `supabase/` contra la base de datos del proyecto.

Por qué existe
--------------
Los archivos de `supabase/` describen el esquema y las funciones, pero nada en
el repositorio sabía **ejecutarlos**: cada vez se hacía a mano con un script de
usar y tirar que se perdía al terminar la sesión. Eso deja el esquema del
repositorio y el de la base sin forma comprobable de coincidir, que es peor que
no tener los archivos.

No usa PostgREST: por ahí no pasa el DDL. Va por la API de gestión de Supabase
(`/v1/projects/{ref}/database/query`), que es la única vía disponible sin un
cliente de Postgres instalado, y necesita `SUPABASE_ACCESS_TOKEN`.

Cómo se usa
-----------
    python scripts/aplicar_sql.py supabase/003_plan_programador.sql
    python scripts/aplicar_sql.py --consulta "select count(*) from programacion"

Los archivos están escritos para poder reaplicarse —`create table if not
exists`, `create or replace function`—, así que volver a correr uno entero no
destruye nada. Aun así pide confirmación, porque una `drop` colada en el
archivo la ejecutaría igual.

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

API_GESTION = "https://api.supabase.com/v1"
TIEMPO_LIMITE = 120.0


def referencia_del_proyecto(url: str) -> str:
    """El `ref` del proyecto, que es el subdominio de su URL."""
    sin_esquema = url.split("://", 1)[-1]
    return sin_esquema.split(".", 1)[0]


def ejecutar(sql: str) -> object:
    load_dotenv(os.path.join(RAIZ, "frontend", ".env"))
    token = os.getenv("SUPABASE_ACCESS_TOKEN")
    url = os.getenv("KAPITAL_V2_SUPABASE_URL")
    if not token:
        raise SystemExit("Falta SUPABASE_ACCESS_TOKEN en frontend/.env.")
    if not url:
        raise SystemExit("Falta KAPITAL_V2_SUPABASE_URL en frontend/.env.")

    ref = referencia_del_proyecto(url)
    respuesta = httpx.post(
        f"{API_GESTION}/projects/{ref}/database/query",
        headers={"Authorization": f"Bearer {token}"},
        json={"query": sql},
        timeout=TIEMPO_LIMITE,
    )
    if respuesta.status_code >= 400:
        # El cuerpo trae el error de Postgres, que es lo único útil aquí.
        raise SystemExit(f"[{respuesta.status_code}] {respuesta.text}")
    return respuesta.json()


def main() -> int:
    partes = argparse.ArgumentParser(description=__doc__)
    partes.add_argument("archivo", nargs="?", help="ruta de un .sql")
    partes.add_argument("--consulta", help="SQL suelto, en vez de un archivo")
    partes.add_argument("--si", action="store_true",
                        help="no preguntar antes de aplicar un archivo")
    args = partes.parse_args()

    if args.consulta:
        sql = args.consulta
    elif args.archivo:
        with open(args.archivo, encoding="utf-8") as mano:
            sql = mano.read()
        if not args.si:
            print(f"Se van a aplicar {len(sql.splitlines())} líneas de "
                  f"{args.archivo}.")
            if input("¿Seguir? [s/N] ").strip().lower() not in ("s", "si", "sí"):
                print("Nada aplicado.")
                return 1
    else:
        partes.error("hace falta un archivo o --consulta")

    print(json.dumps(ejecutar(sql), ensure_ascii=False, indent=2)[:4000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
