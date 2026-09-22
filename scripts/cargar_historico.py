"""Carga masiva de reportes de la intranet en Supabase.

Cuándo se usa esto y cuándo la aplicación
-----------------------------------------
El día a día lo hace el Programador desde la aplicación: sube el reporte y el
endpoint `POST /api/programador/historico` se encarga. Un día son ~830
servicios y tarda unos 3 segundos.

Este script existe para lo otro: importar meses enteros de una vez. Un mes son
21.271 servicios y unos 22 segundos, por encima de lo que aguanta una función
serverless, así que ese trabajo se hace desde aquí y una sola vez.

La lógica de lectura es la misma en los dos caminos —vive en
`api/historico_intranet`— para que no puedan desviarse.

Qué escribe
-----------
Las tres tablas, y después pide a la base que recalcule los domicilios sobre el
histórico acumulado. Ese recálculo es el que decide la ubicación de cada
pasajero: no sale del archivo, porque un archivo suelto tiene pocos puntos GPS
por persona y degradaría lo ya aprendido.

Repetible: todo se escribe con upsert sobre la clave natural.

Cómo se usa
-----------
    python scripts/cargar_historico.py --revisar
    python scripts/cargar_historico.py --cargar
    python scripts/cargar_historico.py --cargar --reporte "ruta/al/Reporte.xlsx"

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402

from api import historico_intranet as hi  # noqa: E402
from api import index as backend  # noqa: E402

REPORTE_POR_DEFECTO = os.path.join(os.path.expanduser("~"), "Downloads",
                                   "0_Reporte Intranet - Agosto 2026.xlsx")

# Filas por petición. Mandar 21.000 de una vez agota el tiempo de PostgREST.
LOTE = 500


def _url(recurso: str) -> str:
    return f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/{recurso}"


def subir(cliente, tabla, filas, conflicto):
    """Escribe en lotes resolviendo duplicados sobre la clave natural."""
    if not filas:
        return 0
    cabeceras = {**backend.HEADERS, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"}
    escritas = 0
    for inicio in range(0, len(filas), LOTE):
        trozo = filas[inicio:inicio + LOTE]
        r = cliente.post(_url(tabla), params={"on_conflict": conflicto},
                         headers=cabeceras, json=trozo)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"{tabla}: {r.status_code} {r.text[:300]}")
        escritas += len(trozo)
        if escritas % (LOTE * 5) == 0 or escritas == len(filas):
            print(f"   {tabla}: {escritas}/{len(filas)}")
    return escritas


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    g.add_argument("--cargar", action="store_true", help="Escribe en Supabase")
    p.add_argument("--reporte", default=REPORTE_POR_DEFECTO, help="Excel de la intranet")
    args = p.parse_args()

    print("Leyendo %s..." % os.path.basename(args.reporte))
    datos = hi.leer_reporte(args.reporte)
    declarados, deducidos = hi.construir_padron(datos)
    servicios = hi.construir_historico(datos)
    duraciones = hi.construir_duraciones(datos)

    print("\n  pasajeros         : %d  (%d con coordenada declarada)"
          % (len(declarados) + len(deducidos), len(declarados)))
    print("  servicios         : %d" % len(servicios))
    print("  celdas de duracion: %d" % len(duraciones))

    if args.revisar:
        print("\nModo revision: no se escribio nada.")
        return 0

    with httpx.Client(timeout=120.0) as cliente:
        print("\nSubiendo...")
        # Por separado: quien no declara coordenada se escribe sin las columnas
        # de ubicacion, para que lo ya aprendido sobre el sobreviva.
        subir(cliente, "pasajeros", declarados, "dni")
        subir(cliente, "pasajeros", deducidos, "dni")
        subir(cliente, "servicios_historicos", servicios,
              "fecha_ejecutada,codigo_vehiculo,turno,dni,modalidad")
        subir(cliente, "duraciones_base", duraciones, "cobertura,modalidad,turno")

        print("\nRecalculando domicilios sobre el historico acumulado...")
        r = cliente.post(_url("rpc/recalcular_ubicaciones"),
                         headers={**backend.HEADERS, "Content-Type": "application/json"},
                         json={})
        if r.status_code == 200 and r.json():
            u = r.json()[0]
            print("   %d resueltas · %d dudosas · %d a revision humana"
                  % (u.get("resueltas", 0), u.get("dudosas", 0), u.get("pendientes", 0)))
        else:
            print("   no se pudo recalcular: %s %s" % (r.status_code, r.text[:160]))

    print("\nListo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
