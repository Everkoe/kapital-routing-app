-- Qué días del histórico están cargados, sin bajar sus filas.
--
-- La pantalla de carga del Programador no sabía si el reporte del día ya se
-- había subido: enseñaba la zona para subir siempre igual, y volver a subir
-- el mismo archivo no avisaba (no duplica nada, pero rehace el trabajo y
-- confunde). Con esto dice «al día» o «falta el del domingo», pinta los
-- últimos días y, al subir, para antes de escribir si el día ya estaba.
--
-- Contar en la aplicación costaría bajar ~500 filas por día; esto devuelve
-- unos bytes por día. `cargado_en` es el de la primera carga: una recarga
-- actualiza los servicios pero no esa columna.

create or replace function public.dias_cargados(p_desde date, p_hasta date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'fecha', d.fecha_ejecutada,
           'servicios', d.n,
           'cargado_en', d.ultimo) order by d.fecha_ejecutada desc), '[]'::jsonb)
  from (select s.fecha_ejecutada, count(*) as n, max(s.cargado_en) as ultimo
        from servicios_historicos s
        where s.fecha_ejecutada between p_desde and p_hasta
        group by s.fecha_ejecutada) d
$$;

revoke all on function public.dias_cargados(date, date) from public, anon, authenticated;
grant execute on function public.dias_cargados(date, date) to service_role;
