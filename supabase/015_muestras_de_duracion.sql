-- Una fila por servicio ejecutado, para entrenar el modelo de duración.
--
-- El modelo (CatBoost) aprende cuánto dura de verdad un servicio según su
-- ruta, turno, día y paradas. Para eso no necesita saber quién viajó ni dónde
-- vive: esta función hace el cruce con el padrón aquí dentro y solo entrega
-- recuentos, distancias y tiempos. Ni DNI ni coordenadas salen de la base, y
-- así se puede reentrenar desde cualquier equipo sin bajar datos personales.
--
-- Los tiempos van en minutos **respecto del turno** y en [-720, 720): un
-- RECOJO de las 06:00 arranca alrededor de -95 y llega a la sede sobre -26; una
-- SALIDA de las 22:01 reparte entre 0 y +80. Medirlos así evita que un
-- servicio que cruza la medianoche dé una duración negativa.
--
-- Una parada es una fila con hora en el punto: el coche fue aunque la persona
-- no subiera («NO SALIO»), y no fue a las anulaciones, que no la tienen. El
-- recorrido se mide en línea recta entre paradas, en el orden en que se
-- hicieron —recojos en un RECOJO, llegadas en una SALIDA—, y solo entre
-- domicilios resueltos: `paradas_ubicadas` dice cuántos entraron en la cuenta.

create or replace function public.muestras_de_duracion(p_desde date, p_hasta date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filas as (
    select s.fecha_ejecutada, s.codigo_vehiculo, s.turno, s.modalidad, s.sede,
           s.cobertura, s.incidencia,
           p.lat, p.lng,
           ((extract(epoch from (s.hora_inicio   - s.turno::time)) / 60)::int + 2160) % 1440 - 720 as ini,
           ((extract(epoch from (s.hora_en_punto - s.turno::time)) / 60)::int + 2160) % 1440 - 720 as pto,
           ((extract(epoch from (s.hora_llegada  - s.turno::time)) / 60)::int + 2160) % 1440 - 720 as lle
    from servicios_historicos s
    left join pasajeros p on p.dni = s.dni and p.estado_ubicacion = 'resuelta'
    where s.fecha_ejecutada between p_desde and p_hasta
      and s.turno ~ '^[0-9]{1,2}:[0-9]{2}$'
  ),
  paradas as (
    select f.*,
           lag(f.lat) over w as lat_ant,
           lag(f.lng) over w as lng_ant
    from filas f
    where f.pto is not null and f.lat is not null
    window w as (partition by f.fecha_ejecutada, f.codigo_vehiculo, f.turno, f.modalidad
                 order by case when f.modalidad = 'RECOJO' then f.pto else f.lle end nulls last)
  ),
  recorrido as (
    select fecha_ejecutada, codigo_vehiculo, turno, modalidad,
           count(*) as ubicadas,
           coalesce(sum(case when lat_ant is null then 0 else
             2 * 6371 * asin(sqrt(power(sin(radians(lat - lat_ant) / 2), 2)
               + cos(radians(lat)) * cos(radians(lat_ant)) * power(sin(radians(lng - lng_ant) / 2), 2)))
           end), 0) as km,
           2 * 6371 * asin(sqrt(power(sin(radians(max(lat) - min(lat)) / 2), 2)
             + cos(radians(max(lat))) * cos(radians(min(lat))) * power(sin(radians(max(lng) - min(lng)) / 2), 2)))
             as extension_km
    from paradas
    group by fecha_ejecutada, codigo_vehiculo, turno, modalidad
  ),
  servicios as (
    select f.fecha_ejecutada, f.codigo_vehiculo, f.turno, f.modalidad,
           min(f.sede) as sede,
           -- La primera en orden alfabético, como la `micro_zona` de
           -- `leer_programacion`: el modelo tiene que ver al estimar un plan la
           -- misma cobertura que vio al entrenar.
           min(f.cobertura) as cobertura,
           count(*) as programados,
           count(*) filter (where f.pto is not null) as paradas,
           count(*) filter (where f.incidencia = 'A BORDO') as a_bordo,
           min(f.ini) as inicio,
           min(f.pto) as primer_punto,
           max(f.pto) as ultimo_punto,
           max(f.lle) as llegada
    from filas f
    group by f.fecha_ejecutada, f.codigo_vehiculo, f.turno, f.modalidad
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'fecha', s.fecha_ejecutada,
           'dia_semana', extract(isodow from s.fecha_ejecutada)::int,
           'vehiculo', s.codigo_vehiculo,
           'turno', s.turno,
           'modalidad', s.modalidad,
           'sede', s.sede,
           'cobertura', s.cobertura,
           'programados', s.programados,
           'paradas', s.paradas,
           'a_bordo', s.a_bordo,
           'paradas_ubicadas', coalesce(r.ubicadas, 0),
           'km', round(coalesce(r.km, 0)::numeric, 2),
           'extension_km', round(coalesce(r.extension_km, 0)::numeric, 2),
           'inicio', s.inicio,
           'primer_punto', s.primer_punto,
           'ultimo_punto', s.ultimo_punto,
           'llegada', s.llegada)
         order by s.fecha_ejecutada, s.codigo_vehiculo, s.turno, s.modalidad), '[]'::jsonb)
  from servicios s
  left join recorrido r using (fecha_ejecutada, codigo_vehiculo, turno, modalidad)
$$;

revoke all on function public.muestras_de_duracion(date, date) from public, anon, authenticated;
grant execute on function public.muestras_de_duracion(date, date) to service_role;
