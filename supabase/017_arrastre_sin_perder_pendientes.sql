-- Arreglos de la revisión independiente de la 016 (2026-09-30).
--
-- 1. **Un pendiente se quita solo de la vuelta que se resuelve.** `agregar`,
--    `mover` y `reponer` borraban todos los pendientes de la persona ese día
--    (por fecha y DNI). Con `a_pendientes`, que deja pendiente una vuelta
--    suelta, eso hacía desaparecer a gente: se dejaba pendiente la SALIDA de
--    alguien, se movía después su RECOJO, y la SALIDA se borraba de pendientes
--    sin tener coche. Pasaba también con dos novedades de la misma persona.
--    Ahora `agregar` quita el pendiente que dice resolver (`pendiente`:
--    turno y sentido tal como están guardados) o, si no lo dice, los de su
--    sentido y su turno; `mover` y `reponer`, los de su sentido y turno. El
--    turno cuenta con un minuto de tolerancia (22:00 y 22:01 son el mismo,
--    como en el motor), porque medido en el histórico hay quien hace dos
--    vueltas del mismo sentido el mismo día en turnos distintos (14 de 15.626).
--
-- 2. **Cada cambio dice si se aplicó** (`resultados`, uno por cambio, en
--    orden) y un `ordenar` puede exigir que el cambio anterior se aplicara
--    (`requiere_anterior`). Un arrastre manda `mover` + `ordenar`: si el
--    `mover` se ignoraba —la vista estaba vieja—, el `ordenar` seguía
--    renumerando el destino, `aplicados` salía mayor que cero y la pantalla
--    decía «va en K027» con la persona en su coche de antes.
--
-- 3. **`agregar` tampoco pone a nadie en dos coches** del mismo turno y
--    sentido (dos pestañas asignando al mismo pendiente), igual que `reponer`
--    desde la 016, ahora los dos con la tolerancia de un minuto.
--
-- 4. Menores: una fila retirada que vuelve con `agregar` pierde la nota vieja
--    («Devuelto a pendientes»), y al reemplazar un día del histórico, entre
--    dos filas con la misma clave se queda la más completa, no una cualquiera.

-- Minutos desde medianoche de un turno 'HH:MM', o null si no lo es. `case`
-- garantiza que el texto no se convierte si no tiene la forma.
create or replace function public._minutos_del_turno(t text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when t ~ '^[0-9]{1,2}:[0-9]{2}$'
              then split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int end
$$;

-- Si dos turnos son el mismo, con un minuto de tolerancia y a través de la
-- medianoche. Igual que `mismoTurno` en `motorInsercion.js`.
create or replace function public._mismo_turno(a text, b text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    least(abs(_minutos_del_turno(a) - _minutos_del_turno(b)) % 1440,
          1440 - abs(_minutos_del_turno(a) - _minutos_del_turno(b)) % 1440) <= 1,
    a = b)
$$;


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
  -- romperían el índice único. De las repetidas se queda la más completa.
  insert into servicios_historicos (
    fecha_ejecutada, fecha_programada, sede, modalidad, turno, cobertura,
    distrito, codigo_vehiculo, dni, hora_inicio, hora_en_punto, hora_llegada,
    incidencia, lat_inicio, lng_inicio)
  select distinct on (r.codigo_vehiculo, r.turno, r.dni, r.modalidad)
         r.fecha_ejecutada, r.fecha_programada, r.sede, r.modalidad, r.turno,
         r.cobertura, r.distrito, r.codigo_vehiculo, r.dni, r.hora_inicio,
         r.hora_en_punto, r.hora_llegada, r.incidencia, r.lat_inicio, r.lng_inicio
  from jsonb_populate_recordset(null::servicios_historicos, p_filas) r
  order by r.codigo_vehiculo, r.turno, r.dni, r.modalidad,
           (r.hora_inicio is null)::int + (r.hora_en_punto is null)::int
           + (r.hora_llegada is null)::int + (r.lat_inicio is null)::int;
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
  antes integer;
  resultados jsonb := '[]'::jsonb;
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
    antes := aplicados;

    -- Cada acción sale de este bloque con `exit este` cuando no se aplica, y
    -- al final se anota cuánto tocó: así cada cambio dice si se aplicó.
    <<este>>
    begin
      -- Un `ordenar` que acompaña a un `mover` o un `agregar` no tiene sentido
      -- si aquel no entró: renumeraría el destino sin la persona.
      if coalesce((cambio ->> 'requiere_anterior')::boolean, false)
         and coalesce((resultados ->> (jsonb_array_length(resultados) - 1))::int, 0) = 0 then
        ignorados := ignorados + 1;
        exit este;
      end if;

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
        -- Si ya viaja en otro servicio del mismo turno y sentido, reponerlo
        -- aquí lo pondría en dos coches a la vez.
        if exists (
          select 1 from programacion p
          where p.fecha = dia and p.dni = cambio ->> 'dni'
            and p.modalidad = cambio ->> 'modalidad'
            and _mismo_turno(p.turno, cambio ->> 'turno')
            and p.codigo_vehiculo <> cambio ->> 'vehiculo'
            and p.estado = 'programado'
        ) then
          ignorados := ignorados + 1;
          exit este;
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
           where x.fecha = dia and x.dni = cambio ->> 'dni'
             and upper(x.modalidad) = upper(cambio ->> 'modalidad')
             and _mismo_turno(x.turno, cambio ->> 'turno');
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
           -- Solo cuenta como ocupado si ya va programado ahí; una fila
           -- retirada de ese servicio se reutiliza más abajo.
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
          exit este;
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
          exit este;
        end if;

        insert into programacion (fecha, codigo_vehiculo, turno, modalidad,
                                  cobertura, dni, orden, origen, estado)
        values (dia, cambio #>> '{hacia,vehiculo}', cambio #>> '{hacia,turno}',
                cambio #>> '{hacia,modalidad}', cambio #>> '{hacia,cobertura}',
                documento, null, 'manual', 'programado')
        on conflict (fecha, codigo_vehiculo, turno, modalidad, dni) do update
          set estado = 'programado', origen = 'manual', orden = null, nota = null,
              actualizado_en = now();
        delete from programacion_pendientes x
         where x.fecha = dia and x.dni = documento
           and upper(x.modalidad) = upper(cambio #>> '{hacia,modalidad}')
           and _mismo_turno(x.turno, cambio #>> '{hacia,turno}');
        aplicados := aplicados + 1;

      elsif accion = 'a_pendientes' then
        -- Sale del servicio y queda para recolocarlo, sin baja: la fila se
        -- marca retirada, como hace una novedad de cambio, y el pendiente
        -- lleva su turno, sentido y zona, que es con lo que se le busca sitio.
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
          exit este;
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
          exit este;
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
          exit este;
        end if;
        -- Ya va en otro coche del mismo turno y sentido: dos pestañas con el
        -- mismo pendiente lo pondrían en los dos.
        if exists (
          select 1 from programacion p
          where p.fecha = dia and p.dni = documento
            and p.modalidad = cambio ->> 'modalidad'
            and _mismo_turno(p.turno, cambio ->> 'turno')
            and p.codigo_vehiculo <> cambio ->> 'vehiculo'
            and p.estado = 'programado'
        ) then
          ignorados := ignorados + 1;
          exit este;
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
          set estado = 'programado', nota = null, actualizado_en = now()
          where programacion.estado <> 'programado';
        get diagnostics tocadas = row_count;
        -- Resuelve el pendiente que dice resolver, o los de su vuelta. Aunque
        -- la fila ya estuviera programada: así se repara un panel desfasado.
        if cambio ? 'pendiente' then
          delete from programacion_pendientes x
           where x.fecha = dia and x.dni = documento
             and x.turno = coalesce(cambio #>> '{pendiente,turno}', '')
             and upper(x.modalidad) = upper(coalesce(cambio #>> '{pendiente,modalidad}', ''));
        else
          delete from programacion_pendientes x
           where x.fecha = dia and x.dni = documento
             and upper(x.modalidad) = upper(cambio ->> 'modalidad')
             and _mismo_turno(x.turno, cambio ->> 'turno');
        end if;
        if tocadas > 0 then aplicados := aplicados + tocadas;
        else ignorados := ignorados + 1;
        end if;
      end if;
    end;

    resultados := resultados || to_jsonb(aplicados - antes);
  end loop;

  update programacion_dias d set actualizado_en = now() where d.fecha = dia;
  return jsonb_build_object(
    'fecha', dia, 'aplicados', aplicados, 'ignorados', ignorados,
    'resultados', resultados);
end;
$$;


revoke all on function public._minutos_del_turno(text) from public, anon, authenticated;
revoke all on function public._mismo_turno(text, text) from public, anon, authenticated;
revoke all on function public.reemplazar_dia_historico(date, jsonb) from public, anon, authenticated;
revoke all on function public.editar_programacion(date, jsonb) from public, anon, authenticated;
grant execute on function public._minutos_del_turno(text) to service_role;
grant execute on function public._mismo_turno(text, text) to service_role;
grant execute on function public.reemplazar_dia_historico(date, jsonb) to service_role;
grant execute on function public.editar_programacion(date, jsonb) to service_role;
