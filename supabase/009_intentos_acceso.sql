-- 009 · Tope de intentos de acceso, y `app_state` cerrada del todo a la clave anónima.
--
-- El login y el cambio de contraseña no tenían límite: se podía probar
-- contraseñas contra un DNI sin freno, y muchas cuentas de conductor tienen
-- todavía la provisional con que se importaron. Un contador en memoria no
-- sirve en Vercel —cada instancia llevaría el suyo y el siguiente intento
-- puede caer en otra—, así que los fallos se anotan aquí.
--
-- No se guarda qué se tecleó ni desde dónde: `clave` es el SHA-256 del
-- identificador en minúsculas y `origen` el de la IP. Basta para contar y no
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

-- Cuántos fallos lleva una cuenta, y cuántos un origen, en los últimos minutos.
create or replace function public.intentos_fallidos(p_clave text, p_origen text, p_minutos integer)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'cuenta', (select count(*) from intentos_acceso
                where clave = p_clave
                  and creado_en > now() - make_interval(mins => p_minutos)),
    'origen', (select count(*) from intentos_acceso
                where p_origen is not null and origen = p_origen
                  and creado_en > now() - make_interval(mins => p_minutos))
  )
$$;

-- Anota un fallo y, de paso, tira lo que ya no cuenta para nada.
create or replace function public.anotar_intento_fallido(p_clave text, p_origen text)
returns void
language sql
set search_path = public
as $$
  delete from intentos_acceso where creado_en < now() - interval '1 day';
  insert into intentos_acceso (clave, origen) values (p_clave, p_origen);
$$;

-- Tras entrar bien, los fallos de esa cuenta dejan de contar: equivocarse tres
-- veces y acertar no debe dejar a nadie más cerca del bloqueo. Los del origen
-- sí se quedan: son los que frenan probar muchas cuentas desde un mismo sitio.
create or replace function public.olvidar_intentos(p_clave text)
returns void
language sql
set search_path = public
as $$
  delete from intentos_acceso where clave = p_clave;
$$;

revoke all on function public.intentos_fallidos(text, text, integer) from public, anon, authenticated;
revoke all on function public.anotar_intento_fallido(text, text) from public, anon, authenticated;
revoke all on function public.olvidar_intentos(text) from public, anon, authenticated;
grant execute on function public.intentos_fallidos(text, text, integer) to service_role;
grant execute on function public.anotar_intento_fallido(text, text) to service_role;
grant execute on function public.olvidar_intentos(text) to service_role;

-- `app_state` tiene RLS sin políticas, así que la clave anónima no ve ninguna
-- fila; pero conservaba el permiso de leerla. Es la fila con todas las cuentas
-- y sus contraseñas cifradas: si alguien añadiera por error una política, el
-- permiso ya estaría ahí. Se quita. El backend usa `service_role`.
revoke all on table public.app_state from anon, authenticated;
