-- Kapital Routing App: OLD app_state compatibility surface for V2.
--
-- This table is deliberately separate from the normalized app/* tables.  The
-- private importer may restore exactly one legacy snapshot row here during a
-- staged cutover; it must never write or delete normalized data.

begin;

set local search_path = pg_catalog, public, extensions, auth;
set local standard_conforming_strings = on;

create table if not exists public.app_state (
  id integer primary key,
  usuarios jsonb not null default '{}'::jsonb,
  rutas jsonb not null default '[]'::jsonb,
  source_sha256 text,
  source_size_bytes bigint,
  usuarios_size_bytes bigint,
  rutas_size_bytes bigint,
  source_user_count integer,
  source_route_count integer,
  restored_at timestamptz
);

alter table public.app_state
  add column if not exists source_sha256 text,
  add column if not exists source_size_bytes bigint,
  add column if not exists usuarios_size_bytes bigint,
  add column if not exists rutas_size_bytes bigint,
  add column if not exists source_user_count integer,
  add column if not exists source_route_count integer,
  add column if not exists restored_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and contype = 'p'
  ) then
    alter table public.app_state add constraint app_state_pkey primary key (id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and conname = 'app_state_id_singleton_chk'
  ) then
    alter table public.app_state
      add constraint app_state_id_singleton_chk check (id = 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and conname = 'app_state_usuarios_object_chk'
  ) then
    alter table public.app_state
      add constraint app_state_usuarios_object_chk
      check (usuarios is not null and jsonb_typeof(usuarios) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and conname = 'app_state_rutas_array_chk'
  ) then
    alter table public.app_state
      add constraint app_state_rutas_array_chk
      check (rutas is not null and jsonb_typeof(rutas) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and conname = 'app_state_source_sha256_chk'
  ) then
    alter table public.app_state
      add constraint app_state_source_sha256_chk
      check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and conname = 'app_state_source_sizes_chk'
  ) then
    alter table public.app_state
      add constraint app_state_source_sizes_chk
      check (
        (source_size_bytes is null or source_size_bytes >= 0)
        and (usuarios_size_bytes is null or usuarios_size_bytes >= 0)
        and (rutas_size_bytes is null or rutas_size_bytes >= 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.app_state'::regclass
      and conname = 'app_state_source_counts_chk'
  ) then
    alter table public.app_state
      add constraint app_state_source_counts_chk
      check (
        (source_user_count is null or source_user_count >= 0)
        and (source_route_count is null or source_route_count >= 0)
      );
  end if;
end;
$$;

-- The browser and ordinary JWT roles must not read this compatibility row.
-- The backend's server-side service_role is the sole application grant.
revoke all privileges on table public.app_state from public, anon, authenticated;
grant select, insert, update, delete on table public.app_state to service_role;

alter table public.app_state enable row level security;
alter table public.app_state force row level security;

-- No policies are created: service_role bypasses RLS, while revoked browser
-- roles have no Data API privilege or policy path to the legacy snapshot.

commit;
