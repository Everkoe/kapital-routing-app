"""Propuesta de rutas con VROOM, turno por turno.

Qué hace
--------
Dado un día, reparte a las personas entre las unidades y ordena sus paradas
respetando las reglas de la operación, y dice quién no cabe y por qué. Es una
**propuesta**: no cambia nada hasta que el Programador la acepta.

Por qué turno por turno
-----------------------
Cada viaje real lleva gente de un solo turno y un solo sentido. Resolviendo el
día entero de una vez, VROOM subía a alguien de las 06:00 mientras dejaba a los
de las 05:00 y lo tenía esperando dentro del coche (116 personas en una prueba
del 19/8). Por eso cada turno se resuelve aparte, en orden, y una unidad que
termina un viaje queda libre desde donde acabó para el siguiente.

Las reglas (`Reglas`)
---------------------
Las confirmó el usuario el 2026-09-30 a partir de lo que ya se hace: a bordo
como mucho 90 min; en RECOJO, en la sede entre 10 y 45 min antes del turno y
recogido como mucho 1 h 45 antes; sin margen fijo entre servicios. Se planifica
con 10 min de **colchón** en cada una, porque el modelo de tiempos se equivoca
unos 8 minutos por servicio.

Los tiempos
-----------
Salen del histórico (7.917 tramos entre recojos seguidos): 1,7 min/km en línea
recta y ~5 min por parada; entrar en la sede, 3 min más, y bajarse, 3. Con eso
la duración de un servicio sale sin sesgo contra lo real. Valen de noche y de
madrugada, que es casi toda la operación; por la tarde, con tráfico, no hay
datos suficientes (85 tramos) y la estimación es más floja.

Este módulo no sabe de la base ni de la aplicación: recibe la matriz de
kilómetros, las paradas y las unidades, y lo usan igual el backend
(`index.py`, «Proponer con IA») y `scripts/probar_vroom.py`.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

RECOJO, SALIDA = "RECOJO", "SALIDA"
# 22:00 y 22:01 son el mismo turno: la intranet escribe las salidas con «:01».
TOLERANCIA_TURNO = 1
# Lo que «cuesta» sumar una unidad cuando se busca usar menos: cuatro horas de
# conducción. Con cero, VROOM solo mira el tiempo total.
COSTO_UNIDAD_NUEVA = 4 * 3600
SEGUNDOS_POR_TURNO = 3


@dataclass(frozen=True)
class Reglas:
    max_a_bordo: int = 90
    min_antes_del_turno: int = 10
    max_antes_del_turno: int = 45
    max_antelacion_recojo: int = 105
    espera_salida: int = 15
    colchon: int = 10
    min_por_km: float = 1.7
    parada_recojo: float = 4.9
    parada_entrega: float = 5.5
    # El último tramo de un RECOJO dura 8 min fijos más la distancia (ajuste de
    # 2.999 servicios): unos 5 son la última parada y 3 son entrar en la sede.
    entrada_sede: float = 3.0
    llegada_sede: float = 3.0

    @property
    def a_bordo_plan(self) -> int:
        return self.max_a_bordo - self.colchon

    @property
    def antes_plan(self) -> int:
        return self.min_antes_del_turno + self.colchon


@dataclass(frozen=True)
class Parada:
    """Una persona que viaja: `punto` es su fila en la matriz (0 es la sede)."""
    id: str
    modalidad: str
    turno: int  # minutos desde el origen del día
    punto: int


@dataclass
class Unidad:
    codigo: str
    capacidad: int
    desde: int  # minutos desde el origen: cuándo puede empezar
    hasta: int
    ocupado: List[Tuple[int, int]] = field(default_factory=list)


@dataclass
class Viaje:
    unidad: str
    modalidad: str
    turno: int
    paradas: List[Tuple[str, float]]  # (id, minuto de su recojo o de su entrega)
    inicio: float
    fin: float


@dataclass
class Propuesta:
    viajes: List[Viaje]
    sin_asignar: List[Tuple[str, str]]  # (id, motivo)
    a_bordo: List[float]
    minutos_trabajo: float
    segundos: float
    # Quien vive tan lejos que ni en viaje directo cumple el máximo a bordo: se
    # le lleva igual, con el viaje más corto posible, y se avisa (id, motivo).
    excepciones: List[Tuple[str, str]] = field(default_factory=list)

    @property
    def unidades(self) -> int:
        return len({v.unidad for v in self.viajes})


def distancia_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    lat1, lng1 = map(math.radians, a)
    lat2, lng2 = map(math.radians, b)
    h = (math.sin((lat2 - lat1) / 2) ** 2
         + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def matriz_km(puntos: Sequence[Tuple[float, float]]) -> List[List[float]]:
    return [[distancia_km(a, b) for b in puntos] for a in puntos]


def bloques(paradas: Iterable[Parada]) -> List[List[Parada]]:
    """Las paradas agrupadas por sentido y turno, en el orden en que empiezan."""
    grupos: Dict[Tuple[str, int], List[Parada]] = {}
    for p in sorted(paradas, key=lambda x: (x.modalidad, x.turno)):
        clave = next((k for k in grupos if k[0] == p.modalidad and abs(k[1] - p.turno) <= TOLERANCIA_TURNO),
                     (p.modalidad, p.turno))
        grupos.setdefault(clave, []).append(p)
    return [grupos[k] for k in sorted(grupos, key=lambda k: _empieza(k[0], k[1]))]


def _empieza(modalidad: str, turno: int, reglas: Reglas = Reglas()) -> int:
    if modalidad == RECOJO:
        return turno - reglas.a_bordo_plan - reglas.antes_plan
    return turno


def _minutos(km: float, reglas: Reglas) -> float:
    return km * reglas.min_por_km


def viaje_directo(km: List[List[float]], parada: Parada, reglas: Reglas) -> float:
    """Minutos a bordo si se le llevara solo, sin nadie más en el camino."""
    if parada.modalidad == RECOJO:
        return reglas.parada_recojo + _minutos(km[parada.punto][0], reglas) + reglas.entrada_sede
    return _minutos(km[0][parada.punto], reglas)


def limite_a_bordo(km: List[List[float]], parada: Parada, reglas: Reglas) -> Tuple[int, bool]:
    """El máximo a bordo con que se planifica a alguien, y si es una excepción.

    Hay gente que vive tan lejos que ni yendo sola cumple la regla: hoy viajan
    92-136 min. Dejarla fuera del plan no es una opción, así que se le da el
    viaje más directo posible con el colchón de siempre, y se avisa.
    """
    directo = viaje_directo(km, parada, reglas)
    if directo <= reglas.a_bordo_plan:
        return reglas.a_bordo_plan, False
    return int(math.ceil(directo)) + reglas.colchon, True


def motivo_excepcion(km: List[List[float]], parada: Parada, reglas: Reglas) -> str:
    directo = viaje_directo(km, parada, reglas)
    return (f"Vive demasiado lejos: ni en viaje directo baja de {reglas.max_a_bordo} min a bordo "
            f"({round(directo)} min). Se le lleva con el viaje más corto posible.")


def motivo_sin_sitio(km: List[List[float]], parada: Parada, reglas: Reglas) -> str:
    """Por qué alguien se queda fuera de la propuesta."""
    return "Ninguna unidad libre a esa hora puede llevarle cumpliendo las reglas."


def _bloqueado(ocupado: Sequence[Tuple[int, int]], desde: int, hasta: int) -> List[Tuple[int, int]]:
    """Los ratos ocupados dentro del horario, ordenados y sin solapes (VROOM los exige así)."""
    fusion: List[List[int]] = []
    for a, b in sorted((max(a, desde), min(b, hasta)) for a, b in ocupado):
        if b <= a:
            continue
        if fusion and a <= fusion[-1][1]:
            fusion[-1][1] = max(fusion[-1][1], b)
        else:
            fusion.append([a, b])
    return [(a, b) for a, b in fusion]


def _ventana_del_bloque(modalidad: str, turno: int, reglas: Reglas) -> Tuple[int, int]:
    if modalidad == RECOJO:
        return turno - reglas.a_bordo_plan - reglas.antes_plan, turno - reglas.antes_plan
    return turno, turno + reglas.espera_salida + reglas.a_bordo_plan


class _Estado:
    """Dónde y desde cuándo está libre cada unidad, y cuáles ya se usaron hoy."""

    def __init__(self, unidades: Sequence[Unidad]):
        self.unidades = {u.codigo: u for u in unidades}
        self.donde: Dict[str, Optional[int]] = {u.codigo: None for u in unidades}
        self.libre: Dict[str, float] = {u.codigo: float(u.desde) for u in unidades}
        self.usadas: Set[str] = set()

    def disponibles(self, desde: int, hasta: int) -> List[Unidad]:
        return [u for u in self.unidades.values()
                if max(self.libre[u.codigo], u.desde) < min(hasta, u.hasta)]


# Cuántas veces se vuelve a intentar colocar a quien VROOM dejó para un segundo
# viaje de la misma unidad en el mismo turno (ver `_resolver_turno`).
REINTENTOS_POR_TURNO = 3


def _resolver_turno(vroom, km, bloque, estado: _Estado, reglas: Reglas, objetivo: str, timeout: float):
    """Un turno entero, con un solo viaje por unidad.

    El plan guarda un servicio por unidad, turno y sentido, así que dos viajes
    de la misma unidad en el mismo turno no caben. VROOM a veces los propone
    —sobre todo con gente que vive cerca de la sede— y lo que iría en el segundo
    se vuelve a resolver con las unidades que aún no han salido en ese turno.
    """
    viajes, trabajo, a_bordo, ya_salieron = [], 0.0, [], set()
    faltan, sin_sitio = list(bloque), []
    for _ in range(REINTENTOS_POR_TURNO):
        propios, segundo, fuera, minutos, minutos_a_bordo = _resolver_bloque(
            vroom, km, faltan, estado, reglas, objetivo, timeout, excluir=ya_salieron)
        viajes += propios
        trabajo += minutos
        a_bordo += minutos_a_bordo
        sin_sitio += fuera
        ya_salieron |= {v.unidad for v in propios}
        por_id = {p.id: p for p in faltan}
        faltan = [por_id[i] for i in segundo]
        if not faltan:
            break
    return viajes, sin_sitio + [p.id for p in faltan], trabajo, a_bordo


def _resolver_bloque(vroom, km, bloque, estado: _Estado, reglas: Reglas, objetivo: str, timeout: float,
                     excluir: Set[str] = frozenset()):
    import numpy

    modalidad, turno = bloque[0].modalidad, bloque[0].turno
    ventana = _ventana_del_bloque(modalidad, turno, reglas)
    unidades = [u for u in estado.disponibles(*ventana) if u.codigo not in excluir]
    if not unidades:
        return [], [], [p.id for p in bloque], 0.0, []
    # Submatriz: la sede, los domicilios del turno y dónde está cada unidad; y un
    # punto virtual a cero de todo, para las que aún no han salido y como final
    # (las rutas quedan abiertas, como en la realidad).
    puntos = [0] + [p.punto for p in bloque]
    for u in unidades:
        if estado.donde[u.codigo] is not None and estado.donde[u.codigo] not in puntos:
            puntos.append(estado.donde[u.codigo])
    indice = {punto: k for k, punto in enumerate(puntos)}
    libre = len(puntos)
    segundos = [[round((_minutos(km[a][b], reglas) + (reglas.entrada_sede if b == 0 and a != 0 else 0)) * 60)
                 for b in puntos] + [0] for a in puntos]
    segundos.append([0] * (libre + 1))
    entrada = vroom.Input()
    # `uintc` es el entero de C: con `uint32`, pyvroom rechaza la matriz en Windows.
    entrada.set_durations_matrix("car", vroom._vroom.Matrix(numpy.asarray(segundos, dtype=numpy.uintc)))
    codigos = {}
    for n, u in enumerate(unidades, start=1):
        codigos[n] = u.codigo
        desde = max(int(math.ceil(estado.libre[u.codigo])), u.desde)
        ocupado = [vroom.Break(n * 1000 + k, time_windows=[vroom.TimeWindow(a * 60, a * 60)],
                               service=(b - a) * 60, max_load=[0])
                   for k, (a, b) in enumerate(_bloqueado(u.ocupado, desde, u.hasta))]
        inicio = indice[estado.donde[u.codigo]] if estado.donde[u.codigo] is not None else libre
        fijo = COSTO_UNIDAD_NUEVA if objetivo == "unidades" and u.codigo not in estado.usadas else 0
        entrada.add_vehicle(vroom.Vehicle(n, capacity=[max(1, u.capacidad)], start=inicio, end=libre,
                                          time_window=vroom.TimeWindow(desde * 60, u.hasta * 60),
                                          breaks=ocupado, costs=vroom.VehicleCosts(fixed=fijo)))
    ids = {}
    for k, p in enumerate(bloque, start=1):
        ids[k] = p
        T = p.turno * 60
        limite, _ = limite_a_bordo(km, p, reglas)
        if modalidad == RECOJO:
            recogida = vroom.ShipmentStep(k, location=indice[p.punto], default_setup=round(reglas.parada_recojo * 60),
                                          time_windows=[vroom.TimeWindow(T - (limite + reglas.antes_plan) * 60,
                                                                         T - reglas.antes_plan * 60)])
            entrega = vroom.ShipmentStep(k, location=0, default_setup=round(reglas.llegada_sede * 60),
                                         time_windows=[vroom.TimeWindow(T - reglas.max_antes_del_turno * 60,
                                                                        T - reglas.antes_plan * 60)])
        else:
            recogida = vroom.ShipmentStep(k, location=0,
                                          time_windows=[vroom.TimeWindow(T, T + reglas.espera_salida * 60)])
            entrega = vroom.ShipmentStep(k, location=indice[p.punto], default_setup=round(reglas.parada_entrega * 60),
                                         time_windows=[vroom.TimeWindow(T, T + limite * 60)])
        entrada.add_shipment(recogida, entrega, amount=vroom.Amount([1]))
    solucion = entrada.solve(exploration_level=4, nb_threads=4, timeout=timedelta(seconds=timeout))
    return _leer_solucion(solucion, codigos, ids, puntos, estado, modalidad, turno)


def _leer_solucion(solucion, codigos, ids, puntos, estado: _Estado, modalidad: str, turno: int):
    rutas = solucion.routes
    viajes, segundo, trabajo, a_bordo = [], [], 0.0, []
    for vehiculo, pasos in rutas.groupby("vehicle_id", sort=False):
        tareas = pasos[pasos["type"].isin(["pickup", "delivery"])]
        if tareas.empty:
            continue
        codigo = codigos[int(vehiculo)]
        # Un turno, un viaje: el plan guarda un servicio por unidad, turno y
        # sentido. Si VROOM volviera a la sede a por más gente del mismo
        # turno, lo de los otros viajes se resuelve aparte (`_resolver_turno`).
        despues = _fuera_del_viaje_principal(tareas, modalidad)
        propias = tareas[~tareas["id"].astype(int).isin(despues)] if despues else tareas
        segundo += [ids[i].id for i in despues]
        clave = "pickup" if modalidad == RECOJO else "delivery"
        paradas = [(ids[int(r.id)].id, (r.arrival + r.waiting_time) / 60 if modalidad == RECOJO else r.arrival / 60)
                   for r in propias.itertuples() if r.type == clave and int(r.id) not in despues]
        if not paradas:
            continue
        # A bordo desde que sube hasta que llega, con las esperas que haya en
        # medio: lo que vive la persona, no lo que tarda el coche en moverse.
        empieza = {int(r.id): (r.arrival + r.waiting_time) / 60 for r in propias.itertuples() if r.type == "pickup"}
        a_bordo += [(r.arrival + r.waiting_time) / 60 - empieza[int(r.id)]
                    for r in propias.itertuples() if r.type == "delivery" and int(r.id) in empieza]
        ultima = propias.iloc[-1]
        fin = (ultima["arrival"] + ultima["waiting_time"] + ultima["setup"] + ultima["service"]) / 60
        inicio = (propias.iloc[0]["arrival"] + propias.iloc[0]["waiting_time"]) / 60
        viajes.append(Viaje(codigo, modalidad, turno, paradas, inicio, fin))
        # `duration` es lo conducido desde que salió; si el viaje que se queda no
        # es el primero, lo conducido antes era de un viaje que ya no hace.
        antes = float(propias.iloc[0]["duration"]) if propias.index[0] != tareas.index[0] else 0.0
        trabajo += (float(propias.iloc[-1]["duration"]) - antes + float(propias["setup"].sum())) / 60
        estado.donde[codigo] = puntos[int(ultima["location_index"])]
        estado.libre[codigo] = fin
        estado.usadas.add(codigo)
    sin_sitio = [ids[numero].id for numero in _no_asignadas(solucion)]
    return viajes, segundo, sin_sitio, trabajo, a_bordo


def _fuera_del_viaje_principal(tareas, modalidad: str) -> Set[int]:
    """Los envíos que no van en el viaje con más gente de esta unidad en este turno.

    Un viaje nuevo empieza cuando la unidad vuelve a recoger después de haber
    entregado (en SALIDA, cuando vuelve a la sede). Se conserva el que lleva
    más gente, no el primero: con una unidad de dos plazas y tres personas,
    quedarse con el primero dejaba fuera a dos si VROOM hacía antes el corto.
    Quien sube en un viaje y baja en otro también queda fuera.
    """
    viajes, actual, entrego = [], [], False
    for r in tareas.itertuples():
        nuevo = r.type == "pickup" and entrego and (modalidad == RECOJO or int(r.location_index) == 0)
        if nuevo:
            viajes.append(actual)
            actual, entrego = [], False
        actual.append(r)
        entrego = entrego or r.type == "delivery"
    viajes.append(actual)
    if len(viajes) == 1:
        return set()
    completos = []
    for viaje in viajes:
        suben = {int(r.id) for r in viaje if r.type == "pickup"}
        bajan = {int(r.id) for r in viaje if r.type == "delivery"}
        completos.append(suben & bajan)
    principal = max(completos, key=len)
    return {int(r.id) for r in tareas.itertuples()} - principal


def _no_asignadas(solucion) -> list:
    """Los números de envío que VROOM no pudo colocar, sin repetir."""
    # pyvroom devuelve aquí objetos `Job` cuyo número está en `_id`, no en `id`.
    vistas, resultado = set(), []
    for tarea in solucion.unassigned:
        numero = int(getattr(tarea, "id", None) or tarea._id)
        if numero not in vistas:
            vistas.add(numero)
            resultado.append(numero)
    return resultado


def proponer(km: List[List[float]], paradas: Sequence[Parada], unidades: Sequence[Unidad],
             objetivo: str = "unidades", reglas: Reglas = Reglas()) -> Propuesta:
    """La propuesta del día, turno por turno. `objetivo`: «unidades» o «tiempo»."""
    import vroom

    if objetivo not in ("unidades", "tiempo"):
        raise ValueError("objetivo debe ser 'unidades' o 'tiempo'")
    t0 = time.time()
    estado = _Estado(unidades)
    por_id = {p.id: p for p in paradas}
    viajes: List[Viaje] = []
    sin_asignar: List[Tuple[str, str]] = []
    trabajo, a_bordo = 0.0, []
    for bloque in bloques(paradas):
        propios, fuera, minutos, minutos_a_bordo = _resolver_turno(
            vroom, km, bloque, estado, reglas, objetivo, SEGUNDOS_POR_TURNO)
        viajes += propios
        trabajo += minutos
        a_bordo += minutos_a_bordo
        sin_asignar += [(i, motivo_sin_sitio(km, por_id[i], reglas)) for i in fuera]
    colocados = {i for v in viajes for i, _ in v.paradas}
    excepciones = [(p.id, motivo_excepcion(km, p, reglas)) for p in paradas
                   if p.id in colocados and limite_a_bordo(km, p, reglas)[1]]
    return Propuesta(viajes, sin_asignar, a_bordo, trabajo, time.time() - t0, excepciones)


@dataclass
class ServicioActual:
    """Un servicio tal como está (en el plan o en lo ejecutado), en su orden."""
    unidad: str
    modalidad: str
    turno: int
    puntos: List[int]


def evaluar(km: List[List[float]], servicios: Sequence[ServicioActual], reglas: Reglas = Reglas()) -> Dict[str, object]:
    """Unidades, horas y minutos a bordo de lo actual, con el mismo modelo de tiempos."""
    a_bordo, por_unidad = [], {}
    for s in servicios:
        if not s.puntos:
            continue
        if s.modalidad == RECOJO:
            reloj, subidas = 0.0, []
            for k, punto in enumerate(s.puntos):
                if k:
                    reloj += _minutos(km[s.puntos[k - 1]][punto], reglas)
                subidas.append(reloj)
                reloj += reglas.parada_recojo
            reloj += _minutos(km[s.puntos[-1]][0], reglas) + reglas.entrada_sede
            a_bordo += [reloj - x for x in subidas]
            duracion, primero, ultimo = reloj + reglas.llegada_sede, s.puntos[0], 0
            orden = s.turno - reglas.antes_plan - duracion
        else:
            reloj, anterior = 0.0, 0
            for punto in s.puntos:
                reloj += _minutos(km[anterior][punto], reglas)
                a_bordo.append(reloj)
                reloj += reglas.parada_entrega
                anterior = punto
            duracion, primero, ultimo, orden = reloj, 0, s.puntos[-1], s.turno
        por_unidad.setdefault(s.unidad, []).append((orden, duracion, primero, ultimo))
    trabajo = 0.0
    for tramos in por_unidad.values():
        tramos.sort()
        trabajo += sum(d for _, d, _, _ in tramos)
        trabajo += sum(_minutos(km[a[3]][b[2]], reglas) for a, b in zip(tramos, tramos[1:]))
    return {"unidades": len(por_unidad), "minutos_trabajo": trabajo, "a_bordo": a_bordo}
