-- Disponibilidad de las unidades: qué días descansa cada conductor y en qué
-- turnos trabaja (pedido del usuario, 2026-10-02).
--
-- La configura el Programador desde su Flota. Dos niveles:
--
-- * **Su semana habitual** (`disponibilidad_semanal`): «descansa los
--   domingos», «los sábados solo hace el de las 03:00». Sin fila, ese día de la
--   semana trabaja todos los turnos.
-- * **Fechas concretas** (`disponibilidad_fechas`), que mandan sobre la semana:
--   «el 4 de octubre descansa», una semana entera de vacaciones (una fila por
--   día), o «este sábado sí trabaja» aunque su semana diga que no.
--
-- En las dos, `turnos` vacío es «descansa» y con turnos es «solo esos». En una
-- fecha, `turnos` nulo es «trabaja todo», que sirve para anular su semana ese
-- día. En la semana no hace falta: sin fila ya trabaja todo.
--
-- La unidad va por su clave normalizada (`_clave_normalizada`: «K-027» y
-- «K027» son la misma, y «KV-026» es la «V026» de la intranet), que es con lo
-- que se cruza contra `programacion.codigo_vehiculo`. La fecha es la del plan,
-- que es la de su turno: un 00:30 del 4 es del 4.
--
-- **Quien no está disponible sale del plan solo.** `retirar_no_disponibles`
-- pasa a pendientes —motivo `no_disponible`, sin baja— a los pasajeros de los
-- servicios de una unidad en un turno que no trabaja. Lo llama el backend al
-- crear la programación de un día y al guardar una disponibilidad que toca un
-- día ya programado («si una unidad no está disponible por cualquier razón,
-- deben reasignarse a pendientes», decisión del usuario).
--
-- Va antes que el código: sin esta migración, la Flota no puede guardar la
-- disponibilidad (503 con aviso) y el plan se sigue viendo como hasta ahora.

-- 'HH:MM' de 00:00 a 23:59, que es como se guardan los turnos del plan.
create or replace function public._turnos_validos(t text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select t is null or not exists (
    select 1 from unnest(t) x
    where x is null or x !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
$$;

create table if not exists public.disponibilidad_semanal (
  unidad text not null check (unidad ~ '^[A-Z0-9]+$'),
  -- 1 lunes … 7 domingo (`isodow`).
  dia_iso smallint not null check (dia_iso between 1 and 7),
  -- Vacío: descansa ese día de la semana. Con turnos: solo trabaja esos.
  turnos text[] not null default '{}' check (_turnos_validos(turnos)),
  actualizado_por text,
  actualizado_en timestamptz not null default now(),
  primary key (unidad, dia_iso)
);

create table if not exists public.disponibilidad_fechas (
  unidad text not null check (unidad ~ '^[A-Z0-9]+$'),
  fecha date not null,
  -- Nulo: trabaja todo ese día, diga lo que diga su semana. Vacío: descansa.
  -- Con turnos: solo trabaja esos.
  turnos text[] check (_turnos_validos(turnos)),
  nota text check (nota is null or char_length(nota) <= 200),
  actualizado_por text,
  actualizado_en timestamptz not null default now(),
  primary key (unidad, fecha)
);

create index if not exists disponibilidad_fechas_fecha_idx
  on public.disponibilidad_fechas (fecha);

alter table public.disponibilidad_semanal enable row level security;
alter table public.disponibilidad_fechas enable row level security;
revoke all on table public.disponibilidad_semanal from public, anon, authenticated;
revoke all on table public.disponibilidad_fechas from public, anon, authenticated;
grant select, insert, update, delete on public.disponibilidad_semanal to service_role;
grant select, insert, update, delete on public.disponibilidad_fechas to service_role;


-- Las unidades con alguna restricción ese día, y cuál:
-- `{ "K027": {"turnos": [], "origen": "fecha", "nota": "Vacaciones"} }`.
-- Las que trabajan todo no aparecen.
create or replace function public.disponibilidad_del_dia(dia date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(r.unidad, jsonb_build_object(
           'turnos', to_jsonb(r.turnos), 'origen', r.origen, 'nota', r.nota)), '{}'::jsonb)
  from (
    select f.unidad, f.turnos, 'fecha'::text as origen, f.nota
      from disponibilidad_fechas f
     where f.fecha = dia and f.turnos is not null
    union all
    select s.unidad, s.turnos, 'semana'::text, null::text
      from disponibilidad_semanal s
     where s.dia_iso = extract(isodow from dia)::smallint
       -- Una fecha concreta manda sobre su semana, también la que dice
       -- «trabaja todo» (turnos nulo).
       and not exists (select 1 from disponibilidad_fechas f
                        where f.unidad = s.unidad and f.fecha = dia)
  ) r
$$;


-- Pasa a pendientes a quien va en una unidad que no está disponible en su
-- turno. No es una baja: la fila queda retirada con su unidad, como con
-- `a_pendientes`, y el pendiente lleva su turno, sentido y zona para buscarle
-- otro coche. Devuelve cuántas personas y de qué servicios.
create or replace function public.retirar_no_disponibles(dia date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reglas jsonb;
  servicios jsonb;
  personas integer;
begin
  perform pg_advisory_xact_lock(hashtext('kapital-programacion:' || dia::text));

  if not exists (select 1 from programacion_dias d where d.fecha = dia) then
    return jsonb_build_object('fecha', dia, 'personas', 0, 'servicios', '[]'::jsonb);
  end if;
  reglas := disponibilidad_del_dia(dia);

  with afectadas as (
    select p.id, p.fecha, p.dni, p.turno, p.modalidad, p.cobertura, p.codigo_vehiculo
      from programacion p
      join jsonb_each(reglas) r on r.key = _clave_normalizada(p.codigo_vehiculo)
     where p.fecha = dia and p.estado = 'programado'
       and not exists (select 1 from jsonb_array_elements_text(r.value -> 'turnos') t
                        where _mismo_turno(p.turno, t))
  ), pendientes as (
    -- `distinct on`: un `on conflict` no puede tocar dos veces la misma fila.
    insert into programacion_pendientes
      (fecha, dni, turno, modalidad, cobertura, motivo, detalle)
    select distinct on (a.dni, a.turno, a.modalidad)
           a.fecha, a.dni, a.turno, a.modalidad, a.cobertura, 'no_disponible',
           'Iba en ' || a.codigo_vehiculo
      from afectadas a
     order by a.dni, a.turno, a.modalidad, a.codigo_vehiculo
    on conflict (fecha, dni, turno, modalidad) do update
      set cobertura = excluded.cobertura, motivo = excluded.motivo,
          detalle = excluded.detalle, creado_en = now()
    returning 1
  ), retiradas as (
    update programacion p
       set estado = 'retirado', nota = 'Unidad no disponible', actualizado_en = now()
      from afectadas a
     where p.id = a.id
    returning a.codigo_vehiculo, a.turno, a.modalidad
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'vehiculo', s.codigo_vehiculo, 'turno', s.turno, 'modalidad', s.modalidad,
           'personas', s.n) order by s.codigo_vehiculo, s.turno, s.modalidad), '[]'::jsonb),
         coalesce(sum(s.n), 0)::int
    into servicios, personas
    from (select codigo_vehiculo, turno, modalidad, count(*)::int as n
            from retiradas group by codigo_vehiculo, turno, modalidad) s;

  if personas > 0 then
    update programacion_dias d set actualizado_en = now() where d.fecha = dia;
  end if;
  return jsonb_build_object('fecha', dia, 'personas', personas, 'servicios', servicios);
end;
$$;


-- Los turnos que usa la operación, con cuántas veces aparecen: los del
-- histórico reciente y los del plan. Salen de los datos y no de una lista
-- escrita, porque «después habrá más» (el usuario).
create or replace function public.turnos_de_la_operacion(p_desde date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('turno', t.turno, 'veces', t.n)
                            order by t.turno), '[]'::jsonb)
  from (
    select x.turno, count(*)::int as n
      from (
        select s.turno from servicios_historicos s where s.fecha_ejecutada >= p_desde
        union all
        select p.turno from programacion p
         where p.fecha >= p_desde and p.estado = 'programado'
      ) x
     where x.turno ~ '^[0-9]{1,2}:[0-9]{2}$'
     group by x.turno
  ) t
$$;


-- Todo lo que necesita la Flota del Programador, en un viaje.
create or replace function public.leer_disponibilidad(p_desde date, p_hasta date, p_turnos_desde date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'semanal', coalesce((
      select jsonb_agg(jsonb_build_object('unidad', s.unidad, 'dia', s.dia_iso,
                                          'turnos', to_jsonb(s.turnos))
                       order by s.unidad, s.dia_iso)
        from disponibilidad_semanal s), '[]'::jsonb),
    'fechas', coalesce((
      select jsonb_agg(jsonb_build_object('unidad', f.unidad, 'fecha', f.fecha,
                                          'turnos', to_jsonb(f.turnos), 'nota', f.nota)
                       order by f.unidad, f.fecha)
        from disponibilidad_fechas f
       where f.fecha between p_desde and p_hasta), '[]'::jsonb),
    'turnos', turnos_de_la_operacion(p_turnos_desde),
    'dias_con_plan', coalesce((
      select jsonb_agg(d.fecha order by d.fecha)
        from programacion_dias d
       where d.fecha between p_desde and p_hasta), '[]'::jsonb))
$$;


-- Guarda la disponibilidad de una unidad y saca del plan a quien ya no puede
-- llevar.
--
-- `p_semana`: `{"1": [...] | null, ...}`; solo cambian los días que vienen, y
-- `null` es «trabaja todo» (se borra la fila). `p_fechas`: `[{"fecha",
-- "turnos", "nota"}]`, con `turnos` igual a la cadena `"semana"` para quitar la
-- excepción y volver a su semana. Las fechas van de `p_hoy` en adelante: lo
-- que ya pasó no se cambia.
--
-- Después revisa los días con plan que toca —de `p_hoy` a `p_hasta`— y pasa a
-- pendientes lo que haga falta, en la misma transacción.
create or replace function public.guardar_disponibilidad(
  p_unidad text, p_semana jsonb, p_fechas jsonb, p_hoy date, p_hasta date, p_por text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dia_texto text;
  valor jsonb;
  entrada jsonb;
  fecha_x date;
  turnos_x text[];
  dias_semana smallint[] := '{}';
  fechas_tocadas date[] := '{}';
  revisar date;
  resultado jsonb;
  retiradas jsonb := '[]'::jsonb;
  personas integer := 0;
begin
  if p_unidad is null or p_unidad !~ '^[A-Z0-9]+$' or p_hoy is null or p_hasta is null
     or (p_semana is not null and jsonb_typeof(p_semana) <> 'object')
     or (p_fechas is not null and jsonb_typeof(p_fechas) <> 'array') then
    return jsonb_build_object('error', 'entrada_invalida');
  end if;

  -- Validar todo antes de escribir nada.
  for dia_texto, valor in select key, value from jsonb_each(coalesce(p_semana, '{}'::jsonb))
  loop
    if dia_texto !~ '^[1-7]$'
       or jsonb_typeof(valor) not in ('null', 'array')
       or (jsonb_typeof(valor) = 'array' and not _turnos_validos(
             array(select jsonb_array_elements_text(valor)))) then
      return jsonb_build_object('error', 'entrada_invalida');
    end if;
  end loop;
  for entrada in select value from jsonb_array_elements(coalesce(p_fechas, '[]'::jsonb))
  loop
    if jsonb_typeof(entrada) <> 'object'
       or coalesce(entrada ->> 'fecha', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (entrada ->> 'fecha')::date < p_hoy
       or (entrada ->> 'fecha')::date > p_hoy + 366
       or not (entrada ? 'turnos')
       or (jsonb_typeof(entrada -> 'turnos') = 'string' and entrada ->> 'turnos' <> 'semana')
       or jsonb_typeof(entrada -> 'turnos') not in ('null', 'array', 'string')
       or (jsonb_typeof(entrada -> 'turnos') = 'array' and not _turnos_validos(
             array(select jsonb_array_elements_text(entrada -> 'turnos')))) then
      return jsonb_build_object('error', 'entrada_invalida');
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext('kapital-disponibilidad:' || p_unidad));

  for dia_texto, valor in select key, value from jsonb_each(coalesce(p_semana, '{}'::jsonb))
  loop
    dias_semana := dias_semana || dia_texto::smallint;
    if jsonb_typeof(valor) = 'null' then
      delete from disponibilidad_semanal s
       where s.unidad = p_unidad and s.dia_iso = dia_texto::smallint;
    else
      insert into disponibilidad_semanal (unidad, dia_iso, turnos, actualizado_por, actualizado_en)
      values (p_unidad, dia_texto::smallint,
              array(select distinct jsonb_array_elements_text(valor) order by 1), p_por, now())
      on conflict (unidad, dia_iso) do update
        set turnos = excluded.turnos, actualizado_por = excluded.actualizado_por,
            actualizado_en = now();
    end if;
  end loop;

  for entrada in select value from jsonb_array_elements(coalesce(p_fechas, '[]'::jsonb))
  loop
    fecha_x := (entrada ->> 'fecha')::date;
    fechas_tocadas := fechas_tocadas || fecha_x;
    if jsonb_typeof(entrada -> 'turnos') = 'string' then
      delete from disponibilidad_fechas f where f.unidad = p_unidad and f.fecha = fecha_x;
    else
      turnos_x := case when jsonb_typeof(entrada -> 'turnos') = 'null' then null
                       else array(select distinct jsonb_array_elements_text(entrada -> 'turnos')
                                  order by 1) end;
      insert into disponibilidad_fechas (unidad, fecha, turnos, nota, actualizado_por, actualizado_en)
      values (p_unidad, fecha_x, turnos_x, nullif(btrim(entrada ->> 'nota'), ''), p_por, now())
      on conflict (unidad, fecha) do update
        set turnos = excluded.turnos, nota = excluded.nota,
            actualizado_por = excluded.actualizado_por, actualizado_en = now();
    end if;
  end loop;

  -- Los días con plan a los que afecta: las fechas tocadas y, si cambió su
  -- semana, los de esos días de la semana. Solo de hoy en adelante.
  for revisar in
    select d.fecha from programacion_dias d
     where d.fecha between p_hoy and p_hasta
       and (d.fecha = any(fechas_tocadas)
            or extract(isodow from d.fecha)::smallint = any(dias_semana))
     order by d.fecha
  loop
    resultado := retirar_no_disponibles(revisar);
    if coalesce((resultado ->> 'personas')::int, 0) > 0 then
      retiradas := retiradas || jsonb_build_array(resultado);
      personas := personas + (resultado ->> 'personas')::int;
    end if;
  end loop;

  return jsonb_build_object('unidad', p_unidad, 'personas', personas, 'retiradas', retiradas);
end;
$$;


revoke all on function public._turnos_validos(text[]) from public, anon, authenticated;
revoke all on function public.disponibilidad_del_dia(date) from public, anon, authenticated;
revoke all on function public.retirar_no_disponibles(date) from public, anon, authenticated;
revoke all on function public.turnos_de_la_operacion(date) from public, anon, authenticated;
revoke all on function public.leer_disponibilidad(date, date, date) from public, anon, authenticated;
revoke all on function public.guardar_disponibilidad(text, jsonb, jsonb, date, date, text)
  from public, anon, authenticated;
grant execute on function public._turnos_validos(text[]) to service_role;
grant execute on function public.disponibilidad_del_dia(date) to service_role;
grant execute on function public.retirar_no_disponibles(date) to service_role;
grant execute on function public.turnos_de_la_operacion(date) to service_role;
grant execute on function public.leer_disponibilidad(date, date, date) to service_role;
grant execute on function public.guardar_disponibilidad(text, jsonb, jsonb, date, date, text)
  to service_role;
