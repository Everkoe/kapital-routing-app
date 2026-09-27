-- Las sesiones, fuera de la fila única de `app_state`.
--
-- Hasta aquí cada sesión vivía dos veces dentro de `app_state.usuarios`: en el
-- propio usuario (`_auth_sessions`) y en el índice `__sessions__`. Iniciar
-- sesión obligaba a reescribir la columna entera —usuarios, flota,
-- notificaciones, actividad—, y como cada instancia del servidor escribe su
-- propia copia en memoria, dos escrituras cercanas desde instancias distintas
-- se pisaban: ganaba la última y la otra se perdía sin error. Con más usuarios
-- entrando a la vez, eso pasa a diario.
--
-- Aquí cada sesión es una fila. Abrirla es un `insert` de unos cientos de
-- bytes, validarla es leer una fila por clave primaria y cerrarla es marcar
-- esa fila: ninguna de las tres toca `app_state`, así que no compiten con nada.
--
-- **Nunca se guarda el token**, solo su SHA-256, igual que antes. Quien lea la
-- tabla no puede entrar con lo que ve.
--
-- Las filas **se conservan 90 días** después de abrirse aunque caduquen a las
-- 12 horas: son el registro de accesos. De ahí salen la «última conexión» de
-- Accesos y los «Usuario inició sesión» del historial de actividad, que antes
-- se escribían en la fila única y además expulsaban del historial —limitado a
-- 500 eventos— las acciones de administración.
--
-- Aplicado el 2026-09-27 con `scripts/aplicar_sql.py`.

create table if not exists public.sesiones (
  -- Solo para dar a cada acceso un identificador estable en el historial sin
  -- enseñar el hash.
  id bigint generated always as identity unique,
  token_hash text primary key check (char_length(token_hash) = 64),
  -- La clave de la cuenta en `app_state.usuarios`.
  usuario text not null,
  -- Lo que la autorización necesita (rol, estado, correo, unidad…) para no
  -- tener que leer al usuario en cada petición, más el nombre para el
  -- historial. Se refresca cuando cambia el rol o el estado de la cuenta.
  instantanea jsonb not null default '{}'::jsonb,
  creada_en timestamptz not null default now(),
  expira_en timestamptz not null,
  revocada_en timestamptz
);

create index if not exists sesiones_usuario_idx on public.sesiones (usuario);
create index if not exists sesiones_creada_idx on public.sesiones (creada_en desc);

-- Como el resto de tablas del proyecto: RLS activada, sin políticas, y solo el
-- backend con `service_role` puede tocarla.
alter table public.sesiones enable row level security;
revoke all on table public.sesiones from public, anon, authenticated;
grant select, insert, update, delete on table public.sesiones to service_role;

-- La última vez que entró cada cuenta, para la columna de Accesos. En Postgres
-- y no en la aplicación porque sería bajar noventa días de accesos para
-- quedarse con una fecha por persona.
create or replace function public.ultimos_accesos()
returns table (usuario text, ultimo timestamptz)
language sql
stable
set search_path = public
as $$
  select s.usuario, max(s.creada_en)
  from sesiones s
  group by s.usuario;
$$;

-- Postgres concede EXECUTE a `public` por defecto: sin esto, cualquiera con la
-- clave anónima podría llamarla por /rpc.
revoke all on function public.ultimos_accesos() from public;
grant execute on function public.ultimos_accesos() to service_role;
