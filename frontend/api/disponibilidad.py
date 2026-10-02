"""Disponibilidad de las unidades: qué días descansa cada conductor y en qué
turnos trabaja.

La guarda la base (`supabase/018_disponibilidad_unidades.sql`), que también
resuelve la de cada día (`disponibilidad_del_dia`) y saca del plan a quien no
puede llevar (`retirar_no_disponibles`). Aquí está lo que el backend necesita
alrededor: validar lo que manda la pantalla, ordenar los turnos de la
operación y decir, ante un cambio del plan, si la unidad de destino trabaja
en ese turno y por qué no.

Una regla del día es `{"turnos": [...], "origen", "nota"}`: `turnos` vacío es
«descansa» y con turnos es «solo esos». Las unidades que trabajan todo no
tienen regla. La misma lógica, para la pantalla, está en
`src/programador/model/disponibilidad.js`: las dos tienen que coincidir.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Dict, Iterable, List, Mapping, Optional

# 22:00 y 22:01 son el mismo turno: la intranet escribe las salidas con «:01».
# Igual que `TOLERANCIA_TURNO_MIN` en el motor y `_mismo_turno` en Postgres.
TOLERANCIA_TURNO_MIN = 1
MINUTOS_DIA = 24 * 60

# La jornada de la operación empieza de noche (las salidas de las 22:00) y
# acaba por la mañana. Ordenar los turnos desde el mediodía los deja en el
# orden en que se trabajan: 22:00, 23:00, 00:00 … 07:00.
INICIO_DE_LA_JORNADA = 12 * 60

_TURNO = re.compile(r"^(\d{1,2}):(\d{2})$")
_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
VOLVER_A_SU_SEMANA = "semana"
LARGO_MAXIMO_NOTA = 200


class EntradaInvalida(ValueError):
    """Lo que manda la pantalla no tiene la forma esperada."""


def canonico(turno: Any) -> Optional[str]:
    """'3:00' → '03:00'. `None` si no es una hora válida."""
    coincide = _TURNO.match(str(turno or "").strip())
    if not coincide:
        return None
    horas, minutos = int(coincide.group(1)), int(coincide.group(2))
    if horas > 23 or minutos > 59:
        return None
    return f"{horas:02d}:{minutos:02d}"


def minutos(turno: Any) -> Optional[int]:
    limpio = canonico(turno)
    if limpio is None:
        return None
    horas, mins = limpio.split(":")
    return int(horas) * 60 + int(mins)


def mismo_turno(a: Any, b: Any, tolerancia: int = TOLERANCIA_TURNO_MIN) -> bool:
    ma, mb = minutos(a), minutos(b)
    if ma is None or mb is None:
        return False
    diferencia = abs(ma - mb) % MINUTOS_DIA
    return min(diferencia, MINUTOS_DIA - diferencia) <= tolerancia


def _en_la_jornada(turno: str) -> int:
    return (minutos(turno) - INICIO_DE_LA_JORNADA) % MINUTOS_DIA


def turnos_de_la_operacion(filas: Iterable[Mapping[str, Any]]) -> List[str]:
    """Los turnos que se pueden marcar, sin repetir 22:00 y 22:01.

    Salen de la base (`turnos_de_la_operacion`: `[{"turno", "veces"}]`). De dos
    turnos a un minuto se queda el de la hora en punto —es como se piensa el
    turno, «el de las 10»— o, si ninguno lo es, el más frecuente.
    """
    grupos: List[Dict[str, Any]] = []
    for fila in sorted(filas or [], key=lambda f: -int(f.get("veces") or 0)):
        turno = canonico(fila.get("turno"))
        if turno is None:
            continue
        veces = int(fila.get("veces") or 0)
        grupo = next((g for g in grupos if mismo_turno(g["turno"], turno)), None)
        if grupo is None:
            grupos.append({"turno": turno, "veces": veces})
            continue
        grupo["veces"] += veces
        if turno.endswith(":00") and not grupo["turno"].endswith(":00"):
            grupo["turno"] = turno
    return sorted((g["turno"] for g in grupos), key=_en_la_jornada)


def _turnos(valor: Any, donde: str) -> List[str]:
    if not isinstance(valor, list):
        raise EntradaInvalida(f"{donde}: los turnos deben ser una lista.")
    limpios = []
    for turno in valor:
        limpio = canonico(turno)
        if limpio is None:
            raise EntradaInvalida(f"{donde}: «{turno}» no es una hora (HH:MM).")
        if limpio not in limpios:
            limpios.append(limpio)
    return sorted(limpios, key=_en_la_jornada)


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
    orden = sorted(turnos, key=lambda t: _en_la_jornada(t) if minutos(t) is not None else 0)
    if len(orden) == 1:
        return orden[0]
    return ", ".join(orden[:-1]) + " y " + orden[-1]


def trabaja_en(regla: Optional[Mapping[str, Any]], turno: Any) -> bool:
    """Si con esa regla del día la unidad trabaja en ese turno."""
    if not regla:
        return True
    return any(mismo_turno(turno, t) for t in regla.get("turnos") or [])


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
    texto = (f"La unidad {nombre} descansa este día" if not turnos
             else f"La unidad {nombre} solo trabaja a las {_lista(turnos)} este día")
    nota = str(regla.get("nota") or "").strip()
    return texto + (f" ({nota})." if nota else ".")


def turnos_permitidos(disponibilidad: Mapping[str, Any], clave: str) -> Optional[List[str]]:
    """Los turnos ('HH:MM') que puede hacer ese día, o `None` si todos (para VROOM)."""
    regla = (disponibilidad or {}).get(clave)
    if not regla:
        return None
    return [t for t in (canonico(t) for t in regla.get("turnos") or []) if t is not None]


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
