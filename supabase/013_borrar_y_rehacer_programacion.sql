-- Borrar y rehacer la programación de un día, con las dos guardas que les faltaban.
--
-- La pantalla solo sabía crear una programación: una vez creada no había forma
-- de quitarla ni de volver a empezar, aunque `sembrar_programacion` ya sabía
-- rehacer. El usuario lo pidió al probar desde su equipo local, que trabaja
-- contra la base real: un plan de prueba de mañana les llegaba como real a los
-- conductores de esas unidades.
--
-- Las dos acciones solo valen sobre un día que no ha pasado y en el que ningún
-- conductor ha marcado todavía quién subió. Lo que ya ocurrió no se borra ni
-- se reescribe, por lo mismo que el plan va aparte del histórico.
--
-- Esta migración añade `borrar_programacion` y reemplaza `sembrar_programacion`
-- (idéntica a la de la 004 salvo la guarda de `rehacer`). No toca tablas.

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
  dia_existia boolean;
  filas_origen integer;
  ya_existia integer;
  creadas integer;
begin
  -- Serializa siembra y edición del mismo día dentro de la transacción. Sin
  -- esto dos pestañas podían leer un día vacío y devolver resultados distintos.
  perform pg_advisory_xact_lock(hashtext('kapital-programacion:' || dia::text));

  -- Hoy sí se puede programar. Fuera de la ventana solo se permite reabrir o
  -- rehacer un plan que ya existe; un día histórico sin plan nunca se convierte
  -- en una mutación accidental del pasado.
  select exists (
    select 1 from programacion_dias d where d.fecha = dia
  ) into dia_existia;

  if not dia_existia
     and (dia < (now() at time zone 'America/Lima')::date
          or dia > (now() at time zone 'America/Lima')::date + 13) then
    return jsonb_build_object(
      'error', 'dia_no_programable', 'fecha', dia);
  end if;

  select count(*) into ya_existia from programacion p where p.fecha = dia;

  -- Rehacer borra el plan del día y lo vuelve a copiar. Sobre un día que ya
  -- pasó o con viajes ya marcados por los conductores, eso tiraría lo que de
  -- verdad ocurrió: las marcas quedarían sueltas de un plan que ya no dice lo
  -- mismo. Se rechaza antes de tocar nada.
  if dia_existia and rehacer then
    if dia < (now() at time zone 'America/Lima')::date then
      return jsonb_build_object('error', 'dia_pasado', 'fecha', dia);
    end if;
    if exists (select 1 from ejecucion_viajes e where e.fecha = dia) then
      return jsonb_build_object(
        'error', 'con_marcas', 'fecha', dia,
        'marcas', (select count(*) from ejecucion_viajes e where e.fecha = dia));
    end if;
  end if;

  if dia_existia and not rehacer then
    return jsonb_build_object(
      'fecha', dia, 'creadas', 0, 'ya_existia', true, 'filas', ya_existia,
      'sembrado_desde', (select d.sembrado_desde from programacion_dias d
                         where d.fecha = dia));
  end if;

  origen := coalesce(
    desde,
    (select max(s.fecha_ejecutada) from servicios_historicos s
     where s.fecha_ejecutada < dia),
    (select max(s.fecha_ejecutada) from servicios_historicos s));

  if origen is null then
    return jsonb_build_object(
      'error', 'sin_historico', 'fecha', dia, 'creadas', 0);
  end if;

  -- No se borra un plan existente si el origen elegido no aporta filas
  -- válidas. Esto evita que rehacerlo deje el día vacío por accidente.
  select count(*) into filas_origen
  from servicios_historicos s
  where s.fecha_ejecutada = origen
    and s.codigo_vehiculo is not null
    and btrim(s.codigo_vehiculo) <> ''
    and s.dni is not null
    and btrim(s.dni) <> ''
    and upper(btrim(coalesce(s.incidencia, ''))) = 'A BORDO';

  if filas_origen = 0 then
    return jsonb_build_object(
      'error', 'sin_filas_historico', 'fecha', dia,
      'sembrado_desde', origen, 'creadas', 0);
  end if;

  if rehacer then
    delete from programacion_pendientes x where x.fecha = dia;
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
    and s.dni is not null
    and btrim(s.dni) <> ''
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

create or replace function public.borrar_programacion(dia date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  borradas integer;
begin
  -- El mismo candado que la siembra y la edición de ese día.
  perform pg_advisory_xact_lock(hashtext('kapital-programacion:' || dia::text));

  if not exists (select 1 from programacion_dias d where d.fecha = dia) then
    return jsonb_build_object('error', 'sin_programacion', 'fecha', dia);
  end if;
  if dia < (now() at time zone 'America/Lima')::date then
    return jsonb_build_object('error', 'dia_pasado', 'fecha', dia);
  end if;
  if exists (select 1 from ejecucion_viajes e where e.fecha = dia) then
    return jsonb_build_object(
      'error', 'con_marcas', 'fecha', dia,
      'marcas', (select count(*) from ejecucion_viajes e where e.fecha = dia));
  end if;

  delete from programacion_pendientes x where x.fecha = dia;
  delete from programacion p where p.fecha = dia;
  get diagnostics borradas = row_count;
  delete from programacion_dias d where d.fecha = dia;

  return jsonb_build_object('fecha', dia, 'borradas', borradas);
end;
$$;

revoke all on function public.sembrar_programacion(date, date, boolean) from public, anon, authenticated;
grant execute on function public.sembrar_programacion(date, date, boolean) to service_role;
revoke all on function public.borrar_programacion(date) from public, anon, authenticated;
grant execute on function public.borrar_programacion(date) to service_role;
