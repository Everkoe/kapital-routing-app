"""Tope de intentos de acceso, compartido entre instancias.

Por qué existe
--------------
El login y el cambio de contraseña no tenían límite: se podía probar
contraseñas contra un DNI sin freno, y muchas cuentas de conductor conservan
la provisional con que se importaron. Un contador en memoria no sirve en
Vercel —cada instancia llevaría el suyo—, así que los intentos se anotan en la
tabla `intentos_acceso` (`supabase/009_intentos_acceso.sql`).

Cómo cuenta
-----------
Cada intento se anota **antes** de comprobar la contraseña, y en el mismo paso
se cuenta, con un candado por cuenta en Postgres: una ráfaga de intentos
simultáneos no puede leer la cuenta antes de que ninguno quede anotado. Si la
contraseña es buena, se borran los de esa cuenta; si no, el intento se queda.

Los topes son tres, para que frenar a quien adivina no sirva para dejar fuera
a quien no:
- por cuenta **y** origen, el más bajo: diez fallos desde un sitio bloquean ese
  sitio para esa cuenta, pero la persona puede seguir entrando desde el suyo;
- por cuenta, desde donde sea, más alto: frena a quien reparte los intentos
  entre muchas IP;
- por origen, a cualquier cuenta: frena a quien prueba muchas cuentas desde un
  mismo sitio.

Qué se guarda
-------------
Nada legible: `clave` es el SHA-256 de la clave de la cuenta —o de lo tecleado,
si no hay cuenta— y `origen` el de la IP. Las filas duran un día.

Qué pasa si la tabla no responde
--------------------------------
Se deja pasar. Si la base entera está caída, el login falla igual al leer la
cuenta; si solo falla esto, bloquear a todo el mundo sería peor que dejar de
frenar unos minutos. Por eso sus peticiones son cortas, sin reintentos y sin
contar para el cortacircuitos de la base (ver `_pedir_sin_reintentos`).
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable, Dict, Optional

MAX_POR_CUENTA_Y_ORIGEN = 10
MAX_POR_CUENTA = 30
# Una oficina, o una operadora móvil que comparte IP entre muchos clientes,
# puede sacar a mucha gente por una sola dirección: por eso es el más alto.
MAX_POR_ORIGEN = 50
VENTANA_MINUTOS = 15
TIEMPO_LIMITE_S = 2.0

DEMASIADOS_INTENTOS = (
    f"Demasiados intentos fallidos. Espera {VENTANA_MINUTOS} minutos antes de volver a probar."
)


def clave_de(identificador: Any) -> str:
    return hashlib.sha256(str(identificador or "").strip().lower().encode("utf-8")).hexdigest()


def origen_de(cabeceras: Dict[str, str], ip_directa: Optional[str]) -> Optional[str]:
    """El SHA-256 de la IP del cliente, o `None` si no se sabe.

    En Vercel la conexión llega del proxy: la IP del cliente es la primera de
    `x-forwarded-for`, que el proxy de Vercel sobrescribe. Fuera de Vercel esa
    cabecera la puede poner cualquiera, y entonces el tope por origen no vale.
    """
    reenviada = (cabeceras.get("x-forwarded-for") or "").split(",")[0].strip()
    ip = reenviada or (cabeceras.get("x-real-ip") or "").strip() or (ip_directa or "")
    return hashlib.sha256(ip.encode("utf-8")).hexdigest() if ip else None


def superado(cuentas: Dict[str, int]) -> bool:
    """Las cuentas incluyen el intento que se acaba de anotar: el décimo pasa, el undécimo no."""
    return (
        cuentas.get("cuenta_origen", 0) > MAX_POR_CUENTA_Y_ORIGEN
        or cuentas.get("cuenta", 0) > MAX_POR_CUENTA
        or cuentas.get("origen", 0) > MAX_POR_ORIGEN
    )


class IntentosNoDisponibles(Exception):
    """La tabla de intentos no respondió como se esperaba."""


class IntentosEnTabla:
    """Los intentos en Postgres, por las funciones de la 009."""

    def __init__(self, pedir: Callable, url_base: Callable[[], str], cabeceras: Callable[[], Dict[str, str]]):
        self._pedir = pedir
        self._url_base = url_base
        self._cabeceras = cabeceras

    async def _rpc(self, funcion: str, cuerpo: Dict[str, Any]) -> Any:
        respuesta = await self._pedir(
            "POST",
            f"{self._url_base().rstrip('/')}/rpc/{funcion}",
            operation=f"intentos_{funcion}",
            headers=self._cabeceras(),
            timeout=TIEMPO_LIMITE_S,
            json_payload=cuerpo,
        )
        if not 200 <= respuesta.status_code < 300:
            raise IntentosNoDisponibles(f"{funcion}: {respuesta.status_code}")
        return respuesta.json() if respuesta.content else None

    async def registrar(self, clave: str, origen: Optional[str]) -> Dict[str, int]:
        cuentas = await self._rpc("registrar_intento", {
            "p_clave": clave, "p_origen": origen, "p_minutos": VENTANA_MINUTOS,
        })
        return {k: int(cuentas.get(k, 0)) for k in ("cuenta", "cuenta_origen", "origen")}

    async def olvidar(self, clave: str) -> None:
        await self._rpc("olvidar_intentos", {"p_clave": clave})


class IntentosEnMemoria:
    """La misma interfaz, para las pruebas. Anotar y contar no ceden el turno: es atómico."""

    def __init__(self) -> None:
        self.filas: list = []

    async def registrar(self, clave: str, origen: Optional[str]) -> Dict[str, int]:
        self.filas.append((clave, origen))
        return {
            "cuenta": sum(1 for c, _ in self.filas if c == clave),
            "cuenta_origen": sum(1 for c, o in self.filas if c == clave and o == origen),
            "origen": sum(1 for _, o in self.filas if origen is not None and o == origen),
        }

    async def olvidar(self, clave: str) -> None:
        self.filas = [(c, o) for c, o in self.filas if c != clave]
