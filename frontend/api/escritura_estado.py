"""Qué cambió en la fila única, para escribir solo eso.

Por qué existe
--------------
Usuarios, flota, avisos y actividad viven en una sola fila (`app_state`,
columna `usuarios`). Cada guardado la reescribía entera desde la copia en
memoria de la instancia de Vercel que atendía la petición. Esa copia puede
tener `DB_CACHE_TTL_SECONDS` de antigüedad y no hay candado entre instancias,
así que un guardado cualquiera deshacía en silencio lo que otra hubiera escrito
entretanto.

Aquí se compara lo que hay en memoria con lo que la instancia leyó de la base
—la «base», una huella JSON por clave de primer nivel— y sale la lista de
cambios, cada uno con su ruta dentro del JSON. `guardar_estado()`
(`supabase/008_guardar_estado.sql`) los aplica sobre lo que haya en la base en
ese momento, con la fila bloqueada. Lo que la instancia no tocó no viaja, y
por tanto no puede pisar nada, por vieja que sea su copia.

Reglas
------
- Una cuenta que no estaba en la base es nueva: va entera. Una que estaba se
  compara campo a campo (y un nivel más dentro de `perfil_conductor`), y cada
  campo lleva `si_existe` para que, si otra instancia la borró, no resucite a
  medias. Una que estaba y ya no está se borra.
- `__flota__` igual, por unidad y campo.
- Avisos y actividad se fusionan por `id`: dos instancias que añaden a la vez
  conservan las dos cosas.
- `__login__` no se copia de memoria —se reconstruye con las cuentas que haya
  cargadas, que pueden ser una sola—: se ponen y quitan los alias de las cuentas
  que cambiaron, sin robar el de otra.
- Una clave reservada que la instancia no leyó nunca **no se escribe**: lo que
  tiene en memoria es el valor vacío con que arranca, no un dato.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

LISTAS_POR_ID = frozenset({"__notifications__", "__actividad__"})
INDICE_LOGIN = "__login__"
# Cuenta → campo → subcampo, y flota → unidad → campo. Más adentro se escribe
# el valor entero: el coste de afinar más no compensa.
PROFUNDIDAD = 3

# Un guardado que borrara más que esto es casi seguro una copia en memoria a
# medias y no una decisión de nadie. Mejor un error que vaciar la fila.
MAX_BORRADOS = 25


class BorradoSospechoso(ValueError):
    """El cálculo pedía borrar demasiadas cuentas o unidades de una vez."""


def huella(valor: Any) -> str:
    """JSON canónico: lo mismo en memoria y en la base da siempre la misma cadena."""
    return json.dumps(valor, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)


def es_cuenta(clave: Any) -> bool:
    return not str(clave).startswith("__")


def vacio(cambios: Mapping[str, Any]) -> bool:
    return not any(cambios.get(parte) for parte in ("poner", "quitar", "listas")) and "rutas" not in cambios


def _ids_validos(lista: Any) -> bool:
    if not isinstance(lista, list):
        return False
    vistos = set()
    for elemento in lista:
        if not isinstance(elemento, dict) or elemento.get("id") is None:
            return False
        clave = huella(elemento["id"])
        if clave in vistos:
            return False
        vistos.add(clave)
    return True


def _diferencia_de_lista(clave: str, antes: Optional[list], despues: list) -> Dict[str, Any]:
    """Qué elementos poner (nuevos o cambiados) y qué ids quitar."""
    conocidos = {huella(e["id"]): huella(e) for e in antes or []}
    ids_despues = {huella(e["id"]) for e in despues}
    return {
        "clave": clave,
        "poner": [e for e in despues if conocidos.get(huella(e["id"])) != huella(e)],
        # Sin base no se sabe qué había, así que no se quita nada.
        "quitar": [e["id"] for e in antes or [] if huella(e["id"]) not in ids_despues],
    }


def _diferencia_de_objeto(ruta: List[str], antes: dict, despues: dict,
                          poner: list, quitar: list) -> None:
    for campo, valor in despues.items():
        camino = ruta + [str(campo)]
        if campo not in antes:
            poner.append({"ruta": camino, "valor": valor, "si_existe": ruta})
        elif huella(antes[campo]) != huella(valor):
            if isinstance(antes[campo], dict) and isinstance(valor, dict) and len(camino) < PROFUNDIDAD:
                _diferencia_de_objeto(camino, antes[campo], valor, poner, quitar)
            else:
                poner.append({"ruta": camino, "valor": valor, "si_existe": ruta})
    for campo in antes:
        if campo not in despues:
            quitar.append({"ruta": ruta + [str(campo)]})


def _alias_cambiados(clave: str, antes: Any, despues: Any,
                     alias_de: Callable[[str, Dict[str, Any]], List[str]],
                     poner: list, quitar: list) -> None:
    """Los alias de acceso de una cuenta que cambió, nació o se borró."""
    previos = alias_de(clave, antes) if isinstance(antes, dict) else []
    actuales = alias_de(clave, despues) if isinstance(despues, dict) else []
    for alias in actuales:
        # Todos, no solo los nuevos: así un índice al que le faltaba alguno se
        # completa solo. `si_libre` impide quitarle el alias a otra cuenta.
        poner.append({"ruta": [INDICE_LOGIN, alias], "valor": clave, "si_libre": True})
    for alias in previos:
        if alias not in actuales:
            quitar.append({"ruta": [INDICE_LOGIN, alias], "si_vale": clave})


def calcular(
    base: Mapping[str, str],
    deseado: Mapping[str, Any],
    *,
    alias_de: Callable[[str, Dict[str, Any]], List[str]],
) -> Tuple[Dict[str, Any], Dict[str, Optional[str]]]:
    """Los cambios para `guardar_estado()` y cómo queda la base si se aplican.

    La base nueva trae una huella por clave tocada, o `None` para las que se
    borraron. Solo debe aplicarse cuando la escritura haya ido bien.
    """
    poner: List[Dict[str, Any]] = []
    quitar: List[Dict[str, Any]] = []
    listas: List[Dict[str, Any]] = []
    alias_poner: List[Dict[str, Any]] = []
    alias_quitar: List[Dict[str, Any]] = []
    base_nueva: Dict[str, Optional[str]] = {}
    borradas = {"cuentas": 0, "unidades": 0}

    for clave, valor in deseado.items():
        clave = str(clave)
        if clave == INDICE_LOGIN:
            continue
        actual = huella(valor)
        conocido = base.get(clave)
        if es_cuenta(clave):
            if conocido is None:
                poner.append({"ruta": [clave], "valor": valor})
                _alias_cambiados(clave, None, valor, alias_de, alias_poner, alias_quitar)
            elif conocido != actual:
                previo = json.loads(conocido)
                if isinstance(previo, dict) and isinstance(valor, dict):
                    _diferencia_de_objeto([clave], previo, valor, poner, quitar)
                else:
                    poner.append({"ruta": [clave], "valor": valor})
                _alias_cambiados(clave, previo, valor, alias_de, alias_poner, alias_quitar)
            base_nueva[clave] = actual
            continue

        if clave in LISTAS_POR_ID and _ids_validos(valor):
            previo = json.loads(conocido) if conocido is not None else None
            if previo is None or _ids_validos(previo):
                if conocido != actual:
                    diferencia = _diferencia_de_lista(clave, previo, valor)
                    if diferencia["poner"] or diferencia["quitar"]:
                        listas.append(diferencia)
                base_nueva[clave] = actual
                continue

        if conocido is None:
            # Nunca se leyó: lo que hay en memoria es el valor de arranque.
            continue
        if conocido != actual:
            previo = json.loads(conocido)
            if isinstance(previo, dict) and isinstance(valor, dict):
                antes_de = len(quitar)
                _diferencia_de_objeto([clave], previo, valor, poner, quitar)
                if clave == "__flota__":
                    borradas["unidades"] += sum(1 for q in quitar[antes_de:] if len(q["ruta"]) == 2)
            else:
                poner.append({"ruta": [clave], "valor": valor})
        base_nueva[clave] = actual

    for clave, conocido in base.items():
        if es_cuenta(clave) and clave not in deseado:
            quitar.append({"ruta": [clave]})
            _alias_cambiados(clave, json.loads(conocido), None, alias_de, alias_poner, alias_quitar)
            base_nueva[clave] = None
            borradas["cuentas"] += 1

    for que, cuantas in borradas.items():
        if cuantas > MAX_BORRADOS:
            raise BorradoSospechoso(f"el guardado borraría {cuantas} {que}")

    cambios: Dict[str, Any] = {}
    if poner or alias_poner:
        cambios["poner"] = poner + alias_poner
    if quitar or alias_quitar:
        cambios["quitar"] = quitar + alias_quitar
    if listas:
        cambios["listas"] = listas
    return cambios, base_nueva
