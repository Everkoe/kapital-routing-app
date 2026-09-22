"""Calibra el método de ubicación y rescata direcciones por geocodificación.

Qué ya NO hace
--------------
Resolver el padrón. Eso lo hace la propia base con `recalcular_ubicaciones()`,
sobre el histórico acumulado y sin mover datos, y la lectura del reporte vive
en `api/historico_intranet`. Este script no duplica nada de eso: importa de
ahí, porque dos copias de la misma regla acaban desviándose —le pasó a este
repositorio con las listas de documentos y costó días encontrarlo—.

Para qué sirve entonces
-----------------------
`--calibrar`  Vuelve a medir el error del método contra los domicilios que el
              reporte sí declara. Es de donde salieron los umbrales que usa el
              sistema, y hay que repetirlo cuando cambien los datos o se quiera
              revisar la decisión. Sin esto, «dispersión < 150 m» sería un
              número elegido a ojo.

`--rescatar`  Intenta geocodificar por dirección a quien el rastro GPS no
              alcanza. Rinde poco —el 88% de estas direcciones no existen en
              ninguna base de calles, porque son manzana y lote— pero es gratis
              y recupera algunas. Lo que saca queda marcado como dudoso: 141 m
              de error mediano y sin forma de verificarlo.

Coste
-----
Cero. Nominatim es gratuito; se consulta a una por segundo como pide su
política y las respuestas quedan en caché.

Cómo se usa
-----------
    python scripts/geocodificar_pasajeros.py --calibrar
    python scripts/geocodificar_pasajeros.py --rescatar

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402

from api import historico_intranet as hi  # noqa: E402
from api import index as backend  # noqa: E402

REPORTE = os.path.join(os.path.expanduser("~"), "Downloads",
                       "0_Reporte Intranet - Agosto 2026.xlsx")
CACHE = os.path.join(RAIZ, "scratch", "geocode_cache.json")

NOMINATIM = "https://nominatim.openstreetmap.org/search"
CONTACTO = "kapitaldevspe@gmail.com"
PAUSA_SEGUNDOS = 1.1

# Tipos de lugar que identifican un domicilio o su calle. Un resultado
# administrativo significa que no entendió la dirección y devolvió el centro de
# la zona, que no es la casa de nadie.
TIPOS_UTILES = {
    "house", "building", "residential", "apartments", "commercial", "retail",
    "primary", "secondary", "tertiary", "unclassified", "living_street",
    "pedestrian", "road", "footway", "service", "trunk", "motorway", "yes",
}


def _url(recurso: str) -> str:
    return f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/{recurso}"


def _cliente_geocodificador():
    return httpx.Client(
        headers={"User-Agent": "KapitalRouting/1.0 (padron; %s)" % CONTACTO},
        timeout=30.0)


def _leer_cache():
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _guardar_cache(datos):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)


def calibrar():
    """Mide el error del método contra los domicilios que el reporte declara.

    Es la comprobación que sostiene los umbrales: se estima el domicilio de
    quien además lo declara, y se compara la estimación con la verdad.
    """
    datos = hi.leer_reporte(REPORTE)
    verdad = {}
    for dni, grupo in datos.groupby("DNI"):
        declaradas = [c for c in grupo["casa"] if isinstance(c, tuple)]
        if declaradas:
            verdad[dni] = declaradas[0]

    recojos = datos[(datos["mod"] == "RECOJO") & datos["gps_ok"]]
    filas = []
    for dni, grupo in recojos.groupby("DNI"):
        if dni not in verdad:
            continue
        lat, lng, dispersion, n = hi.estimar_por_rastro(grupo)
        estado, _ = hi.clasificar_rastro(dispersion, n)
        filas.append((estado, hi.metros(verdad[dni], (lat, lng))))

    print("Calibracion sobre %d pasajeros con domicilio declarado.\n" % len(filas))
    print("error real frente a la verdad, por estado asignado:")
    for estado in ("resuelta", "dudosa", "no_resuelta"):
        errores = np.array([e for s, e in filas if s == estado])
        if not errores.size:
            continue
        print("   %-12s n=%3d   mediana %6.0f m   p90 %6.0f m   bajo 300 m: %3.0f%%"
              % (estado, errores.size, np.median(errores),
                 np.percentile(errores, 90), 100 * (errores <= 300).mean()))
    print("\nSi «resuelta» deja de estar en unas decenas de metros, los umbrales")
    print("de `api/historico_intranet` han dejado de describir estos datos.")
    return 0


def rescatar():
    """Geocodifica por dirección a quien el rastro GPS no alcanza."""
    respuesta = httpx.get(_url("pasajeros"), headers=backend.HEADERS, timeout=60.0,
                          params={"select": "dni,nombre,direccion,distrito",
                                  "estado_ubicacion": "eq.no_resuelta"})
    if respuesta.status_code != 200:
        print("No se pudo leer el padron: %s" % respuesta.status_code)
        return 1

    pendientes = [p for p in respuesta.json() if (p.get("direccion") or "").strip()]
    print("%d pasajeros sin ubicar y con direccion escrita." % len(pendientes))
    print("(~%.0f min; se guarda en cache)\n" % (len(pendientes) * PAUSA_SEGUNDOS / 60))

    cache = _leer_cache()
    rescatados = []
    with _cliente_geocodificador() as cliente:
        for i, fila in enumerate(pendientes, 1):
            consulta = ", ".join(x for x in (fila["direccion"], fila.get("distrito"),
                                             "Lima", "Peru") if x)
            if consulta in cache:
                encontrado = cache[consulta]
            else:
                try:
                    r = cliente.get(NOMINATIM, params={
                        "q": consulta, "format": "jsonv2", "limit": 1,
                        "countrycodes": "pe", "addressdetails": 1})
                    hallazgos = r.json() if r.status_code == 200 else []
                    encontrado = hallazgos[0] if hallazgos else None
                except Exception:  # noqa: BLE001 - una direccion no detiene el lote
                    encontrado = None
                cache[consulta] = encontrado
                time.sleep(PAUSA_SEGUNDOS)

            if not encontrado or str(encontrado.get("type")) not in TIPOS_UTILES:
                continue
            try:
                lat, lng = float(encontrado["lat"]), float(encontrado["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if not hi.en_lima(lat, lng):
                continue
            rescatados.append({
                "dni": fila["dni"], "lat": lat, "lng": lng,
                "estado_ubicacion": "dudosa", "origen_ubicacion": "geocodificada",
                "motivo": "Geocodificado por direccion: 141 m de error mediano, sin verificar.",
            })
            if i % 50 == 0:
                _guardar_cache(cache)
                print("   %d/%d  (%d rescatados)" % (i, len(pendientes), len(rescatados)))
    _guardar_cache(cache)

    print("\n%d de %d resueltos por direccion." % (len(rescatados), len(pendientes)))
    if not rescatados:
        return 0

    escritura = httpx.post(
        _url("pasajeros"), params={"on_conflict": "dni"},
        headers={**backend.HEADERS, "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        json=rescatados, timeout=90.0)
    print("guardado: %s" % escritura.status_code)
    return 0 if escritura.status_code in (200, 201, 204) else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--calibrar", action="store_true",
                   help="Mide el error del metodo contra domicilios declarados")
    g.add_argument("--rescatar", action="store_true",
                   help="Geocodifica por direccion lo que el rastro no alcanza")
    args = p.parse_args()
    return calibrar() if args.calibrar else rescatar()


if __name__ == "__main__":
    raise SystemExit(main())
