"""Resuelve a coordenadas el domicilio de cada pasajero del reporte de intranet.

Por qué existe
--------------
Sin un punto por pasajero no hay ruteo posible: cualquier optimizador colocaría
con precisión de metros a quien no sabe dónde vive. Medido sobre el reporte de
agosto (21.277 servicios, 1.111 pasajeros), solo 418 traen coordenada declarada
—en la columna `Referencia`, como par `lat, lng`—. Los 693 restantes tienen
dirección escrita, pero ningún punto.

De dónde sale el punto que falta
--------------------------------
No de un geocodificador. Se probó primero y falla en el 88% de estas
direcciones, porque buena parte del padrón vive en notación de manzana y lote
—`MZ A1 LT 31`, `MANZ 37 LOTE 4-C`— que no existe en ninguna base de calles.
Cuando acierta es preciso (141 m de error mediano), pero acierta poco.

La salida está en los propios datos: cada servicio de recojo deja el GPS del
vehículo al iniciarlo. Un punto suelto es ruidoso, pero **la mediana de los
puntos de un pasajero cae sobre su casa**. Comprobado contra los 418 domicilios
conocidos: 29 m de error mediano.

Cómo se decide si un punto es fiable
------------------------------------
El umbral no es inventado: sale de medir el error real contra esos 418
domicilios. La dispersión del rastro predice el error con claridad:

    dispersión < 150 m   ->  error mediano    21 m   (88% por debajo de 300 m)
    dispersión 150-400 m ->  error mediano   155 m   (58%)
    dispersión 400-800 m ->  error mediano   553 m   (33%)
    dispersión > 800 m   ->  error mediano  1820 m   (17%)

Y por debajo de tres puntos el error se dispara a 915 m, tenga la dispersión
que tenga. De ahí las reglas que aplica `clasificar_rastro`.

Un pasajero que no alcanza el umbral **no recibe una coordenada aproximada**:
se marca para revisión humana. Una ubicación inventada que no se anuncia
invalida cualquier ruteo posterior, y nadie puede corregir lo que no ve.

Coste
-----
Cero. El método principal usa datos que ya tienes. El respaldo por
geocodificación usa Nominatim, gratuito, a una consulta por segundo como pide
su política, con caché en disco para no repetir consultas.

Cómo se usa
-----------
    python scripts/geocodificar_pasajeros.py --resolver
    python scripts/geocodificar_pasajeros.py --resolver --con-geocodificador
    python scripts/geocodificar_pasajeros.py --calibrar

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from datetime import datetime

import httpx
import numpy as np
import pandas as pd

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORTE = os.path.join(os.path.expanduser("~"), "Downloads",
                       "0_Reporte Intranet - Agosto 2026.xlsx")
CACHE = os.path.join(RAIZ, "scratch", "geocode_cache.json")

NOMINATIM = "https://nominatim.openstreetmap.org/search"
CONTACTO = "kapitaldevspe@gmail.com"
PAUSA_SEGUNDOS = 1.1

# Lima metropolitana con holgura. Fuera de esto no es un domicilio de la operación.
LIMA_LAT = (-13.2, -11.0)
LIMA_LNG = (-77.6, -76.3)

# Umbrales calibrados contra los 418 domicilios conocidos (ver cabecera).
MINIMO_PUNTOS = 3
DISPERSION_FIABLE = 150.0   # metros
DISPERSION_DUDOSA = 400.0

# Tipos de lugar que identifican un domicilio o su calle. Un resultado
# administrativo significa que el geocodificador no entendió la dirección y
# devolvió el centro de la zona, que no es la casa de nadie.
TIPOS_UTILES = {
    "house", "building", "residential", "apartments", "commercial", "retail",
    "primary", "secondary", "tertiary", "unclassified", "living_street",
    "pedestrian", "road", "footway", "service", "trunk", "motorway", "yes",
}

PAR_COORD = re.compile(r"^\s*(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\s*$")


def en_lima(lat, lng):
    return LIMA_LAT[0] <= lat <= LIMA_LAT[1] and LIMA_LNG[0] <= lng <= LIMA_LNG[1]


def coordenada_declarada(valor):
    """La coordenada de casa que ya trae el reporte, o `None`."""
    m = PAR_COORD.match(str(valor))
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    return (lat, lng) if en_lima(lat, lng) else None


def metros(a, b):
    """Distancia aproximada entre dos coordenadas, en metros."""
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot((b[1] - a[1]) * 111_320 * math.cos(lat),
                      (b[0] - a[0]) * 110_540)


def cargar_reporte(ruta=REPORTE):
    df = pd.read_excel(ruta, sheet_name="Consolidado", header=2)
    df.columns = [str(c).strip() for c in df.columns]
    df = df[df["Usuario"].notna()].copy()
    df["casa"] = df["Referencia"].apply(coordenada_declarada)
    df["mod"] = df["Modalidad"].astype(str).str.upper().str.strip()
    df["la"] = pd.to_numeric(df["Latitudinicio"], errors="coerce")
    df["lo"] = pd.to_numeric(df["Longitudinicio"], errors="coerce")
    df["gps_ok"] = df["la"].between(*LIMA_LAT) & df["lo"].between(*LIMA_LNG)
    return df


def estimar_por_rastro(grupo):
    """(lat, lng, dispersión, n) a partir del GPS de los recojos del pasajero.

    La mediana y no el promedio: un solo punto disparatado —el vehículo
    arrancando desde otro sitio— desplazaría un promedio, pero no una mediana.
    La dispersión se mide igual, como mediana de las distancias al estimado, y
    es la que después decide si el punto se puede usar.
    """
    lat = float(grupo["la"].median())
    lng = float(grupo["lo"].median())
    if len(grupo) > 1:
        dispersion = float(np.median([metros((lat, lng), (f.la, f.lo))
                                      for f in grupo.itertuples()]))
    else:
        dispersion = float("inf")
    return lat, lng, dispersion, len(grupo)


def clasificar_rastro(dispersion, n):
    """(estado, motivo) según los umbrales calibrados."""
    if n < MINIMO_PUNTOS:
        return ("no_resuelta",
                "Solo %d recojo(s) con GPS: por debajo de %d el error mediano es de 915 m."
                % (n, MINIMO_PUNTOS))
    if dispersion < DISPERSION_FIABLE:
        return "resuelta", ""
    if dispersion < DISPERSION_DUDOSA:
        return ("dudosa",
                "El rastro se dispersa %.0f m; a esa dispersion el error mediano es de 155 m."
                % dispersion)
    return ("no_resuelta",
            "El rastro se dispersa %.0f m: demasiado para situar un domicilio." % dispersion)


def cajas_por_distrito(df):
    """Caja envolvente de cada distrito, desde las coordenadas reales."""
    cajas = {}
    holgura = 0.02  # ~2 km: los conocidos no cubren todo el distrito
    for distrito, grupo in df[df["casa"].notna()].groupby("Distrito"):
        lats = [c[0] for c in grupo["casa"]]
        lngs = [c[1] for c in grupo["casa"]]
        if len(lats) < 3:
            continue
        cajas[str(distrito).strip().upper()] = (
            min(lats) - holgura, max(lats) + holgura,
            min(lngs) - holgura, max(lngs) + holgura,
        )
    return cajas


def padron(df):
    """Un registro por pasajero con su mejor dirección y su coordenada si la hay."""
    filas = []
    for dni, grupo in df.groupby("DNI"):
        conocidas = [c for c in grupo["casa"] if c]
        direcciones = [str(d).strip() for d in grupo["Direccion"].dropna() if str(d).strip()]
        filas.append({
            "dni": str(dni),
            "nombre": str(grupo["Usuario"].iloc[0]),
            "direccion": max(direcciones, key=len) if direcciones else "",
            "distrito": str(grupo["Distrito"].iloc[0]).strip(),
            "cobertura": str(grupo["Cobertura"].iloc[0]).strip(),
            "coord_declarada": conocidas[0] if conocidas else None,
        })
    return pd.DataFrame(filas)


# --- Respaldo por geocodificación -------------------------------------------

def leer_cache():
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def guardar_cache(datos):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False)


def abrir_cliente():
    return httpx.Client(
        headers={"User-Agent": "KapitalRouting/1.0 (padron; %s)" % CONTACTO},
        timeout=30.0)


def consulta_de(fila):
    partes = [fila["direccion"], fila["distrito"], "Lima", "Peru"]
    return ", ".join(p for p in partes if p and str(p).lower() != "nan")


def geocodificar(cliente, consulta, cache):
    """Consulta el geocodificador o devuelve lo guardado. Nunca lanza."""
    if consulta in cache:
        return cache[consulta]
    try:
        r = cliente.get(NOMINATIM, params={
            "q": consulta, "format": "jsonv2", "limit": 1,
            "countrycodes": "pe", "addressdetails": 1})
        datos = r.json() if r.status_code == 200 else []
        salida = datos[0] if datos else None
    except Exception:  # noqa: BLE001 - una direccion que falla no detiene el lote
        salida = None
    cache[consulta] = salida
    time.sleep(PAUSA_SEGUNDOS)
    return salida


def clasificar_geocodificado(resultado, distrito, cajas):
    """(estado, lat, lng, motivo) para un resultado del geocodificador."""
    if not resultado:
        return "no_resuelta", None, None, "Ni rastro de GPS ni direccion geocodificable."
    try:
        lat, lng = float(resultado["lat"]), float(resultado["lon"])
    except (KeyError, TypeError, ValueError):
        return "no_resuelta", None, None, "Respuesta sin coordenada legible."
    if not en_lima(lat, lng):
        return "no_resuelta", lat, lng, "El punto cae fuera de Lima."
    tipo = str(resultado.get("type") or "")
    if tipo not in TIPOS_UTILES:
        return ("no_resuelta", lat, lng,
                "Solo identifico la zona, no la direccion (tipo '%s')." % tipo)
    caja = cajas.get(str(distrito).strip().upper())
    if caja and not (caja[0] <= lat <= caja[1] and caja[2] <= lng <= caja[3]):
        return ("dudosa", lat, lng,
                "El punto cae fuera del distrito declarado (%s)." % distrito)
    return "dudosa", lat, lng, "Geocodificado: 141 m de error mediano, sin verificar contra rastro."


# --- Modos ------------------------------------------------------------------

def calibrar():
    """Mide el error del método contra los domicilios ya conocidos."""
    df = cargar_reporte()
    verdad = df[df["casa"].notna()].groupby("DNI")["casa"].first()
    rec = df[(df["mod"] == "RECOJO") & df["gps_ok"] & df["DNI"].isin(verdad.index)]

    filas = []
    for dni, grupo in rec.groupby("DNI"):
        lat, lng, dispersion, n = estimar_por_rastro(grupo)
        estado, _ = clasificar_rastro(dispersion, n)
        filas.append({"dispersion": dispersion, "n": n, "estado": estado,
                      "error": metros(verdad[dni], (lat, lng))})
    cal = pd.DataFrame(filas)
    print("Calibracion sobre %d pasajeros con domicilio conocido.\n" % len(cal))
    print("error real por estado asignado:")
    for estado in ("resuelta", "dudosa", "no_resuelta"):
        s = cal[cal["estado"] == estado]
        if s.empty:
            continue
        e = s["error"].values
        print("   %-12s n=%3d   mediana %6.0f m   p90 %6.0f m   por debajo de 300 m: %3.0f%%"
              % (estado, len(s), np.median(e), np.percentile(e, 90), 100 * (e <= 300).mean()))
    return 0


def resolver(con_geocodificador):
    df = cargar_reporte()
    cajas = cajas_por_distrito(df)
    gente = padron(df)
    # La clave se normaliza a texto: el padron guarda el DNI como cadena y
    # `groupby` lo devuelve como numero, asi que sin esto no casaria ninguno.
    rastros = {str(dni): g for dni, g in
               df[(df["mod"] == "RECOJO") & df["gps_ok"]].groupby("DNI")}

    salida = []
    for _, fila in gente.iterrows():
        base = {k: fila[k] for k in ("dni", "nombre", "direccion", "distrito", "cobertura")}

        # Al pasar por el DataFrame, un `None` puede volverse `NaN`: la tupla
        # se comprueba por su tipo y no por verdad, o un flotante se cuela.
        declarada = fila["coord_declarada"]
        if isinstance(declarada, tuple):
            lat, lng = declarada
            salida.append({**base, "lat": lat, "lng": lng, "estado": "resuelta",
                           "origen": "declarada", "dispersion_m": None,
                           "puntos": None, "motivo": ""})
            continue

        grupo = rastros.get(fila["dni"])
        if grupo is not None:
            lat, lng, dispersion, n = estimar_por_rastro(grupo)
            estado, motivo = clasificar_rastro(dispersion, n)
            if estado != "no_resuelta":
                salida.append({**base, "lat": lat, "lng": lng, "estado": estado,
                               "origen": "rastro_gps",
                               "dispersion_m": round(dispersion),
                               "puntos": n, "motivo": motivo})
                continue
        else:
            dispersion, n, motivo = None, 0, "El pasajero no tiene ningun recojo con GPS."

        # Con un solo punto la dispersion es infinita por definicion y no hay
        # nada que redondear; se deja vacia en vez de inventar un numero.
        medible = grupo is not None and math.isfinite(dispersion)
        salida.append({**base, "lat": None, "lng": None, "estado": "no_resuelta",
                       "origen": "", "dispersion_m": round(dispersion) if medible else None,
                       "puntos": n, "motivo": motivo})

    out = pd.DataFrame(salida)

    if con_geocodificador:
        pendientes = out[(out["estado"] == "no_resuelta") & (out["direccion"].str.len() > 8)]
        print("Respaldo por geocodificacion sobre %d direcciones (~%.0f min)...\n"
              % (len(pendientes), len(pendientes) * PAUSA_SEGUNDOS / 60))
        cache = leer_cache()
        with abrir_cliente() as cliente:
            for i, (idx, fila) in enumerate(pendientes.iterrows(), 1):
                res = geocodificar(cliente, consulta_de(fila), cache)
                estado, lat, lng, motivo = clasificar_geocodificado(res, fila["distrito"], cajas)
                if estado != "no_resuelta":
                    out.loc[idx, ["lat", "lng", "estado", "origen", "motivo"]] = \
                        [lat, lng, estado, "geocodificada", motivo]
                if i % 50 == 0:
                    guardar_cache(cache)
                    print("   %d/%d" % (i, len(pendientes)))
        guardar_cache(cache)

    destino = os.path.join(RAIZ, "scratch",
                           "padron-coordenadas-%s.csv" % datetime.now().strftime("%Y%m%d-%H%M%S"))
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    out.to_csv(destino, index=False, encoding="utf-8-sig")

    print("\nPADRON: %d pasajeros\n" % len(out))
    for estado, n in out["estado"].value_counts().items():
        print("   %-12s %4d  (%2.0f%%)" % (estado, n, 100 * n / len(out)))
    print("\norigen del punto:")
    for origen, n in out[out["origen"] != ""]["origen"].value_counts().items():
        print("   %-14s %4d" % (origen, n))
    print("\nmotivos de lo que queda fuera:")
    for motivo, n in out[out["estado"] == "no_resuelta"]["motivo"].value_counts().head(5).items():
        print("   %4d  %s" % (n, motivo[:88]))
    print("\ninforme: %s" % destino)
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--resolver", action="store_true", help="Resuelve el padron completo")
    g.add_argument("--calibrar", action="store_true",
                   help="Mide el error del metodo contra domicilios conocidos")
    p.add_argument("--con-geocodificador", action="store_true",
                   help="Intenta ademas geocodificar lo que el rastro no resuelve")
    args = p.parse_args()
    return calibrar() if args.calibrar else resolver(args.con_geocodificador)


if __name__ == "__main__":
    raise SystemExit(main())
