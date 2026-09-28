-- 010 · El plan llega al conductor y al cliente, y el conductor marca quién subió.
--
-- Hasta aquí lo que decidía el Programador se quedaba en su pantalla: el portal
-- del conductor y el del cliente leían el tablero viejo (`app_state.rutas`),
-- que nada vuelve a escribir. Estas funciones sirven a cada uno solo lo suyo,
-- filtrado en la base: el plan de un día entero son ~150 KB y un conductor
-- necesita sus dos o tres servicios, unos pocos KB.
--
-- Lo que marca el conductor va a su propia tabla, `ejecucion_viajes`, y no a
-- `programacion`, por lo mismo que el plan no se mezcla con el histórico: una
-- es lo que se decidió y la otra lo que pasó, y cuando algo sale mal hay que
-- poder distinguirlas. La marca se enlaza con el plan por su clave natural
-- (día, unidad, turno, sentido y persona), así que sobrevive a que el
-- Programador vuelva a sembrar el día con la misma asignación.

create table if not exists public.ejecucion_viajes (
  fecha date not null,
  codigo_vehiculo text not null,
  turno text not null,
  modalidad text not null,
  dni text not null,
  -- «A BORDO» es la palabra de la intranet para «viajó»; la otra es la
  -- incidencia más frecuente cuando no (ver servicios_historicos).
  estado text not null check (estado in ('a_bordo', 'no_se_presento')),
  marcado_en timestamptz not null default now(),
  -- La clave de la cuenta que marcó, para saber quién lo dijo.
  marcado_por text,
  primary key (fecha, codigo_vehiculo, turno, modalidad, dni)
);

alter table public.ejecucion_viajes enable row level security;
revoke all on table public.ejecucion_viajes from public, anon, authenticated;
grant select, insert, update, delete on table public.ejecucion_viajes to service_role;

-- La flota guarda «K-027» y la intranet «K027»; las sedes llegan con espacios.
-- Es la misma normalización que `_clave_de_vehiculo` en el backend.
create or replace function public._clave_normalizada(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select upper(regexp_replace(coalesce(p_texto, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Los servicios de una unidad entre dos días, con sus pasajeros en orden de
-- recogida y lo que el conductor ya marcó. El `id` de cada pasajero es el de su
-- fila del plan: el conductor no necesita el DNI de nadie para marcarlo.
create or replace function public.servicios_de_unidad(p_clave text, p_desde date, p_hasta date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filas as (
    select p.id, p.fecha, p.codigo_vehiculo, p.turno, p.modalidad, p.cobertura,
           p.dni, p.orden, p.estado, p.actualizado_en,
           pa.nombre, pa.direccion, pa.distrito, pa.lat, pa.lng,
           pa.estado_ubicacion, e.estado as viaje, e.marcado_en
      from programacion p
      left join pasajeros pa on pa.dni = p.dni
      left join ejecucion_viajes e
        on e.fecha = p.fecha and e.codigo_vehiculo = p.codigo_vehiculo
       and e.turno = p.turno and e.modalidad = p.modalidad and e.dni = p.dni
     where p.fecha between p_desde and p_hasta
       and _clave_normalizada(p.codigo_vehiculo) = p_clave
  ),
  sede_de as (
    select distinct on (s.dni) s.dni, s.sede
      from servicios_historicos s
     where s.dni in (select f.dni from filas f) and s.sede is not null
     order by s.dni, s.fecha_ejecutada desc
  ),
  servicios as (
    select f.fecha, f.codigo_vehiculo, f.turno, f.modalidad,
           (array_agg(f.cobertura order by f.cobertura)
              filter (where f.cobertura is not null))[1] as cobertura,
           mode() within group (order by sd.sede) as sede,
           max(f.actualizado_en) as actualizado_en,
           jsonb_agg(jsonb_build_object(
             'id', f.id,
             'nombre', coalesce(f.nombre, 'Sin nombre'),
             'direccion', f.direccion,
             'distrito', f.distrito,
             'lat', f.lat,
             'lng', f.lng,
             'ubicacion', f.estado_ubicacion,
             'orden', f.orden,
             'viaje', f.viaje,
             'marcado_en', f.marcado_en)
             order by f.orden nulls last, f.nombre)
             filter (where f.estado = 'programado') as pasajeros,
           -- Quien se cayó del servicio: si no se le avisa, el conductor va a
           -- buscarle igual.
           coalesce(jsonb_agg(coalesce(f.nombre, 'Sin nombre') order by f.nombre)
             filter (where f.estado = 'retirado'), '[]'::jsonb) as ya_no_viajan
      from filas f
      left join sede_de sd on sd.dni = f.dni
     group by f.fecha, f.codigo_vehiculo, f.turno, f.modalidad
  )
  select jsonb_build_object(
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fecha', s.fecha,
               'unidad', s.codigo_vehiculo,
               'turno', s.turno,
               'modalidad', s.modalidad,
               'cobertura', s.cobertura,
               'sede', s.sede,
               'actualizado_en', s.actualizado_en,
               'pasajeros', coalesce(s.pasajeros, '[]'::jsonb),
               'ya_no_viajan', s.ya_no_viajan)
             order by s.fecha, s.turno, s.modalidad, s.codigo_vehiculo)
        from servicios s), '[]'::jsonb),
    -- Un día sin plan no es un día sin servicios: el conductor tiene que
    -- saber cuál de las dos cosas le pasa.
    'dias_con_plan', coalesce((
      select jsonb_agg(d.fecha order by d.fecha)
        from programacion_dias d
       where d.fecha between p_desde and p_hasta), '[]'::jsonb)
  )
$$;

-- Marca (o desmarca, con `p_estado` nulo) a un pasajero del plan. Solo si la
-- fila sigue en el plan, es de esa unidad y cae dentro de la ventana que
-- decide el backend: el conductor no puede marcar a nadie de otro coche ni de
-- otro día.
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

-- Lo que ve una empresa cliente de un día: los servicios de su personal, con
-- la unidad y quién la conduce, y lo que el conductor ha marcado. Sin
-- direcciones ni coordenadas: el cliente sabe dónde vive su gente, y no le
-- hace falta para seguir el transporte.
--
-- La empresa se reconoce por el principio de la sede («TELEPERFORMANCE» en
-- «TELEPERFORMANCE BELLAVISTA»). La sede de cada persona sale del histórico;
-- a quien no tiene (un alta nueva) se le da la del servicio en que va.
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
     where p_prefijo <> ''
       and starts_with(_clave_normalizada(coalesce(sd.sede, ss.sede)), p_prefijo)
  ),
  flota as (
    select _clave_normalizada(u.key) as clave, u.value as unidad
      from app_state a, jsonb_each(a.usuarios -> '__flota__') u
     where a.id = 1 and jsonb_typeof(u.value) = 'object'
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
    -- Quien viaja ese día pero todavía no tiene unidad: el cliente debe verlo
    -- antes de que sea un problema, no después.
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
         and p_prefijo <> ''
         and starts_with(_clave_normalizada(sd.sede), p_prefijo)), '[]'::jsonb)
  )
$$;

-- Postgres concede EXECUTE a `public` por defecto: sin esto cualquiera con la
-- clave anónima podría llamarlas por /rest/v1/rpc/ (ver 005).
revoke all on function public._clave_normalizada(text) from public, anon, authenticated;
revoke all on function public.servicios_de_unidad(text, date, date) from public, anon, authenticated;
revoke all on function public.marcar_viaje(bigint, text, text, text, date, date) from public, anon, authenticated;
revoke all on function public.servicios_de_empresa(text, date) from public, anon, authenticated;
grant execute on function public._clave_normalizada(text) to service_role;
grant execute on function public.servicios_de_unidad(text, date, date) to service_role;
grant execute on function public.marcar_viaje(bigint, text, text, text, date, date) to service_role;
grant execute on function public.servicios_de_empresa(text, date) to service_role;
