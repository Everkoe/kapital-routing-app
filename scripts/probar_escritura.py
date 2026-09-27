"""Prueba la escritura por diferencias del backend contra la fila real.

Por qué existe
--------------
`probar_guardar_estado.py` comprueba la función de Postgres por dentro. Esto
comprueba el camino entero del backend —cargar, calcular los cambios, mandarlos
por PostgREST— sobre la fila de verdad: permisos, caché de esquema de
PostgREST y codificación JSON incluidos, que es lo que las pruebas simuladas no
ven.

Qué hace
--------
Da de alta una cuenta de prueba (inactiva y sin contraseña: no puede entrar),
le cambia un campo, simula que otra instancia le cambia otro a la vez y la
borra. Comprueba que cada paso escribe lo que debe y que **el resto de la fila
queda idéntico**. La cuenta se borra al final pase lo que pase.

Cómo se usa
-----------
    python scripts/probar_escritura.py

Desde la raíz del repositorio, con el entorno de `frontend/`, y con la función
`guardar_estado()` ya aplicada (`supabase/008_guardar_estado.sql`).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402

CUENTA = "prueba-escritura@kapital.test"
DNI = "00000000-prueba"


async def leer_fila() -> dict:
    respuesta = await backend._db_http_request(
        "GET", backend._app_state_url(select="usuarios"),
        operation="prueba_escritura_leer", headers=backend.HEADERS, timeout=30.0,
    )
    return respuesta.json()[0]["usuarios"]


async def guardar_como_otra_instancia(cambios: dict) -> None:
    respuesta = await backend._db_http_request(
        "POST", f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/rpc/guardar_estado",
        operation="prueba_escritura_otra", headers=backend._build_supabase_headers(backend.STORAGE_CONFIG.key),
        timeout=30.0, json_payload={"p_cambios": cambios},
    )
    assert respuesta.status_code == 200, respuesta.status_code


async def main() -> int:
    if not backend._is_compat_storage():
        print("El backend no está en V2_COMPAT: esto no probaría nada.")
        return 2
    fallos = 0
    enviados: list = []
    pedir_original = backend._db_http_request

    async def pedir_y_medir(*args, **kwargs):
        if args and args[0] == "POST" and "guardar_estado" in args[1]:
            enviados.append(len(json.dumps(kwargs.get("json_payload"))))
        return await pedir_original(*args, **kwargs)

    backend._db_http_request = pedir_y_medir

    def comprobar(nombre: str, bien: bool, detalle: object = "") -> None:
        nonlocal fallos
        fallos += not bien
        print(f"{'ok   ' if bien else 'FALLO'} {nombre:34} {detalle}")

    antes = await leer_fila()
    if CUENTA in antes:
        print("La cuenta de prueba ya estaba: se borra y se empieza de nuevo.")
        await guardar_como_otra_instancia({"quitar": [{"ruta": [CUENTA]}]})
        antes = await leer_fila()
    tamano_fila = len(json.dumps(antes))
    try:
        await backend.reload_db(force=True)
        backend.usuarios_db[CUENTA] = {
            "identifier": CUENTA, "email": CUENTA, "dni": DNI, "nombre": "Prueba de escritura",
            "rol": "Conductor", "estado": "Inactivo", "perfil_conductor": {"direccion": "Uno"},
        }
        inicio = time.perf_counter()
        await backend.persist_users_only()
        fila = await leer_fila()
        comprobar("alta", fila.get(CUENTA, {}).get("dni") == DNI,
                  f"{enviados[-1]} bytes en {1000 * (time.perf_counter() - inicio):.0f} ms")
        comprobar("alias de acceso", fila["__login__"].get(DNI) == CUENTA)

        await backend.reload_db(force=True)  # otra petición, en frío
        backend.usuarios_db[CUENTA]["perfil_conductor"]["direccion"] = "Dos"
        await backend.persist_users_only()
        fila = await leer_fila()
        comprobar("un campo anidado", fila[CUENTA]["perfil_conductor"]["direccion"] == "Dos",
                  f"{enviados[-1]} bytes (la fila entera son {tamano_fila})")

        # Otra instancia cambia el nombre; esta, sin releer, cambia el estado.
        await guardar_como_otra_instancia({"poner": [{
            "ruta": [CUENTA, "nombre"], "valor": "Cambiado por otra instancia", "si_existe": [CUENTA]}]})
        backend.usuarios_db[CUENTA]["estado"] = "Rechazado"
        await backend.persist_users_only()
        fila = await leer_fila()
        comprobar("dos instancias, dos campos",
                  fila[CUENTA]["nombre"] == "Cambiado por otra instancia"
                  and fila[CUENTA]["estado"] == "Rechazado",
                  {k: fila[CUENTA][k] for k in ("nombre", "estado")})

        await backend.reload_db(force=True)
        del backend.usuarios_db[CUENTA]
        await backend.persist_users_only()
        fila = await leer_fila()
        comprobar("baja", CUENTA not in fila and DNI not in fila["__login__"])
    except Exception as fallo:  # noqa: BLE001 - se informa y se limpia igual
        comprobar("sin excepciones", False, f"{type(fallo).__name__}: {fallo}")
    finally:
        fila = await leer_fila()
        if CUENTA in fila or DNI in fila.get("__login__", {}):
            await guardar_como_otra_instancia({"quitar": [
                {"ruta": [CUENTA]}, {"ruta": ["__login__", DNI], "si_vale": CUENTA},
                {"ruta": ["__login__", CUENTA], "si_vale": CUENTA}]})
            print("limpieza: la cuenta de prueba se borró a mano")
        despues = await leer_fila()

    distintas = sorted(k for k in set(antes) | set(despues) if antes.get(k) != despues.get(k))
    comprobar("el resto de la fila, idéntico", not distintas,
              distintas and f"cambiaron {distintas} (¿actividad real mientras tanto?)")
    return 1 if fallos else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
