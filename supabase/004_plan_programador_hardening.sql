-- Endurecimiento incremental de 003_plan_programador.sql.
--
-- Corregido el 2026-09-26: `editar_programacion` declaraba una variable `dni`,
-- igual que la columna, y Postgres rechazaba con «column reference "dni" is
-- ambiguous» toda llamada con `agregar`, `mover` u `ordenar`. En producción
-- esas tres acciones no funcionaron nunca; retirar y reponer sí, porque no
-- usan la variable. Las pruebas del backend simulan la base y no podían verlo:
-- `scripts/probar_funciones_plan.py` las ejecuta de verdad y deshace después.
-- La variable se llama ahora `documento`, como en `aplicar_novedades`.
--
-- 003 ya está aplicado en V2. Este archivo solo reemplaza las funciones: no
-- vuelve a crear tablas ni borra datos. Las mutaciones mantienen como fuente
-- de verdad las tablas del plan y devuelven errores estructurados que el API
-- convierte en HTTP 4xx.

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
  ignorados integer := 0;
  tocadas integer;
  i integer;
  documentos jsonb;
  documento text;
  origen text;
begin
  perform pg_advisory_xact_lock(hashtext('kapital-programacion:' || dia::text));

  if not exists (select 1 from programacion_dias d where d.fecha = dia) then
    return jsonb_build_object('error', 'sin_programacion', 'fecha', dia);
  end if;
  if cambios is null or jsonb_typeof(cambios) <> 'array' then
    return jsonb_build_object('error', 'entrada_invalida', 'fecha', dia);
  end if;

  -- Validar toda la tanda antes de tocar filas. Un error de acción no puede
  -- dejar aplicados solo los cambios que venían antes en el JSON.
  for cambio in select value from jsonb_array_elements(cambios)
  loop
    if jsonb_typeof(cambio) <> 'object' then
      return jsonb_build_object('error', 'entrada_invalida', 'fecha', dia);
    end if;
    accion := cambio ->> 'accion';
    if accion not in ('retirar', 'reponer', 'mover', 'ordenar', 'agregar') then
      return jsonb_build_object('error', 'accion_desconocida', 'fecha', dia);
    end if;
  end loop;

  for cambio in select value from jsonb_array_elements(cambios)
  loop
    accion := cambio ->> 'accion';

    if accion = 'retirar' then
      update programacion p
         set estado = 'retirado', nota = cambio ->> 'nota', actualizado_en = now()
       where p.fecha = dia and p.dni = cambio ->> 'dni'
         and p.codigo_vehiculo = cambio ->> 'vehiculo'
         and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad'
         and p.estado = 'programado';
      get diagnostics tocadas = row_count;
      if tocadas > 0 then aplicados := aplicados + tocadas;
      else ignorados := ignorados + 1;
      end if;

    elsif accion = 'reponer' then
      update programacion p
         set estado = 'programado', nota = null, actualizado_en = now()
       where p.fecha = dia and p.dni = cambio ->> 'dni'
         and p.codigo_vehiculo = cambio ->> 'vehiculo'
         and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad'
         and p.estado = 'retirado';
      get diagnostics tocadas = row_count;
      if tocadas > 0 then
        delete from programacion_pendientes x
         where x.fecha = dia and x.dni = cambio ->> 'dni';
        aplicados := aplicados + tocadas;
      else ignorados := ignorados + 1;
      end if;

    elsif accion = 'mover' then
      documento := nullif(btrim(cambio ->> 'dni'), '');
      if documento is null
         or nullif(btrim(cambio #>> '{desde,vehiculo}'), '') is null
         or nullif(btrim(cambio #>> '{desde,turno}'), '') is null
         or nullif(btrim(cambio #>> '{desde,modalidad}'), '') is null
         or nullif(btrim(cambio #>> '{hacia,vehiculo}'), '') is null
         or nullif(btrim(cambio #>> '{hacia,turno}'), '') is null
         or nullif(btrim(cambio #>> '{hacia,modalidad}'), '') is null
         or exists (
           select 1 from programacion p
           where p.fecha = dia and p.dni = documento
             and p.codigo_vehiculo = cambio #>> '{hacia,vehiculo}'
             and p.turno = cambio #>> '{hacia,turno}'
             and p.modalidad = cambio #>> '{hacia,modalidad}'
         )
         or not exists (
           select 1 from programacion p
           where p.fecha = dia and p.dni = documento
             and p.codigo_vehiculo = cambio #>> '{desde,vehiculo}'
             and p.turno = cambio #>> '{desde,turno}'
             and p.modalidad = cambio #>> '{desde,modalidad}'
             and p.estado = 'programado'
         ) then
        ignorados := ignorados + 1;
        continue;
      end if;

      delete from programacion p
       where p.fecha = dia and p.dni = documento
         and p.codigo_vehiculo = cambio #>> '{desde,vehiculo}'
         and p.turno = cambio #>> '{desde,turno}'
         and p.modalidad = cambio #>> '{desde,modalidad}'
         and p.estado = 'programado';
      get diagnostics tocadas = row_count;
      if tocadas = 0 then
        ignorados := ignorados + 1;
        continue;
      end if;

      insert into programacion (fecha, codigo_vehiculo, turno, modalidad,
                                cobertura, dni, orden, origen, estado)
      values (dia, cambio #>> '{hacia,vehiculo}', cambio #>> '{hacia,turno}',
              cambio #>> '{hacia,modalidad}', cambio #>> '{hacia,cobertura}',
              documento, null, 'manual', 'programado');
      delete from programacion_pendientes x where x.fecha = dia and x.dni = documento;
      aplicados := aplicados + 1;

    elsif accion = 'ordenar' then
      documentos := cambio -> 'dnis';
      if documentos is null or jsonb_typeof(documentos) <> 'array'
         or jsonb_array_length(documentos) = 0 then
        ignorados := ignorados + 1;
        continue;
      end if;
      for i in 0 .. jsonb_array_length(documentos) - 1
      loop
        documento := nullif(btrim(documentos ->> i), '');
        if documento is null then
          ignorados := ignorados + 1;
          continue;
        end if;
        update programacion p
           set orden = i + 1, actualizado_en = now()
         where p.fecha = dia and p.dni = documento
           and p.codigo_vehiculo = cambio ->> 'vehiculo'
           and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad'
           and p.estado = 'programado'
           and p.orden is distinct from i + 1;
        get diagnostics tocadas = row_count;
        if tocadas > 0 then aplicados := aplicados + tocadas;
        else ignorados := ignorados + 1;
        end if;
      end loop;

    elsif accion = 'agregar' then
      documento := nullif(btrim(cambio ->> 'dni'), '');
      origen := coalesce(nullif(cambio ->> 'origen', ''), 'manual');
      if documento is null
         or nullif(btrim(cambio ->> 'vehiculo'), '') is null
         or nullif(btrim(cambio ->> 'turno'), '') is null
         or nullif(btrim(cambio ->> 'modalidad'), '') is null
         or origen not in ('manual', 'historico', 'novedad') then
        ignorados := ignorados + 1;
        continue;
      end if;

      insert into programacion (fecha, codigo_vehiculo, turno, modalidad,
                                cobertura, dni, orden, origen, estado)
      values (dia, cambio ->> 'vehiculo', cambio ->> 'turno',
              cambio ->> 'modalidad', cambio ->> 'cobertura', documento,
              (select coalesce(max(p.orden), 0) + 1 from programacion p
                where p.fecha = dia and p.codigo_vehiculo = cambio ->> 'vehiculo'
                  and p.turno = cambio ->> 'turno'
                  and p.modalidad = cambio ->> 'modalidad'),
              origen, 'programado')
      on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do update
        set estado = 'programado', actualizado_en = now()
        where programacion.estado <> 'programado';
      get diagnostics tocadas = row_count;
      -- Una asignación manual resuelve cualquier pendiente del mismo DNI en
      -- ese día, incluso si la fila ya estaba programada y solo se reparó el
      -- panel en una segunda llamada.
      delete from programacion_pendientes x where x.fecha = dia and x.dni = documento;
      if tocadas > 0 then aplicados := aplicados + tocadas;
      else ignorados := ignorados + 1;
      end if;
    end if;
  end loop;

  update programacion_dias d set actualizado_en = now() where d.fecha = dia;
  return jsonb_build_object(
    'fecha', dia, 'aplicados', aplicados, 'ignorados', ignorados);
end;
$$;


create or replace function public.aplicar_novedades(dia date, entradas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e jsonb;
  documento text;
  viaja text;
  clasificacion text;
  tocadas integer;
  borradas integer;
  retiradas integer := 0;
  movidas integer := 0;
  pendientes integer := 0;
  sin_cambio integer := 0;
  pendiente_existe boolean;
  pendiente_cambio boolean;
begin
  perform pg_advisory_xact_lock(hashtext('kapital-programacion:' || dia::text));

  if not exists (select 1 from programacion_dias d where d.fecha = dia) then
    return jsonb_build_object('error', 'sin_programacion', 'fecha', dia);
  end if;
  if entradas is null or jsonb_typeof(entradas) <> 'array' then
    return jsonb_build_object('error', 'entrada_invalida', 'fecha', dia);
  end if;

  -- Validación completa antes de las mutaciones para que una entrada inválida
  -- no deje aplicadas solo las novedades anteriores del mismo archivo.
  for e in select value from jsonb_array_elements(entradas)
  loop
    if jsonb_typeof(e) <> 'object' then
      return jsonb_build_object('error', 'entrada_invalida', 'fecha', dia);
    end if;
    documento := nullif(btrim(e ->> 'dni'), '');
    viaja := lower(btrim(coalesce(e ->> 'viaja', '')));
    if documento is null or viaja not in ('true', 'false', '1', '0', 'si', 'sí', 'no') then
      return jsonb_build_object('error', 'entrada_invalida', 'fecha', dia);
    end if;
  end loop;

  for e in select value from jsonb_array_elements(entradas)
  loop
    documento := nullif(btrim(e ->> 'dni'), '');
    viaja := lower(btrim(coalesce(e ->> 'viaja', '')));
    clasificacion := lower(btrim(coalesce(e ->> 'clasificacion', '')));

    if viaja in ('false', '0', 'no') then
      update programacion p
         set estado = 'retirado',
             nota = coalesce(nullif(e ->> 'etiqueta', ''), 'Baja del cliente'),
             actualizado_en = now()
       where p.fecha = dia and p.dni = documento and p.estado = 'programado';
      get diagnostics tocadas = row_count;
      delete from programacion_pendientes x
       where x.fecha = dia and x.dni = documento;
      get diagnostics borradas = row_count;
      if tocadas > 0 then retiradas := retiradas + tocadas;
      elsif borradas = 0 then sin_cambio := sin_cambio + 1;
      end if;

    elsif clasificacion in ('alta', 'cambio') then
      update programacion p
         set estado = 'retirado',
             nota = coalesce(nullif(e ->> 'resumen_cambios', ''),
                             nullif(e ->> 'etiqueta', ''),
                             'Cambio del cliente'),
             actualizado_en = now()
       where p.fecha = dia and p.dni = documento and p.estado = 'programado';
      get diagnostics tocadas = row_count;
      movidas := movidas + tocadas;

      select exists (
               select 1 from programacion_pendientes x
               where x.fecha = dia and x.dni = documento
                 and x.turno = coalesce(e ->> 'turno', '')
                 and x.modalidad = coalesce(e ->> 'sentido', '')
             ),
             exists (
               select 1 from programacion_pendientes x
               where x.fecha = dia and x.dni = documento
                 and x.turno = coalesce(e ->> 'turno', '')
                 and x.modalidad = coalesce(e ->> 'sentido', '')
                 and (x.cobertura is distinct from (e ->> 'cobertura')
                      or x.motivo is distinct from (e ->> 'clasificacion')
                      or x.detalle is distinct from nullif(e ->> 'resumen_cambios', ''))
             )
        into pendiente_existe, pendiente_cambio;

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

      if not pendiente_existe or pendiente_cambio then
        pendientes := pendientes + 1;
      elsif tocadas = 0 then
        sin_cambio := sin_cambio + 1;
      end if;

    else
      sin_cambio := sin_cambio + 1;
    end if;
  end loop;

  update programacion_dias d set actualizado_en = now() where d.fecha = dia;

  return jsonb_build_object(
    'fecha', dia, 'retiradas', retiradas, 'movidas', movidas,
    'pendientes', pendientes, 'sin_cambio', sin_cambio);
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
