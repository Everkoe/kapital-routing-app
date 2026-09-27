"""Dónde viven las sesiones: una fila por sesión en `public.sesiones`.

Por qué salieron de `app_state`
-------------------------------
Cada sesión se guardaba dos veces dentro de la fila única de `app_state`, y
abrir una obligaba a reescribir la columna `usuarios` entera. Como cada
instancia del servidor escribe su copia en memoria, dos escrituras cercanas
desde instancias distintas se pisaban y la última borraba a la otra sin error.
Con muchos usuarios entrando a la vez eso deja de ser raro. Aquí abrir,
validar y cerrar una sesión son operaciones de una fila que no compiten con
nada. El esquema está en `supabase/007_sesiones.sql`.

Qué hay en este módulo
----------------------
Solo el almacenamiento, con dos implementaciones de la misma interfaz:

- `SesionesEnTabla`: la de verdad, contra PostgREST.
- `SesionesEnMemoria`: la de las pruebas, que se comporta igual sin red.

La lógica de sesión —quién es el actor, la caché de cada instancia, qué pasa
al revocar— sigue en `index.py`, que es quien sabe de usuarios. Este módulo no
importa nada de allí: recibe cómo hacer peticiones al construirse, así no hay
importación circular y las pruebas pueden sustituirlo entero.

**El token nunca se guarda**, solo su SHA-256: quien lea la tabla no puede
entrar con lo que ve.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import quote

# Cuánto se conservan las filas después de abrirse. Una sesión caduca a las
# 12 horas, pero la fila sigue siendo el registro del acceso: de ahí salen la
# «última conexión» de Accesos y los inicios de sesión del historial.
RETENCION_ACCESOS_DIAS = 90

TABLA = "sesiones"

# Las columnas que se leen al validar. Nunca `*`: no hace falta el id ni la
# fecha de creación para decidir si una sesión vale.
COLUMNAS_VALIDACION = "usuario,instantanea,expira_en,revocada_en"

# Lo que el historial de actividad enseña de cada acceso.
CAMPOS_HISTORIAL = ("nombre", "email", "dni", "rol")
COLUMNAS_HISTORIAL = "id,usuario,creada_en," + ",".join(
    f"{campo}:instantanea->>{campo}" for campo in CAMPOS_HISTORIAL)


def hash_de_token(token: str) -> str:
    """El SHA-256 del token, que es lo único que se guarda."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso_de_epoch(segundos: int) -> str:
    return datetime.fromtimestamp(int(segundos), timezone.utc).isoformat()


def epoch_de_iso(valor: Any) -> int:
    """Segundos desde 1970 de una marca ISO, o 0 si no se entiende.

    El 0 no es un descuido: una sesión con fecha ilegible se da por caducada,
    que es el lado seguro.
    """
    if not isinstance(valor, str) or not valor:
        return 0
    # Supabase recorta los ceros finales de los microsegundos y devuelve cosas
    # como `05:15:00.35672+00:00`. `fromisoformat` solo acepta eso desde Python
    # 3.11, y la versión de Vercel no está fijada en el proyecto: con una
    # anterior, toda sesión parecería caducada y la aplicación echaría a todo
    # el mundo. Se dejan siempre seis decimales, que se leen en cualquiera.
    normal = re.sub(r"\.(\d+)", lambda m: "." + (m.group(1) + "000000")[:6],
                    valor.strip().replace("Z", "+00:00"), count=1)
    try:
        fecha = datetime.fromisoformat(normal)
    except ValueError:
        return 0
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=timezone.utc)
    return int(fecha.timestamp())


class SesionesNoDisponibles(Exception):
    """La base no respondió como debía. Quien llama decide cómo fallar."""

    def __init__(self, operacion: str, estado: Optional[int] = None):
        super().__init__(f"{operacion} devolvió {estado}")
        self.operacion = operacion
        self.estado = estado


class SesionesEnTabla:
    """Sesiones en `public.sesiones`, por PostgREST.

    `pedir` es el ayudante del backend para hablar con la base —reintentos,
    cortacircuitos y métricas incluidos— con la firma de `_db_http_request`.
    `url_base` y `cabeceras` se leen en cada llamada porque la configuración
    de almacenamiento puede cambiar en caliente (las pruebas lo hacen).
    """

    def __init__(
        self,
        pedir: Callable[..., Awaitable[Any]],
        url_base: Callable[[], str],
        cabeceras: Callable[..., Dict[str, str]],
    ):
        self._pedir = pedir
        self._url_base = url_base
        self._cabeceras = cabeceras

    def _url(self, sufijo: str) -> str:
        return f"{self._url_base().rstrip('/')}/{sufijo}"

    async def _llamar(
        self,
        metodo: str,
        sufijo: str,
        operacion: str,
        *,
        cuerpo: Optional[Any] = None,
        prefer: Optional[str] = None,
    ) -> Any:
        respuesta = await self._pedir(
            metodo,
            self._url(sufijo),
            operation=operacion,
            headers=self._cabeceras(prefer=prefer),
            timeout=10.0,
            json_payload=cuerpo,
        )
        estado = getattr(respuesta, "status_code", None)
        if not isinstance(estado, int) or not 200 <= estado < 300:
            raise SesionesNoDisponibles(operacion, estado)
        return respuesta

    @staticmethod
    def _filas(respuesta: Any) -> List[Dict[str, Any]]:
        try:
            filas = respuesta.json()
        except (TypeError, ValueError):
            return []
        return [f for f in filas if isinstance(f, dict)] if isinstance(filas, list) else []

    async def abrir(self, fila: Dict[str, Any]) -> None:
        await self._llamar("POST", TABLA, "sesion_abrir", cuerpo=fila, prefer="return=minimal")

    async def buscar(self, token_hash: str) -> Optional[Dict[str, Any]]:
        respuesta = await self._llamar(
            "GET",
            f"{TABLA}?token_hash=eq.{quote(token_hash)}&select={COLUMNAS_VALIDACION}&limit=1",
            "sesion_buscar",
        )
        filas = self._filas(respuesta)
        return filas[0] if filas else None

    async def revocar(self, token_hash: str) -> bool:
        respuesta = await self._llamar(
            "PATCH",
            f"{TABLA}?token_hash=eq.{quote(token_hash)}&revocada_en=is.null&select=token_hash",
            "sesion_revocar",
            cuerpo={"revocada_en": ahora_iso()},
            prefer="return=representation",
        )
        return bool(self._filas(respuesta))

    async def revocar_de(self, usuario: str) -> int:
        respuesta = await self._llamar(
            "PATCH",
            f"{TABLA}?usuario=eq.{quote(usuario, safe='')}&revocada_en=is.null&select=token_hash",
            "sesion_revocar_de",
            cuerpo={"revocada_en": ahora_iso()},
            prefer="return=representation",
        )
        return len(self._filas(respuesta))

    async def refrescar(self, usuario: str, instantanea: Dict[str, Any]) -> None:
        # Solo las abiertas: reescribir la instantánea de un acceso de hace un
        # mes cambiaría lo que el historial cuenta de él.
        await self._llamar(
            "PATCH",
            f"{TABLA}?usuario=eq.{quote(usuario, safe='')}&revocada_en=is.null"
            f"&expira_en=gt.{quote(ahora_iso())}",
            "sesion_refrescar",
            cuerpo={"instantanea": instantanea},
            prefer="return=minimal",
        )

    async def purgar(self, antes_de: str) -> None:
        await self._llamar(
            "DELETE",
            f"{TABLA}?creada_en=lt.{quote(antes_de)}",
            "sesion_purgar",
            prefer="return=minimal",
        )

    async def ultimos_accesos(self) -> Dict[str, str]:
        respuesta = await self._llamar("POST", "rpc/ultimos_accesos", "sesion_ultimos_accesos",
                                       cuerpo={})
        return {
            str(f.get("usuario")): str(f.get("ultimo"))
            for f in self._filas(respuesta) if f.get("usuario") and f.get("ultimo")
        }

    async def inicios_recientes(self, limite: int) -> List[Dict[str, Any]]:
        # Solo lo que el historial enseña, no la instantánea entera: se pide
        # cada vez que se abre el panel de administración.
        respuesta = await self._llamar(
            "GET",
            f"{TABLA}?select={COLUMNAS_HISTORIAL}&order=creada_en.desc&limit={int(limite)}",
            "sesion_inicios_recientes",
        )
        return self._filas(respuesta)


class SesionesEnMemoria:
    """La misma interfaz sin red, para las pruebas.

    Reproduce lo que importa de la tabla: una fila por hash, la revocación como
    marca y no como borrado, y que refrescar solo toca las sesiones abiertas.
    """

    def __init__(self) -> None:
        self.filas: Dict[str, Dict[str, Any]] = {}
        self._siguiente_id = 1

    async def abrir(self, fila: Dict[str, Any]) -> None:
        self.filas[fila["token_hash"]] = {
            "id": self._siguiente_id,
            "creada_en": ahora_iso(),
            "revocada_en": None,
            **fila,
        }
        self._siguiente_id += 1

    async def buscar(self, token_hash: str) -> Optional[Dict[str, Any]]:
        fila = self.filas.get(token_hash)
        if fila is None:
            return None
        return {c: fila.get(c) for c in COLUMNAS_VALIDACION.split(",")}

    async def revocar(self, token_hash: str) -> bool:
        fila = self.filas.get(token_hash)
        if fila is None or fila.get("revocada_en"):
            return False
        fila["revocada_en"] = ahora_iso()
        return True

    async def revocar_de(self, usuario: str) -> int:
        cerradas = 0
        for fila in self.filas.values():
            if fila.get("usuario") == usuario and not fila.get("revocada_en"):
                fila["revocada_en"] = ahora_iso()
                cerradas += 1
        return cerradas

    async def refrescar(self, usuario: str, instantanea: Dict[str, Any]) -> None:
        ahora = epoch_de_iso(ahora_iso())
        for fila in self.filas.values():
            if (fila.get("usuario") == usuario and not fila.get("revocada_en")
                    and epoch_de_iso(fila.get("expira_en")) > ahora):
                fila["instantanea"] = dict(instantanea)

    async def purgar(self, antes_de: str) -> None:
        limite = epoch_de_iso(antes_de)
        for clave in [k for k, f in self.filas.items() if epoch_de_iso(f.get("creada_en")) < limite]:
            del self.filas[clave]

    async def ultimos_accesos(self) -> Dict[str, str]:
        ultimos: Dict[str, str] = {}
        for fila in self.filas.values():
            usuario, creada = fila.get("usuario"), fila.get("creada_en")
            if usuario and creada and epoch_de_iso(creada) > epoch_de_iso(ultimos.get(usuario)):
                ultimos[usuario] = creada
        return ultimos

    async def inicios_recientes(self, limite: int) -> List[Dict[str, Any]]:
        orden = sorted(self.filas.values(), key=lambda f: epoch_de_iso(f.get("creada_en")),
                       reverse=True)
        return [{
            "id": f.get("id"), "usuario": f.get("usuario"), "creada_en": f.get("creada_en"),
            **{campo: (f.get("instantanea") or {}).get(campo) for campo in CAMPOS_HISTORIAL},
        } for f in orden[:limite]]
