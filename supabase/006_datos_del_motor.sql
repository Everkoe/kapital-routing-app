-- Lo que el motor de inserción necesita saber y el plan no traía.
--
-- El motor propone en qué servicio entra cada pendiente. Para eso hacen falta
-- cuatro datos que `leer_programacion` no devolvía, y los cuatro salen del
-- histórico, no de ninguna suposición:
--
-- 1. **Dónde vive cada pendiente** (`lat`, `lng`). Sin ella no hay desvío que
--    calcular. Los agentes del plan ya la traían; los pendientes no.
--
-- 2. **La sede de cada persona y de cada servicio.** Es una restricción dura:
--    medido el 2026-09-25, ninguno de los 5.959 servicios del histórico mezcla
--    sedes, y solo una persona ha ido alguna vez a dos. Meter a alguien en un
--    coche que va a otra sede sería un error grave, y el plan no guarda la
--    sede. Se toma la del último servicio de cada persona, y la de un servicio
--    es la de sus pasajeros.
--
-- 3. **Cuánto ha llevado cada unidad** (`max_llevado`): el máximo de «A BORDO»
--    en un mismo servicio. Sirve de capacidad cuando la flota no la declara,
--    que es el caso de las 36 unidades V### y M### del histórico. Está medido
--    que es una buena estimación: en las 39 unidades que sí la declaran, el
--    máximo llevado coincide con la capacidad en 23, y la holgura mediana es 0.
--    Tres la superan (K170 declara 4 y llevó 6; K244 y K246 declaran 4 y
--    llevaron 5): ahí manda la declarada, y la diferencia es un dato a revisar.
--
-- 4. **Sus unidades habituales** (`habituales`): las tres en que más ha
--    viajado en ese sentido. Lo que rota de un día a otro es el vehículo, pero
--    lo normal es que alguien vuelva con el mismo conductor.
--
-- Todo lo que se consulta del histórico se limita a las personas y unidades
-- del día, para no recorrer las 21.000 filas en cada lectura.
--
-- Aplicado el 2026-09-25 con `scripts/aplicar_sql.py`.

create or replace function public.leer_programacion(dia date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filas as (
    select
      p.codigo_vehiculo, p.turno, p.modalidad, p.cobertura, p.dni,
      p.orden, p.origen, p.estado, p.nota,
      pa.nombre, pa.direccion, pa.lat, pa.lng, pa.estado_ubicacion
    from programacion p
    left join pasajeros pa on pa.dni = p.dni
    where p.fecha = dia
  ),
  personas as (
    select dni from programacion where fecha = dia
    union
    select dni from programacion_pendientes where fecha = dia
  ),
  sede_de as (
    select distinct on (s.dni) s.dni, s.sede
    from servicios_historicos s
    join personas pe on pe.dni = s.dni
    where s.sede is not null
    order by s.dni, s.fecha_ejecutada desc
  ),
  llevado as (
    select x.codigo_vehiculo, max(x.n) as max_llevado
    from (
      select s.codigo_vehiculo, count(*) as n
      from servicios_historicos s
      where s.codigo_vehiculo in (
              select distinct p.codigo_vehiculo from programacion p
              where p.fecha = dia)
        and s.dni is not null
        and upper(btrim(coalesce(s.incidencia, ''))) = 'A BORDO'
      group by s.codigo_vehiculo, s.fecha_ejecutada, s.turno, s.modalidad
    ) x
    group by x.codigo_vehiculo
  ),
  habituales as (
    select h.dni, h.modalidad,
           jsonb_agg(h.codigo_vehiculo order by h.n desc, h.codigo_vehiculo) as vehiculos
    from (
      select s.dni, s.modalidad, s.codigo_vehiculo, count(*) as n,
             row_number() over (partition by s.dni, s.modalidad
                                order by count(*) desc, s.codigo_vehiculo) as rk
      from servicios_historicos s
      where s.dni in (select x.dni from programacion_pendientes x where x.fecha = dia)
        and s.codigo_vehiculo is not null
        and upper(btrim(coalesce(s.incidencia, ''))) = 'A BORDO'
      group by s.dni, s.modalidad, s.codigo_vehiculo
    ) h
    where h.rk <= 3
    group by h.dni, h.modalidad
  ),
  agrupados as (
    select
      f.codigo_vehiculo,
      f.turno,
      f.modalidad,
      (array_agg(f.cobertura order by f.cobertura))[1] as cobertura,
      mode() within group (order by sd.sede) as sede,
      count(*) filter (where f.estado = 'programado') as viajan,
      jsonb_agg(jsonb_build_object(
        'id', f.dni,
        'nombre', coalesce(f.nombre, 'Sin nombre'),
        'direccion', f.direccion,
        'lat', f.lat,
        'lng', f.lng,
        'ubicacion', f.estado_ubicacion,
        'orden', f.orden,
        'origen', f.origen,
        'estado', f.estado,
        'nota', f.nota
      ) order by f.orden nulls last, f.dni)
        filter (where f.estado = 'programado') as agentes,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', f.dni, 'nombre', coalesce(f.nombre, 'Sin nombre'), 'nota', f.nota)
        order by f.dni) filter (where f.estado = 'retirado'), '[]'::jsonb) as retirados
    from filas f
    left join sede_de sd on sd.dni = f.dni
    group by f.codigo_vehiculo, f.turno, f.modalidad
  ),
  con_duracion as (
    select
      a.*,
      l.max_llevado,
      coalesce(fino.p50_minutos, grueso.p50_minutos) as p50,
      coalesce(fino.p90_minutos, grueso.p90_minutos) as p90,
      coalesce(fino.n_casos, grueso.n_casos) as casos
    from agrupados a
    left join llevado l on l.codigo_vehiculo = a.codigo_vehiculo
    left join duraciones_base fino
      on fino.cobertura = a.cobertura and fino.modalidad = a.modalidad
     and fino.turno = a.turno
    left join duraciones_base grueso
      on grueso.cobertura = a.cobertura and grueso.modalidad = a.modalidad
     and grueso.turno = ''
  )
  select jsonb_build_object(
    'fecha', dia,
    'existe', exists (select 1 from programacion_dias d where d.fecha = dia),
    'sembrado_desde', (select d.sembrado_desde from programacion_dias d
                       where d.fecha = dia),
    'dias_disponibles', coalesce((
      select jsonb_agg(f order by f desc)
      from (select distinct fecha_ejecutada as f from servicios_historicos
            order by fecha_ejecutada desc limit 60) x), '[]'::jsonb),
    'dias_con_plan', coalesce((
      select jsonb_agg(d.fecha order by d.fecha desc) from programacion_dias d),
      '[]'::jsonb),
    'pendientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.dni,
               'nombre', coalesce(pa.nombre, 'Sin nombre'),
               'direccion', pa.direccion,
               'ubicacion', pa.estado_ubicacion,
               'lat', pa.lat,
               'lng', pa.lng,
               'sede', sd.sede,
               'habituales', coalesce(h.vehiculos, '[]'::jsonb),
               'cobertura', x.cobertura,
               'turno', nullif(x.turno, ''),
               'modalidad', nullif(x.modalidad, ''),
               'motivo', x.motivo,
               'detalle', x.detalle)
             order by x.turno, pa.nombre)
      from programacion_pendientes x
      left join pasajeros pa on pa.dni = x.dni
      left join sede_de sd on sd.dni = x.dni
      left join habituales h on h.dni = x.dni and h.modalidad = x.modalidad
      where x.fecha = dia), '[]'::jsonb),
    'rutas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conductor', codigo_vehiculo,
               'micro_zona', cobertura,
               'horario', turno || ' ' || lower(modalidad),
               'turno', turno,
               'modalidad', modalidad,
               'sede', sede,
               'max_llevado', max_llevado,
               'duracion', case when p50 is null then null else jsonb_build_object(
                 'p50', p50, 'p90', p90, 'casos', casos) end,
               'retirados', retirados,
               'agentes', coalesce(agentes, '[]'::jsonb))
             order by turno, codigo_vehiculo)
      from con_duracion where viajan > 0 or jsonb_array_length(retirados) > 0),
      '[]'::jsonb)
  );
$$;

revoke all on function public.leer_programacion(date) from public;
grant execute on function public.leer_programacion(date) to service_role;
