"""Disponibilidad de las unidades: qué días descansa cada conductor y en qué
turnos trabaja.

La guarda la base (`supabase/018_disponibilidad_unidades.sql`), que también
resuelve la de cada día (`disponibilidad_del_dia`) y saca del plan a quien no
puede llevar (`retirar_no_disponibles`). Aquí está lo que el backend necesita
alrededor: validar lo que manda la pantalla, decir qué turnos se pueden marcar
y, ante un cambio del plan, si la unidad de destino trabaja en ese turno y por
qué no.

**Los turnos van por horas** (019): `'03:00'` es el turno de las 3 y vale para
cualquier servicio de 03:00 a 03:59 —22:00 y 22:01, 00:30 y 00:40—, que es como
lo piensa el usuario («de 12, 1, 2, 3, 4, 5»). Del histórico salían 49 turnos
distintos, muchos variantes de la misma hora o que casi nunca se usan.

Una regla del día es `{"turnos": [...], "origen", "nota"}`: `turnos` vacío es
«descansa» y con turnos es «solo esos». Las unidades que trabajan todo no
tienen regla. La misma lógica, para la pantalla, está en
`src/programador/model/disponibilidad.js`: las dos tienen que coincidir.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, Iterable, List, Mapping, Optional

# La jornada de la operación empieza de noche (las salidas de las 22:00) y
# acaba por la mañana. Ordenar las horas desde el mediodía las deja en el
# orden en que se trabajan: 22:00, 23:00, 00:00 … 07:00.
INICIO_DE_LA_JORNADA = 12

_TURNO = re.compile(r"^(\d{1,2}):(\d{2})$")
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VOLVER_A_SU_SEMANA = "semana"
LARGO_MAXIMO_NOTA = 200


class EntradaInvalida(ValueError):
    """Lo que manda la pantalla no tiene la forma esperada."""


def hora(turno: Any) -> Optional[int]:
    """La hora de un turno 'HH:MM' (de 0 a 23), o `None` si no es una hora válida."""
    coincide = _TURNO.match(str(turno or "").strip())
    if not coincide:
        return None
    horas, minutos = int(coincide.group(1)), int(coincide.group(2))
    if horas > 23 or minutos > 59:
        return None
    return horas


def de_la_hora(turno: Any) -> Optional[str]:
    """El turno de la hora a la que pertenece: '3:40' → '03:00'."""
    valor = hora(turno)
    return None if valor is None else f"{valor:02d}:00"


def misma_hora(a: Any, b: Any) -> bool:
    ha, hb = hora(a), hora(b)
    return ha is not None and ha == hb


def _en_la_jornada(turno: str) -> int:
    return (hora(turno) - INICIO_DE_LA_JORNADA) % 24


def ordenar(turnos: Iterable[str]) -> List[str]:
    return sorted(turnos, key=_en_la_jornada)


def turnos_de_la_operacion(filas: Iterable[Mapping[str, Any]], minimo: int = 1) -> List[str]:
    """Las horas que se pueden marcar: las que la operación usa de verdad.

    Salen de la base (`turnos_de_la_operacion`: `[{"turno", "veces"}]`),
    agrupadas por hora. Solo entran las que llegan a `minimo` pasajeros en el
    periodo: así las horas que casi nunca se usan no llenan la pantalla. Las
    demás se pueden marcar igual con «Ver todas las horas».
    """
    por_hora: Dict[str, int] = {}
    for fila in filas or []:
        turno = de_la_hora(fila.get("turno"))
        if turno is not None:
            por_hora[turno] = por_hora.get(turno, 0) + int(fila.get("veces") or 0)
    return ordenar(t for t, veces in por_hora.items() if veces >= minimo)


def _turnos(valor: Any, donde: str) -> List[str]:
    if not isinstance(valor, list):
        raise EntradaInvalida(f"{donde}: los turnos deben ser una lista.")
    limpios = []
    for turno in valor:
        limpio = de_la_hora(turno)
        if limpio is None:
            raise EntradaInvalida(f"{donde}: «{turno}» no es una hora (HH:MM).")
        if limpio not in limpios:
            limpios.append(limpio)
    return ordenar(limpios)


def validar_semana(valor: Any) -> Optional[Dict[str, Optional[List[str]]]]:
    """`{"1": [...] | None, …}` (1 lunes … 7 domingo), o `None` si no cambia."""
    if valor is None:
        return None
    if not isinstance(valor, Mapping):
        raise EntradaInvalida("La semana debe ir por días (1 lunes … 7 domingo).")
    semana: Dict[str, Optional[List[str]]] = {}
    for dia, turnos in valor.items():
        if str(dia) not in {"1", "2", "3", "4", "5", "6", "7"}:
            raise EntradaInvalida(f"«{dia}» no es un día de la semana (1 lunes … 7 domingo).")
        semana[str(dia)] = None if turnos is None else _turnos(turnos, "La semana")
    return semana


def validar_fechas(valor: Any, hoy: date, hasta: date) -> List[Dict[str, Any]]:
    """`[{"fecha", "turnos", "nota"}]`, de hoy a `hasta`.

    `turnos` es una lista (vacía: descansa), `None` (trabaja todo ese día) o
    «semana» (quitar la excepción y volver a su semana).
    """
    if valor is None:
        return []
    if not isinstance(valor, list):
        raise EntradaInvalida("Las fechas deben ir en una lista.")
    vistas, fechas = set(), []
    for entrada in valor:
        if not isinstance(entrada, Mapping) or "turnos" not in entrada:
            raise EntradaInvalida("Cada fecha debe decir qué turnos trabaja.")
        texto = str(entrada.get("fecha") or "")
        try:
            dia = date.fromisoformat(texto) if _FECHA.match(texto) else None
        except ValueError:
            dia = None
        if dia is None:
            raise EntradaInvalida(f"«{texto}» no es una fecha (AAAA-MM-DD).")
        if dia < hoy:
            raise EntradaInvalida(f"El {texto} ya pasó: su disponibilidad no se cambia.")
        if dia > hasta:
            raise EntradaInvalida(f"El {texto} queda demasiado lejos para planificarlo.")
        if dia in vistas:
            raise EntradaInvalida(f"El {texto} viene dos veces.")
        vistas.add(dia)
        turnos = entrada.get("turnos")
        if turnos != VOLVER_A_SU_SEMANA and turnos is not None:
            turnos = _turnos(turnos, f"El {texto}")
        nota = str(entrada.get("nota") or "").strip()
        if len(nota) > LARGO_MAXIMO_NOTA:
            raise EntradaInvalida(f"La nota del {texto} es demasiado larga.")
        fechas.append({"fecha": texto, "turnos": turnos, "nota": nota or None})
    return fechas


def _lista(turnos: List[str]) -> str:
    """«22:00, 03:00 y 04:00», en el orden de la jornada (la base los da por orden alfabético)."""
    orden = ordenar(t for t in turnos if hora(t) is not None)
    if len(orden) == 1:
        return orden[0]
    return ", ".join(orden[:-1]) + " y " + orden[-1]


def trabaja_en(regla: Optional[Mapping[str, Any]], turno: Any) -> bool:
    """Si con esa regla del día la unidad trabaja en ese turno (por su hora)."""
    if not regla:
        return True
    return any(misma_hora(turno, t) for t in regla.get("turnos") or [])


def motivo_no_disponible(disponibilidad: Mapping[str, Any], clave: str,
                         nombre: str, turno: Any) -> Optional[str]:
    """Por qué esa unidad no puede llevar a nadie en ese turno, o `None`.

    `clave` es la normalizada (la de las claves de `disponibilidad`) y `nombre`
    la que se enseña.
    """
    regla = (disponibilidad or {}).get(clave)
    if trabaja_en(regla, turno):
        return None
    turnos = list(regla.get("turnos") or [])
    if not turnos:
        texto = f"La unidad {nombre} descansa este día"
    else:
        cuales = "el turno" if len(turnos) == 1 else "los turnos"
        texto = f"La unidad {nombre} solo trabaja {cuales} de las {_lista(turnos)} este día"
    nota = str(regla.get("nota") or "").strip()
    return texto + (f" ({nota})." if nota else ".")


def turnos_permitidos(disponibilidad: Mapping[str, Any], clave: str) -> Optional[List[str]]:
    """Las horas ('HH:00') que puede hacer ese día, o `None` si todas (para VROOM)."""
    regla = (disponibilidad or {}).get(clave)
    if not regla:
        return None
    return [t for t in (de_la_hora(t) for t in regla.get("turnos") or []) if t is not None]


def destinos(cambios: Iterable[Any]) -> List[Dict[str, Any]]:
    """A qué unidad y turno lleva a alguien cada `agregar` o `mover` de una tanda."""
    encontrados = []
    for cambio in cambios or []:
        if not isinstance(cambio, Mapping):
            continue
        if cambio.get("accion") == "agregar":
            encontrados.append({"vehiculo": cambio.get("vehiculo"), "turno": cambio.get("turno")})
        elif cambio.get("accion") == "mover" and isinstance(cambio.get("hacia"), Mapping):
            hacia = cambio["hacia"]
            encontrados.append({"vehiculo": hacia.get("vehiculo"), "turno": hacia.get("turno")})
    return encontrados
