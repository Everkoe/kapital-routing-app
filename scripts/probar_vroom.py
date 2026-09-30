"""Prueba de VROOM: replanifica una jornada ya ejecutada de Bellavista y la compara con lo real.

Cómo se usa (desde la raíz, con el entorno de `frontend/` y `pip install -r scripts/requirements-modelo.txt`):

    python scripts/probar_vroom.py 2026-08-05 2026-08-19
    MAX_A_BORDO=70 python scripts/probar_vroom.py 2026-08-19     # la variante más cómoda

Solo lee. Resultados del 2026-09-30 en CLAUDE.md («La prueba de VROOM»).

Los datos personales no salen de la base: la consulta devuelve paradas con un
número opaco y la matriz de kilómetros entre ellas, calculada dentro de
Postgres. Nada se guarda en disco. Solo se imprimen totales.

Reglas (confirmadas por el usuario el 2026-09-30): a bordo como mucho 90 min;
en RECOJO, en la sede al menos 10 min antes del turno y recogido como mucho
1 h 45 antes; sin margen fijo entre servicios.

Para no engañarse, VROOM planifica con **más exigencia que la realidad**:
- 10 min de colchón en cada regla (a bordo ≤ 80, en la sede ≥ 20 min antes),
  porque el modelo de tiempos se equivoca ~8 min por servicio;
- cada unidad solo trabaja en el horario en que trabajó ese día;
- sus servicios en otras sedes le bloquean ese tiempo (vacía);
- en RECOJO se visita también a quien luego no salió: al planificar no se sabe.
Tiempos (medidos en el histórico, 7.917 tramos): 1,7 min/km, 4,9 min por
recojo, 5,5 min por entrega de SALIDA y 8 min al llegar a la sede.
"""
import os
import statistics
import sys
import time
from collections import defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aplicar_sql  # noqa: E402
import numpy  # noqa: E402
import vroom  # noqa: E402
from vroom import _vroom  # noqa: E402

# La sede, ajustada con los datos: el punto que mejor explica el último tramo de
# sus RECOJO (R² 0,69 sobre 2.999 servicios, a 1,63 min/km; no hay dirección pública).
SEDE = ("TELEPERFORMANCE BELLAVISTA", -12.055, -77.1075)
MIN_POR_KM = 1.7
SETUP_RECOJO, SETUP_ENTREGA, SETUP_SEDE = 4.9, 5.5, 8.0
MAX_A_BORDO, MARGEN_LLEGADA, ESPERA_SALIDA = int(os.getenv("MAX_A_BORDO", "90")), 10, 15
COLCHON = 10
ORIGEN_MIN = 8 * 60  # los minutos cuentan desde el día D a las 08:00
HOLGURA_HORARIO = 15  # la unidad puede empezar/terminar 15 min antes/después que ese día


def consulta(dia: date) -> str:
    sede, lat, lng = SEDE
    return f"""
with base as (
  select s.codigo_vehiculo v, s.turno, s.modalidad, s.incidencia, s.sede, p.lat, p.lng,
    (s.fecha_ejecutada - date '{dia}') * 1440 + split_part(s.turno,':',1)::int * 60
      + split_part(s.turno,':',2)::int - {ORIGEN_MIN} as t,
    ((extract(epoch from (s.hora_inicio   - s.turno::time))/60)::int + 2160) % 1440 - 720 as ini,
    ((extract(epoch from (s.hora_en_punto - s.turno::time))/60)::int + 2160) % 1440 - 720 as pto,
    ((extract(epoch from (s.hora_llegada  - s.turno::time))/60)::int + 2160) % 1440 - 720 as lle
  from servicios_historicos s
  left join pasajeros p on p.dni = s.dni and p.estado_ubicacion = 'resuelta'
  where s.turno ~ '^[0-9]{{1,2}}:[0-9]{{2}}$' and s.codigo_vehiculo is not null
    and s.fecha_ejecutada between date '{dia}' and date '{dia}' + 1),
ventana as (select * from base where t >= 120 and t < 1560),
aqui as (select * from ventana where sede = '{sede}'),
visitas as (select * from aqui where
              (modalidad = 'RECOJO' and pto is not null and lle is not null)
           or (modalidad = 'SALIDA' and incidencia = 'A BORDO' and lle is not null)),
paradas as (select row_number() over (order by random()) as i, v, turno, modalidad, t, pto, lle,
                   incidencia = 'A BORDO' as subio, lat, lng
            from visitas where lat is not null),
puntos as (select 0 as i, {lat}::float as lat, {lng}::float as lng union all select i, lat, lng from paradas),
filas as (select a.i, jsonb_agg(round((2 * 6371 * asin(sqrt(power(sin(radians(b.lat - a.lat)/2), 2)
            + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng)/2), 2))))::numeric, 3)
            order by b.i) as fila
          from puntos a cross join puntos b group by a.i),
unidades as (select distinct v from aqui),
servicios as (select v, sede, t, modalidad, t + min(coalesce(ini, pto, 0)) as desde, t + max(lle) as hasta
              from ventana where v in (select v from unidades) group by v, sede, t, modalidad
              having max(lle) is not null),
flota as (select public._clave_normalizada(k) as clave, (u->>'capacidad')::int as cap
          from app_state, jsonb_each(usuarios->'__flota__') e(k, u) where id = 1 and (u->>'capacidad') ~ '^[0-9]+$'),
llevado as (select codigo_vehiculo v, max(n) as n from (
              select codigo_vehiculo, count(*) n from servicios_historicos where incidencia = 'A BORDO'
              group by codigo_vehiculo, fecha_ejecutada, turno, modalidad) x group by 1)
select jsonb_build_object(
  'paradas', (select jsonb_agg(jsonb_build_object('i', i, 'v', v, 'modalidad', modalidad, 't', t,
                                                  'pto', pto, 'lle', lle, 'subio', subio)) from paradas),
  'km', (select jsonb_agg(fila order by i) from filas),
  'unidades', (select jsonb_agg(jsonb_build_object(
                 'v', u.v, 'cap', f.cap, 'llevado', l.n,
                 'desde', (select min(desde) from servicios s where s.v = u.v),
                 'hasta', (select max(hasta) from servicios s where s.v = u.v),
                 'fuera', (select coalesce(jsonb_agg(jsonb_build_array(desde, hasta)), '[]'::jsonb)
                           from servicios s where s.v = u.v and s.sede <> '{sede}')))
               from unidades u left join flota f on f.clave = public._clave_normalizada(u.v)
               left join llevado l on l.v = u.v),
  'a_bordo_total', (select count(*) from aqui where incidencia = 'A BORDO'),
  'visitas_total', (select count(*) from visitas),
  'sin_ubicar', (select count(*) from visitas where lat is null)
) as datos"""


def viaje(km: float) -> float:
    return km * MIN_POR_KM


def real(datos):
    """Lo que se hizo, medido con el mismo modelo de tiempos que VROOM."""
    km = datos["km"]
    servicios = defaultdict(list)
    for p in datos["paradas"]:
        servicios[(p["v"], p["t"], p["modalidad"])].append(p)
    rutas, a_bordo, errores = defaultdict(list), [], []
    for (v, t, modalidad), ps in servicios.items():
        if modalidad == "RECOJO":
            ps.sort(key=lambda p: p["pto"])
            reloj = inicio = t + ps[0]["pto"]
            subidas = []
            for k, p in enumerate(ps):
                if k:
                    reloj += viaje(km[ps[k - 1]["i"]][p["i"]])
                if p["subio"]:
                    subidas.append(reloj)
                reloj += SETUP_RECOJO
            reloj += viaje(km[ps[-1]["i"]][0])
            a_bordo += [reloj - x for x in subidas]
            reloj += SETUP_SEDE
            real_min = max(p["lle"] for p in ps) - ps[0]["pto"]
            rutas[v].append((inicio, reloj, ps[0]["i"], 0))
        else:
            ps.sort(key=lambda p: p["lle"])
            reloj = inicio = t
            anterior = 0
            for p in ps:
                reloj += viaje(km[anterior][p["i"]])
                a_bordo.append(reloj - t)
                reloj += SETUP_ENTREGA
                anterior = p["i"]
            real_min = max(p["lle"] for p in ps)
            rutas[v].append((inicio, reloj, 0, ps[-1]["i"]))
        errores.append((reloj - inicio) - real_min)
    trabajo = 0.0
    for tramos in rutas.values():
        tramos.sort()
        trabajo += sum(fin - ini for ini, fin, _, _ in tramos)
        trabajo += sum(viaje(km[a[3]][b[2]]) for a, b in zip(tramos, tramos[1:]))
    return {"unidades": len(rutas), "servicios": len(servicios), "minutos": trabajo,
            "a_bordo": a_bordo, "errores": errores}


def bloques(intervalos, desde):
    """Los servicios en otras sedes, ordenados y sin solapes (VROOM los exige así)."""
    fusion = []
    for a, b in sorted((max(a, desde, 0), b) for a, b in intervalos):
        if b <= a:
            continue
        if fusion and a <= fusion[-1][1]:
            fusion[-1][1] = max(fusion[-1][1], b)
        else:
            fusion.append([a, b])
    return fusion


def problema(datos, costo_fijo: int) -> vroom.Input:
    km = datos["km"]
    entrada = vroom.Input()
    # Un punto virtual a distancia cero de todo, como salida y llegada: las rutas
    # quedan abiertas, como en la realidad (nadie sale ni vuelve a una cochera).
    libre = len(km)
    segundos = [[round(viaje(x) * 60) for x in fila] + [0] for fila in km] + [[0] * (libre + 1)]
    # En Windows, pyvroom solo acepta el entero de C (`uintc`); en Linux da igual.
    entrada.set_durations_matrix("car", _vroom.Matrix(numpy.asarray(segundos, dtype=numpy.uintc)))
    for n, u in enumerate(datos["unidades"], start=1):
        if u["desde"] is None:
            continue
        cap = u["cap"] or u["llevado"] or 4
        horario = vroom.TimeWindow(max(0, (u["desde"] - HOLGURA_HORARIO) * 60), (u["hasta"] + HOLGURA_HORARIO) * 60)
        # Lo que hizo en otras sedes le ocupa ese tiempo, y va vacía para esta.
        ocupado = [vroom.Break(k, time_windows=[vroom.TimeWindow(a * 60, a * 60)],
                               service=(b - a) * 60, max_load=[0])
                   for k, (a, b) in enumerate(bloques(u["fuera"], u["desde"] - HOLGURA_HORARIO), start=n * 100)]
        entrada.add_vehicle(vroom.Vehicle(n, capacity=[cap], start=libre, end=libre, time_window=horario,
                                          breaks=ocupado, costs=vroom.VehicleCosts(fixed=costo_fijo)))
    a_bordo_plan, margen_plan = MAX_A_BORDO - COLCHON, MARGEN_LLEGADA + COLCHON
    for p in datos["paradas"]:
        T = p["t"] * 60
        if p["modalidad"] == "RECOJO":
            ventana = vroom.TimeWindow(T - (a_bordo_plan + margen_plan) * 60, T - margen_plan * 60)
            recogida = vroom.ShipmentStep(p["i"], location=p["i"], default_setup=round(SETUP_RECOJO * 60),
                                          time_windows=[ventana])
            entrega = vroom.ShipmentStep(p["i"], location=0, default_setup=round(SETUP_SEDE * 60),
                                         time_windows=[ventana])
        else:
            recogida = vroom.ShipmentStep(p["i"], location=0,
                                          time_windows=[vroom.TimeWindow(T, T + ESPERA_SALIDA * 60)])
            entrega = vroom.ShipmentStep(p["i"], location=p["i"], default_setup=round(SETUP_ENTREGA * 60),
                                         time_windows=[vroom.TimeWindow(T, T + a_bordo_plan * 60)])
        entrada.add_shipment(recogida, entrega, amount=vroom.Amount([1]))
    return entrada


def resolver(datos, costo_fijo: int):
    t0 = time.time()
    solucion = problema(datos, costo_fijo).solve(exploration_level=5, nb_threads=4,
                                                 timeout=timedelta(seconds=120))
    rutas = solucion.routes
    tareas = rutas[rutas["type"].isin(["pickup", "delivery"])]
    subio = {p["i"]: p["subio"] for p in datos["paradas"]}
    # A bordo desde que la persona sube (tras la espera, si la unidad llegó antes)
    # hasta que la unidad llega a destino: lo mismo que se mide en lo real.
    subida = {int(r.id): (r.arrival + r.waiting_time) / 60 for r in tareas.itertuples() if r.type == "pickup"}
    bajada = {int(r.id): r.arrival / 60 for r in tareas.itertuples() if r.type == "delivery"}
    a_bordo = [bajada[i] - subida[i] for i in subida if i in bajada and subio[i]]
    fin = rutas[rutas["type"] == "end"]
    tareas_y_paradas = rutas[rutas["type"] != "break"]
    trabajo = (fin["duration"].sum() + tareas_y_paradas["setup"].sum() + tareas_y_paradas["service"].sum()) / 60
    return {"unidades": tareas["vehicle_id"].nunique(), "minutos": trabajo, "a_bordo": a_bordo,
            "sin_asignar": len(solucion.unassigned), "segundos": time.time() - t0}


def p90(valores):
    return round(statistics.quantiles(valores, n=10)[-1]) if len(valores) > 2 else None


def informe(dia, datos, r, soluciones):
    e = r["errores"]
    print(f"\n=== {dia} ({dia:%a}) · jornada 10:00 → 10:00 · {SEDE[0]} ===")
    print(f"visitas: {datos['visitas_total']} ({datos['a_bordo_total']} subieron); sin domicilio resuelto, "
          f"fuera: {datos['sin_ubicar']}; en la prueba: {len(datos['paradas'])}")
    print(f"modelo de tiempos contra lo real: error mediano {statistics.median(abs(x) for x in e):.1f} min, "
          f"sesgo mediano {statistics.median(e):+.1f} min ({len(e)} servicios)")
    print(f"  REAL           {r['unidades']:3d} unidades · {r['minutos'] / 60:5.1f} h · a bordo med "
          f"{statistics.median(r['a_bordo']):.0f} p90 {p90(r['a_bordo'])} máx {max(r['a_bordo']):.0f}")
    for nombre, s in soluciones.items():
        print(f"  VROOM {nombre:<9}{s['unidades']:3d} unidades · {s['minutos'] / 60:5.1f} h · a bordo med "
              f"{statistics.median(s['a_bordo']):.0f} p90 {p90(s['a_bordo'])} máx {max(s['a_bordo']):.0f}"
              f" · sin asignar {s['sin_asignar']} · {s['segundos']:.0f} s")


if __name__ == "__main__":
    for texto in sys.argv[1:]:
        dia = date.fromisoformat(texto)
        datos = aplicar_sql.ejecutar(consulta(dia))[0]["datos"]
        r = real(datos)
        soluciones = {nombre: resolver(datos, fijo)
                      for nombre, fijo in (("unidades", 4 * 3600), ("tiempo", 0))}
        informe(dia, datos, r, soluciones)
