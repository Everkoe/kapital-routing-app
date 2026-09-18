"""Cifra de una vez las contraseñas que siguen guardadas en texto plano.

Por qué existe
--------------
El backend ya sabe leer los dos formatos —PBKDF2 y texto plano— y, con
`KAPITAL_PASSWORD_HASH_WRITE=true`, cifra la de cada persona en su siguiente
acceso. Pero medido sobre la base real: de 115 cuentas, 103 no han iniciado
sesión nunca. Esperar al login dejaría casi toda la base en claro
indefinidamente, así que hay que hacerlo de una vez.

Qué NO hace
-----------
No cambia la contraseña de nadie. Cada persona sigue escribiendo exactamente
lo mismo; lo único que cambia es cómo se guarda. `verify_password` recalcula
el hash al entrar y compara.

Qué se pierde
-------------
La posibilidad de leer una contraseña de la base, que hoy es la única forma de
recuperar la de alguien que la olvidó: no hay ninguna acción de reinicio en
Administración y `/api/auth/change-password` exige la actual. Antes de
ejecutarlo hay que tener la copia de los accesos fuera.

Es idempotente: una contraseña ya cifrada se deja como está.

Cómo se usa
-----------
    frontend/venv/Scripts/python.exe scripts/cifrar_contrasenas.py --revisar
    frontend/venv/Scripts/python.exe scripts/cifrar_contrasenas.py --ejecutar

Desde la raíz del repositorio.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

from api import index as backend  # noqa: E402


def _cuentas():
    return {
        clave: usuario
        for clave, usuario in backend.usuarios_db.items()
        if not str(clave).startswith("__") and isinstance(usuario, dict)
    }


def _en_claro(usuario) -> bool:
    """Una contraseña que todavía no es un hash de este esquema."""
    valor = usuario.get("password")
    return isinstance(valor, str) and bool(valor) and not valor.startswith(
        f"{backend.PASSWORD_SCHEME}$"
    )


async def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    grupo = parser.add_mutually_exclusive_group(required=True)
    grupo.add_argument("--revisar", action="store_true", help="Informa sin escribir nada")
    grupo.add_argument("--ejecutar", action="store_true", help="Cifra de verdad")
    args = parser.parse_args()

    print("Cargando estado desde Supabase...")
    await backend.reload_db(force=True)

    cuentas = _cuentas()
    pendientes = {c: u for c, u in cuentas.items() if _en_claro(u)}
    sin_clave = [c for c, u in cuentas.items() if not u.get("password")]

    print(f"\n  cuentas               : {len(cuentas)}")
    print(f"  en texto plano        : {len(pendientes)}")
    print(f"  ya cifradas           : {len(cuentas) - len(pendientes) - len(sin_clave)}")
    print(f"  sin contraseña        : {len(sin_clave)}")
    for clave in sin_clave:
        print(f"     {clave[:40]}")

    if not pendientes:
        print("\nNo queda ninguna en texto plano. Nada que hacer.")
        return 0

    if args.revisar:
        print("\nModo revision: no se escribio nada.")
        return 0

    respaldo = os.path.join(RAIZ, "scratch",
                            f"contrasenas-{datetime.now():%Y%m%d-%H%M%S}.json")
    os.makedirs(os.path.dirname(respaldo), exist_ok=True)
    with open(respaldo, "w", encoding="utf-8") as f:
        json.dump({c: u.get("password") for c, u in pendientes.items()}, f,
                  ensure_ascii=False, indent=1)
    print(f"\nCopia de seguridad: {respaldo}")
    print("   Guardala fuera del repositorio y borrala cuando ya no haga falta.")

    print(f"\nCifrando {len(pendientes)} contrasenas...")
    # Se comprueba una por una que la original sigue validando contra su hash
    # antes de sustituirla: si algo saliera mal, esa cuenta se queda como está
    # en vez de quedar con un hash que no abre nada.
    cifradas, fallidas = 0, []
    for clave, usuario in pendientes.items():
        original = usuario["password"]
        try:
            resumen = backend.hash_password(original)
            if not backend.verify_password(original, resumen):
                raise ValueError("el hash no valida la original")
        except Exception as exc:  # noqa: BLE001 - se informa y se sigue
            fallidas.append((clave, type(exc).__name__))
            continue
        usuario["password"] = resumen
        cifradas += 1

    if fallidas:
        print(f"\n{len(fallidas)} no se pudieron cifrar y quedan intactas:")
        for clave, error in fallidas:
            print(f"   {clave}: {error}")

    if not cifradas:
        print("\nNo se cifro ninguna. No se persiste nada.")
        return 1

    print(f"\nPersistiendo {cifradas} contrasenas cifradas...")
    await backend.persist_users_only()

    await backend.reload_db(force=True)
    quedan = len([u for u in _cuentas().values() if _en_claro(u)])
    print(f"\n  quedan en texto plano: {quedan}")
    return 0 if not fallidas else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
