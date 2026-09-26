-- El plan del Programador: la programación que decide, no la que ocurrió.
--
-- El histórico (001 y 002) es lo que pasó y no se toca. Esto es lo que se
-- pretende que pase, y se edita. Viven en tablas distintas a propósito:
-- mezclarlas haría imposible saber si una fila es un hecho o una intención,
-- que es justo lo que hay que distinguir cuando algo sale mal.
--
-- El flujo es el del trabajo real: se siembra el día copiando el último
-- ejecutado —«seguir el orden anterior»—, se le aplican las novedades del
-- cliente, y lo que queda sin sitio espera en `programacion_pendientes` a que
-- alguien lo coloque. Ese «alguien» es hoy una persona y mañana el motor de
-- inserción, que aún no existe porque le faltan las reglas de la operación.
--
-- Aplicado el 2026-09-25. Medido: sembrar un día son 396 asignaciones en
-- 0,9 s, y leerlo 0,5 s.

create table if not exists public.programacion (
  id bigserial primary key,
  fecha date not null,
  codigo_vehiculo text not null,
  turno text not null,
  modalidad text not null,
  cobertura text,
  dni text not null,
  -- Posición de recogida dentro del servicio. Se siembra con el orden real
  -- del histórico y el Programador la cambia a mano.
  orden integer,
  -- De dónde salió esta fila. Sin esto, al revisar un día no hay forma de
  -- saber qué decidió una persona y qué se arrastró solo.
  origen text not null default 'historico'
    check (origen in ('historico', 'novedad', 'manual')),
  -- Una baja no se borra: se marca. Borrarla dejaría el día sin rastro de que
  -- alguien iba a viajar y se cayó, que es información que el día siguiente
  -- necesita.
  estado text not null default 'programado'
    check (estado in ('programado', 'retirado')),
  nota text,
  actualizado_en timestamptz not null default now(),
  unique (fecha, codigo_vehiculo, turno, modalidad, dni)
);

create index if not exists programacion_fecha_idx on public.programacion (fecha);

-- Qué días tienen programación y de dónde se sembró cada uno. Va aparte
-- porque es un dato del día entero, no de cada fila.
create table if not exists public.programacion_dias (
  fecha date primary key,
  sembrado_desde date,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  nota text
);

-- Quien tiene que viajar y todavía no tiene sitio.
--
-- Tabla aparte y no un estado más de `programacion` porque un pendiente no
-- está en ningún servicio: no tiene vehículo, que es media clave natural de
-- aquella. Meterlo allí obligaría a inventar un vehículo falso, y ese vehículo
-- acabaría apareciendo en algún recuento.
--
-- `turno` y `modalidad` van con `not null default ''` porque forman parte de
-- la clave y una clave primaria no admite expresiones: el mismo apaño que en
-- `duraciones_base`.
create table if not exists public.programacion_pendientes (
  fecha date not null,
  dni text not null,
  turno text not null default '',
  modalidad text not null default '',
  cobertura text,
  motivo text not null,
  detalle text,
  creado_en timestamptz not null default now(),
  primary key (fecha, dni, turno, modalidad)
);

alter table public.programacion enable row level security;
alter table public.programacion_dias enable row level security;
alter table public.programacion_pendientes enable row level security;

grant select, insert, update, delete on public.programacion to service_role;
grant select, insert, update, delete on public.programacion_dias to service_role;
grant select, insert, update, delete on public.programacion_pendientes to service_role;
grant usage, select on sequence public.programacion_id_seq to service_role;


-- Crea la programación de un día copiando lo que se ejecutó en otro.
--
-- Es el «seguir el orden anterior» del que parte el trabajo del Programador:
-- el día empieza siendo igual al último que se hizo, y encima se aplican las
-- novedades. Empezar de cero cada día sería rehacer un trabajo que ya estaba
-- bien el 78% de las veces.
--
-- **No pisa lo ya hecho.** Si el día ya tiene programación devuelve lo que hay
-- y no toca nada, salvo que se pida rehacerlo a propósito: volver a sembrar
-- sin querer borraría las decisiones de una persona.
create or replace function public.sembrar_programacion(
  dia date,
  desde date default null,
  rehacer boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  origen date;
  ya_existe integer;
  creadas integer;
begin
  select count(*) into ya_existe from programacion p where p.fecha = dia;

  if ya_existe > 0 and not rehacer then
    return jsonb_build_object(
      'fecha', dia, 'creadas', 0, 'ya_existia', true, 'filas', ya_existe,
      'sembrado_desde', (select d.sembrado_desde from programacion_dias d
                         where d.fecha = dia));
  end if;

  origen := coalesce(
    desde,
    (select max(s.fecha_ejecutada) from servicios_historicos s
     where s.fecha_ejecutada < dia),
    (select max(s.fecha_ejecutada) from servicios_historicos s));

  if origen is null then
    return jsonb_build_object('fecha', dia, 'creadas', 0, 'sin_historico', true);
  end if;

  if rehacer then
    delete from programacion p where p.fecha = dia;
  end if;

  insert into programacion (fecha, codigo_vehiculo, turno, modalidad, cobertura,
                            dni, orden, origen, estado)
  select
    dia,
    s.codigo_vehiculo,
    s.turno,
    s.modalidad,
    s.cobertura,
    s.dni,
    row_number() over (
      partition by s.codigo_vehiculo, s.turno, s.modalidad
      order by s.hora_inicio nulls last, s.dni),
    'historico',
    'programado'
  from servicios_historicos s
  where s.fecha_ejecutada = origen
    and s.codigo_vehiculo is not null
    and btrim(s.codigo_vehiculo) <> ''
    -- Quien no subió el día de referencia no se arrastra: sembrar una baja
    -- conocida haría empezar el día con asientos que ya se sabe que sobran.
    and upper(btrim(coalesce(s.incidencia, ''))) = 'A BORDO'
  on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do nothing;

  get diagnostics creadas = row_count;

  insert into programacion_dias (fecha, sembrado_desde)
  values (dia, origen)
  on conflict (fecha) do update
    set sembrado_desde = excluded.sembrado_desde,
        actualizado_en = now();

  return jsonb_build_object(
    'fecha', dia, 'sembrado_desde', origen, 'creadas', creadas,
    'ya_existia', false);
end;
$$;


-- La programación guardada de un día, con la forma que consume la mesa.
--
-- Misma salida que `programacion_del_dia()` —`conductor`, `micro_zona`,
-- `horario`, `agentes`— a propósito: así la pantalla no distingue si está
-- mirando el histórico o un plan editable, y las tarjetas, los filtros y la
-- exportación siguen funcionando sin tocarlos.
--
-- Lo que sí añade es lo que solo tiene un plan: el estado y el origen de cada
-- fila, los retirados —aparte, para poder enseñarlos sin mezclarlos con quien
-- sí va— y los pendientes de colocar.
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
  agrupados as (
    select
      f.codigo_vehiculo,
      f.turno,
      f.modalidad,
      (array_agg(f.cobertura order by f.cobertura))[1] as cobertura,
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
    group by f.codigo_vehiculo, f.turno, f.modalidad
  ),
  con_duracion as (
    select
      a.*,
      coalesce(fino.p50_minutos, grueso.p50_minutos) as p50,
      coalesce(fino.p90_minutos, grueso.p90_minutos) as p90,
      coalesce(fino.n_casos, grueso.n_casos) as casos
    from agrupados a
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
               'cobertura', x.cobertura,
               'turno', nullif(x.turno, ''),
               'modalidad', nullif(x.modalidad, ''),
               'motivo', x.motivo,
               'detalle', x.detalle)
             order by x.turno, pa.nombre)
      from programacion_pendientes x
      left join pasajeros pa on pa.dni = x.dni
      where x.fecha = dia), '[]'::jsonb),
    'rutas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'conductor', codigo_vehiculo,
               'micro_zona', cobertura,
               'horario', turno || ' ' || lower(modalidad),
               'duracion', case when p50 is null then null else jsonb_build_object(
                 'p50', p50, 'p90', p90, 'casos', casos) end,
               'retirados', retirados,
               'agentes', coalesce(agentes, '[]'::jsonb))
             order by turno, codigo_vehiculo)
      from con_duracion where viajan > 0 or jsonb_array_length(retirados) > 0),
      '[]'::jsonb)
  );
$$;


-- Las ediciones del Programador sobre el plan de un día.
--
-- Va en una sola función y no en cinco endpoints porque una tanda de cambios
-- —reordenar un servicio, retirar a dos y mover a uno— se guarda de golpe:
-- partirla en veinte peticiones a PostgREST sería lento y dejaría el plan a
-- medias si una fallara por el camino.
--
-- Acciones:
--   retirar  {dni, vehiculo, turno, modalidad, nota?}
--   reponer  {dni, vehiculo, turno, modalidad}
--   mover    {dni, desde:{vehiculo,turno,modalidad}, hacia:{...}}
--   ordenar  {vehiculo, turno, modalidad, dnis:[...]}
--   agregar  {dni, vehiculo, turno, modalidad, cobertura?}
create or replace function public.editar_programacion(dia date, cambios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cambio jsonb;
  accion text;
  aplicados integer := 0;
  i integer;
  documentos jsonb;
begin
  if not exists (select 1 from programacion_dias d where d.fecha = dia) then
    return jsonb_build_object('error', 'sin_programacion', 'fecha', dia);
  end if;

  for cambio in select * from jsonb_array_elements(cambios)
  loop
    accion := cambio ->> 'accion';

    if accion = 'retirar' then
      update programacion p
         set estado = 'retirado', nota = cambio ->> 'nota', actualizado_en = now()
       where p.fecha = dia and p.dni = cambio ->> 'dni'
         and p.codigo_vehiculo = cambio ->> 'vehiculo'
         and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad';

    elsif accion = 'reponer' then
      update programacion p
         set estado = 'programado', nota = null, actualizado_en = now()
       where p.fecha = dia and p.dni = cambio ->> 'dni'
         and p.codigo_vehiculo = cambio ->> 'vehiculo'
         and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad';

    elsif accion = 'mover' then
      -- El destino manda: si esa persona ya estaba allí se actualiza en vez de
      -- chocar contra la clave natural, y la fila de origen desaparece.
      delete from programacion p
       where p.fecha = dia and p.dni = cambio ->> 'dni'
         and p.codigo_vehiculo = cambio #>> '{desde,vehiculo}'
         and p.turno = cambio #>> '{desde,turno}'
         and p.modalidad = cambio #>> '{desde,modalidad}';

      insert into programacion (fecha, codigo_vehiculo, turno, modalidad,
                                cobertura, dni, orden, origen, estado)
      values (dia, cambio #>> '{hacia,vehiculo}', cambio #>> '{hacia,turno}',
              cambio #>> '{hacia,modalidad}', cambio #>> '{hacia,cobertura}',
              cambio ->> 'dni', null, 'manual', 'programado')
      on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do update
        set estado = 'programado', origen = 'manual', actualizado_en = now();

    elsif accion = 'ordenar' then
      documentos := cambio -> 'dnis';
      for i in 0 .. jsonb_array_length(documentos) - 1
      loop
        update programacion p
           set orden = i + 1, actualizado_en = now()
         where p.fecha = dia and p.dni = documentos ->> i
           and p.codigo_vehiculo = cambio ->> 'vehiculo'
           and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad';
      end loop;

    elsif accion = 'agregar' then
      insert into programacion (fecha, codigo_vehiculo, turno, modalidad,
                                cobertura, dni, orden, origen, estado)
      values (dia, cambio ->> 'vehiculo', cambio ->> 'turno',
              cambio ->> 'modalidad', cambio ->> 'cobertura', cambio ->> 'dni',
              (select coalesce(max(p.orden), 0) + 1 from programacion p
                where p.fecha = dia and p.codigo_vehiculo = cambio ->> 'vehiculo'
                  and p.turno = cambio ->> 'turno'
                  and p.modalidad = cambio ->> 'modalidad'),
              coalesce(cambio ->> 'origen', 'manual'), 'programado')
      on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do update
        set estado = 'programado', actualizado_en = now();

    else
      return jsonb_build_object('error', 'accion_desconocida', 'accion', accion);
    end if;

    aplicados := aplicados + 1;
  end loop;

  update programacion_dias d set actualizado_en = now() where d.fecha = dia;
  return jsonb_build_object('fecha', dia, 'aplicados', aplicados);
end;
$$;


-- Aplica al plan de un día lo que dicen las novedades del cliente.
--
-- Hace solo lo que no admite duda:
--
-- * **La baja se retira.** Es mecánico y no hay dónde equivocarse.
-- * **El cambio de zona o de turno saca a la persona de su servicio actual**
--   y la deja pendiente. No la recoloca sola: elegir en qué vehículo entra es
--   justo el problema que necesita las reglas de la operación, y meterla en
--   el primero que quepa sería inventarse una decisión.
-- * **El alta queda pendiente**, por lo mismo.
-- * Lo que no cambia no se toca.
--
-- Recibe las entradas ya analizadas por `novedades_intranet`, no el Excel: el
-- cruce contra el histórico ya se hizo allí y repetirlo aquí serían dos reglas
-- que se desviarían.
create or replace function public.aplicar_novedades(dia date, entradas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  documento text;
  tocadas integer;
  retiradas integer := 0;
  pendientes integer := 0;
  sin_cambio integer := 0;
begin
  if not exists (select 1 from programacion_dias d where d.fecha = dia) then
    return jsonb_build_object('error', 'sin_programacion', 'fecha', dia);
  end if;

  for e in select * from jsonb_array_elements(entradas)
  loop
    documento := e ->> 'dni';

    if (e ->> 'viaja')::boolean is false then
      update programacion p
         set estado = 'retirado',
             nota = coalesce(nullif(e ->> 'etiqueta', ''), 'Baja del cliente'),
             actualizado_en = now()
       where p.fecha = dia and p.dni = documento and p.estado = 'programado';
      get diagnostics tocadas = row_count;
      retiradas := retiradas + tocadas;
      delete from programacion_pendientes x
       where x.fecha = dia and x.dni = documento;

    elsif (e ->> 'clasificacion') in ('alta', 'cambio') then
      -- Sale de donde estaba: si cambió de zona o de turno, ese sitio ya no
      -- le corresponde y dejarlo allí sería programar un recojo que no toca.
      delete from programacion p
       where p.fecha = dia and p.dni = documento;

      insert into programacion_pendientes
        (fecha, dni, turno, modalidad, cobertura, motivo, detalle)
      values (dia, documento, coalesce(e ->> 'turno', ''),
              coalesce(e ->> 'sentido', ''), e ->> 'cobertura',
              e ->> 'clasificacion', nullif(e ->> 'resumen_cambios', ''))
      on conflict (fecha, dni, turno, modalidad) do update
        set cobertura = excluded.cobertura,
            motivo = excluded.motivo,
            detalle = excluded.detalle,
            creado_en = now();
      pendientes := pendientes + 1;

    else
      sin_cambio := sin_cambio + 1;
    end if;
  end loop;

  update programacion_dias d set actualizado_en = now() where d.fecha = dia;

  return jsonb_build_object(
    'fecha', dia, 'retiradas', retiradas, 'pendientes', pendientes,
    'sin_cambio', sin_cambio);
end;
$$;


revoke all on function public.sembrar_programacion(date, date, boolean) from public;
revoke all on function public.leer_programacion(date) from public;
revoke all on function public.editar_programacion(date, jsonb) from public;
revoke all on function public.aplicar_novedades(date, jsonb) from public;

grant execute on function public.sembrar_programacion(date, date, boolean) to service_role;
grant execute on function public.leer_programacion(date) to service_role;
grant execute on function public.editar_programacion(date, jsonb) to service_role;
grant execute on function public.aplicar_novedades(date, jsonb) to service_role;
