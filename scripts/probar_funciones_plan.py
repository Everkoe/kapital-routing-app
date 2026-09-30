"""Ejecuta de verdad cada acción de la programación contra la base, y deshace.

Por qué existe
--------------
Las pruebas del backend simulan PostgREST: comprueban lo que hace el API con
la respuesta de una función, no que la función funcione. Así pasó a
producción una `editar_programacion` que rechazaba toda llamada con `agregar`,
`mover` u `ordenar` («column reference "dni" is ambiguous») con todas las
pruebas en verde. Esto las ejecuta en Postgres.

Cómo no deja rastro
-------------------
Todo va dentro de un único bloque `do`: siembra un día vacío de la ventana
programable, aplica cada acción y termina lanzando una excepción a propósito,
que deshace la transacción entera. La excepción lleva los resultados; si llega
otra, es el error de verdad. Si el día elegido ya tiene plan, no hace nada.

Cómo se usa
-----------
    python scripts/probar_funciones_plan.py
    python scripts/probar_funciones_plan.py --con-migracion   # antes de aplicar la 016

Con `--con-migracion` manda la migración más reciente del plan (la 016) en la
misma llamada: se prueba sin haberla aplicado y se deshace con todo lo demás.

También vuelve a cargar el último día del histórico con una fila menos, otra
cambiada de unidad y otra repetida, y comprueba que el día queda como el
archivo: dentro de la misma transacción, así que tampoco deja rastro.

Desde la raíz del repositorio, con el entorno de `frontend/`. Necesita
`SUPABASE_ACCESS_TOKEN`, como `aplicar_sql.py`.
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
MIGRACION = "016_recarga_y_arrastre.sql"

# El último día de la ventana: es el que menos probable es que tenga plan.
BLOQUE = r"""
do $prueba$
declare
  dia date := (now() at time zone 'America/Lima')::date + 13;
  r jsonb;
  res jsonb := '{}'::jsonb;
  v record;
  destino record;
  lista jsonb;
  nuevo text;
  pasado date;
  hoy date := (now() at time zone 'America/Lima')::date;
  w record;
  otro text;
  dia_hist date;
  n_antes integer;
  filas_hist jsonb;
  movida jsonb;
begin
  if exists (select 1 from programacion_dias d where d.fecha = dia) then
    raise exception 'OMITIDA: el % ya tiene plan y no se toca', dia;
  end if;

  r := sembrar_programacion(dia);
  res := res || jsonb_build_object('sembrar', r -> 'creadas');

  -- Un servicio con al menos dos personas, para poder reordenarlo.
  select p.codigo_vehiculo, p.turno, p.modalidad into v
  from programacion p where p.fecha = dia
  group by 1, 2, 3 having count(*) >= 2
  order by 1, 2, 3 limit 1;
  select jsonb_agg(p.dni order by p.orden desc) into lista
  from programacion p
  where p.fecha = dia and p.codigo_vehiculo = v.codigo_vehiculo
    and p.turno = v.turno and p.modalidad = v.modalidad;

  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'retirar', 'dni', lista ->> 0, 'vehiculo', v.codigo_vehiculo,
    'turno', v.turno, 'modalidad', v.modalidad, 'nota', 'prueba')));
  res := res || jsonb_build_object('retirar', r -> 'aplicados');

  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'reponer', 'dni', lista ->> 0, 'vehiculo', v.codigo_vehiculo,
    'turno', v.turno, 'modalidad', v.modalidad)));
  res := res || jsonb_build_object('reponer', r -> 'aplicados');

  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'ordenar', 'vehiculo', v.codigo_vehiculo, 'turno', v.turno,
    'modalidad', v.modalidad, 'dnis', lista)));
  res := res || jsonb_build_object('ordenar', r -> 'aplicados');

  -- Mover a la primera persona a otro servicio del mismo turno y sentido.
  select p.codigo_vehiculo, p.cobertura into destino
  from programacion p
  where p.fecha = dia and p.turno = v.turno and p.modalidad = v.modalidad
    and p.codigo_vehiculo <> v.codigo_vehiculo
  limit 1;
  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'mover', 'dni', lista ->> 0,
    'desde', jsonb_build_object('vehiculo', v.codigo_vehiculo, 'turno', v.turno,
                                'modalidad', v.modalidad),
    'hacia', jsonb_build_object('vehiculo', destino.codigo_vehiculo, 'turno', v.turno,
                                'modalidad', v.modalidad, 'cobertura', destino.cobertura))));
  res := res || jsonb_build_object('mover', r -> 'aplicados');

  -- Agregar a alguien del padrón que no esté en el plan.
  select pa.dni into nuevo from pasajeros pa
  where not exists (select 1 from programacion p where p.fecha = dia and p.dni = pa.dni)
  limit 1;
  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'agregar', 'dni', nuevo, 'vehiculo', v.codigo_vehiculo,
    'turno', v.turno, 'modalidad', v.modalidad, 'origen', 'manual')));
  res := res || jsonb_build_object('agregar', r -> 'aplicados');

  r := aplicar_novedades(dia, jsonb_build_array(jsonb_build_object(
    'dni', lista ->> 1, 'viaja', false, 'etiqueta', 'prueba')));
  res := res || jsonb_build_object('baja', r -> 'retiradas');

  -- Arrastrar a pendientes: sale del servicio sin baja y queda para recolocar.
  -- Un servicio distinto del de arriba con otro del mismo turno y sentido.
  select p.codigo_vehiculo, p.turno, p.modalidad, p.dni, p.cobertura into w
  from programacion p
  where p.fecha = dia and p.estado = 'programado' and p.codigo_vehiculo <> v.codigo_vehiculo
    and exists (select 1 from programacion q
                where q.fecha = dia and q.turno = p.turno and q.modalidad = p.modalidad
                  and q.codigo_vehiculo <> p.codigo_vehiculo and q.estado = 'programado')
  order by p.codigo_vehiculo, p.turno limit 1;
  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'a_pendientes', 'dni', w.dni, 'vehiculo', w.codigo_vehiculo,
    'turno', w.turno, 'modalidad', w.modalidad)));
  res := res || jsonb_build_object(
    'a_pendientes', r -> 'aplicados',
    'a_pendientes_queda', (exists (
      select 1 from programacion_pendientes x
      where x.fecha = dia and x.dni = w.dni and x.motivo = 'devuelto'
        and x.turno = w.turno and x.modalidad = w.modalidad))::int,
    'a_pendientes_sin_baja', (exists (
      select 1 from programacion p
      where p.fecha = dia and p.dni = w.dni and p.codigo_vehiculo = w.codigo_vehiculo
        and p.estado = 'retirado' and p.nota = 'Devuelto a pendientes'))::int);

  -- Asignado desde pendientes a otra unidad, ya no se puede reponer en la suya:
  -- iría en dos coches a la vez.
  select q.codigo_vehiculo into otro from programacion q
  where q.fecha = dia and q.turno = w.turno and q.modalidad = w.modalidad
    and q.codigo_vehiculo <> w.codigo_vehiculo and q.estado = 'programado'
  limit 1;
  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'agregar', 'dni', w.dni, 'vehiculo', otro,
    'turno', w.turno, 'modalidad', w.modalidad, 'origen', 'manual')));
  res := res || jsonb_build_object('desde_pendientes', r -> 'aplicados',
    'pendiente_resuelto', (not exists (
      select 1 from programacion_pendientes x where x.fecha = dia and x.dni = w.dni))::int);
  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'reponer', 'dni', w.dni, 'vehiculo', w.codigo_vehiculo,
    'turno', w.turno, 'modalidad', w.modalidad)));
  res := res || jsonb_build_object('reponer_en_dos_no',
    ((r ->> 'aplicados')::int = 0 and (r ->> 'ignorados')::int = 1)::int);

  -- Y arrastrarla de vuelta a su unidad reutiliza la fila retirada.
  r := editar_programacion(dia, jsonb_build_array(jsonb_build_object(
    'accion', 'mover', 'dni', w.dni,
    'desde', jsonb_build_object('vehiculo', otro, 'turno', w.turno, 'modalidad', w.modalidad),
    'hacia', jsonb_build_object('vehiculo', w.codigo_vehiculo, 'turno', w.turno,
                                'modalidad', w.modalidad, 'cobertura', w.cobertura))));
  res := res || jsonb_build_object('mover_a_su_fila', r -> 'aplicados',
    'mover_una_sola_fila', ((select count(*) from programacion p
      where p.fecha = dia and p.dni = w.dni and p.turno = w.turno
        and p.modalidad = w.modalidad and p.estado = 'programado') = 1)::int);

  r := leer_programacion(dia);
  res := res || jsonb_build_object('leer', jsonb_array_length(r -> 'rutas'));

  -- Volver a cargar un día del histórico lo sustituye por el archivo: sin la
  -- fila que ya no viene, con la movida solo en su unidad nueva y sin repetir
  -- la que el archivo trae dos veces.
  select max(s.fecha_ejecutada) into dia_hist from servicios_historicos s;
  select count(*) into n_antes from servicios_historicos s where s.fecha_ejecutada = dia_hist;
  select jsonb_agg(to_jsonb(s) - 'id' - 'cargado_en' order by s.orden) into filas_hist
  from (select h.*, row_number() over (order by h.dni is null, h.id) as orden
        from servicios_historicos h where h.fecha_ejecutada = dia_hist) s
  where s.orden > 1;
  filas_hist := (select jsonb_agg(f - 'orden') from jsonb_array_elements(filas_hist) f);
  movida := filas_hist -> 0;
  filas_hist := jsonb_set(filas_hist, '{0,codigo_vehiculo}', '"PRUEBA-RECARGA"')
                || jsonb_build_array(filas_hist -> 1);
  res := res || jsonb_build_object('recarga_otro_dia_no',
    (reemplazar_dia_historico(dia_hist + 1, filas_hist) ->> 'error' = 'otro_dia')::int);
  r := reemplazar_dia_historico(dia_hist, filas_hist);
  res := res || jsonb_build_object(
    'recarga', r -> 'insertadas',
    'recarga_quita_lo_que_no_viene', ((select count(*) from servicios_historicos s
      where s.fecha_ejecutada = dia_hist) = n_antes - 1)::int,
    'recarga_mueve_de_unidad', ((select count(*) from servicios_historicos s
      where s.fecha_ejecutada = dia_hist and s.codigo_vehiculo = 'PRUEBA-RECARGA') = 1
      and not exists (select 1 from servicios_historicos s
        where s.fecha_ejecutada = dia_hist and s.dni = movida ->> 'dni'
          and s.codigo_vehiculo = movida ->> 'codigo_vehiculo'
          and s.turno = movida ->> 'turno' and s.modalidad = movida ->> 'modalidad'))::int);

  -- Con un viaje marcado por un conductor, ni rehacer ni borrar.
  insert into ejecucion_viajes (fecha, codigo_vehiculo, turno, modalidad, dni, estado, marcado_por)
  select p.fecha, p.codigo_vehiculo, p.turno, p.modalidad, p.dni, 'a_bordo', 'prueba'
  from programacion p where p.fecha = dia limit 1;
  res := res || jsonb_build_object(
    'rehacer_con_marcas_no', (sembrar_programacion(dia, null, true) ->> 'error' = 'con_marcas')::int,
    'borrar_con_marcas_no', (borrar_programacion(dia) ->> 'error' = 'con_marcas')::int);
  delete from ejecucion_viajes e where e.fecha = dia;

  -- Rehacer vuelve a copiar el día: lo tocado a mano se pierde.
  r := sembrar_programacion(dia, null, true);
  res := res || jsonb_build_object('rehacer', r -> 'creadas');
  res := res || jsonb_build_object('rehacer_sin_lo_manual', (not exists (
    select 1 from programacion p where p.fecha = dia and p.origen = 'manual'))::int);

  -- Borrar deja el día sin nada, y una segunda vez ya no hay qué borrar.
  r := borrar_programacion(dia);
  res := res || jsonb_build_object('borrar', r -> 'borradas');
  res := res || jsonb_build_object('borrado_limpio', (
    not exists (select 1 from programacion p where p.fecha = dia)
    and not exists (select 1 from programacion_dias d where d.fecha = dia)
    and not exists (select 1 from programacion_pendientes x where x.fecha = dia))::int);
  res := res || jsonb_build_object(
    'borrar_otra_vez_no', (borrar_programacion(dia) ->> 'error' = 'sin_programacion')::int);

  -- Lo que ya pasó no se borra ni se rehace, aunque tenga plan.
  select max(d.fecha) into pasado from programacion_dias d where d.fecha < hoy;
  if pasado is not null then
    res := res || jsonb_build_object(
      'pasado_no_se_borra', (borrar_programacion(pasado) ->> 'error' = 'dia_pasado')::int,
      'pasado_no_se_rehace', (sembrar_programacion(pasado, null, true) ->> 'error' = 'dia_pasado')::int);
  end if;

  res := res || jsonb_build_object('cerradas_a_anon', (
    not has_function_privilege('anon', 'public.borrar_programacion(date)', 'execute')
    and not has_function_privilege('authenticated', 'public.borrar_programacion(date)', 'execute')
    and not has_function_privilege('anon', 'public.sembrar_programacion(date,date,boolean)', 'execute')
    and not has_function_privilege('anon', 'public.editar_programacion(date,jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.reemplazar_dia_historico(date,jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.reemplazar_dia_historico(date,jsonb)', 'execute'))::int);

  raise exception '% %', '""" + SENAL + r"""', res;
end $prueba$;
"""

# Lo que cada acción tiene que haber tocado como mínimo.
MINIMOS = {
    "sembrar": 1, "retirar": 1, "reponer": 1, "ordenar": 1,
    "mover": 1, "agregar": 1, "baja": 1, "leer": 1,
    "a_pendientes": 1, "a_pendientes_queda": 1, "a_pendientes_sin_baja": 1,
    "desde_pendientes": 1, "pendiente_resuelto": 1, "reponer_en_dos_no": 1,
    "mover_a_su_fila": 1, "mover_una_sola_fila": 1,
    "recarga_otro_dia_no": 1, "recarga": 1,
    "recarga_quita_lo_que_no_viene": 1, "recarga_mueve_de_unidad": 1,
    "rehacer_con_marcas_no": 1, "borrar_con_marcas_no": 1,
    "rehacer": 1, "rehacer_sin_lo_manual": 1,
    "borrar": 1, "borrado_limpio": 1, "borrar_otra_vez_no": 1,
    "pasado_no_se_borra": 1, "pasado_no_se_rehace": 1, "cerradas_a_anon": 1,
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
        print("FALLO en Postgres:", (error.group(0) if error else limpio)[:500].strip())
        return 1

    resultados = json.loads(re.search(SENAL + r" (\{.*?\})", mensaje.replace('\\"', '"')).group(1))
    fallos = 0
    for accion, minimo in MINIMOS.items():
        valor = resultados.get(accion)
        bien = isinstance(valor, int) and valor >= minimo
        fallos += not bien
        print(f"{'ok   ' if bien else 'FALLO'} {accion:8} {valor}")
    print("Todo deshecho: la base queda como estaba.")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
