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


-- La programación de un día, con la forma que ya consume la mesa de trabajo.
--
-- El tablero leía `/api/routes`, que devuelve una lista vacía desde que la
-- programación dejó de escribirse en `app_state`. Esto lo sustituye por lo que
-- el Programador carga cada día. No propone rutas —eso necesita un motor que
-- no existe— sino que enseña lo que de verdad se ejecutó, que es el punto de
-- partida del trabajo: seguir el orden anterior y aplicar las novedades.
--
-- Un servicio es un vehículo en una fecha, turno y modalidad. La forma de
-- salida (`conductor`, `micro_zona`, `horario`, `agentes`) es la del contrato
-- anterior a propósito: así las tarjetas, los filtros, la búsqueda y la
-- exportación siguen funcionando sin tocarlas.
--
-- Trae además tres cosas que la pantalla necesita:
--
-- * **La duración medida.** Se busca la celda con turno y se cae al nivel
--   grueso cuando no hay casos suficientes; casi la mitad de las celdas con
--   turno tienen menos de cinco casos en un mes. Medido: 130 de 135 rutas la
--   reciben, frente a un puñado sin el respaldo.
-- * **Las coordenadas de cada agente**, para el mapa. Solo las que existen:
--   401 de 518 en el último día cargado. Quien no tiene domicilio resuelto se
--   cuenta aparte en vez de recibir un punto inventado, que mandaría un
--   vehículo a una casa que no existe.
-- * **Qué cambió respecto al día cargado anterior**, comparando el conjunto de
--   documentos de cada servicio. Está modificado si entró o salió alguien, y
--   es nuevo si esa unidad no hacía ese turno. El día de comparación es el
--   último cargado anterior, que no tiene por qué ser el natural anterior, así
--   que se devuelve su fecha y la pantalla la nombra.
create or replace function public.programacion_del_dia(dia date default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with elegido as (
    select coalesce(dia, (select max(fecha_ejecutada) from servicios_historicos)) as fecha
  ),
  previo as (
    select max(fecha_ejecutada) as fecha
    from servicios_historicos
    where fecha_ejecutada < (select fecha from elegido)
  ),
  servicios as (
    select
      s.codigo_vehiculo, s.turno, s.modalidad, s.cobertura, s.dni,
      s.hora_inicio, s.incidencia, p.nombre, p.direccion,
      p.lat, p.lng, p.estado_ubicacion
    from servicios_historicos s
    left join pasajeros p on p.dni = s.dni
    where s.fecha_ejecutada = (select fecha from elegido)
      and s.codigo_vehiculo is not null
      and btrim(s.codigo_vehiculo) <> ''
  ),
  ayer as (
    select
      s.codigo_vehiculo as codigo_vehiculo,
      s.turno as turno,
      s.modalidad as modalidad,
      s.dni as dni,
      coalesce(p.nombre, s.dni) as nombre
    from servicios_historicos s
    left join pasajeros p on p.dni = s.dni
    where s.fecha_ejecutada = (select fecha from previo)
      and s.codigo_vehiculo is not null
  ),
  agrupados as (
    select
      s.codigo_vehiculo,
      s.turno,
      s.modalidad,
      -- Una unidad puede tocar dos zonas en el mismo turno; manda la primera.
      (array_agg(s.cobertura order by s.cobertura))[1] as cobertura,
      jsonb_agg(jsonb_build_object(
        'id', s.dni,
        'nombre', coalesce(s.nombre, 'Sin nombre'),
        'direccion', s.direccion,
        'hora', s.hora_inicio,
        'incidencia', s.incidencia,
        'lat', s.lat,
        'lng', s.lng,
        'ubicacion', s.estado_ubicacion,
        'nuevo', not exists (
          select 1 from ayer a
          where a.codigo_vehiculo = s.codigo_vehiculo and a.turno = s.turno
            and a.modalidad = s.modalidad and a.dni = s.dni)
      ) order by s.hora_inicio nulls last, s.dni) as agentes,
      count(*) filter (where not exists (
        select 1 from ayer a
        where a.codigo_vehiculo = s.codigo_vehiculo and a.turno = s.turno
          and a.modalidad = s.modalidad and a.dni = s.dni)) as nuevos,
      not exists (
        select 1 from ayer a
        where a.codigo_vehiculo = s.codigo_vehiculo and a.turno = s.turno
          and a.modalidad = s.modalidad) as servicio_nuevo,
      coalesce((
        select jsonb_agg(distinct a.nombre)
        from ayer a
        where a.codigo_vehiculo = s.codigo_vehiculo and a.turno = s.turno
          and a.modalidad = s.modalidad
          and not exists (select 1 from servicios x
                          where x.codigo_vehiculo = a.codigo_vehiculo
                            and x.turno = a.turno and x.modalidad = a.modalidad
                            and x.dni = a.dni)), '[]'::jsonb) as salieron
    from servicios s
    group by s.codigo_vehiculo, s.turno, s.modalidad
  ),
  con_duracion as (
    select
      a.*,
      coalesce(fino.p50_minutos, grueso.p50_minutos) as p50,
      coalesce(fino.p90_minutos, grueso.p90_minutos) as p90,
      coalesce(fino.n_casos, grueso.n_casos) as casos,
      (fino.p50_minutos is not null) as con_turno
    from agrupados a
    left join duraciones_base fino
      on fino.cobertura = a.cobertura and fino.modalidad = a.modalidad
     and fino.turno = a.turno
    left join duraciones_base grueso
      on grueso.cobertura = a.cobertura and grueso.modalidad = a.modalidad
     and grueso.turno = ''
  )
  select jsonb_build_object(
    'fecha', (select fecha from elegido),
    'comparado_con', (select fecha from previo),
    'dias_disponibles', coalesce((
      select jsonb_agg(f order by f desc)
      from (select distinct fecha_ejecutada as f from servicios_historicos
            order by fecha_ejecutada desc limit 60) d), '[]'::jsonb),
    'rutas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conductor', codigo_vehiculo,
               'micro_zona', cobertura,
               'horario', turno || ' ' || lower(modalidad),
               'duracion', case when p50 is null then null else jsonb_build_object(
                 'p50', p50, 'p90', p90, 'casos', casos, 'con_turno', con_turno) end,
               'cambio', jsonb_build_object(
                 'nuevos', nuevos,
                 'salieron', salieron,
                 'servicio_nuevo', servicio_nuevo,
                 'modificado', servicio_nuevo or nuevos > 0
                               or jsonb_array_length(salieron) > 0),
               'agentes', agentes)
             order by turno, codigo_vehiculo)
      from con_duracion), '[]'::jsonb)
  );
$$;

revoke all on function public.programacion_del_dia(date) from public;
grant execute on function public.programacion_del_dia(date) to service_role;
