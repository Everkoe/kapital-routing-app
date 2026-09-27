-- 009 · Tope de intentos de acceso, y `app_state` cerrada del todo a la clave anónima.
--
-- El login y el cambio de contraseña no tenían límite: se podía probar
-- contraseñas contra un DNI sin freno, y muchas cuentas de conductor tienen
-- todavía la provisional con que se importaron. Un contador en memoria no
-- sirve en Vercel —cada instancia llevaría el suyo y el siguiente intento
-- puede caer en otra—, así que los fallos se anotan aquí.
--
-- No se guarda qué se tecleó ni desde dónde: `clave` es el SHA-256 de la clave
-- de la cuenta (o de lo tecleado, si no hay cuenta) y `origen` el de la IP. Basta para contar y no
-- dice nada a quien lea la tabla. Las filas duran un día.

create table if not exists public.intentos_acceso (
  id bigint generated always as identity primary key,
  clave text not null check (char_length(clave) = 64),
  origen text check (origen is null or char_length(origen) = 64),
  creado_en timestamptz not null default now()
);

create index if not exists intentos_acceso_clave_idx on public.intentos_acceso (clave, creado_en desc);
create index if not exists intentos_acceso_origen_idx on public.intentos_acceso (origen, creado_en desc);
create index if not exists intentos_acceso_creado_idx on public.intentos_acceso (creado_en);

alter table public.intentos_acceso enable row level security;
revoke all on table public.intentos_acceso from public, anon, authenticated;
grant select, insert, delete on table public.intentos_acceso to service_role;

-- Las funciones de la primera versión contaban y anotaban por separado: una
-- ráfaga de intentos simultáneos leía la cuenta antes de que ninguno quedara
-- anotado y pasaba entera (40 a la vez, 40 respuestas 401 y ningún 429).
drop function if exists public.intentos_fallidos(text, text, integer);
drop function if exists public.anotar_intento_fallido(text, text);

-- Anota el intento y devuelve cuántos lleva, contándolo a él, en un solo paso.
-- El candado por clave hace que dos intentos a la misma cuenta se cuenten uno
-- detrás de otro. Se anota antes de comprobar la contraseña; si acierta, el
-- backend lo borra con `olvidar_intentos`, y si falla, se queda como fallo.
--   cuenta         intentos a esa cuenta, desde donde sea
--   cuenta_origen  intentos a esa cuenta desde ese origen
--   origen         intentos desde ese origen, a cualquier cuenta
create or replace function public.registrar_intento(p_clave text, p_origen text, p_minutos integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_desde timestamptz := now() - make_interval(mins => p_minutos);
  v_cuenta integer;
  v_cuenta_origen integer;
  v_origen integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('intentos:' || p_clave, 0));
  delete from intentos_acceso where creado_en < now() - interval '1 day';
  insert into intentos_acceso (clave, origen) values (p_clave, p_origen);

  select count(*) into v_cuenta from intentos_acceso
   where clave = p_clave and creado_en > v_desde;
  select count(*) into v_cuenta_origen from intentos_acceso
   where clave = p_clave and origen is not distinct from p_origen and creado_en > v_desde;
  select count(*) into v_origen from intentos_acceso
   where p_origen is not null and origen = p_origen and creado_en > v_desde;

  return jsonb_build_object('cuenta', v_cuenta, 'cuenta_origen', v_cuenta_origen, 'origen', v_origen);
end
$$;

-- Tras entrar bien, los intentos de esa cuenta dejan de contar: equivocarse
-- tres veces y acertar no debe dejar a nadie más cerca del bloqueo. Los de
-- otras cuentas desde el mismo origen se quedan: frenan probar muchas cuentas
-- desde un mismo sitio.
create or replace function public.olvidar_intentos(p_clave text)
returns void
language sql
set search_path = public
as $$
  delete from intentos_acceso where clave = p_clave;
$$;

revoke all on function public.registrar_intento(text, text, integer) from public, anon, authenticated;
revoke all on function public.olvidar_intentos(text) from public, anon, authenticated;
grant execute on function public.registrar_intento(text, text, integer) to service_role;
grant execute on function public.olvidar_intentos(text) to service_role;

-- `app_state` tiene RLS sin políticas, así que la clave anónima no ve ninguna
-- fila; pero conservaba el permiso de leerla. Es la fila con todas las cuentas
-- y sus contraseñas cifradas: si alguien añadiera por error una política, el
-- permiso ya estaría ahí. Se quita. El backend usa `service_role`.
revoke all on table public.app_state from anon, authenticated;
