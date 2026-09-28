"""Ejecuta de verdad las funciones del conductor y del cliente, y deshace.

Por qué existe
--------------
Las pruebas del backend simulan PostgREST: comprueban qué pide el API, no que
Postgres devuelva lo que debe. Aquí se llaman `servicios_de_unidad`,
`marcar_viaje` y `servicios_de_empresa` sobre el último día con plan de la
base real: que cada conductor vea solo lo suyo, que no se le pueda marcar a
nadie de otro coche ni fuera de la hora de su servicio, y que al cliente no le lleguen direcciones
ni los datos personales del conductor.

Cómo no deja rastro
-------------------
Todo va dentro de un único bloque `do` que termina lanzando una excepción a
propósito, lo que deshace la transacción entera, marcas incluidas.

Cómo se usa
-----------
    python scripts/probar_servicios.py
    python scripts/probar_servicios.py --con-migracion   # antes de aplicar una migración

Con `--con-migracion` manda la 010, la 011 y la 012 en la misma llamada, así que se prueba sin
haberlas aplicado y se deshace con todo lo demás. Desde la raíz del
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
SUPABASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "supabase")
# Las que definen lo que se prueba, en orden: la 011 y la 012 reemplazan funciones de la 010.
MIGRACIONES = ("010_servicios_conductor_cliente.sql", "011_ventana_y_empresa.sql",
               "012_unidades_kv.sql")

BLOQUE = r"""
do $prueba$
declare
  dia date;
  hoy date := (now() at time zone 'America/Lima')::date;
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
  mover timestamp;
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

  -- Lo que ve el cliente del día entero, y que la empresa sea palabra entera.
  t0 := clock_timestamp();
  c := servicios_de_empresa('TELEPERFORMANCE', dia);
  res := res || jsonb_build_object(
    'ms_cliente', round(extract(epoch from clock_timestamp() - t0) * 1000),
    'bytes_cliente', length(c::text),
    'cliente_ve_su_personal', (
      select sum(jsonb_array_length(x -> 'personas')) from jsonb_array_elements(c -> 'servicios') x
    ) = (select count(*) from programacion p where p.fecha = dia and p.estado = 'programado'),
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
    'empresa_en_minusculas_es_la_misma', servicios_de_empresa('Teleperformance', dia) = c,
    'un_trozo_de_palabra_no_abre_nada', jsonb_array_length(servicios_de_empresa('TELE', dia) -> 'servicios') = 0,
    'otra_empresa_no_ve_nada', jsonb_array_length(servicios_de_empresa('KONECTAXYZ', dia) -> 'servicios') = 0,
    'prefijo_vacio_no_ve_nada', jsonb_array_length(servicios_de_empresa('', dia) -> 'servicios') = 0,
    'una_sede_ve_solo_la_suya', (
      select count(*) from jsonb_array_elements(servicios_de_empresa('TELEPERFORMANCE BELLAVISTA', dia) -> 'servicios') x
       where x ->> 'sede' <> 'TELEPERFORMANCE BELLAVISTA') = 0,
    'sin_servicios_duplicados', (
      select count(*) = count(distinct (x ->> 'unidad', x ->> 'turno', x ->> 'modalidad'))
        from jsonb_array_elements(c -> 'servicios') x));

  -- La «KV-026» de la base de conductores es la «V026» de la intranet (012).
  res := res || jsonb_build_object(
    'kv_de_la_base_es_la_v_de_la_intranet',
      _clave_normalizada('KV-026') = 'V026' and _clave_normalizada('V026') = 'V026'
      and _clave_normalizada('K-027') = 'K027' and _clave_normalizada('KV TEST') = 'KVTEST',
    'cliente_ve_el_vehiculo_de_una_v', not exists (
      select 1 from programacion p where p.fecha = dia and p.codigo_vehiculo ~ '^V[0-9]+$')
      or exists (
      select 1 from jsonb_array_elements(c -> 'servicios') x
       where x ->> 'unidad' ~ '^V[0-9]+$' and x -> 'conductor' ->> 'placa' is not null));

  -- Marcar. La ventana es la del servicio (de 3 h antes a 6 h después de su
  -- turno, en hora de Lima), así que se trae un pasajero a ahora mismo.
  update programacion
     set fecha = hoy, turno = to_char(now() at time zone 'America/Lima', 'HH24:MI')
   where id = una;
  r := marcar_viaje(una, clave, 'a_bordo', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('marca_propia', r ->> 'viaje' = 'a_bordo' and r ? 'marcado_en');
  s := servicios_de_unidad(clave, hoy, hoy);
  res := res || jsonb_build_object('marca_se_ve', exists (
    select 1 from jsonb_array_elements(s -> 'servicios') x,
                  jsonb_array_elements(x -> 'pasajeros') p
     where (p ->> 'id')::bigint = una and p ->> 'viaje' = 'a_bordo'));
  r := marcar_viaje(una, clave, 'no_se_presento', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('remarcar_cambia', r ->> 'viaje' = 'no_se_presento'
    and (select count(*) from ejecucion_viajes e where e.fecha = hoy and e.codigo_vehiculo = codigo) = 1);
  c := servicios_de_empresa('TELEPERFORMANCE', hoy);
  res := res || jsonb_build_object('cliente_ve_la_marca', exists (
    select 1 from jsonb_array_elements(c -> 'servicios') x,
                  jsonb_array_elements(x -> 'personas') p
     where _clave_normalizada(x ->> 'unidad') = clave and p ->> 'viaje' = 'no_se_presento'));
  r := marcar_viaje(una, coalesce(otra_clave, 'NADIE'), 'a_bordo', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('otro_coche_no', r ->> 'error' = 'no_esta_en_el_plan');
  r := marcar_viaje(una, clave, 'a_bordo', 'prueba', hoy + 1, hoy + 2);
  res := res || jsonb_build_object('otro_dia_no', r ->> 'error' = 'no_esta_en_el_plan');
  r := marcar_viaje(una, clave, 'recogido', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('estado_raro_no', r ->> 'error' = 'estado_invalido');
  r := marcar_viaje(-1, clave, 'a_bordo', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('fila_inexistente_no', r ->> 'error' = 'no_esta_en_el_plan');

  -- Fuera de la ventana de su servicio, no, aunque el día valga.
  mover := (now() at time zone 'America/Lima') + interval '4 hours';
  update programacion set fecha = mover::date, turno = to_char(mover, 'HH24:MI') where id = una;
  r := marcar_viaje(una, clave, 'a_bordo', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('cuatro_horas_antes_no', r ->> 'error' = 'fuera_de_hora');
  mover := (now() at time zone 'America/Lima') - interval '7 hours';
  update programacion set fecha = mover::date, turno = to_char(mover, 'HH24:MI') where id = una;
  r := marcar_viaje(una, clave, 'a_bordo', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('siete_horas_despues_no', r ->> 'error' = 'fuera_de_hora');
  -- Un servicio de hace cinco horas (una salida de ayer a última hora, pasada
  -- la medianoche) se sigue pudiendo marcar.
  mover := (now() at time zone 'America/Lima') - interval '5 hours';
  update programacion set fecha = mover::date, turno = to_char(mover, 'HH24:MI') where id = una;
  r := marcar_viaje(una, clave, 'a_bordo', 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('cinco_horas_despues_si', r ->> 'viaje' = 'a_bordo');
  r := marcar_viaje(una, clave, null, 'prueba', hoy - 1, hoy + 1);
  res := res || jsonb_build_object('desmarcar', r ->> 'viaje' is null and not (r ? 'error')
    and not exists (select 1 from ejecucion_viajes e join programacion p on p.id = una
                     where e.fecha = p.fecha and e.codigo_vehiculo = p.codigo_vehiculo
                       and e.turno = p.turno and e.modalidad = p.modalidad and e.dni = p.dni));

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
    and not has_function_privilege('anon', 'public._es_de_la_empresa(text,text)', 'execute')
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
        partes = []
        for nombre in MIGRACIONES:
            with open(os.path.join(SUPABASE, nombre), encoding="utf-8") as mano:
                partes.append(mano.read())
        sql = "\n".join(partes + [BLOQUE])
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
