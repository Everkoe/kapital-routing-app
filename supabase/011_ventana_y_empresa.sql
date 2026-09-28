-- 011 · Lo que la revisión de la 010 encontró antes de publicarla.
--
-- 1. La ventana para marcar la decidía solo la pantalla (de 3 h antes a 6 h
--    después del turno). La base aceptaba cualquier servicio de hoy o mañana:
--    por el API, a las 08:00, un conductor podía marcar como «no se presentó» a
--    todo el turno de la noche siguiente, y el cliente lo veía. Además, la
--    ventana por días dejaba fuera a medianoche las salidas de última hora del
--    día anterior, que siguen dejando gente pasadas las 00:00. Ahora cada
--    marca se comprueba contra la hora de su propio servicio, en hora de Lima.
--
-- 2. La empresa se reconocía por un prefijo sin frontera de palabra: «TELE»
--    abría todo TELEPERFORMANCE y «TP» cualquier sede que empezara por esas
--    letras. Ahora tiene que coincidir la palabra entera: la sede es la
--    empresa, o empieza por la empresa seguida de un espacio.
--
-- 3. Dos claves de la flota que se normalizan igual («K-027» y «K027»)
--    duplicaban el servicio en la vista del cliente.

-- Mayúsculas, todo lo que no sea letra o número a un solo espacio, sin bordes:
-- «Teleperformance  Bellavista» y «TELEPERFORMANCE-BELLAVISTA» son lo mismo.
create or replace function public._palabras_normalizadas(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(upper(coalesce(p_texto, '')), '[^A-Z0-9]+', ' ', 'g'))
$$;

create or replace function public._es_de_la_empresa(p_sede text, p_empresa text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select _palabras_normalizadas(p_empresa) <> ''
     and (_palabras_normalizadas(p_sede) = _palabras_normalizadas(p_empresa)
          or starts_with(_palabras_normalizadas(p_sede), _palabras_normalizadas(p_empresa) || ' '))
$$;

-- Horas alrededor del turno en las que se puede marcar. Son las mismas que usa
-- la pantalla (HORAS_ANTES_DE_MARCAR y HORAS_DESPUES_DE_MARCAR en
-- frontend/src/conductor/modeloServicios.js): un recojo arranca ~85 min antes
-- de la entrada y una salida deja a su gente ~36 min después.
create or replace function public.marcar_viaje(
  p_id bigint, p_clave text, p_estado text, p_por text, p_desde date, p_hasta date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila programacion%rowtype;
  v_turno timestamptz;
  v_marcado timestamptz;
begin
  if p_estado is not null and p_estado not in ('a_bordo', 'no_se_presento') then
    return jsonb_build_object('error', 'estado_invalido');
  end if;
  select * into v_fila from programacion where id = p_id;
  if not found
     or v_fila.estado <> 'programado'
     or _clave_normalizada(v_fila.codigo_vehiculo) <> p_clave
     or v_fila.fecha not between p_desde and p_hasta then
    return jsonb_build_object('error', 'no_esta_en_el_plan');
  end if;
  if v_fila.turno !~ '^\d{1,2}:\d{2}$' then
    return jsonb_build_object('error', 'fuera_de_hora');
  end if;
  v_turno := (v_fila.fecha + v_fila.turno::time) at time zone 'America/Lima';
  if now() not between v_turno - interval '3 hours' and v_turno + interval '6 hours' then
    return jsonb_build_object('error', 'fuera_de_hora');
  end if;

  if p_estado is null then
    delete from ejecucion_viajes e
     where e.fecha = v_fila.fecha and e.codigo_vehiculo = v_fila.codigo_vehiculo
       and e.turno = v_fila.turno and e.modalidad = v_fila.modalidad
       and e.dni = v_fila.dni;
    return jsonb_build_object('id', p_id, 'viaje', null, 'marcado_en', null);
  end if;

  insert into ejecucion_viajes (fecha, codigo_vehiculo, turno, modalidad, dni,
                                estado, marcado_en, marcado_por)
  values (v_fila.fecha, v_fila.codigo_vehiculo, v_fila.turno, v_fila.modalidad,
          v_fila.dni, p_estado, now(), p_por)
  on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do update
    set estado = excluded.estado,
        marcado_en = excluded.marcado_en,
        marcado_por = excluded.marcado_por
  returning marcado_en into v_marcado;
  return jsonb_build_object('id', p_id, 'viaje', p_estado, 'marcado_en', v_marcado);
end
$$;

create or replace function public.servicios_de_empresa(p_prefijo text, p_dia date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filas as (
    select p.codigo_vehiculo, p.turno, p.modalidad, p.cobertura, p.dni, p.orden,
           pa.nombre, pa.distrito, e.estado as viaje, e.marcado_en
      from programacion p
      left join pasajeros pa on pa.dni = p.dni
      left join ejecucion_viajes e
        on e.fecha = p.fecha and e.codigo_vehiculo = p.codigo_vehiculo
       and e.turno = p.turno and e.modalidad = p.modalidad and e.dni = p.dni
     where p.fecha = p_dia and p.estado = 'programado'
  ),
  personas as (
    select f.dni from filas f
    union
    select x.dni from programacion_pendientes x where x.fecha = p_dia
  ),
  sede_de as (
    select distinct on (s.dni) s.dni, s.sede
      from servicios_historicos s
      join personas pe on pe.dni = s.dni
     where s.sede is not null
     order by s.dni, s.fecha_ejecutada desc
  ),
  sede_del_servicio as (
    select f.codigo_vehiculo, f.turno, f.modalidad,
           mode() within group (order by sd.sede) as sede
      from filas f
      left join sede_de sd on sd.dni = f.dni
     group by f.codigo_vehiculo, f.turno, f.modalidad
  ),
  suyas as (
    select f.*, coalesce(sd.sede, ss.sede) as sede
      from filas f
      left join sede_de sd on sd.dni = f.dni
      left join sede_del_servicio ss
        on ss.codigo_vehiculo = f.codigo_vehiculo and ss.turno = f.turno
       and ss.modalidad = f.modalidad
     where _es_de_la_empresa(coalesce(sd.sede, ss.sede), p_prefijo)
  ),
  flota as (
    select distinct on (_clave_normalizada(u.key)) _clave_normalizada(u.key) as clave, u.value as unidad
      from app_state a, jsonb_each(a.usuarios -> '__flota__') u
     where a.id = 1 and jsonb_typeof(u.value) = 'object'
     order by _clave_normalizada(u.key), u.key
  ),
  servicios as (
    select s.codigo_vehiculo, s.turno, s.modalidad,
           (array_agg(s.cobertura order by s.cobertura)
              filter (where s.cobertura is not null))[1] as cobertura,
           mode() within group (order by s.sede) as sede,
           jsonb_agg(jsonb_build_object(
             'dni', s.dni,
             'nombre', coalesce(s.nombre, 'Sin nombre'),
             'distrito', s.distrito,
             'sede', s.sede,
             'orden', s.orden,
             'viaje', s.viaje,
             'marcado_en', s.marcado_en)
             order by s.orden nulls last, s.nombre) as personas
      from suyas s
     group by s.codigo_vehiculo, s.turno, s.modalidad
  )
  select jsonb_build_object(
    'fecha', p_dia,
    'existe', exists (select 1 from programacion_dias d where d.fecha = p_dia),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unidad', s.codigo_vehiculo,
               'turno', s.turno,
               'modalidad', s.modalidad,
               'cobertura', s.cobertura,
               'sede', s.sede,
               -- De la flota solo lo que identifica el vehículo y a quien lo
               -- conduce; su documento, domicilio y teléfonos no.
               'conductor', case when fl.unidad is null then null else jsonb_build_object(
                 'nombre', nullif(btrim(fl.unidad ->> 'chofer'), ''),
                 'placa', nullif(btrim(fl.unidad ->> 'placa'), ''),
                 'marca', nullif(btrim(fl.unidad ->> 'marca'), ''),
                 'modelo', nullif(btrim(fl.unidad ->> 'modelo'), ''),
                 'color', nullif(btrim(fl.unidad ->> 'color'), ''),
                 'capacidad', fl.unidad -> 'capacidad') end,
               'personas', s.personas)
             order by s.turno, s.modalidad, s.codigo_vehiculo)
        from servicios s
        left join flota fl on fl.clave = _clave_normalizada(s.codigo_vehiculo)), '[]'::jsonb),
    -- Quien viaja ese día y todavía no tiene unidad. Solo los de sede conocida:
    -- un alta sin histórico no se sabe de qué empresa es, y enseñarla a una que
    -- no es la suya sería dar el nombre de alguien a otra empresa.
    'pendientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dni', x.dni,
               'nombre', coalesce(pa.nombre, 'Sin nombre'),
               'turno', nullif(x.turno, ''),
               'modalidad', nullif(x.modalidad, ''),
               'sede', sd.sede)
             order by x.turno, pa.nombre)
        from programacion_pendientes x
        left join pasajeros pa on pa.dni = x.dni
        left join sede_de sd on sd.dni = x.dni
       where x.fecha = p_dia
         and _es_de_la_empresa(sd.sede, p_prefijo)), '[]'::jsonb)
  )
$$;

revoke all on function public._palabras_normalizadas(text) from public, anon, authenticated;
revoke all on function public._es_de_la_empresa(text, text) from public, anon, authenticated;
revoke all on function public.marcar_viaje(bigint, text, text, text, date, date) from public, anon, authenticated;
revoke all on function public.servicios_de_empresa(text, date) from public, anon, authenticated;
grant execute on function public._palabras_normalizadas(text) to service_role;
grant execute on function public._es_de_la_empresa(text, text) to service_role;
grant execute on function public.marcar_viaje(bigint, text, text, text, date, date) to service_role;
grant execute on function public.servicios_de_empresa(text, date) to service_role;
