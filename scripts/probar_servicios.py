"""Ejecuta de verdad las funciones del conductor y del cliente, y deshace.

Por qué existe
--------------
Las pruebas del backend simulan PostgREST: comprueban qué pide el API, no que
Postgres devuelva lo que debe. Aquí se llaman `servicios_de_unidad`,
`marcar_viaje` y `servicios_de_empresa` sobre el último día con plan de la
base real: que cada conductor vea solo lo suyo, que no se le pueda marcar a
nadie de otro coche ni de otro día, y que al cliente no le lleguen direcciones
ni los datos personales del conductor.

Cómo no deja rastro
-------------------
Todo va dentro de un único bloque `do` que termina lanzando una excepción a
propósito, lo que deshace la transacción entera, marcas incluidas.

Cómo se usa
-----------
    python scripts/probar_servicios.py
    python scripts/probar_servicios.py --con-migracion   # antes de aplicar la 010

Con `--con-migracion` manda la 010 en la misma llamada, así que se prueba sin
haberla aplicado y se deshace con todo lo demás. Desde la raíz del
repositorio, con el entorno de `frontend/`; necesita `SUPABASE_ACCESS_TOKEN`.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import aplicar_sql  # noqa: E402

SENAL = "PRUEBA_TERMINADA"
MIGRACION = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "supabase", "010_servicios_conductor_cliente.sql")

BLOQUE = r"""
do $prueba$
declare
  dia date;
  codigo text;
  clave text;
  otra_clave text;
  n_filas integer;
  una bigint;
  otra bigint;
  r jsonb;
  s jsonb;
  c jsonb;
  res jsonb := '{}'::jsonb;
  t0 timestamptz;
begin
  select max(fecha) into dia from programacion_dias;
  if dia is null then
    raise exception 'OMITIDA: no hay ningún día con plan';
  end if;
  select p.codigo_vehiculo, count(*) into codigo, n_filas
    from programacion p
   where p.fecha = dia and p.estado = 'programado'
   group by p.codigo_vehiculo
   having count(*) >= 3
   order by count(*) desc, p.codigo_vehiculo
   limit 1;
  if codigo is null then
    raise exception 'OMITIDA: el día % no tiene ninguna unidad con tres pasajeros', dia;
  end if;
  clave := _clave_normalizada(codigo);
  select _clave_normalizada(p.codigo_vehiculo) into otra_clave
    from programacion p
   where p.fecha = dia and _clave_normalizada(p.codigo_vehiculo) <> clave
   limit 1;
  select min(p.id), max(p.id) into una, otra
    from programacion p
   where p.fecha = dia and p.codigo_vehiculo = codigo and p.estado = 'programado';

  -- Lo que ve el conductor.
  t0 := clock_timestamp();
  s := servicios_de_unidad(clave, dia, dia);
  res := res || jsonb_build_object(
    'ms_conductor', round(extract(epoch from clock_timestamp() - t0) * 1000),
    'bytes_conductor', length(s::text),
    'conductor_ve_a_todos_los_suyos', (
      select sum(jsonb_array_length(x -> 'pasajeros')) from jsonb_array_elements(s -> 'servicios') x
    ) = n_filas,
    'conductor_solo_su_unidad', not exists (
      select 1 from jsonb_array_elements(s -> 'servicios') x
       where _clave_normalizada(x ->> 'unidad') <> clave),
    'conductor_sin_dni', not exists (
      select 1 from jsonb_array_elements(s -> 'servicios') x,
                    jsonb_array_elements(x -> 'pasajeros') p
       where p ? 'dni'),
    'conductor_con_direccion', exists (
      select 1 from jsonb_array_elements(s -> 'servicios') x,
                    jsonb_array_elements(x -> 'pasajeros') p
       where p ? 'direccion' and p ? 'lat'),
    'dia_con_plan', (s -> 'dias_con_plan') @> jsonb_build_array(dia));

  -- Marcar: el suyo sí; el de otro coche, otro día o con un estado raro, no.
  r := marcar_viaje(una, clave, 'a_bordo', 'prueba', dia, dia);
  res := res || jsonb_build_object('marca_propia', r ->> 'viaje' = 'a_bordo' and r ? 'marcado_en');
  s := servicios_de_unidad(clave, dia, dia);
  res := res || jsonb_build_object('marca_se_ve', exists (
    select 1 from jsonb_array_elements(s -> 'servicios') x,
                  jsonb_array_elements(x -> 'pasajeros') p
     where (p ->> 'id')::bigint = una and p ->> 'viaje' = 'a_bordo'));
  r := marcar_viaje(una, clave, 'no_se_presento', 'prueba', dia, dia);
  res := res || jsonb_build_object('remarcar_cambia', r ->> 'viaje' = 'no_se_presento'
    and (select count(*) from ejecucion_viajes e where e.fecha = dia and e.codigo_vehiculo = codigo) = 1);
  r := marcar_viaje(otra, coalesce(otra_clave, 'NADIE'), 'a_bordo', 'prueba', dia, dia);
  res := res || jsonb_build_object('otro_coche_no', r ->> 'error' = 'no_esta_en_el_plan');
  r := marcar_viaje(otra, clave, 'a_bordo', 'prueba', dia + 1, dia + 2);
  res := res || jsonb_build_object('otro_dia_no', r ->> 'error' = 'no_esta_en_el_plan');
  r := marcar_viaje(otra, clave, 'recogido', 'prueba', dia, dia);
  res := res || jsonb_build_object('estado_raro_no', r ->> 'error' = 'estado_invalido');
  r := marcar_viaje(-1, clave, 'a_bordo', 'prueba', dia, dia);
  res := res || jsonb_build_object('fila_inexistente_no', r ->> 'error' = 'no_esta_en_el_plan');

  -- Lo que ve el cliente, con la marca de antes.
  t0 := clock_timestamp();
  c := servicios_de_empresa('TELEPERFORMANCE', dia);
  res := res || jsonb_build_object(
    'ms_cliente', round(extract(epoch from clock_timestamp() - t0) * 1000),
    'bytes_cliente', length(c::text),
    'cliente_ve_su_personal', (
      select sum(jsonb_array_length(x -> 'personas')) from jsonb_array_elements(c -> 'servicios') x
    ) = (select count(*) from programacion p where p.fecha = dia and p.estado = 'programado'),
    'cliente_ve_la_marca', exists (
      select 1 from jsonb_array_elements(c -> 'servicios') x,
                    jsonb_array_elements(x -> 'personas') p
       where _clave_normalizada(x ->> 'unidad') = clave and p ->> 'viaje' = 'no_se_presento'),
    'cliente_sin_direcciones', not exists (
      select 1 from jsonb_array_elements(c -> 'servicios') x,
                    jsonb_array_elements(x -> 'personas') p
       where p ?| array['direccion', 'lat', 'lng']),
    'cliente_sin_datos_del_conductor', not exists (
      select 1 from jsonb_array_elements(c -> 'servicios') x
       where x -> 'conductor' ?| array['telefono', 'licencia', 'dni', 'direccion']),
    'cliente_ve_quien_conduce', exists (
      select 1 from jsonb_array_elements(c -> 'servicios') x
       where x -> 'conductor' ->> 'placa' is not null),
    'otra_empresa_no_ve_nada', jsonb_array_length(servicios_de_empresa('KONECTAXYZ', dia) -> 'servicios') = 0,
    'prefijo_vacio_no_ve_nada', jsonb_array_length(servicios_de_empresa('', dia) -> 'servicios') = 0);

  -- Desmarcar.
  r := marcar_viaje(una, clave, null, 'prueba', dia, dia);
  res := res || jsonb_build_object('desmarcar', r ->> 'viaje' is null
    and not exists (select 1 from ejecucion_viajes e where e.fecha = dia and e.codigo_vehiculo = codigo));

  -- Quien sale del servicio deja de estar en la lista, se avisa, y ya no se marca.
  update programacion set estado = 'retirado' where id = otra;
  s := servicios_de_unidad(clave, dia, dia);
  res := res || jsonb_build_object(
    'retirado_fuera_de_la_lista', not exists (
      select 1 from jsonb_array_elements(s -> 'servicios') x,
                    jsonb_array_elements(x -> 'pasajeros') p
       where (p ->> 'id')::bigint = otra),
    'retirado_avisado', exists (
      select 1 from jsonb_array_elements(s -> 'servicios') x
       where jsonb_array_length(x -> 'ya_no_viajan') > 0),
    'retirado_no_se_marca', marcar_viaje(otra, clave, 'a_bordo', 'prueba', dia, dia) ->> 'error' = 'no_esta_en_el_plan');

  -- Nadie más que el backend puede llamarlas ni leer las marcas.
  res := res || jsonb_build_object('cerradas_a_anon',
    not has_function_privilege('anon', 'public.servicios_de_unidad(text,date,date)', 'execute')
    and not has_function_privilege('anon', 'public.marcar_viaje(bigint,text,text,text,date,date)', 'execute')
    and not has_function_privilege('anon', 'public.servicios_de_empresa(text,date)', 'execute')
    and not has_function_privilege('authenticated', 'public.marcar_viaje(bigint,text,text,text,date,date)', 'execute')
    and not has_table_privilege('anon', 'public.ejecucion_viajes', 'select')
    and not has_table_privilege('authenticated', 'public.ejecucion_viajes', 'insert'));

  res := res || jsonb_build_object('dia', dia, 'unidad', codigo, 'pasajeros', n_filas);
  raise exception '% %', '""" + SENAL + r"""', res;
end $prueba$;
"""


def main() -> int:
    sql = BLOQUE
    if "--con-migracion" in sys.argv:
        with open(MIGRACION, encoding="utf-8") as mano:
            sql = mano.read() + "\n" + BLOQUE
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

    texto = mensaje.replace('\\"', '"')
    inicio = texto.index(SENAL) + len(SENAL) + 1
    resultados, _ = json.JSONDecoder().raw_decode(texto[inicio:])
    fallos = 0
    for nombre, valor in resultados.items():
        if isinstance(valor, bool):
            fallos += valor is not True
            print(f"{'ok   ' if valor else 'FALLO'} {nombre}")
        else:
            print(f"      {nombre}: {valor}")
    print("Todo deshecho: la base queda como estaba.")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
