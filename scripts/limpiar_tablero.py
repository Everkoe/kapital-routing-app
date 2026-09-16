"""Vacía el tablero de rutas descartando su contenido, sin archivarlo.

Por qué existe
--------------
El tablero en producción no contiene una programación válida: contiene la
semana entera de un Excel colapsada en un solo turno. El filtro de fecha venía
vacío en la interfaz anterior, y `str.contains("")` coincide con todas las
filas, así que los cinco días entraron juntos; el `horario` que quedó guardado
—`00:00` en las 193 rutas— es el texto que había en la casilla del filtro, no
la hora de ningún pasajero.

Por qué no se usa `POST /api/clear-routes`
-------------------------------------------
Ese endpoint **archiva** el tablero en `__historial_rutas__` antes de vaciarlo.
Aquí eso sería contraproducente: convertiría en «programación histórica» algo
que nunca fue una programación, y como ambas claves viven en la misma fila
`app_state`, el snapshot de ~3,95 MB no encogería: la basura solo cambiaría de
sitio. El histórico está hoy vacío y conviene que su primer registro sea real.

`POST /api/routes` con una lista vacía descarta sin archivar, y ya está gateado
con sesión administrativa.

Cómo se usa
-----------
1. Inicia sesión en la aplicación con un rol administrativo.
2. Copia el valor de la cookie de sesión desde las herramientas del navegador
   (Application / Cookies / la cookie de sesion de Kapital).
3. Ejecuta:

       python scripts/limpiar_tablero.py --base-url http://localhost:8000 --cookie <valor>

   Añade `--si` para saltarte la confirmación interactiva.

El script muestra qué va a borrar antes de tocar nada, y verifica el resultado
releyendo el tablero.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

COOKIE_NAME = "kapital_session"


def _request(base_url: str, path: str, cookie: str, *, payload=None):
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET")
    req.add_header("Cookie", f"{COOKIE_NAME}={cookie}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read() or b"null")
    except urllib.error.HTTPError as err:
        cuerpo = err.read().decode(errors="replace")[:300]
        raise SystemExit(f"Error {err.code} en {path}: {cuerpo}") from err
    except urllib.error.URLError as err:
        raise SystemExit(f"No se pudo conectar con {url}: {err.reason}") from err


def _resumen(rutas: list) -> str:
    registros = sum(len(r.get("agentes", []) or []) for r in rutas)
    documentos = {
        str(a.get("id", "")).strip()
        for r in rutas
        for a in (r.get("agentes") or [])
        if str(a.get("id", "")).strip()
    }
    horarios = sorted({str(r.get("horario", "")).strip() for r in rutas})
    return (
        f"  rutas          : {len(rutas)}\n"
        f"  registros      : {registros}\n"
        f"  personas       : {len(documentos)}\n"
        f"  horarios       : {', '.join(horarios) or '(ninguno)'}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", required=True, help="Origen de la API, por ejemplo http://localhost:8000")
    parser.add_argument("--cookie", required=True, help="Valor de la cookie de sesión")
    parser.add_argument("--si", action="store_true", help="No pedir confirmación")
    args = parser.parse_args()

    # `GET /api/routes` no exige sesión, así que leer el tablero funcionaría
    # incluso con una cookie inválida: sin esta comprobación el usuario
    # confirmaría un borrado que después falla con 401. Se valida antes.
    identidad = _request(args.base_url, "/api/auth/me", args.cookie)
    if not isinstance(identidad, dict) or not identidad.get("rol"):
        raise SystemExit("La cookie no corresponde a una sesión válida. Vuelve a copiarla.")
    quien = identidad.get("nombre") or identidad.get("identifier") or "sin nombre"
    print(f"Sesion valida: {quien} ({identidad['rol']})\n")

    actual = _request(args.base_url, "/api/routes", args.cookie)
    if not isinstance(actual, list):
        raise SystemExit(f"Respuesta inesperada de /api/routes: {type(actual).__name__}")

    if not actual:
        print("El tablero ya está vacío. No hay nada que hacer.")
        return 0

    print("Se va a DESCARTAR el siguiente tablero, sin archivarlo:\n")
    print(_resumen(actual))
    print("\nEsta acción no es reversible desde la aplicación.")

    if not args.si:
        if input("\nEscribe 'limpiar' para continuar: ").strip().lower() != "limpiar":
            print("Cancelado. No se tocó nada.")
            return 1

    _request(args.base_url, "/api/routes", args.cookie, payload=[])

    despues = _request(args.base_url, "/api/routes", args.cookie)
    if despues:
        print(f"\nAVISO: el tablero sigue con {len(despues)} rutas. La escritura no se confirmó.")
        return 2

    print("\nTablero vacío y verificado. El histórico queda intacto para la primera programación real.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
