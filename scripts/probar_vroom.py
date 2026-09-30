"""Prueba de VROOM: replanifica una jornada ya ejecutada de Bellavista y la compara con lo real.

Cómo se usa (desde la raíz, con el entorno de `frontend/` y `pip install -r scripts/requirements-modelo.txt`):

    python scripts/probar_vroom.py 2026-08-05 2026-08-19
    MAX_A_BORDO=70 python scripts/probar_vroom.py 2026-08-19     # la variante más cómoda

Solo lee. Resultados del 2026-09-30 en CLAUDE.md («La IA que organiza el día»).

Los datos personales no salen de la base: la consulta devuelve paradas con un
número opaco y la matriz de kilómetros entre ellas, calculada dentro de
Postgres. Nada se guarda en disco. Solo se imprimen totales.

Reglas (confirmadas por el usuario el 2026-09-30): a bordo como mucho 90 min;
en RECOJO, en la sede al menos 10 min antes del turno y recogido como mucho
1 h 45 antes; sin margen fijo entre servicios. Más una práctica medida: en la
sede **como mucho 45 min antes** (el 99% llega ≤ 42). Sin ella VROOM entregaba
a la vez gente de turnos distintos (8-11% de sus llegadas a la sede), cosa que
hoy no se hace: cada viaje es de un turno.

La lógica es la de la aplicación (`frontend/api/ruteo_vroom.py`): turno por
turno, sin mezclar turnos en un viaje. Para no engañarse, VROOM planifica con
**más exigencia que la realidad**:
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
from collections import defaultdict
from datetime import date

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "frontend"))
import aplicar_sql  # noqa: E402

from api import ruteo_vroom as rv  # noqa: E402

# La sede, ajustada con los datos: el punto que mejor explica el último tramo de
# sus RECOJO (R² 0,69 sobre 2.999 servicios, a 1,63 min/km; no hay dirección pública).
SEDE = ("TELEPERFORMANCE BELLAVISTA", -12.055, -77.1075)
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


def servicios_reales(datos):
    """Lo que se hizo, servicio a servicio y en el orden en que ocurrió."""
    servicios = defaultdict(list)
    for p in datos["paradas"]:
        servicios[(p["v"], p["t"], p["modalidad"])].append(p)
    resultado = []
    for (v, t, modalidad), ps in servicios.items():
        ps.sort(key=lambda p: p["pto"] if modalidad == rv.RECOJO else p["lle"])
        resultado.append((rv.ServicioActual(v, modalidad, t, [p["i"] for p in ps]), ps))
    return resultado


def error_del_modelo(km, servicios):
    """Duración según el modelo menos la real, por servicio: cuánto se equivoca."""
    reglas, errores = rv.Reglas(), []
    for s, ps in servicios:
        if s.modalidad == rv.RECOJO:
            modelo = sum(km[a][b] for a, b in zip(s.puntos, s.puntos[1:])) * reglas.min_por_km
            modelo += (len(s.puntos) * reglas.parada_recojo + km[s.puntos[-1]][0] * reglas.min_por_km
                       + reglas.entrada_sede)
            real = max(p["lle"] for p in ps) - ps[0]["pto"]
        else:
            camino = [0] + s.puntos
            modelo = sum(km[a][b] for a, b in zip(camino, camino[1:])) * reglas.min_por_km
            modelo += (len(s.puntos) - 1) * reglas.parada_entrega
            real = max(p["lle"] for p in ps)
        errores.append(modelo - real)
    return errores


def p90(valores):
    return round(statistics.quantiles(valores, n=10)[-1]) if len(valores) > 2 else None


def linea(nombre, unidades, minutos, a_bordo, extra=""):
    return (f"  {nombre:<15}{unidades:3d} unidades · {minutos / 60:5.1f} h · a bordo med "
            f"{statistics.median(a_bordo):.0f} p90 {p90(a_bordo)} máx {max(a_bordo):.0f}{extra}")


def probar(dia: date, reglas: rv.Reglas) -> None:
    datos = aplicar_sql.ejecutar(consulta(dia))[0]["datos"]
    km = datos["km"]
    servicios = servicios_reales(datos)
    errores = error_del_modelo(km, servicios)
    actual = rv.evaluar(km, [s for s, _ in servicios], reglas)
    paradas = [rv.Parada(str(p["i"]), p["modalidad"], p["t"], p["i"]) for p in datos["paradas"]]
    unidades = [rv.Unidad(u["v"], u["cap"] or u["llevado"] or 4, u["desde"] - HOLGURA_HORARIO,
                          u["hasta"] + HOLGURA_HORARIO, [tuple(x) for x in u["fuera"]])
                for u in datos["unidades"] if u["desde"] is not None]
    print(f"\n=== {dia} ({dia:%a}) · jornada 10:00 → 10:00 · {SEDE[0]} ===")
    print(f"visitas: {datos['visitas_total']} ({datos['a_bordo_total']} subieron); sin domicilio resuelto, "
          f"fuera: {datos['sin_ubicar']}; en la prueba: {len(paradas)}")
    print(f"modelo de tiempos contra lo real: error mediano {statistics.median(abs(x) for x in errores):.1f} min, "
          f"sesgo mediano {statistics.median(errores):+.1f} min ({len(errores)} servicios)")
    print(linea("REAL", actual["unidades"], actual["minutos_trabajo"], actual["a_bordo"]))
    for objetivo in ("unidades", "tiempo"):
        p = rv.proponer(km, paradas, unidades, objetivo, reglas)
        print(linea(f"VROOM {objetivo}", p.unidades, p.minutos_trabajo, p.a_bordo,
                    f" · sin asignar {len(p.sin_asignar)} · {p.segundos:.0f} s"))


if __name__ == "__main__":
    reglas = rv.Reglas(max_a_bordo=int(os.getenv("MAX_A_BORDO", "90")))
    for texto in sys.argv[1:]:
        probar(date.fromisoformat(texto), reglas)
