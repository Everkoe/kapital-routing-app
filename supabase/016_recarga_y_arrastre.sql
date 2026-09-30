-- Volver a cargar un día del histórico lo sustituye, y el plan se edita
-- arrastrando (2026-09-30).
--
-- 1. `reemplazar_dia_historico`. «Volver a cargar» un reporte hacía un upsert
--    por la clave natural (día, unidad, turno, DNI, sentido): actualizaba lo
--    que seguía en el archivo pero **no quitaba lo que ya no venía**. Si la
--    intranet corregía a alguien de unidad, quedaba en las dos, y la pantalla
--    decía «no se duplica nada». Ahora el día se borra y se vuelve a escribir
--    en una sola transacción: o queda el archivo entero o queda lo que había.
--    Es seguro borrar el día entero porque cada día sale de un solo reporte:
--    medido el 2026-09-30, los 32 días cargados tienen una única carga cada
--    uno, y el reporte de un día no trae filas de otra fecha ejecutada. Nada
--    referencia `servicios_historicos.id`, así que reescribir las filas no
--    rompe nada; el plan se copia del histórico, no lo enlaza. Desde aquí
--    `cargado_en` es el de la última carga del día, no el de la primera como
--    decía la 014: la tira de la pantalla de carga enseña cuándo se recargó.
--
-- 2. `editar_programacion`, con lo que hace falta para mover gente a mano:
--    - `a_pendientes`: saca a alguien de su servicio **sin darle de baja** y lo
--      deja en pendientes, para recolocarlo. La fila se marca retirada, como
--      hace una novedad de cambio, y no se borra: conserva en qué unidad iba.
--    - `mover` reutiliza la fila si la persona ya estuvo retirada en el
--      servicio de destino. Antes lo daba por ocupado y lo ignoraba: sacar a
--      alguien a pendientes y devolverlo después a su unidad no hacía nada.
--    - `reponer` no devuelve a alguien a un servicio si ya viaja en otro del
--      mismo turno y sentido: quedaría en dos coches a la vez.
--    El resto es la función de la 004 tal cual (comprobada idéntica a la que
--    corre en la base antes de escribir esto).

create or replace function public.reemplazar_dia_historico(p_dia date, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  borradas integer;
  insertadas integer;
begin
  if p_dia is null or p_filas is null or jsonb_typeof(p_filas) <> 'array'
     or jsonb_array_length(p_filas) = 0 then
    return jsonb_build_object('error', 'entrada_invalida', 'fecha', p_dia);
  end if;
  -- Una fila de otro día borraría este y escribiría aquel a medias.
  if exists (select 1 from jsonb_array_elements(p_filas) f
             where jsonb_typeof(f) <> 'object'
                or (f ->> 'fecha_ejecutada') is distinct from p_dia::text) then
    return jsonb_build_object('error', 'otro_dia', 'fecha', p_dia);
  end if;

  perform pg_advisory_xact_lock(hashtext('kapital-historico:' || p_dia::text));

  delete from servicios_historicos s where s.fecha_ejecutada = p_dia;
  get diagnostics borradas = row_count;

  -- `distinct on` por la clave natural: dos filas iguales en el archivo
  -- romperían el índice único y con él la carga entera.
  insert into servicios_historicos (
    fecha_ejecutada, fecha_programada, sede, modalidad, turno, cobertura,
    distrito, codigo_vehiculo, dni, hora_inicio, hora_en_punto, hora_llegada,
    incidencia, lat_inicio, lng_inicio)
  select distinct on (r.codigo_vehiculo, r.turno, r.dni, r.modalidad)
         r.fecha_ejecutada, r.fecha_programada, r.sede, r.modalidad, r.turno,
         r.cobertura, r.distrito, r.codigo_vehiculo, r.dni, r.hora_inicio,
         r.hora_en_punto, r.hora_llegada, r.incidencia, r.lat_inicio, r.lng_inicio
  from jsonb_populate_recordset(null::servicios_historicos, p_filas) r
  order by r.codigo_vehiculo, r.turno, r.dni, r.modalidad;
  get diagnostics insertadas = row_count;

  return jsonb_build_object('fecha', p_dia, 'borradas', borradas, 'insertadas', insertadas);
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
    if accion not in ('retirar', 'reponer', 'mover', 'ordenar', 'agregar', 'a_pendientes') then
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
      -- Si ya viaja en otro servicio del mismo turno y sentido, reponerlo aquí
      -- lo pondría en dos coches a la vez.
      if exists (
        select 1 from programacion p
        where p.fecha = dia and p.dni = cambio ->> 'dni'
          and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad'
          and p.codigo_vehiculo <> cambio ->> 'vehiculo'
          and p.estado = 'programado'
      ) then
        ignorados := ignorados + 1;
        continue;
      end if;
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
         -- Solo cuenta como ocupado si ya va programado ahí; una fila retirada
         -- de ese servicio se reutiliza más abajo.
         or exists (
           select 1 from programacion p
           where p.fecha = dia and p.dni = documento
             and p.codigo_vehiculo = cambio #>> '{hacia,vehiculo}'
             and p.turno = cambio #>> '{hacia,turno}'
             and p.modalidad = cambio #>> '{hacia,modalidad}'
             and p.estado = 'programado'
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
              documento, null, 'manual', 'programado')
      on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do update
        set estado = 'programado', origen = 'manual', orden = null, nota = null,
            actualizado_en = now();
      delete from programacion_pendientes x where x.fecha = dia and x.dni = documento;
      aplicados := aplicados + 1;

    elsif accion = 'a_pendientes' then
      -- Sale del servicio y queda para recolocarlo, sin baja: la fila se marca
      -- retirada, como hace una novedad de cambio, y el pendiente lleva su
      -- turno, sentido y zona, que es con lo que se le busca sitio.
      documento := nullif(btrim(cambio ->> 'dni'), '');
      insert into programacion_pendientes
        (fecha, dni, turno, modalidad, cobertura, motivo, detalle)
      select p.fecha, p.dni, p.turno, p.modalidad, p.cobertura, 'devuelto',
             'Iba en ' || p.codigo_vehiculo
      from programacion p
      where p.fecha = dia and p.dni = documento
        and p.codigo_vehiculo = cambio ->> 'vehiculo'
        and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad'
        and p.estado = 'programado'
      on conflict (fecha, dni, turno, modalidad) do update
        set cobertura = excluded.cobertura, motivo = excluded.motivo,
            detalle = excluded.detalle, creado_en = now();
      get diagnostics tocadas = row_count;
      if tocadas = 0 then
        ignorados := ignorados + 1;
        continue;
      end if;
      update programacion p
         set estado = 'retirado',
             nota = coalesce(nullif(cambio ->> 'nota', ''), 'Devuelto a pendientes'),
             actualizado_en = now()
       where p.fecha = dia and p.dni = documento
         and p.codigo_vehiculo = cambio ->> 'vehiculo'
         and p.turno = cambio ->> 'turno' and p.modalidad = cambio ->> 'modalidad'
         and p.estado = 'programado';
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


revoke all on function public.reemplazar_dia_historico(date, jsonb) from public, anon, authenticated;
revoke all on function public.editar_programacion(date, jsonb) from public, anon, authenticated;
grant execute on function public.reemplazar_dia_historico(date, jsonb) to service_role;
grant execute on function public.editar_programacion(date, jsonb) to service_role;
