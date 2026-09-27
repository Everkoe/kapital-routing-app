-- 008 · Escribir en la fila única solo lo que cambió.
--
-- Todo el estado de usuarios, flota, avisos y actividad vive en
-- `app_state.usuarios` (fila 1). Hasta aquí cada guardado la reescribía entera
-- con un PATCH desde la copia en memoria de la instancia de Vercel que atendía
-- la petición. Esa copia puede tener 45 s y no hay candado entre instancias, así
-- que un guardado cualquiera deshacía en silencio lo que otra hubiera escrito
-- entretanto: aprobar a un conductor mientras otro subía sus documentos podía
-- perder una de las dos cosas, sin error.
--
-- `guardar_estado()` recibe solo los cambios, cada uno con su ruta dentro del
-- JSON (la cuenta y su campo, la unidad y su campo), y los aplica sobre lo que
-- hay en la base en ese momento con la fila bloqueada. Dos guardados sobre
-- cosas distintas ya no se pisan; sobre el mismo campo, gana el último, como
-- en cualquier formulario. El cálculo de los cambios está en
-- `frontend/api/escritura_estado.py`.
--
-- Forma de `p_cambios`:
--   quitar: [{ruta: [..], si_vale?: valor}]        -- borra; con `si_vale`, solo si vale eso
--   poner:  [{ruta: [..], valor, si_existe?: [..], si_libre?: bool, si_ausente?: bool}]
--           `si_existe`: solo si esa ruta sigue siendo un objeto (un campo de una
--           cuenta que otra instancia borró no la resucita a medias).
--           `si_libre`: solo si la ruta está vacía o ya vale eso (alias de acceso).
--           `si_ausente`: la ruta no puede existir ya (una cuenta nueva). Si existe
--           con otro valor, se rechaza el guardado entero con HTTP 409 (con el
--           mismo valor es un reintento de esta escritura y pasa): escribirla encima
--           sustituiría una cuenta real —con su contraseña— por lo que esta
--           instancia creyó que era nueva.
--   listas: [{clave, poner: [elementos], quitar: [ids]}]  -- avisos y actividad, por `id`
--   rutas:  valor                                   -- la columna `rutas`, entera

create or replace function public._fusionar_lista_por_id(p_actual jsonb, p_poner jsonb, p_quitar jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  -- Los que ya estaban conservan su sitio (con su versión nueva si la hay) y
  -- los nuevos van al final, en el orden en que llegan. Lo que otra instancia
  -- añadió y esta no conoce no se toca.
  with actual as (
    select e, ord
      from jsonb_array_elements(
             case when jsonb_typeof(p_actual) = 'array' then p_actual else '[]'::jsonb end
           ) with ordinality as t(e, ord)
  ),
  nuevos as (
    select e, ord
      from jsonb_array_elements(coalesce(p_poner, '[]'::jsonb)) with ordinality as t(e, ord)
  ),
  mezcla as (
    select coalesce(n.e, a.e) as e, 0 as grupo, a.ord as orden
      from actual a
      left join nuevos n on n.e -> 'id' = a.e -> 'id'
     where not (coalesce(p_quitar, '[]'::jsonb) @> jsonb_build_array(a.e -> 'id'))
    union all
    select n.e, 1, n.ord
      from nuevos n
     where not exists (select 1 from actual a where a.e -> 'id' = n.e -> 'id')
  )
  select coalesce(jsonb_agg(e order by grupo, orden), '[]'::jsonb) from mezcla
$$;

create or replace function public.guardar_estado(p_cambios jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_estado jsonb;
  v_op jsonb;
  v_ruta text[];
  v_condicion text[];
  v_actual jsonb;
  v_aplicados integer := 0;
  v_omitidos integer := 0;
  i integer;
begin
  if jsonb_typeof(p_cambios) is distinct from 'object' then
    raise exception 'guardar_estado: los cambios deben ser un objeto' using errcode = '22023';
  end if;

  -- El bloqueo es lo que hace que dos guardados a la vez se apliquen uno tras
  -- otro, cada uno sobre lo que dejó el anterior.
  select usuarios into v_estado from app_state where id = 1 for update;
  if not found then
    raise exception 'guardar_estado: falta la fila 1 de app_state' using errcode = 'P0002';
  end if;
  v_estado := coalesce(v_estado, '{}'::jsonb);

  for v_op in select value from jsonb_array_elements(coalesce(p_cambios -> 'quitar', '[]'::jsonb)) loop
    v_ruta := array(select jsonb_array_elements_text(v_op -> 'ruta'));
    if coalesce(array_length(v_ruta, 1), 0) = 0 then
      raise exception 'guardar_estado: quitar sin ruta' using errcode = '22023';
    end if;
    if v_op ? 'si_vale' and (v_estado #> v_ruta) is distinct from (v_op -> 'si_vale') then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;
    v_estado := v_estado #- v_ruta;
    v_aplicados := v_aplicados + 1;
  end loop;

  for v_op in select value from jsonb_array_elements(coalesce(p_cambios -> 'poner', '[]'::jsonb)) loop
    v_ruta := array(select jsonb_array_elements_text(v_op -> 'ruta'));
    -- Sin `valor`, jsonb_set devolvería NULL y se llevaría la fila entera.
    if coalesce(array_length(v_ruta, 1), 0) = 0 or not (v_op ? 'valor') then
      raise exception 'guardar_estado: poner sin ruta o sin valor' using errcode = '22023';
    end if;
    if v_op ? 'si_existe' then
      v_condicion := array(select jsonb_array_elements_text(v_op -> 'si_existe'));
      if jsonb_typeof(v_estado #> v_condicion) is distinct from 'object' then
        v_omitidos := v_omitidos + 1;
        continue;
      end if;
    end if;
    v_actual := v_estado #> v_ruta;
    -- Si ya vale exactamente eso, es esta misma escritura repetida (el cliente
    -- reintenta cuando se pierde la respuesta): no es un conflicto.
    if coalesce((v_op ->> 'si_ausente')::boolean, false)
       and v_actual is not null and v_actual <> 'null'::jsonb and v_actual <> (v_op -> 'valor') then
      -- PT409: PostgREST lo devuelve como HTTP 409, y la excepción deshace
      -- todo lo aplicado antes en esta misma llamada.
      raise exception 'guardar_estado: % ya existe', v_ruta[1] using errcode = 'PT409';
    end if;
    -- Un `null` de JSON cuenta como libre, igual que la ausencia.
    if coalesce((v_op ->> 'si_libre')::boolean, false)
       and v_actual is not null and v_actual <> 'null'::jsonb and v_actual <> (v_op -> 'valor') then
      v_omitidos := v_omitidos + 1;
      continue;
    end if;
    -- Contenedores que falten por el camino (la primera unidad de una flota
    -- vacía, el primer alias del índice). Solo si no existen: nunca se pisa
    -- un valor que no sea un objeto.
    for i in 1 .. array_length(v_ruta, 1) - 1 loop
      if (v_estado #> v_ruta[1:i]) is null then
        v_estado := jsonb_set(v_estado, v_ruta[1:i], '{}'::jsonb, true);
      end if;
    end loop;
    v_estado := jsonb_set(v_estado, v_ruta, v_op -> 'valor', true);
    v_aplicados := v_aplicados + 1;
  end loop;

  for v_op in select value from jsonb_array_elements(coalesce(p_cambios -> 'listas', '[]'::jsonb)) loop
    if coalesce(v_op ->> 'clave', '') = '' then
      raise exception 'guardar_estado: lista sin clave' using errcode = '22023';
    end if;
    v_estado := jsonb_set(
      v_estado,
      array[v_op ->> 'clave'],
      _fusionar_lista_por_id(v_estado -> (v_op ->> 'clave'), v_op -> 'poner', v_op -> 'quitar'),
      true
    );
    v_aplicados := v_aplicados + 1;
  end loop;

  if jsonb_typeof(v_estado) is distinct from 'object' then
    raise exception 'guardar_estado: el resultado no es un objeto' using errcode = '22023';
  end if;
  if p_cambios ? 'rutas' and jsonb_typeof(p_cambios -> 'rutas') is distinct from 'array' then
    raise exception 'guardar_estado: rutas debe ser una lista' using errcode = '22023';
  end if;

  update app_state
     set usuarios = v_estado,
         rutas = case when p_cambios ? 'rutas' then p_cambios -> 'rutas' else rutas end
   where id = 1;

  return jsonb_build_object('aplicados', v_aplicados, 'omitidos', v_omitidos);
end
$$;

-- Postgres concede EXECUTE a `public` por defecto: sin esto cualquiera con la
-- clave anónima podría llamarlas por /rest/v1/rpc/ (ver 005).
revoke all on function public._fusionar_lista_por_id(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.guardar_estado(jsonb) from public, anon, authenticated;
grant execute on function public._fusionar_lista_por_id(jsonb, jsonb, jsonb) to service_role;
grant execute on function public.guardar_estado(jsonb) to service_role;
