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

  r := leer_programacion(dia);
  res := res || jsonb_build_object('leer', jsonb_array_length(r -> 'rutas'));

  raise exception '% %', '""" + SENAL + r"""', res;
end $prueba$;
"""

# Lo que cada acción tiene que haber tocado como mínimo.
MINIMOS = {
    "sembrar": 1, "retirar": 1, "reponer": 1, "ordenar": 1,
    "mover": 1, "agregar": 1, "baja": 1, "leer": 1,
}


def main() -> int:
    try:
        aplicar_sql.ejecutar(BLOQUE)
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
