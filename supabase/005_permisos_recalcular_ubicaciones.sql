-- Cierra `recalcular_ubicaciones()` a la clave anónima.
--
-- La 004 revocó `EXECUTE` de `public` en las cuatro funciones del plan, pero
-- esta, de la 002, se quedó fuera: Postgres concede `EXECUTE` a `public` por
-- defecto y la función es `security definer`, así que cualquiera con la clave
-- anónima del proyecto podía lanzar por `/rpc/recalcular_ubicaciones` un
-- recálculo completo de los domicilios sobre las 21.000 filas del histórico.
-- No filtra datos —devuelve tres contadores— y el resultado es determinista,
-- pero es una escritura con privilegios que no debe poder disparar nadie de
-- fuera. El backend la llama con `service_role`, así que no cambia nada para
-- la aplicación.
--
-- Aplicado el 2026-09-25 con `scripts/aplicar_sql.py`.

revoke all on function public.recalcular_ubicaciones() from public;
grant execute on function public.recalcular_ubicaciones() to service_role;
