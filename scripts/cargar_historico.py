"""Carga en Supabase el padrón y el histórico de servicios de la intranet.

Qué hace
--------
Tres cosas, en este orden, porque cada una se apoya en la anterior:

1. **Padrón** — un registro por pasajero con su domicilio resuelto y el estado
   de confianza que le corresponde. La resolución la hace
   `geocodificar_pasajeros`, que no se duplica aquí: los umbrales están
   calibrados contra los domicilios conocidos y deben vivir en un solo sitio.

2. **Histórico** — una fila por pasajero transportado. Es lo que realmente
   ocurrió, y es la materia prima de todo lo demás.

3. **Duraciones base** — cuánto tarda de verdad cada tipo de ruta. Esto es lo
   que sustituye al tiempo teórico del mapa, que para esta operación se queda
   corto de forma sistemática.

Sobre las duraciones
--------------------
Se guardan en dos niveles: por cobertura + modalidad + turno, y por cobertura +
modalidad agregando todos los turnos. Hace falta porque casi la mitad de las
combinaciones con turno tienen menos de cinco casos en un mes; ahí el nivel
grueso es el único con datos suficientes para decir algo.

De cada celda se guarda la mediana y el percentil 90. La mediana es lo que se
espera; la diferencia con el p90 es el margen, y de ahí sale el riesgo que se
le muestra al programador. Ninguno de los dos es una estimación inventada: son
los cuantiles observados.

Repetible
---------
Todo se escribe con `upsert` sobre la clave natural, así que volver a cargar el
mismo mes no duplica nada y cargar un mes nuevo solo añade.

Cómo se usa
-----------
    python scripts/cargar_historico.py --revisar
    python scripts/cargar_historico.py --cargar
    python scripts/cargar_historico.py --cargar --reporte "ruta/al/Reporte.xlsx"

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from datetime import datetime

import numpy as np
import pandas as pd

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx  # noqa: E402

from api import index as backend  # noqa: E402
from geocodificar_pasajeros import (  # noqa: E402
    REPORTE, cargar_reporte, clasificar_rastro, estimar_por_rastro, padron,
)

LOTE = 500  # filas por petición; 21.277 caben en 43 viajes

# Mínimo de casos para que una celda de duración signifique algo. Por debajo,
# la mediana es la de dos o tres servicios y no describe la ruta.
MINIMO_CASOS = 3


def _url(tabla):
    base = str(backend.STORAGE_CONFIG.url).rstrip("/")
    return f"{base}/{tabla}"


def _cabeceras(conflicto):
    return {
        **backend.HEADERS,
        "Content-Type": "application/json",
        "Prefer": f"resolution=merge-duplicates,return=minimal",
        "on-conflict": conflicto,
    }


def subir(cliente, tabla, filas, conflicto):
    """Sube en lotes con upsert. Devuelve cuántas filas entraron."""
    escritas = 0
    for inicio in range(0, len(filas), LOTE):
        trozo = filas[inicio:inicio + LOTE]
        r = cliente.post(
            _url(tabla), params={"on_conflict": conflicto},
            headers=_cabeceras(conflicto), json=trozo,
        )
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"{tabla}: {r.status_code} {r.text[:300]}")
        escritas += len(trozo)
        if escritas % (LOTE * 5) == 0 or escritas == len(filas):
            print(f"   {tabla}: {escritas}/{len(filas)}")
    return escritas


def _limpio(valor):
    """Un texto utilizable, o `None`. Pandas devuelve `nan` por todas partes."""
    if valor is None:
        return None
    texto = str(valor).strip()
    return texto if texto and texto.lower() != "nan" else None


def _hora(valor):
    """'HH:MM:SS' a partir de lo que sea que traiga la celda.

    La columna mezcla tipos: la mayoria son `datetime.time`, pero algunas filas
    llegan como fecha completa. Pasar a texto y cortar los primeros caracteres
    daba '1900-' en esas, y ese turno inventado habria corrompido el conjunto.
    """
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return None
    hora = getattr(valor, "hour", None)
    if hora is not None:
        return "%02d:%02d:%02d" % (hora, valor.minute, getattr(valor, "second", 0))
    texto = _limpio(valor)
    if not texto or ":" not in texto:
        return None
    if " " in texto:
        texto = texto.split(" ")[-1]
    return texto[:8]


def _turno(valor):
    """'HH:MM' del turno programado, o `None`."""
    hora = _hora(valor)
    return hora[:5] if hora else None


def _fecha(valor):
    if pd.isna(valor):
        return None
    try:
        return pd.to_datetime(valor).date().isoformat()
    except (ValueError, TypeError):
        return None


def construir_padron(df):
    """El padrón con el domicilio resuelto, listo para subir."""
    gente = padron(df)
    rastros = {str(dni): g for dni, g in
               df[(df["mod"] == "RECOJO") & df["gps_ok"]].groupby("DNI")}

    filas = []
    for _, fila in gente.iterrows():
        registro = {
            "dni": fila["dni"], "nombre": fila["nombre"],
            "direccion": _limpio(fila["direccion"]),
            "distrito": _limpio(fila["distrito"]),
            "cobertura": _limpio(fila["cobertura"]),
            "lat": None, "lng": None, "estado_ubicacion": "no_resuelta",
            "origen_ubicacion": None, "dispersion_m": None,
            "puntos_rastro": None, "motivo": None,
            "actualizado_en": datetime.now().astimezone().isoformat(),
        }

        declarada = fila["coord_declarada"]
        if isinstance(declarada, tuple):
            registro.update(lat=declarada[0], lng=declarada[1],
                            estado_ubicacion="resuelta", origen_ubicacion="declarada")
            filas.append(registro)
            continue

        grupo = rastros.get(fila["dni"])
        if grupo is None:
            registro["motivo"] = "El pasajero no tiene ningun recojo con GPS."
            registro["puntos_rastro"] = 0
            filas.append(registro)
            continue

        lat, lng, dispersion, n = estimar_por_rastro(grupo)
        estado, motivo = clasificar_rastro(dispersion, n)
        registro["puntos_rastro"] = n
        registro["motivo"] = motivo or None
        if math.isfinite(dispersion):
            registro["dispersion_m"] = round(dispersion)
        if estado != "no_resuelta":
            registro.update(lat=lat, lng=lng, estado_ubicacion=estado,
                            origen_ubicacion="rastro_gps")
        filas.append(registro)
    return filas


def construir_historico(df):
    """Una fila por pasajero transportado, deduplicada por su clave natural."""
    datos = df.copy()
    datos["turno"] = datos["Horaprogramada"].apply(_turno)
    datos["dia"] = pd.to_datetime(datos["Fechaejecutada"]).dt.date

    # Seis filas del mes repiten la clave natural: son registros duplicados de
    # la intranet, no servicios distintos. Se conserva la mas completa.
    datos["_completitud"] = datos[["Hora de inicio", "Horallegada",
                                   "Latitudinicio"]].notna().sum(axis=1)
    datos = (datos.sort_values("_completitud", ascending=False)
                  .drop_duplicates(subset=["dia", "CodigoVehiculo", "turno",
                                           "DNI", "mod"]))

    filas = []
    # Por nombre y no por posicion: los nombres con espacios —«Hora de
    # inicio»— no son identificadores validos, y con `itertuples` se renombran
    # a `_6`, `_7`... por orden. Bastaba con que el Excel moviera una columna
    # para que las horas se cruzaran en silencio, que es lo que pasaba.
    for reg in datos.to_dict("records"):
        if reg.get("mod") not in ("RECOJO", "SALIDA"):
            continue
        filas.append({
            "fecha_ejecutada": _fecha(reg.get("Fechaejecutada")),
            "fecha_programada": _fecha(reg.get("Fechaprogramada")),
            "sede": _limpio(reg.get("Sede")),
            "modalidad": reg["mod"],
            "turno": reg.get("turno"),
            "cobertura": _limpio(reg.get("Cobertura")),
            "distrito": _limpio(reg.get("Distrito")),
            "codigo_vehiculo": _limpio(reg.get("CodigoVehiculo")),
            "dni": _limpio(reg.get("DNI")),
            "hora_inicio": _hora(reg.get("Hora de inicio")),
            "hora_en_punto": _hora(reg.get("Hora en el punto")),
            "hora_llegada": _hora(reg.get("Horallegada")),
            "incidencia": _limpio(reg.get("Incidencia")),
            "lat_inicio": float(reg["la"]) if pd.notna(reg.get("la")) else None,
            "lng_inicio": float(reg["lo"]) if pd.notna(reg.get("lo")) else None,
        })
    return [f for f in filas if f["fecha_ejecutada"] and f["turno"]]


def construir_duraciones(df):
    """Mediana y p90 de la duracion real, por ruta y en dos niveles."""
    datos = df.copy()
    datos["turno"] = datos["Horaprogramada"].apply(_turno)
    datos["dia"] = pd.to_datetime(datos["Fechaejecutada"]).dt.date

    def minutos(serie):
        # Mismo motivo que en `_hora`: la columna mezcla `time` con fechas
        # completas, y un formato fijo descarta silenciosamente la mitad.
        def uno(v):
            hora = getattr(v, "hour", None)
            return hora * 60 + v.minute if hora is not None else np.nan
        return serie.apply(uno)

    datos["_ini"] = minutos(datos["Hora de inicio"])
    datos["_fin"] = minutos(datos["Horallegada"])

    servicio = datos.groupby(["dia", "CodigoVehiculo", "turno", "mod"]).agg(
        ini=("_ini", "min"), fin=("_fin", "max"),
        cobertura=("Cobertura", "first")).dropna(subset=["ini", "fin"])
    servicio["dur"] = servicio["fin"] - servicio["ini"]
    # Fuera de este rango no es un servicio: es un registro mal cerrado.
    servicio = servicio[(servicio["dur"] > 5) & (servicio["dur"] < 300)].reset_index()

    filas = []
    ahora = datetime.now().astimezone().isoformat()
    for claves, etiqueta in ((["cobertura", "mod", "turno"], "con turno"),
                             (["cobertura", "mod"], "todos los turnos")):
        for valores, grupo in servicio.groupby(claves):
            if len(grupo) < MINIMO_CASOS:
                continue
            cobertura = valores[0] if isinstance(valores, tuple) else valores
            if not _limpio(cobertura):
                continue
            filas.append({
                "cobertura": str(cobertura),
                "modalidad": grupo["mod"].iloc[0],
                "turno": str(valores[2]) if etiqueta == "con turno" else "",
                "n_casos": len(grupo),
                "p50_minutos": round(float(np.median(grupo["dur"])), 1),
                "p90_minutos": round(float(np.percentile(grupo["dur"], 90)), 1),
                "actualizado_en": ahora,
            })
    return filas


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    g.add_argument("--cargar", action="store_true", help="Escribe en Supabase")
    p.add_argument("--reporte", default=REPORTE, help="Excel de la intranet")
    args = p.parse_args()

    print(f"Leyendo {os.path.basename(args.reporte)}...")
    df = cargar_reporte(args.reporte)

    pasajeros = construir_padron(df)
    historico = construir_historico(df)
    duraciones = construir_duraciones(df)

    from collections import Counter
    estados = Counter(f["estado_ubicacion"] for f in pasajeros)
    print(f"\n  pasajeros        : {len(pasajeros):,}   {dict(estados)}")
    print(f"  servicios        : {len(historico):,}")
    print(f"  celdas de duracion: {len(duraciones):,} "
          f"({sum(1 for d in duraciones if d['turno']):,} con turno)")

    if args.revisar:
        print("\nModo revision: no se escribio nada.")
        return 0

    with httpx.Client(timeout=90.0) as cliente:
        print("\nSubiendo...")
        subir(cliente, "pasajeros", pasajeros, "dni")
        subir(cliente, "servicios_historicos", historico,
              "fecha_ejecutada,codigo_vehiculo,turno,dni,modalidad")
        subir(cliente, "duraciones_base", duraciones, "cobertura,modalidad,turno")
    print("\nListo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
