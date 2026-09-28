-- La «KV-026» de la base de conductores es la «V026» de la intranet.
--
-- La base MASIVO escribe sus unidades de terceros como KV-### y la intranet de
-- Teleperformance las registra como V###. Es la misma unidad, y está medido,
-- no supuesto (2026-09-27):
--   * 29 de las 33 V### que aparecen en la intranet tienen su KV-### con el
--     mismo número en la base; la intranet no escribe nunca «KV».
--   * Lo más que llevó cada una en un servicio cabe en la capacidad que declara
--     la base, y casi siempre la iguala: las VAN de 10 llevaron 10, las SUV de
--     6 llevaron 6, las minivan de 7 llevaron 7.
--   * Las 10 KV marcadas solo «TP» aparecen todas en la intranet de TP; de las
--     10 marcadas solo «KONECTA», 9 no aparecen nunca.
-- Sin esto, 23 unidades con conductor —el 71% de los viajes a bordo— no
-- recibían su servicio, y el cliente no veía qué vehículo llevaba a su gente.
--
-- Solo cambia `_clave_normalizada`, que es donde se comparan las dos fuentes.
-- La misma regla está en `_clave_de_vehiculo` (backend) y en `fleetKey`
-- (frontend): las tres tienen que coincidir. Solo «KV» seguido de cifras: la
-- unidad de prueba «KV TEST» y las K### se quedan como estaban.

create or replace function public._clave_normalizada(p_texto text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           upper(regexp_replace(coalesce(p_texto, ''), '[^A-Za-z0-9]', '', 'g')),
           '^KV([0-9]+)$', 'V\1')
$$;

revoke all on function public._clave_normalizada(text) from public, anon, authenticated;
grant execute on function public._clave_normalizada(text) to service_role;
