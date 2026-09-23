"""Lectura del archivo de Novedades del cliente y contraste con el histórico.

Qué es este archivo
-------------------
Lo que el cliente pide cambiar para los días siguientes: altas, bajas, cambios
de dirección y cambios de turno. No es el histórico —eso es lo que ya pasó— y
llega por otra vía: el cliente lo manda, normalmente el viernes con el sábado y
el domingo dentro.

Por qué no se lee la columna «NOVEDAD» y ya está
------------------------------------------------
Porque miente. Medido sobre los dos archivos de muestra, 23 filas:

- 6 filas dicen «Asignar Ruta» de gente que ya viajaba desde hacía semanas
  —una de ellas con 108 servicios previos—, y dos de esas seis son idénticas a
  lo que ya hacían. «Asignar» no significa alta.
- «Modificar ruta» aparece donde no cambió nada y falta donde sí cambió: en un
  caso la etiqueta decía «Asignar Ruta» y lo que de verdad cambiaba era el
  turno, de las 06:00 a las 05:00.
- Hay siete escrituras para cuatro acciones («Modificar ruta» y «Modificar
  Ruta», «Cambio de Direccion» y «Cambio Domicilio»…).

Así que el cambio se **deduce del histórico**, que es el registro de lo que esa
persona hacía de verdad: si su cobertura era VEN2 durante dieciséis servicios y
la novedad dice VEN1, eso es un cambio de zona, lo llame el archivo como lo
llame.

Lo único que sí se lee de la etiqueta
-------------------------------------
Un bit: si viaja o no. Y no porque haya que fiarse, sino porque **no está en
ninguna otra parte**. Una baja es, por construcción, idéntica al histórico:
mismo DNI, misma zona, misma hora. No hay nada que detectar, porque la baja es
justamente lo que contradice al histórico sin diferenciarse de él. De las seis
bajas de la muestra, cinco no dejan ninguna señal. Para ese bit basta buscar
«elimin» o «anul» en el texto, que sobrevive al desorden de mayúsculas.

Por qué la dirección se compara por palabras
--------------------------------------------
Comparar los textos tal cual daba cuatro cambios de dirección falsos de ocho:
la mitad eran la «Ñ» rota por el export de la intranet, y otro era la misma
casa escrita con la referencia pegada detrás. Se comparan los términos con
peso, sin acentos y sin las palabras que aparecen en todas las direcciones
(«AVENIDA», «MZ», «LOTE»).
"""

from __future__ import annotations

import io
import re
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence

import pandas as pd

try:  # el backend se importa como paquete o suelto, según quién lo arranque
    from api.historico_intranet import (
        ReporteInvalido, bytes_de, dni_de, reparar_acentos, tabla_html_a_frame,
        turno_de,
    )
except ImportError:  # pragma: no cover - solo cambia la forma de importar
    from historico_intranet import (  # type: ignore[no-redef]
        ReporteInvalido, bytes_de, dni_de, reparar_acentos, tabla_html_a_frame,
        turno_de,
    )

COLUMNAS_MINIMAS = ("DNI", "NOVEDAD", "FECHA")

# Palabras que aparecen en casi todas las direcciones y no distinguen una de
# otra. Dejarlas dentro hacía que dos casas sin nada que ver se parecieran.
RELLENO = frozenset({
    "AV", "AVE", "AVENIDA", "CALLE", "CA", "JR", "JIRON", "PASAJE", "PSJE", "PJ",
    "MZ", "MZA", "MANZ", "MANZANA", "LT", "LTE", "LOTE", "NRO", "NUM", "N",
    "SN", "URB", "URBANIZACION", "AAHH", "AH", "PP", "PPJJ", "SECTOR", "ETAPA",
    "DEPTO", "DPTO", "INT", "PISO", "REF", "REFERENCIA", "DE", "DEL", "LA",
    "LAS", "LOS", "EL", "Y", "CON", "TZ", "NZ", "PROVIV",
})

# Por debajo de esto son direcciones distintas. Calibrado contra los ocho
# pares en que el texto no coincidía literalmente: separa los tres traslados
# reales de los cinco que eran la misma casa escrita de otra forma.
PARECIDO_MINIMO = 0.6

# El único dato que se toma de la etiqueta del cliente.
PALABRAS_DE_BAJA = ("ELIMIN", "ANUL", "RETIR", "BAJA", "CANCEL")

CAMBIO_ZONA = "zona"
CAMBIO_TURNO = "turno"
CAMBIO_SENTIDO = "sentido"
CAMBIO_DIRECCION = "direccion"


def _canonica(columna: Any) -> str:
    return " ".join(str(columna).split()).strip().rstrip(".").upper()


def _sin_acentos(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto)
                   if unicodedata.category(c) != "Mn")


def terminos_de_direccion(direccion: Optional[str]) -> frozenset:
    """Las palabras con peso de una dirección, para poder compararla.

    Se corta en «REF», porque el histórico pega ahí la referencia («... 604
    REF HOSPITAL SAN JOSE») y el archivo del cliente la manda en otra columna:
    sin cortar, la misma casa parecía dos.
    """
    if not direccion:
        return frozenset()
    limpio = _sin_acentos(reparar_acentos(str(direccion)) or "").upper()
    limpio = re.split(r"\bREF\b", limpio)[0]
    palabras = re.findall(r"[A-Z0-9]+", limpio)
    return frozenset(p for p in palabras if p not in RELLENO)


def parecido(a: Optional[str], b: Optional[str]) -> float:
    """Cuánto se parecen dos direcciones, entre 0 y 1."""
    uno, otro = terminos_de_direccion(a), terminos_de_direccion(b)
    if not uno or not otro:
        return 1.0  # sin material para comparar, no se afirma un cambio
    return len(uno & otro) / len(uno | otro)


def es_baja(etiqueta: Any) -> bool:
    """Si la etiqueta del cliente dice que esa persona no viaja."""
    texto = _sin_acentos(str(etiqueta or "")).upper()
    return any(palabra in texto for palabra in PALABRAS_DE_BAJA)


def leer_novedades(origen: Any) -> pd.DataFrame:
    """El archivo de Novedades, con las columnas normalizadas."""
    contenido = bytes_de(origen)
    if contenido[:2] == b"PK":
        marco = pd.read_excel(io.BytesIO(contenido), sheet_name=0, header=0,
                              dtype={"DNI.": str, "DNI": str})
    else:
        marco = tabla_html_a_frame(contenido)

    marco.columns = [_canonica(c) for c in marco.columns]
    faltan = [c for c in COLUMNAS_MINIMAS if c not in marco.columns]
    if faltan:
        raise ReporteInvalido(
            "Esto no parece el archivo de Novedades: le faltan las columnas %s."
            % ", ".join(faltan)
        )

    marco = marco[marco["DNI"].notna()].copy()
    if marco.empty:
        raise ReporteInvalido("El archivo de Novedades no trae ninguna fila.")

    marco["dni"] = marco["DNI"].apply(dni_de)
    marco["fecha"] = pd.to_datetime(marco["FECHA"], dayfirst=True,
                                    errors="coerce").dt.date
    marco["turno"] = marco["HORA"].apply(turno_de) if "HORA" in marco.columns else None
    return marco[marco["dni"].notna()]


def _sentido(valor: Any) -> Optional[str]:
    """La modalidad del histórico que corresponde al sentido del cliente.

    El cliente dice si la persona entra o sale de su centro; el histórico
    llama «RECOJO» a lo primero.
    """
    texto = _sin_acentos(str(valor or "")).upper().strip()
    if texto.startswith("INGRESO"):
        return "RECOJO"
    if texto.startswith("SALIDA"):
        return "SALIDA"
    return None


def agrupar_por_dni(servicios: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Los servicios de cada pasajero, por documento."""
    agrupados: Dict[str, List[Dict[str, Any]]] = {}
    for servicio in servicios:
        clave = dni_de(servicio.get("dni"))
        if clave:
            agrupados.setdefault(clave, []).append(servicio)
    return agrupados


def resumir_historial(servicios: Sequence[Dict[str, Any]],
                      antes_de: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Lo que ese pasajero venía haciendo, o `None` si no hay nada.

    El corte por fecha no es un detalle: una novedad habla del futuro, así que
    hay que contrastarla con lo que se sabía **antes** de ese día. Sin el
    corte, al recargar un archivo viejo el histórico ya contiene el cambio que
    la novedad anunciaba y la detección se queda muda, justo en los casos que
    sirven para comprobarla.
    """
    previos = [s for s in servicios
               if not antes_de or (s.get("fecha_ejecutada") or "") < antes_de]
    if not previos:
        return None

    ficha: Dict[str, Any] = {
        "coberturas": {}, "turnos": {}, "modalidades": {},
        "servicios": len(previos), "ultimo_dia": None,
    }
    for servicio in previos:
        for campo, columna in (("coberturas", "cobertura"), ("turnos", "turno"),
                               ("modalidades", "modalidad")):
            valor = servicio.get(columna)
            if valor:
                ficha[campo][valor] = ficha[campo].get(valor, 0) + 1
        dia = servicio.get("fecha_ejecutada")
        if dia and (ficha["ultimo_dia"] is None or dia > ficha["ultimo_dia"]):
            ficha["ultimo_dia"] = dia
    return ficha


def _habitual(conteo: Dict[str, int]) -> Optional[str]:
    return max(conteo, key=conteo.get) if conteo else None


def _detectar(fila: Dict[str, Any], ficha: Optional[Dict[str, Any]],
              persona: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Los cambios que el histórico ve en esta fila. Sin mirar la etiqueta."""
    cambios: List[Dict[str, Any]] = []
    if not ficha:
        return cambios

    cobertura = fila.get("COBERTURA")
    if cobertura and cobertura not in ficha["coberturas"]:
        cambios.append({
            "tipo": CAMBIO_ZONA, "antes": _habitual(ficha["coberturas"]),
            "ahora": cobertura,
            "porque": "%d servicios en %s y ninguno en %s" % (
                ficha["servicios"], _habitual(ficha["coberturas"]), cobertura),
        })

    turno = fila.get("turno")
    if turno and turno not in ficha["turnos"]:
        cambios.append({
            "tipo": CAMBIO_TURNO, "antes": _habitual(ficha["turnos"]),
            "ahora": turno,
            "porque": "siempre a las %s" % ", ".join(sorted(ficha["turnos"])),
        })

    sentido = _sentido(fila.get("SENTIDO"))
    if sentido and ficha["modalidades"] and sentido not in ficha["modalidades"]:
        cambios.append({
            "tipo": CAMBIO_SENTIDO, "antes": _habitual(ficha["modalidades"]),
            "ahora": sentido,
            "porque": "nunca se le había registrado un servicio de %s" % sentido.lower(),
        })

    conocida = persona.get("direccion")
    declarada = fila.get("DIRECCION")
    if conocida and declarada and parecido(conocida, declarada) < PARECIDO_MINIMO:
        cambios.append({
            "tipo": CAMBIO_DIRECCION, "antes": conocida,
            "ahora": reparar_acentos(str(declarada)),
            "porque": "la dirección del padrón es otra",
        })
    return cambios


def analizar(marco: pd.DataFrame, servicios: Iterable[Dict[str, Any]],
             padron: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """El resultado que se le enseña a quien acaba de subir el archivo.

    Una entrada por fila del archivo, con lo que el histórico detecta y lo que
    la etiqueta decía, para que las discrepancias se vean en lugar de quedar
    resueltas en silencio a favor de una de las dos.
    """
    por_dni = agrupar_por_dni(servicios)
    fichas = {dni_de(p["dni"]): p for p in padron if p.get("dni")}

    entradas: List[Dict[str, Any]] = []
    for fila in marco.to_dict("records"):
        clave = fila["dni"]
        dia = fila["fecha"].isoformat() if fila.get("fecha") else None
        ficha = resumir_historial(por_dni.get(clave, []), antes_de=dia)
        persona = fichas.get(clave, {})
        cambios = _detectar(fila, ficha, persona)
        viaja = not es_baja(fila.get("NOVEDAD"))
        nuevo = ficha is None

        if not viaja:
            clasificacion = "baja"
        elif nuevo:
            clasificacion = "alta"
        elif cambios:
            clasificacion = "cambio"
        else:
            clasificacion = "sin_cambio"

        entradas.append({
            "dni": clave,
            "nombre": reparar_acentos(persona.get("nombre")
                                      or str(fila.get("NOMBRES") or "")),
            "fecha": dia,
            "turno": fila.get("turno"),
            "cobertura": fila.get("COBERTURA"),
            "sentido": _sentido(fila.get("SENTIDO")),
            "etiqueta": str(fila.get("NOVEDAD") or "").strip(),
            "viaja": viaja,
            "clasificacion": clasificacion,
            "conocido": not nuevo,
            "servicios_previos": ficha["servicios"] if ficha else 0,
            "ultimo_dia": ficha["ultimo_dia"] if ficha else None,
            "cambios": cambios,
            "ubicacion_obsoleta": any(c["tipo"] == CAMBIO_DIRECCION for c in cambios)
                                  and persona.get("estado_ubicacion") == "resuelta",
            "sin_ubicacion": persona.get("estado_ubicacion") == "no_resuelta",
        })

    entradas.sort(key=lambda e: (e["fecha"] or "", e["nombre"]))
    fechas = sorted({e["fecha"] for e in entradas if e["fecha"]})
    cuenta = lambda tipo: sum(  # noqa: E731 - un contador de una línea
        1 for e in entradas for c in e["cambios"] if c["tipo"] == tipo)

    return {
        "filas": len(entradas),
        "desde": fechas[0] if fechas else None,
        "hasta": fechas[-1] if fechas else None,
        "dias": len(fechas),
        "altas": sum(1 for e in entradas if e["clasificacion"] == "alta"),
        "bajas": sum(1 for e in entradas if e["clasificacion"] == "baja"),
        "cambios": sum(1 for e in entradas if e["clasificacion"] == "cambio"),
        "sin_cambio": sum(1 for e in entradas if e["clasificacion"] == "sin_cambio"),
        "cambio_zona": cuenta(CAMBIO_ZONA),
        "cambio_turno": cuenta(CAMBIO_TURNO),
        "cambio_sentido": cuenta(CAMBIO_SENTIDO),
        "cambio_direccion": cuenta(CAMBIO_DIRECCION),
        "ubicacion_obsoleta": sum(1 for e in entradas if e["ubicacion_obsoleta"]),
        "sin_ubicacion": sum(1 for e in entradas if e["sin_ubicacion"]),
        "desconocidos": sum(1 for e in entradas if not e["conocido"]),
        "entradas": entradas,
    }
