"""Ejecuta de verdad la disponibilidad de las unidades contra la base, y deshace.

Igual que `probar_funciones_plan.py`: las pruebas del backend simulan
PostgREST y no ven si una función de Postgres funciona. Esto siembra un día
vacío de la ventana programable, le pone descansos y turnos a dos unidades y
comprueba que sus pasajeros pasan a pendientes, que lo que sí trabajan se
queda y que se pueden recolocar. Termina lanzando una excepción a propósito,
que deshace la transacción entera: no deja rastro. Si el día elegido ya tiene
plan, no hace nada.

    python scripts/probar_disponibilidad.py
    python scripts/probar_disponibilidad.py --con-migracion   # antes de aplicar la 018

Con `--con-migracion` manda la 018 en la misma llamada: se prueba sin haberla
aplicado y se deshace con todo lo demás. Desde la raíz del repositorio, con el
entorno de `frontend/`. Necesita `SUPABASE_ACCESS_TOKEN`, como `aplicar_sql.py`.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import aplicar_sql  # noqa: E402

SENAL = "PRUEBA_TERMINADA"
SUPABASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "supabase")
MIGRACION = "018_disponibilidad_unidades.sql"

BLOQUE = r"""
do $prueba$
declare
  hoy date := (now() at time zone 'America/Lima')::date;
  dia date := (now() at time zone 'America/Lima')::date + 13;
  dia_iso_x smallint;
  r jsonb;
  res jsonb := '{}'::jsonb;
  v record;
  w record;
  clave_v text;
  clave_w text;
  n_v integer;
  turno_a text;
  quedan integer;
  persona record;
  hueco record;
  sin_plan date;
begin
  if exists (select 1 from programacion_dias d where d.fecha = dia) then
    raise exception 'OMITIDA: el % ya tiene plan y no se toca', dia;
  end if;
  dia_iso_x := extract(isodow from dia)::smallint;

  r := sembrar_programacion(dia);
  res := res || jsonb_build_object('sembrar', r -> 'creadas');

  -- La unidad con más pasajeros ese día descansa; la de más turnos distintos
  -- trabaja solo uno de ellos.
  select p.codigo_vehiculo, count(*)::int as n into v
    from programacion p where p.fecha = dia and p.estado = 'programado'
   group by 1 order by 2 desc, 1 limit 1;
  clave_v := _clave_normalizada(v.codigo_vehiculo);
  select p.codigo_vehiculo, count(distinct p.turno)::int as turnos_distintos,
         min(p.turno) as primero into w
    from programacion p
   where p.fecha = dia and p.estado = 'programado'
     and _clave_normalizada(p.codigo_vehiculo) <> clave_v
   group by 1 order by 2 desc, 1 limit 1;
  clave_w := _clave_normalizada(w.codigo_vehiculo);
  turno_a := w.primero;

  res := res || jsonb_build_object('sin_regla',
    (not (disponibilidad_del_dia(dia) ? clave_v))::int);

  -- 1. Descansa ese día (fecha concreta).
  r := guardar_disponibilidad(clave_v, null,
         jsonb_build_array(jsonb_build_object('fecha', dia, 'turnos', '[]'::jsonb,
                                              'nota', 'Prueba')),
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('descanso_retira',
    ((r ->> 'personas')::int = v.n)::int);
  select count(*) into quedan from programacion p
   where p.fecha = dia and p.estado = 'programado'
     and _clave_normalizada(p.codigo_vehiculo) = clave_v;
  res := res || jsonb_build_object('no_queda_nadie', (quedan = 0)::int);
  res := res || jsonb_build_object('a_pendientes', (
    select count(*) from programacion_pendientes x
     where x.fecha = dia and x.motivo = 'no_disponible'
       and x.detalle = 'Iba en ' || v.codigo_vehiculo));
  res := res || jsonb_build_object('retirados_sin_baja', (
    select count(*) from programacion p
     where p.fecha = dia and p.estado = 'retirado' and p.nota = 'Unidad no disponible'
       and _clave_normalizada(p.codigo_vehiculo) = clave_v));
  res := res || jsonb_build_object('regla_del_dia', (
    disponibilidad_del_dia(dia) -> clave_v ->> 'origen' = 'fecha'
    and disponibilidad_del_dia(dia) -> clave_v ->> 'nota' = 'Prueba'
    and jsonb_array_length(disponibilidad_del_dia(dia) -> clave_v -> 'turnos') = 0)::int);
  r := retirar_no_disponibles(dia);
  res := res || jsonb_build_object('otra_vez_nada', ((r ->> 'personas')::int = 0)::int);

  -- 2. Su semana: ese día de la semana solo trabaja `turno_a`.
  r := guardar_disponibilidad(clave_w,
         jsonb_build_object(dia_iso_x::text, jsonb_build_array(turno_a)), null,
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('solo_su_turno_sigue', (
    select count(*) from programacion p
     where p.fecha = dia and p.estado = 'programado'
       and _clave_normalizada(p.codigo_vehiculo) = clave_w
       and _mismo_turno(p.turno, turno_a)));
  res := res || jsonb_build_object('los_otros_turnos_salen', (not exists (
    select 1 from programacion p
     where p.fecha = dia and p.estado = 'programado'
       and _clave_normalizada(p.codigo_vehiculo) = clave_w
       and not _mismo_turno(p.turno, turno_a)))::int);
  res := res || jsonb_build_object('regla_semanal', (
    disponibilidad_del_dia(dia) -> clave_w ->> 'origen' = 'semana')::int);

  -- 3. Una fecha con «trabaja todo» anula su semana; «semana» la devuelve.
  r := guardar_disponibilidad(clave_w, null,
         jsonb_build_array(jsonb_build_object('fecha', dia, 'turnos', 'null'::jsonb)),
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('fecha_anula_semana',
    (not (disponibilidad_del_dia(dia) ? clave_w))::int);
  r := guardar_disponibilidad(clave_w, null,
         jsonb_build_array(jsonb_build_object('fecha', dia, 'turnos', 'semana')),
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('vuelve_a_su_semana',
    (disponibilidad_del_dia(dia) ? clave_w)::int);

  -- 4. Quitar la regla de la semana (null) la deja trabajando todo.
  r := guardar_disponibilidad(clave_w, jsonb_build_object(dia_iso_x::text, 'null'::jsonb), null,
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('semana_quitada',
    (not (disponibilidad_del_dia(dia) ? clave_w))::int);

  -- 5. Lo que pasó a pendientes se puede recolocar en otra unidad.
  select x.dni, x.turno, x.modalidad, x.cobertura into persona
    from programacion_pendientes x
   where x.fecha = dia and x.motivo = 'no_disponible' limit 1;
  select p.codigo_vehiculo into hueco
    from programacion p
   where p.fecha = dia and p.estado = 'programado' and p.modalidad = persona.modalidad
     and _mismo_turno(p.turno, persona.turno)
     and _clave_normalizada(p.codigo_vehiculo) not in (clave_v, clave_w)
   limit 1;
  if hueco.codigo_vehiculo is not null then
    r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
      'accion', 'agregar', 'dni', persona.dni, 'vehiculo', hueco.codigo_vehiculo,
      'turno', persona.turno, 'modalidad', persona.modalidad, 'cobertura', persona.cobertura,
      'pendiente', jsonb_build_object('turno', persona.turno, 'modalidad', persona.modalidad))));
    res := res || jsonb_build_object('recolocado', (
      (r ->> 'aplicados')::int >= 1
      and not exists (select 1 from programacion_pendientes x
                       where x.fecha = dia and x.dni = persona.dni
                         and x.turno = persona.turno and x.modalidad = persona.modalidad))::int);
  else
    res := res || jsonb_build_object('recolocado', 1);
  end if;

  -- 6. Lo que no se debe aceptar.
  r := guardar_disponibilidad(clave_v, null,
         jsonb_build_array(jsonb_build_object('fecha', hoy - 1, 'turnos', '[]'::jsonb)),
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('pasado_no', (r ->> 'error' = 'entrada_invalida')::int);
  r := guardar_disponibilidad(clave_v, jsonb_build_object('1', jsonb_build_array('25:00')), null,
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('turno_malo_no', (r ->> 'error' = 'entrada_invalida')::int);
  r := guardar_disponibilidad(clave_v, jsonb_build_object('8', '[]'::jsonb), null,
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('dia_malo_no', (r ->> 'error' = 'entrada_invalida')::int);
  r := guardar_disponibilidad('K-027', jsonb_build_object('1', '[]'::jsonb), null,
         hoy, hoy + 90, 'prueba');
  res := res || jsonb_build_object('clave_sin_normalizar_no', (r ->> 'error' = 'entrada_invalida')::int);

  -- 7. Un día sin plan no hace nada.
  select max(d.fecha) + 400 into sin_plan from programacion_dias d;
  r := retirar_no_disponibles(sin_plan);
  res := res || jsonb_build_object('sin_plan_nada', ((r ->> 'personas')::int = 0)::int);

  -- 8. Lectura para la Flota.
  r := leer_disponibilidad(hoy, hoy + 90, hoy - 45);
  res := res || jsonb_build_object('leer', (
    jsonb_array_length(r -> 'fechas') >= 1
    and jsonb_array_length(r -> 'turnos') >= 1
    and (r -> 'dias_con_plan') @> to_jsonb(array[dia::text]))::int);

  -- 9. Nada de esto se abre a la clave anónima.
  res := res || jsonb_build_object('cerradas_a_anon', (
    not has_table_privilege('anon', 'public.disponibilidad_semanal', 'select')
    and not has_table_privilege('anon', 'public.disponibilidad_fechas', 'select')
    and not has_table_privilege('authenticated', 'public.disponibilidad_fechas', 'insert')
    and not has_function_privilege('anon', 'public.guardar_disponibilidad(text,jsonb,jsonb,date,date,text)', 'execute')
    and not has_function_privilege('anon', 'public.retirar_no_disponibles(date)', 'execute')
    and not has_function_privilege('anon', 'public.disponibilidad_del_dia(date)', 'execute')
    and not has_function_privilege('anon', 'public.leer_disponibilidad(date,date,date)', 'execute')
    and not has_function_privilege('authenticated', 'public.turnos_de_la_operacion(date)', 'execute'))::int);

  raise exception '% %', '""" + SENAL + r"""', res;
end $prueba$;
"""

MINIMOS = {
    "sembrar": 1, "sin_regla": 1, "descanso_retira": 1, "no_queda_nadie": 1,
    "a_pendientes": 1, "retirados_sin_baja": 1, "regla_del_dia": 1, "otra_vez_nada": 1,
    "solo_su_turno_sigue": 1, "los_otros_turnos_salen": 1, "regla_semanal": 1,
    "fecha_anula_semana": 1, "vuelve_a_su_semana": 1, "semana_quitada": 1, "recolocado": 1,
    "pasado_no": 1, "turno_malo_no": 1, "dia_malo_no": 1, "clave_sin_normalizar_no": 1,
    "sin_plan_nada": 1, "leer": 1, "cerradas_a_anon": 1,
}


def main() -> int:
    sql = BLOQUE
    if "--con-migracion" in sys.argv:
        with open(os.path.join(SUPABASE, MIGRACION), encoding="utf-8") as mano:
            sql = mano.read() + chr(10) + BLOQUE
    try:
        aplicar_sql.ejecutar(sql)
    except SystemExit as salida:
        mensaje = str(salida)
    else:
        print("El bloque terminó sin su excepción: algo lo cambió y no se sabe qué quedó.")
        return 2

    if "OMITIDA" in mensaje:
        print(re.search(r"OMITIDA[^\\\"]*", mensaje).group(0))
        return 0
    if SENAL not in mensaje:
        limpio = mensaje.replace('\\"', '"').replace("\\n", " ")
        error = re.search(r"ERROR:.*?(?=QUERY:|CONTEXT:|$)", limpio)
        print("FALLO en Postgres:", (error.group(0) if error else limpio)[:600].strip())
        return 1

    resultados = json.loads(re.search(SENAL + r" (\{.*?\})", mensaje.replace('\\"', '"')).group(1))
    fallos = 0
    for prueba, minimo in MINIMOS.items():
        valor = resultados.get(prueba)
        bien = isinstance(valor, int) and valor >= minimo
        fallos += not bien
        print(f"{'ok   ' if bien else 'FALLO'} {prueba:26} {valor}")
    print("Todo deshecho: la base queda como estaba.")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
