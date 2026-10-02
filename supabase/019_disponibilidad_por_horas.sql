-- La disponibilidad va por horas, no por turnos exactos (2026-10-02).
--
-- Con la 018 aplicada, los turnos que salían del histórico eran 49 distintos:
-- 22:00 y 22:01, 00:30 y 00:40, y muchos que casi nunca se usan (12:50, 21:35,
-- 00:05…). El usuario piensa en horas —«de 12, 1, 2, 3, 4, 5», «solo el de las
-- 3»—, así que cada botón es una hora y la regla `'03:00'` vale para cualquier
-- turno de 03:00 a 03:59.
--
-- Solo cambia cómo se compara un turno del plan con los de la regla
-- (`_misma_hora` en lugar de `_mismo_turno`). Las tablas y el resto de
-- funciones de la 018 siguen igual. La misma comparación está en
-- `api/disponibilidad.py` y en `model/disponibilidad.js`.

create or replace function public._misma_hora(a text, b text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case when a ~ '^[0-9]{1,2}:[0-9]{2}$' and b ~ '^[0-9]{1,2}:[0-9]{2}$'
              then split_part(a, ':', 1)::int = split_part(b, ':', 1)::int
              else false end
$$;


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
                        where _misma_hora(p.turno, t))
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


revoke all on function public._misma_hora(text, text) from public, anon, authenticated;
revoke all on function public.retirar_no_disponibles(date) from public, anon, authenticated;
grant execute on function public._misma_hora(text, text) to service_role;
grant execute on function public.retirar_no_disponibles(date) to service_role;
