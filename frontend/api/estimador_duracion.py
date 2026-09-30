"""Duración estimada de un servicio, aprendida del histórico con CatBoost.

Qué es y qué no es
------------------
Es la parte del ruteo que **aprende de la operación**: dado un servicio del
plan —ruta, turno, sentido, unidad, día y paradas—, estima cuánto va a durar
de verdad, con una banda que se ha comprobado sobre días que el modelo no vio.
No decide nada: informa al Programador y, más adelante, al motor.

El modelo se entrena fuera, con `scripts/entrenar_duracion.py`, y se exporta a
código Python puro en `api/modelo_duracion/`: CatBoost pesa 97 MB y no cabe en
Vercel, pero el modelo exportado no necesita la librería. Si ese paquete no
está, `estimar` devuelve `None` y el plan se enseña como siempre.

Por qué este módulo lo comparten el entrenamiento y el backend
---------------------------------------------------------------
Las características tienen que construirse igual al entrenar que al estimar;
si se desvían, el modelo sigue respondiendo y nadie lo nota. Al entrenar, las
muestras llegan ya agregadas desde la base (`muestras_de_duracion()`, en
`supabase/015_muestras_de_duracion.sql`, que no deja salir DNI ni
coordenadas); al estimar, `muestra_del_plan` las arma con la misma forma a
partir del plan. El recorrido se mide igual en los dos sitios: línea recta
(haversine, radio 6371 km) entre los domicilios resueltos, en el orden de
recogida, redondeado a centésimas.

Qué se mide
-----------
- RECOJO: desde que la unidad arranca hasta que llega a la sede.
- SALIDA: desde que sale de la sede hasta la última entrega. Medirla desde el
  arranque metía la espera en la sede y predecía peor (error medio de 25,7
  frente a 17,8 minutos con la misma tabla).
"""

from __future__ import annotations

import importlib.util
import logging
import math
import struct
import unicodedata
from datetime import date
from functools import lru_cache
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

CATEGORICAS: Tuple[str, ...] = ("modalidad", "sede", "cobertura", "turno", "vehiculo", "dia")
NUMERICAS: Tuple[str, ...] = ("turno_min", "programados", "paradas_ubicadas",
                              "frac_ubicadas", "km", "extension_km")

# Fuera de este rango no es un servicio, es un registro mal cerrado. El mismo
# criterio que `construir_duraciones` en `historico_intranet.py`.
DURACION_MINIMA = 5
DURACION_MAXIMA = 300

# Cuántos servicios de la misma ruta y turno ha visto el modelo. Por debajo
# de POCOS_CASOS la estimación se apoya en rutas parecidas, no en la suya, y
# la pantalla lo avisa con el error que se midió en ese caso.
POCOS_CASOS = 5
BASTANTES_CASOS = 20

RADIO_TIERRA_KM = 6371.0
MINUTOS_DEL_DIA = 24 * 60
SIN_VALOR = "NA"


def normalizar(texto: Any) -> str:
    """Texto sin tildes y en mayúsculas, o `NA` si no hay.

    El modelo exportado resume cada texto con un hash, y el de una «Ñ» no
    coincide con el de CatBoost: sin esto, BREÑA daba otra estimación en el
    backend que en el entrenamiento.
    """
    if texto is None:
        return SIN_VALOR
    # Tras separar las tildes, fuera todo lo que no sea ASCII: el texto roto
    # de la intranet trae comillas tipográficas donde iba una «Ñ».
    limpio = unicodedata.normalize("NFKD", str(texto).strip())
    limpio = limpio.encode("ascii", "ignore").decode("ascii").strip().upper()
    return limpio or SIN_VALOR


def minutos_del_turno(turno: Any) -> Optional[int]:
    """«06:00» → 360; `None` si no es una hora."""
    partes = str(turno or "").strip().split(":")
    if len(partes) != 2 or not all(p.isdigit() for p in partes):
        return None
    horas, minutos = int(partes[0]), int(partes[1])
    if horas > 23 or minutos > 59:
        return None
    return horas * 60 + minutos


def hora_legible(minutos: float) -> str:
    """Minutos desde medianoche, dando la vuelta al día, como «HH:MM»."""
    total = int(round(minutos)) % MINUTOS_DEL_DIA
    return f"{total // 60:02d}:{total % 60:02d}"


def distancia_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Distancia en línea recta entre dos puntos (lat, lng)."""
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * RADIO_TIERRA_KM * math.asin(math.sqrt(h))


def recorrido(puntos: Sequence[Tuple[float, float]]) -> Tuple[float, float]:
    """Kilómetros entre paradas en orden, y la diagonal de la zona que cubren."""
    if not puntos:
        return 0.0, 0.0
    km = sum(distancia_km(a, b) for a, b in zip(puntos, puntos[1:]))
    lats = [p[0] for p in puntos]
    lngs = [p[1] for p in puntos]
    extension = distancia_km((min(lats), min(lngs)), (max(lats), max(lngs)))
    return round(km, 2), round(extension, 2)


def _coordenada(valor: Any) -> Optional[float]:
    """Un número finito, o `None`: una coordenada ausente no es el cero."""
    if valor is None or str(valor).strip() == "":
        return None
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return None
    return numero if math.isfinite(numero) else None


def muestra_del_plan(ruta: Mapping[str, Any], dia: str) -> Optional[Dict[str, Any]]:
    """Un servicio del plan con la forma de las muestras de entrenamiento."""
    try:
        dia_semana = date.fromisoformat(str(dia)).isoweekday()
    except ValueError:
        return None
    agentes = [a for a in (ruta.get("agentes") or []) if isinstance(a, Mapping)]
    puntos = []
    for agente in agentes:
        if agente.get("ubicacion") != "resuelta":
            continue
        lat, lng = _coordenada(agente.get("lat")), _coordenada(agente.get("lng"))
        if lat is not None and lng is not None:
            puntos.append((lat, lng))
    km, extension = recorrido(puntos)
    return {
        "modalidad": ruta.get("modalidad"),
        "sede": ruta.get("sede"),
        "cobertura": ruta.get("micro_zona"),
        "turno": ruta.get("turno"),
        "vehiculo": ruta.get("conductor"),
        "dia_semana": dia_semana,
        # En un plan cada agente es una parada: el coche va aunque luego la
        # persona no suba, que es lo mismo que cuentan las muestras.
        "programados": len(agentes),
        "paradas": len(agentes),
        "paradas_ubicadas": len(puntos),
        "km": km,
        "extension_km": extension,
    }


def _en_float32(valor: float) -> float:
    """El número como lo ve CatBoost, que compara en precisión simple.

    El modelo exportado compara en doble: un servicio de 12,49 km, justo en un
    corte del árbol, caía del otro lado y la estimación cambiaba (lo detectó
    la comprobación de `scripts/entrenar_duracion.py`).
    """
    return struct.unpack("f", struct.pack("f", valor))[0]


def caracteristicas(muestra: Mapping[str, Any]) -> Optional[Tuple[Tuple[float, ...], Tuple[str, ...]]]:
    """Los números y los textos que recibe el modelo, en su orden fijo."""
    turno_min = minutos_del_turno(muestra.get("turno"))
    if turno_min is None:
        return None
    try:
        paradas = max(int(muestra.get("paradas") or 0), 1)
        numeros = tuple(_en_float32(v) for v in (
            float(turno_min),
            float(muestra.get("programados") or 0),
            float(muestra.get("paradas_ubicadas") or 0),
            float(muestra.get("paradas_ubicadas") or 0) / paradas,
            float(muestra.get("km") or 0),
            float(muestra.get("extension_km") or 0),
        ))
    except (TypeError, ValueError, OverflowError):
        return None
    textos = (
        normalizar(muestra.get("modalidad")),
        normalizar(muestra.get("sede")),
        normalizar(muestra.get("cobertura")),
        normalizar(muestra.get("turno")),
        normalizar(muestra.get("vehiculo")),
        str(muestra.get("dia_semana") or SIN_VALOR),
    )
    return numeros, textos


def duracion_observada(muestra: Mapping[str, Any]) -> Optional[float]:
    """Lo que el modelo aprende a predecir, o `None` si la muestra no vale."""
    desde = "primer_punto" if muestra.get("modalidad") == "SALIDA" else "inicio"
    inicio, llegada = muestra.get(desde), muestra.get("llegada")
    if inicio is None or llegada is None:
        return None
    duracion = float(llegada) - float(inicio)
    if not DURACION_MINIMA < duracion < DURACION_MAXIMA:
        return None
    return duracion


def clave_de_ruta(muestra: Mapping[str, Any]) -> str:
    """Con qué se cuentan los casos comparables: ruta, sentido y turno."""
    return "|".join(normalizar(muestra.get(c)) for c in ("cobertura", "modalidad", "turno"))


def confianza(casos: int) -> str:
    """Cuánto se apoya la estimación en servicios de su misma ruta."""
    if casos < POCOS_CASOS:
        return "baja"
    return "media" if casos < BASTANTES_CASOS else "alta"


def ajustar_cortes(modulo: Any) -> Any:
    """Los cortes de un modelo exportado, en la precisión en que los usa CatBoost.

    El código exportado los escribe con nueve cifras (4.09000015) y los
    compara en doble: un valor que en CatBoost es *igual* al corte quedaba por
    encima, y ese servicio recibía otra estimación. Pasados a float32 —igual
    que los números de `caracteristicas`— la comparación es la de CatBoost.
    Lo usa también la comprobación de `scripts/entrenar_duracion.py`.
    """
    clase = modulo.catboost_model
    clase.float_feature_borders = [[_en_float32(b) for b in fila]
                                   for fila in clase.float_feature_borders]
    return modulo


def disponible() -> bool:
    """Si el modelo exportado viajó con la función, sin cargarlo (pesa ~3,6 MB).

    Lo enseña `GET /api` para comprobarlo tras un despliegue: si el paquete
    faltara, `estimar` devolvería `None` sin que nada lo señalara.
    """
    for nombre in ("api.modelo_duracion", "modelo_duracion"):
        try:
            if importlib.util.find_spec(nombre) is not None:
                return True
        except (ImportError, ValueError):
            continue
    return False


@lru_cache(maxsize=1)
def _modelo() -> Any:
    try:
        from api import modelo_duracion
    except ImportError:
        try:
            import modelo_duracion  # ejecución desde dentro de `api/`
        except ImportError:
            return None
    for nombre in ("p50", "p10", "p90"):
        ajustar_cortes(getattr(modelo_duracion, nombre))
    return modelo_duracion


@lru_cache(maxsize=4096)
def _predecir(numeros: Tuple[float, ...], textos: Tuple[str, ...]) -> Tuple[float, float, float]:
    # Con caché porque el plan se relee tras cada cambio y la mayoría de sus
    # servicios siguen igual: sin ella, cada lectura recalculaba ~230.
    modelo = _modelo()
    return tuple(getattr(modelo, nombre).apply_catboost_model(list(numeros), list(textos))
                 for nombre in ("p50", "p10", "p90"))


def estimar(ruta: Mapping[str, Any], dia: str) -> Optional[Dict[str, Any]]:
    """La estimación de un servicio del plan, o `None` si no se puede dar.

    Nunca lanza: una estimación que falla no puede impedir que se abra el plan.
    """
    modelo = _modelo()
    if modelo is None:
        return None
    try:
        muestra = muestra_del_plan(ruta, dia)
        vector = caracteristicas(muestra) if muestra else None
        if vector is None:
            return None
        return _estimacion(modelo.META, muestra, *_predecir(*vector))
    except Exception:  # noqa: BLE001 — el plan se enseña igual, sin estimación
        logger.exception("[Kapital] No se pudo estimar la duración de %s", ruta.get("conductor"))
        return None


def banda_calibrada(p50: float, p10: float, p90: float, ensanche: float) -> Tuple[float, float, float]:
    """La estimación y su banda, ensanchada con lo que falló en la calibración.

    Los cuantiles 10 y 90 de CatBoost solos prometen el 80% y en la prueba
    acertaban el 67%. El ensanche es lo que hizo falta añadirles, en una
    semana que el modelo no vio, para que la banda acertara de verdad el 80%
    (conformal por cuantiles). Lo usa también el entrenamiento para medirse.
    """
    minutos = max(p50, DURACION_MINIMA)
    desde = max(DURACION_MINIMA, min(p10 - ensanche, minutos))
    hasta = max(p90 + ensanche, minutos)
    return minutos, desde, hasta


def _estimacion(meta: Mapping[str, Any], muestra: Mapping[str, Any],
                p50: float, p10: float, p90: float) -> Dict[str, Any]:
    modalidad = normalizar(muestra.get("modalidad"))
    ensanche = float(meta["ensanche"].get(modalidad, max(meta["ensanche"].values())))
    minutos, desde, hasta = banda_calibrada(p50, p10, p90, ensanche)
    casos = int(meta["casos"].get(clave_de_ruta(muestra), 0))
    nivel = confianza(casos)
    prueba = meta["prueba"]
    turno = minutos_del_turno(muestra.get("turno"))
    resultado = {
        "minutos": round(minutos),
        "desde": round(desde),
        "hasta": round(hasta),
        # Lo comprobado sobre días que el modelo no vio, no lo prometido.
        "acierto_banda": prueba["banda"].get(modalidad),
        "casos": casos,
        "confianza": nivel,
        "error_medio": prueba["error_por_confianza"].get(nivel),
        "entrenado_el": meta.get("entrenado_el"),
    }
    if modalidad == "RECOJO":
        # Arrancando a esta hora, en la prueba llegó antes del turno en el
        # `a_tiempo` % de los servicios.
        resultado["salir_antes"] = hora_legible(turno - hasta)
        resultado["a_tiempo"] = prueba["a_tiempo"].get(modalidad)
    else:
        resultado["ultima_entrega"] = hora_legible(turno + minutos)
    return resultado


def filas_de_entrenamiento(muestras: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Las muestras que valen para entrenar, con su vector y su duración."""
    filas = []
    for muestra in muestras:
        vector = caracteristicas(muestra)
        duracion = duracion_observada(muestra)
        if vector is None or duracion is None:
            continue
        filas.append({
            "fecha": str(muestra.get("fecha")),
            "modalidad": normalizar(muestra.get("modalidad")),
            "clave": clave_de_ruta(muestra),
            "numeros": vector[0],
            "textos": vector[1],
            "duracion": duracion,
        })
    return filas
