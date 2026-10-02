"""«Proponer con IA»: del plan de un día a una propuesta de VROOM, y de vuelta.

Qué se toca y qué no
--------------------
- Solo las sedes cuya ubicación se conoce (`SEDES_UBICADAS`). Hoy es
  Bellavista, el 77% de los servicios; su punto se ajustó con los datos
  (R² 0,69 del último tramo de 2.999 RECOJO). Lo de las demás sedes no se
  mueve, y a las unidades que van allí les ocupa ese rato.
- **Un servicio con alguien sin domicilio ubicado se queda como está**: no se
  puede calcular dónde recogerle, y moverlo sería inventar. Su unidad cuenta
  como ocupada durante ese servicio. La pantalla dice cuántos son.
- Los **pendientes** los sigue proponiendo el motor de inserción. Aquí se
  reorganiza a quien ya está asignado, que es lo que se puede deshacer limpio.
- Las unidades son las del plan, en el horario en que ya trabajan ese día.

La propuesta vuelve como la tanda de cambios que entiende
`editar_programacion` (`mover` y `ordenar`) y su contraria para deshacerla.
No se aplica nada aquí: lo aplica el Programador si la acepta.
"""

from __future__ import annotations

import math
import statistics
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

try:
    from api import ruteo_vroom as rv
except ImportError:  # ejecución desde dentro de `api/`
    import ruteo_vroom as rv

SEDES_UBICADAS: Dict[str, Tuple[float, float]] = {
    "TELEPERFORMANCE BELLAVISTA": (-12.055, -77.1075),
}
# Los minutos cuentan desde las 21:00 de la víspera: un RECOJO de las 00:00
# empieza a recoger hacia las 22:15 del día anterior y no puede quedar negativo.
ORIGEN = 180
HOLGURA_HORARIO = 15
DURACION_POR_DEFECTO = 60
CAPACIDAD_POR_DEFECTO = 4
OBJETIVOS = ("unidades", "tiempo")


def _normalizar(texto: Any) -> str:
    limpio = unicodedata.normalize("NFKD", str(texto or "").strip())
    return limpio.encode("ascii", "ignore").decode("ascii").upper()


def minuto_del_turno(turno: Any) -> Optional[int]:
    partes = str(turno or "").strip().split(":")
    if len(partes) != 2 or not all(p.isdigit() for p in partes):
        return None
    horas, minutos = int(partes[0]), int(partes[1])
    if horas > 23 or minutos > 59:
        return None
    return horas * 60 + minutos + ORIGEN


def _en_minutos(turnos: Optional[Sequence[str]]) -> Optional[List[int]]:
    """Los turnos permitidos de una unidad, en los minutos de `minuto_del_turno`."""
    if turnos is None:
        return None
    return [m for m in (minuto_del_turno(t) for t in turnos) if m is not None]


def hora(minutos: float) -> str:
    total = int(round(minutos)) - ORIGEN
    total %= 24 * 60
    return f"{total // 60:02d}:{total % 60:02d}"


def _coordenada(valor: Any) -> Optional[float]:
    if valor is None or str(valor).strip() == "":
        return None
    try:
        numero = float(valor)
    except (TypeError, ValueError):
        return None
    return numero if math.isfinite(numero) else None


def _punto(agente: Mapping[str, Any]) -> Optional[Tuple[float, float]]:
    if agente.get("ubicacion") != "resuelta":
        return None
    lat, lng = _coordenada(agente.get("lat")), _coordenada(agente.get("lng"))
    return (lat, lng) if lat is not None and lng is not None else None


def _duracion_estimada(ruta: Mapping[str, Any]) -> float:
    """Lo que dura un servicio que no se toca: la IA de duración, o la tabla."""
    estimacion = ruta.get("estimacion") or {}
    duracion = ruta.get("duracion") or {}
    for valor in (estimacion.get("hasta"), duracion.get("p90")):
        if isinstance(valor, (int, float)) and valor > 0:
            return float(valor)
    return float(DURACION_POR_DEFECTO)


def _ventana(ruta: Mapping[str, Any], turno: int, reglas: rv.Reglas) -> Tuple[int, int]:
    """El rato que ocupa un servicio, estimado."""
    duracion = _duracion_estimada(ruta)
    if str(ruta.get("modalidad")).upper() == rv.RECOJO:
        fin = turno - reglas.min_antes_del_turno
        return int(fin - duracion), int(fin)
    return turno, int(turno + reglas.espera_salida + duracion)


def clave_parada(dni: str, modalidad: str, turno: str) -> str:
    """Una persona puede ir y volver el mismo día: la parada es persona, sentido y turno."""
    return f"{dni}|{modalidad}|{turno}"


@dataclass
class Problema:
    sede: str
    km: List[List[float]]
    paradas: List[rv.Parada]
    unidades: List[rv.Unidad]
    actuales: List[rv.ServicioActual]
    # Por clave de parada: dni, nombre, unidad, turno (texto) y sentido actuales.
    personas: Dict[str, Dict[str, Any]]
    orden_actual: Dict[Tuple[str, str, str], List[str]]
    intactos: List[Dict[str, Any]] = field(default_factory=list)
    sin_ubicar: List[Dict[str, Any]] = field(default_factory=list)


def _sede_del_plan(rutas: Sequence[Mapping[str, Any]]) -> Optional[str]:
    presentes = {_normalizar(r.get("sede")) for r in rutas}
    return next((s for s in SEDES_UBICADAS if s in presentes), None)


def construir(plan: Mapping[str, Any], capacidad_de: Callable[[str], Optional[int]],
              reglas: rv.Reglas = rv.Reglas(),
              turnos_de: Callable[[str], Optional[List[str]]] = lambda codigo: None) -> Optional[Problema]:
    """El problema de VROOM a partir del plan, o `None` si no hay nada que proponer.

    `turnos_de` dice qué turnos ('HH:MM') trabaja cada unidad ese día, o
    `None` si todos (la disponibilidad que configura el Programador).
    """
    rutas = [r for r in (plan.get("rutas") or []) if isinstance(r, Mapping)]
    sede = _sede_del_plan(rutas)
    if sede is None:
        return None
    coordenadas = [SEDES_UBICADAS[sede]]
    paradas, actuales, personas, orden_actual = [], [], {}, {}
    intactos, sin_ubicar = [], []
    horario: Dict[str, List[int]] = {}
    ocupado: Dict[str, List[Tuple[int, int]]] = {}
    llevado: Dict[str, int] = {}
    for ruta in rutas:
        codigo, turno_texto = str(ruta.get("conductor") or ""), str(ruta.get("turno") or "")
        modalidad = str(ruta.get("modalidad") or "").upper()
        turno = minuto_del_turno(turno_texto)
        agentes = [a for a in (ruta.get("agentes") or []) if isinstance(a, Mapping)]
        if not codigo or turno is None or modalidad not in (rv.RECOJO, rv.SALIDA) or not agentes:
            continue
        ventana = _ventana(ruta, turno, reglas)
        horario.setdefault(codigo, []).extend(ventana)
        llevado[codigo] = max(llevado.get(codigo, 0), int(ruta.get("max_llevado") or 0), len(agentes))
        faltan = [a for a in agentes if _punto(a) is None]
        if _normalizar(ruta.get("sede")) != sede or faltan:
            ocupado.setdefault(codigo, []).append(ventana)
            if _normalizar(ruta.get("sede")) == sede:
                intactos.append({"unidad": codigo, "turno": turno_texto, "modalidad": modalidad,
                                 "personas": len(agentes), "sin_ubicar": len(faltan)})
                sin_ubicar += [{"id": a.get("id"), "nombre": a.get("nombre")} for a in faltan]
            continue
        puntos = []
        for agente in agentes:
            clave = clave_parada(str(agente.get("id")), modalidad, turno_texto)
            coordenadas.append(_punto(agente))
            indice = len(coordenadas) - 1
            puntos.append(indice)
            paradas.append(rv.Parada(clave, modalidad, turno, indice))
            personas[clave] = {"dni": str(agente.get("id")), "nombre": agente.get("nombre"), "unidad": codigo,
                               "turno": turno_texto, "modalidad": modalidad,
                               "cobertura": ruta.get("micro_zona")}
        orden_actual[(codigo, turno_texto, modalidad)] = [str(a.get("id")) for a in agentes]
        actuales.append(rv.ServicioActual(codigo, modalidad, turno, puntos))
    if not paradas:
        return None
    unidades = [rv.Unidad(codigo, capacidad_de(codigo) or llevado.get(codigo) or CAPACIDAD_POR_DEFECTO,
                          min(ventanas) - HOLGURA_HORARIO, max(ventanas) + HOLGURA_HORARIO,
                          ocupado.get(codigo, []), _en_minutos(turnos_de(codigo)))
                for codigo, ventanas in horario.items()]
    # Quien descansa ese día no entra; sus pasajeros ya están en pendientes.
    unidades = [u for u in unidades if u.turnos is None or u.turnos]
    return Problema(sede, rv.matriz_km(coordenadas), paradas, unidades, actuales, personas,
                    orden_actual, intactos, sin_ubicar)


def cambios(problema: Problema, propuesta: rv.Propuesta) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """La tanda que aplica la propuesta, y la que la deshace."""
    aplicar, deshacer = [], []
    nuevo_orden: Dict[Tuple[str, str, str], List[str]] = {}
    tocados = set()
    for viaje in propuesta.viajes:
        for clave, _ in viaje.paradas:
            persona = problema.personas[clave]
            destino = (viaje.unidad, persona["turno"], persona["modalidad"])
            nuevo_orden.setdefault(destino, []).append(persona["dni"])
            if viaje.unidad == persona["unidad"]:
                continue
            origen = (persona["unidad"], persona["turno"], persona["modalidad"])
            tocados.add(origen)
            aplicar.append(_mover(persona["dni"], origen, destino, persona["cobertura"]))
            deshacer.append(_mover(persona["dni"], destino, origen, persona["cobertura"]))
    for (unidad, turno, modalidad), dnis in nuevo_orden.items():
        aplicar.append({"accion": "ordenar", "vehiculo": unidad, "turno": turno, "modalidad": modalidad, "dnis": dnis})
    for servicio in set(nuevo_orden) | tocados:
        if servicio in problema.orden_actual:
            unidad, turno, modalidad = servicio
            deshacer.append({"accion": "ordenar", "vehiculo": unidad, "turno": turno, "modalidad": modalidad,
                             "dnis": problema.orden_actual[servicio]})
    return aplicar, deshacer


def _mover(dni: str, desde: Tuple[str, str, str], hacia: Tuple[str, str, str], cobertura: Any) -> Dict[str, Any]:
    return {"accion": "mover", "dni": dni,
            "desde": {"vehiculo": desde[0], "turno": desde[1], "modalidad": desde[2]},
            "hacia": {"vehiculo": hacia[0], "turno": hacia[1], "modalidad": hacia[2], "cobertura": cobertura}}


def _resumen(unidades: int, minutos: float, a_bordo: Sequence[float], reglas: rv.Reglas) -> Dict[str, Any]:
    ordenados = sorted(a_bordo)
    p90 = ordenados[min(len(ordenados) - 1, int(0.9 * len(ordenados)))] if ordenados else None
    return {
        "unidades": unidades,
        "horas": round(minutos / 60, 1),
        "a_bordo_mediana": round(statistics.median(ordenados)) if ordenados else None,
        "a_bordo_p90": round(p90) if p90 is not None else None,
        "a_bordo_max": round(ordenados[-1]) if ordenados else None,
        "por_encima_de_la_regla": sum(x > reglas.max_a_bordo for x in ordenados),
    }


def respuesta(problema: Problema, propuesta: rv.Propuesta, objetivo: str,
              reglas: rv.Reglas = rv.Reglas()) -> Dict[str, Any]:
    """Lo que ve el Programador: la comparación, los servicios y lo que no se tocó."""
    actual = rv.evaluar(problema.km, problema.actuales, reglas)
    aplicar, deshacer = cambios(problema, propuesta)
    movidas = sum(1 for c in aplicar if c["accion"] == "mover")
    nombre = {clave: p["nombre"] for clave, p in problema.personas.items()}
    servicios = [{
        "unidad": v.unidad, "modalidad": v.modalidad, "turno": problema.personas[v.paradas[0][0]]["turno"],
        "inicio": hora(v.inicio), "fin": hora(v.fin),
        "agentes": [{"id": problema.personas[c]["dni"], "nombre": nombre[c], "hora": hora(m),
                     "cambia": problema.personas[c]["unidad"] != v.unidad,
                     "antes": problema.personas[c]["unidad"]} for c, m in v.paradas],
    } for v in sorted(propuesta.viajes, key=lambda v: (v.turno, v.unidad))]
    def con_nombre(lista):
        return [{"id": problema.personas[c]["dni"], "nombre": nombre[c], "turno": problema.personas[c]["turno"],
                 "modalidad": problema.personas[c]["modalidad"], "unidad": problema.personas[c]["unidad"],
                 "motivo": motivo} for c, motivo in lista]
    unidades_intactas = {s["unidad"] for s in problema.intactos}
    return {
        "sede": problema.sede,
        "objetivo": objetivo,
        "reglas": {"max_a_bordo": reglas.max_a_bordo, "min_antes_del_turno": reglas.min_antes_del_turno,
                   "max_antes_del_turno": reglas.max_antes_del_turno, "colchon": reglas.colchon},
        "actual": _resumen(actual["unidades"], actual["minutos_trabajo"], actual["a_bordo"], reglas),
        "propuesta": _resumen(propuesta.unidades, propuesta.minutos_trabajo, propuesta.a_bordo, reglas),
        # Unidades de la sede contando las que siguen con servicios que no se tocan.
        "unidades_de_la_sede": {
            "actual": len({s.unidad for s in problema.actuales} | unidades_intactas),
            "propuesta": len({v.unidad for v in propuesta.viajes} | unidades_intactas),
        },
        "servicios": servicios,
        "sin_asignar": con_nombre(propuesta.sin_asignar),
        "excepciones": con_nombre(propuesta.excepciones),
        "intactos": {"servicios": len(problema.intactos), "personas": sum(s["personas"] for s in problema.intactos),
                     "sin_ubicar": len(problema.sin_ubicar)},
        "movidas": movidas,
        "cambios": aplicar,
        "deshacer": deshacer,
        "segundos": round(propuesta.segundos, 1),
    }
