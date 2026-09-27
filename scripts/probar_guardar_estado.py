"""Ejecuta `guardar_estado()` de verdad contra la fila única, y deshace.

Por qué existe
--------------
Las pruebas del backend simulan PostgREST: comprueban qué cambios calcula el
API, no que Postgres los aplique bien. Un fallo aquí no daría error: dejaría
la fila con un campo de menos o una cuenta a medias, y es la fila de todos los
usuarios. Esto recorre cada tipo de cambio sobre la fila real.

Cómo no deja rastro
-------------------
Todo va dentro de un único bloque `do` que termina lanzando una excepción a
propósito, lo que deshace la transacción entera. Las comprobaciones viajan en
esa excepción; si llega otra, es el error de verdad. Usa una cuenta y un alias
inventados, que no existen en la fila.

Cómo se usa
-----------
    python scripts/probar_guardar_estado.py

Desde la raíz del repositorio, con el entorno de `frontend/`. Necesita
`SUPABASE_ACCESS_TOKEN`, como `aplicar_sql.py`.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import aplicar_sql  # noqa: E402

SENAL = "PRUEBA_TERMINADA"

BLOQUE = r"""
do $prueba$
declare
  cuenta constant text := '__prueba_guardar__@kapital.test';
  alias constant text := '__prueba_alias__';
  antes jsonb;
  despues jsonb;
  rutas_antes jsonb;
  primero jsonb;
  res jsonb := '{}'::jsonb;
  r jsonb;
  fallo text;
begin
  select usuarios, rutas into antes, rutas_antes from app_state where id = 1;
  if antes ? cuenta then
    raise exception 'OMITIDA: la cuenta de prueba ya existe en la fila';
  end if;

  -- Cuenta nueva, entera.
  r := guardar_estado(jsonb_build_object('poner', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array(cuenta),
    'valor', jsonb_build_object('nombre', 'Prueba', 'estado', 'Pendiente', 'rol', 'Conductor')))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object('cuenta_nueva', despues -> cuenta ->> 'estado' = 'Pendiente');

  -- Un campo de una cuenta que existe, y quitar otro.
  r := guardar_estado(jsonb_build_object(
    'poner', jsonb_build_array(jsonb_build_object(
      'ruta', jsonb_build_array(cuenta, 'estado'), 'valor', 'Activo',
      'si_existe', jsonb_build_array(cuenta))),
    'quitar', jsonb_build_array(jsonb_build_object('ruta', jsonb_build_array(cuenta, 'nombre')))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object(
    'campo', despues -> cuenta ->> 'estado' = 'Activo' and despues -> cuenta ->> 'rol' = 'Conductor',
    'quitar_campo', not (despues -> cuenta ? 'nombre'));

  -- Un campo de una cuenta que ya no existe: no la resucita a medias.
  r := guardar_estado(jsonb_build_object('poner', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array(cuenta || '.borrada', 'estado'), 'valor', 'Activo',
    'si_existe', jsonb_build_array(cuenta || '.borrada')))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object(
    'sin_resucitar', not (despues ? (cuenta || '.borrada')) and (r ->> 'omitidos')::int = 1);

  -- Alias de acceso: se pone si está libre, no se roba, y solo se quita si es suyo.
  r := guardar_estado(jsonb_build_object('poner', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array('__login__', alias), 'valor', cuenta, 'si_libre', true))));
  r := guardar_estado(jsonb_build_object('poner', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array('__login__', alias), 'valor', 'otra-cuenta', 'si_libre', true))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object('alias_no_se_roba', despues -> '__login__' ->> alias = cuenta);
  r := guardar_estado(jsonb_build_object('quitar', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array('__login__', alias), 'si_vale', 'otra-cuenta'))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object('alias_ajeno_se_queda', despues -> '__login__' ->> alias = cuenta);
  r := guardar_estado(jsonb_build_object('quitar', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array('__login__', alias), 'si_vale', cuenta))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object('alias_propio_se_quita', not (despues -> '__login__' ? alias));

  -- Avisos: el nuevo va al final, el cambiado conserva su sitio, el quitado se va.
  primero := antes -> '__notifications__' -> 0;
  r := guardar_estado(jsonb_build_object('listas', jsonb_build_array(jsonb_build_object(
    'clave', '__notifications__',
    'poner', jsonb_build_array(
      primero || jsonb_build_object('prueba', true),
      jsonb_build_object('id', 'prueba-nuevo', 'message', 'prueba')),
    'quitar', '[]'::jsonb))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object(
    'lista_crece', jsonb_array_length(despues -> '__notifications__')
                   = jsonb_array_length(antes -> '__notifications__') + 1,
    'lista_nuevo_al_final', despues -> '__notifications__' -> -1 ->> 'id' = 'prueba-nuevo',
    'lista_cambio_en_su_sitio', (despues -> '__notifications__' -> 0 ->> 'prueba')::boolean
                                and despues -> '__notifications__' -> 0 -> 'id' = primero -> 'id');
  r := guardar_estado(jsonb_build_object('listas', jsonb_build_array(jsonb_build_object(
    'clave', '__notifications__', 'poner', '[]'::jsonb,
    'quitar', jsonb_build_array('prueba-nuevo')))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object('lista_quitar', jsonb_array_length(despues -> '__notifications__')
                                                   = jsonb_array_length(antes -> '__notifications__'));

  -- Un cambio mal formado se rechaza entero, sin tocar la fila.
  begin
    r := guardar_estado(jsonb_build_object('poner', jsonb_build_array(jsonb_build_object(
      'ruta', jsonb_build_array(cuenta)))));
    fallo := 'no';
  exception when others then
    fallo := 'si';
  end;
  res := res || jsonb_build_object('sin_valor_se_rechaza', fallo = 'si');

  -- Borrar la cuenta de prueba, y que todo lo demás siga igual que al empezar.
  r := guardar_estado(jsonb_build_object('quitar', jsonb_build_array(jsonb_build_object(
    'ruta', jsonb_build_array(cuenta)))));
  select usuarios into despues from app_state where id = 1;
  res := res || jsonb_build_object(
    'resto_intacto', (despues - '__notifications__') = (antes - '__notifications__'),
    'flota_intacta', despues -> '__flota__' = antes -> '__flota__',
    'rutas_intactas', (select rutas from app_state where id = 1) is not distinct from rutas_antes);

  -- Quien no es el backend no puede llamarla.
  res := res || jsonb_build_object(
    'cerrada_a_anon', not has_function_privilege('anon', 'public.guardar_estado(jsonb)', 'execute')
                      and not has_function_privilege('authenticated', 'public.guardar_estado(jsonb)', 'execute')
                      and not has_function_privilege('anon', 'public._fusionar_lista_por_id(jsonb,jsonb,jsonb)', 'execute'));

  raise exception '% %', '""" + SENAL + r"""', res;
end $prueba$;
"""


def main() -> int:
    try:
        aplicar_sql.ejecutar(BLOQUE)
    except SystemExit as salida:
        mensaje = str(salida)
    else:
        print("El bloque terminó sin su excepción: algo lo cambió y no se sabe qué quedó.")
        return 2

    if "OMITIDA" in mensaje:
        print(re.search(r"OMITIDA[^\\\"]*", mensaje).group(0))
        return 0
    if SENAL not in mensaje:
        limpio = mensaje.replace('\\"', '"').replace("\\n", " ")
        error = re.search(r"ERROR:.*?(?=QUERY:|CONTEXT:|$)", limpio)
        print("FALLO en Postgres:", (error.group(0) if error else limpio)[:500].strip())
        return 1

    resultados = json.loads(re.search(SENAL + r" (\{.*?\})", mensaje.replace('\\"', '"')).group(1))
    fallos = 0
    for nombre, bien in resultados.items():
        fallos += bien is not True
        print(f"{'ok   ' if bien is True else 'FALLO'} {nombre}")
    print("Todo deshecho: la base queda como estaba.")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(main())
