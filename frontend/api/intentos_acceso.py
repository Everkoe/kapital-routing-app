"""Tope de intentos de acceso, compartido entre instancias.

Por qué existe
--------------
El login y el cambio de contraseña no tenían límite: se podía probar
contraseñas contra un DNI sin freno, y muchas cuentas de conductor conservan
la provisional con que se importaron. Un contador en memoria no sirve en
Vercel —cada instancia llevaría el suyo—, así que los fallos se anotan en la
tabla `intentos_acceso` (`supabase/009_intentos_acceso.sql`).

Qué se guarda
-------------
Nada legible: `clave` es el SHA-256 del identificador en minúsculas y
`origen` el de la IP. Basta para contar, y las filas duran un día.

Qué pasa si la tabla no responde
--------------------------------
Se deja pasar. Si la base entera está caída, el login falla igual al leer la
cuenta; si solo falla esto, bloquear a todo el mundo sería peor que dejar de
frenar unos minutos. Queda escrito en el log.
"""

from __future__ import annotations

import hashlib
from typing import Any, Callable, Dict, Optional

# Por cuenta: suficiente para equivocarse de verdad, poco para adivinar.
MAX_POR_CUENTA = 10
# Por origen: frena probar muchas cuentas desde un mismo sitio. Más alto
# porque una oficina entera puede salir a internet por una sola IP.
MAX_POR_ORIGEN = 50
VENTANA_MINUTOS = 15

DEMASIADOS_INTENTOS = (
    f"Demasiados intentos fallidos. Espera {VENTANA_MINUTOS} minutos antes de volver a probar."
)


def clave_de(identificador: Any) -> str:
    return hashlib.sha256(str(identificador or "").strip().lower().encode("utf-8")).hexdigest()


def origen_de(cabeceras: Dict[str, str], ip_directa: Optional[str]) -> Optional[str]:
    """El SHA-256 de la IP del cliente, o `None` si no se sabe.

    En Vercel la conexión llega del proxy: la IP del cliente es la primera de
    `x-forwarded-for`, que el proxy de Vercel escribe (no la del cliente).
    """
    reenviada = (cabeceras.get("x-forwarded-for") or "").split(",")[0].strip()
    ip = reenviada or (cabeceras.get("x-real-ip") or "").strip() or (ip_directa or "")
    return hashlib.sha256(ip.encode("utf-8")).hexdigest() if ip else None


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
            timeout=5.0,
            json_payload=cuerpo,
        )
        if not 200 <= respuesta.status_code < 300:
            raise IntentosNoDisponibles(f"{funcion}: {respuesta.status_code}")
        return respuesta.json() if respuesta.content else None

    async def fallidos(self, clave: str, origen: Optional[str]) -> Dict[str, int]:
        cuentas = await self._rpc("intentos_fallidos", {
            "p_clave": clave, "p_origen": origen, "p_minutos": VENTANA_MINUTOS,
        })
        return {"cuenta": int(cuentas.get("cuenta", 0)), "origen": int(cuentas.get("origen", 0))}

    async def anotar(self, clave: str, origen: Optional[str]) -> None:
        await self._rpc("anotar_intento_fallido", {"p_clave": clave, "p_origen": origen})

    async def olvidar(self, clave: str) -> None:
        await self._rpc("olvidar_intentos", {"p_clave": clave})


class IntentosEnMemoria:
    """La misma interfaz, para las pruebas."""

    def __init__(self) -> None:
        self.filas: list = []

    async def fallidos(self, clave: str, origen: Optional[str]) -> Dict[str, int]:
        return {
            "cuenta": sum(1 for c, _ in self.filas if c == clave),
            "origen": sum(1 for _, o in self.filas if origen is not None and o == origen),
        }

    async def anotar(self, clave: str, origen: Optional[str]) -> None:
        self.filas.append((clave, origen))

    async def olvidar(self, clave: str) -> None:
        self.filas = [(c, o) for c, o in self.filas if c != clave]


def superado(fallidos: Dict[str, int]) -> bool:
    return fallidos["cuenta"] >= MAX_POR_CUENTA or fallidos["origen"] >= MAX_POR_ORIGEN
