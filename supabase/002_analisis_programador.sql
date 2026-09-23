-- Resúmenes del histórico para las pantallas del Programador.
--
-- Se calculan en Postgres y no en la aplicación por la misma razón que
-- `recalcular_ubicaciones()`: son 21.789 filas y subirlas para contarlas
-- costaría medio mega de egress cada vez que alguien abre una pestaña. Lo que
-- viaja es el resumen: ~4 KB el de Análisis, ~9 KB el de vehículos.
--
-- «A BORDO» es la única incidencia que significa que el servicio ocurrió. Todo
-- lo demás —no salió, no vino a trabajar, se fue por su cuenta— es un asiento
-- reservado que viajó vacío, y es el dato que más le importa a quien programa:
-- hoy son 6.010 de 21.789.
--
-- Aplicadas el 2026-09-23 como migraciones `resumen_analisis_programador` y
-- `resumen_vehiculos_programador`. Este archivo las deja versionadas junto al
-- esquema de 001.

create or replace function public.resumen_analisis()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      fecha_ejecutada,
      modalidad,
      cobertura,
      codigo_vehiculo,
      upper(btrim(coalesce(incidencia, ''))) as motivo
    from servicios_historicos
  ),
  efectivos as (
    select
      count(*) filter (where motivo = 'A BORDO') as a_bordo,
      count(*) as total
    from base
  )
  select jsonb_build_object(
    'servicios', (select total from efectivos),
    'a_bordo', (select a_bordo from efectivos),
    'dias', (select count(distinct fecha_ejecutada) from base),
    'desde', (select min(fecha_ejecutada) from base),
    'hasta', (select max(fecha_ejecutada) from base),
    'vehiculos', (select count(distinct codigo_vehiculo)
                  from base where codigo_vehiculo is not null),
    'pasajeros', (select count(*) from pasajeros),
    'ubicacion', coalesce((
      select jsonb_object_agg(estado_ubicacion, n)
      from (select estado_ubicacion, count(*) as n from pasajeros
            group by estado_ubicacion) u), '{}'::jsonb),

    -- Por qué no viajaron. Sin el caso bueno, que ya va aparte.
    'motivos', coalesce((
      select jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n) order by n desc)
      from (select motivo, count(*) as n from base
            where motivo <> 'A BORDO' and motivo <> ''
            group by motivo order by count(*) desc limit 8) m), '[]'::jsonb),

    -- Volumen por día, para ver la forma de la operación.
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', fecha_ejecutada, 'n', n,
                                          'a_bordo', ab) order by fecha_ejecutada)
      from (select fecha_ejecutada, count(*) as n,
                   count(*) filter (where motivo = 'A BORDO') as ab
            from base group by fecha_ejecutada
            order by fecha_ejecutada desc limit 31) d), '[]'::jsonb),

    -- Las zonas con más peso, con su efectividad.
    'coberturas', coalesce((
      select jsonb_agg(jsonb_build_object('cobertura', cobertura, 'n', n,
                                          'a_bordo', ab) order by n desc)
      from (select cobertura, count(*) as n,
                   count(*) filter (where motivo = 'A BORDO') as ab
            from base where cobertura is not null
            group by cobertura order by count(*) desc limit 12) c), '[]'::jsonb),

    -- La duración real medida, que es lo que no existía antes de cargar el
    -- histórico. Solo el nivel con turno: el grueso es el respaldo interno.
    'duraciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cobertura', cobertura, 'modalidad', modalidad, 'turno', turno,
               'p50', p50_minutos, 'p90', p90_minutos, 'casos', n_casos)
             order by n_casos desc)
      from (select * from duraciones_base where turno <> ''
            order by n_casos desc limit 15) t), '[]'::jsonb),
    'celdas_duracion', (select count(*) from duraciones_base)
  );
$$;

revoke all on function public.resumen_analisis() from public;
grant execute on function public.resumen_analisis() to service_role;


-- Ocupación real de cada vehículo.
--
-- Un viaje es un vehículo en una fecha, turno y modalidad, y lo que llevó son
-- los pasajeros que subieron. La mediana dice lo que mueve habitualmente y el
-- máximo lo que ha llegado a mover, que es lo que importa al decidir si cabe
-- uno más. Medido: la unidad más usada hace 176 viajes con una mediana de 2
-- pasajeros sobre 4 asientos.
create or replace function public.resumen_vehiculos()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with viajes as (
    select
      codigo_vehiculo,
      fecha_ejecutada,
      turno,
      modalidad,
      count(*) filter (where upper(btrim(coalesce(incidencia, ''))) = 'A BORDO') as a_bordo,
      count(*) as programados
    from servicios_historicos
    where codigo_vehiculo is not null and btrim(codigo_vehiculo) <> ''
    group by codigo_vehiculo, fecha_ejecutada, turno, modalidad
  ),
  por_vehiculo as (
    select
      codigo_vehiculo,
      count(*) as viajes,
      count(distinct fecha_ejecutada) as dias,
      sum(a_bordo) as pasajeros,
      sum(programados) as programados,
      percentile_cont(0.5) within group (order by a_bordo) as ocupacion_p50,
      max(a_bordo) as ocupacion_max
    from viajes
    group by codigo_vehiculo
  )
  select coalesce(jsonb_object_agg(codigo_vehiculo, jsonb_build_object(
           'viajes', viajes,
           'dias', dias,
           'pasajeros', pasajeros,
           'programados', programados,
           'ocupacion_p50', round(ocupacion_p50::numeric, 1),
           'ocupacion_max', ocupacion_max)), '{}'::jsonb)
  from por_vehiculo;
$$;

revoke all on function public.resumen_vehiculos() from public;
grant execute on function public.resumen_vehiculos() to service_role;
