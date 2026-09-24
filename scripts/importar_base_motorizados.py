"""Da de alta una base de motorizados: su unidad y su cuenta de acceso.

Qué hace
--------
Lee el Excel de una base —«BASE DE SHARF MOTORIZADO 2026.xlsx» y los que
vengan después— y por cada persona escribe dos cosas en `app_state`:

* una **unidad** en `__flota__`, con el padrón por clave, igual que las 110 que
  ya hay. Un conductor sin unidad no sirve aquí: la mesa del Programador
  resuelve la capacidad por `unidad_id`.
* un **usuario** con rol Conductor, su perfil, y una contraseña provisional
  distinta para cada uno.

Por qué no se fía de la cabecera
--------------------------------
El mismo archivo llegó tres veces en diez minutos con la cabecera distinta: la
primera con el bloque duplicado a partir de la columna 11, la segunda con las
etiquetas 11–15 descuadradas sobre datos que eran MODELO, AÑO, COLOR, GRUPO y
CORREO. Leer por posición habría metido el modelo de la moto en el campo de la
dirección sin que nada avisara. Se lee **por nombre de columna normalizado**, y
si falta alguna obligatoria se para.

Las contraseñas
---------------
Se genera una provisional por persona, se guarda **cifrada** y se marca
`needs_password_change`. Las provisionales en claro salen a un CSV local que
queda fuera del repositorio: es la única copia, y es para repartirlas. En la
base no queda ninguna contraseña legible, igual que con las 115 de la
migración anterior.

Repetible
---------
Va por padrón y por DNI: volver a pasarlo actualiza los datos de quien ya
existe en vez de duplicarlo, y **no le cambia la contraseña** a nadie que ya
haya entrado.

Cómo se usa
-----------
    python scripts/importar_base_motorizados.py "ruta\\al\\archivo.xlsx"
    python scripts/importar_base_motorizados.py "ruta\\al\\archivo.xlsx" --aplicar

Desde la raíz del repositorio, con el entorno de `frontend/`.
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402
import pandas as pd  # noqa: E402

from api import index as backend  # noqa: E402
from api.historico_intranet import dni_de, reparar_acentos  # noqa: E402

# Nombre normalizado de la columna -> campo con el que trabaja el script.
COLUMNAS = {
    "base": "base",
    "nombresyapellidos": "nombre",
    "direccion": "direccion",
    "dni": "dni",
    "fechadenacimiento": "nacimiento",
    "celular": "celular",
    "padron": "padron",
    "placa": "placa",
    "tipodevehiculo": "tipo",
    "capacidad": "capacidad",
    "marca": "marca",
    "modelo": "modelo",
    "ano": "anio",
    "color": "color",
    "grupo": "grupo",
    "correoelectronico": "correo",
}

OBLIGATORIAS = ("nombre", "dni", "padron", "placa")

DOMINIO = "kapital.com"


class BaseInvalida(ValueError):
    """El archivo no tiene la forma de una base de motorizados."""


def _clave_columna(nombre: Any) -> str:
    """El nombre de una columna, sin acentos, espacios ni mayúsculas."""
    texto = unicodedata.normalize("NFD", str(nombre or ""))
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return "".join(c for c in texto.lower() if c.isalnum())


def _texto(valor: Any) -> Optional[str]:
    if valor is None:
        return None
    limpio = reparar_acentos(str(valor).strip())
    return limpio if limpio and limpio.lower() != "nan" else None


def _grupo(valor: Any) -> Optional[str]:
    """El grupo de la unidad, tal como lo declara su base.

    En masivo es el cliente —«TP», «KONECTA» o «TP/KONECTA», porque una unidad
    puede servir a los dos—; en Remisse y en Sharf es el nombre de la propia
    base. Las tres cosas son el grupo, y se enseñan igual.

    Llegué a descartarlo cuando repetía el nombre de la base, dándolo por
    redundante. No me correspondía: quien mantiene el archivo lo escribe ahí a
    propósito, y quitarlo dejaba 56 unidades marcadas como «No consta» cuando
    su grupo estaba escrito en la columna.

    Solo se normaliza para comparar: mayúsculas y sin espacios alrededor. Los
    espacios de dentro se respetan, que «SHARF MOTORIZADO» se lee.
    """
    texto = _texto(valor)
    return " ".join(texto.upper().split()) if texto else None


def _fecha(valor: Any) -> Optional[str]:
    texto = _texto(valor)
    if not texto:
        return None
    try:
        return pd.to_datetime(texto).date().isoformat()
    except (ValueError, TypeError):
        return texto


def leer_base(ruta: str) -> List[Dict[str, Any]]:
    """Las filas del Excel, con los campos nombrados y sin las vacías."""
    crudo = pd.read_excel(ruta, sheet_name=0, header=0, dtype=str)
    mapa = {}
    for columna in crudo.columns:
        campo = COLUMNAS.get(_clave_columna(columna))
        if campo and campo not in mapa.values():
            mapa[columna] = campo
    marco = crudo.rename(columns=mapa)

    faltan = [c for c in OBLIGATORIAS if c not in marco.columns]
    if faltan:
        raise BaseInvalida(
            "Al archivo le faltan columnas: %s. Encontradas: %s."
            % (", ".join(faltan), ", ".join(str(c) for c in crudo.columns))
        )

    personas = []
    for fila in marco.to_dict("records"):
        documento = dni_de(_texto(fila.get("dni")))
        padron = _texto(fila.get("padron"))
        if not documento or not padron:
            continue
        personas.append({
            "base": _texto(fila.get("base")) or _texto(fila.get("grupo")),
            "nombre": _texto(fila.get("nombre")),
            "direccion": _texto(fila.get("direccion")),
            "dni": documento,
            "nacimiento": _fecha(fila.get("nacimiento")),
            "celular": _texto(fila.get("celular")),
            "padron": padron.upper(),
            "placa": _texto(fila.get("placa")),
            "tipo": _texto(fila.get("tipo")),
            "capacidad": _texto(fila.get("capacidad")),
            "marca": _texto(fila.get("marca")),
            "modelo": _texto(fila.get("modelo")),
            "anio": _texto(fila.get("anio")),
            "color": _texto(fila.get("color")),
            "grupo": _grupo(fila.get("grupo")),
            "correo": (_texto(fila.get("correo")) or "").lower() or None,
        })
    if not personas:
        raise BaseInvalida("El archivo no trae ninguna fila con DNI y padrón.")
    return personas


def revisar(personas: List[Dict[str, Any]]) -> List[str]:
    """Lo que está mal en el archivo y una persona tiene que mirar.

    No se corrige por cuenta propia: dos motorizados con la misma placa es un
    error de quien mantiene la base, y adivinar cuál es la buena sería peor
    que decirlo.
    """
    avisos = []
    for campo, etiqueta in (("padron", "padrón"), ("dni", "DNI"), ("placa", "placa")):
        vistos: Dict[str, List[str]] = {}
        for persona in personas:
            if persona.get(campo):
                vistos.setdefault(persona[campo], []).append(persona["padron"])
        for valor, duenos in vistos.items():
            if len(duenos) > 1:
                avisos.append("%s repetid%s «%s» en: %s"
                              % (etiqueta, "a" if campo == "placa" else "o",
                                 valor, ", ".join(duenos)))
    for persona in personas:
        if not persona.get("correo"):
            avisos.append("%s no trae correo" % persona["padron"])
        capacidad = persona.get("capacidad")
        if capacidad and not str(capacidad).isdigit():
            avisos.append("%s tiene una capacidad ilegible: %r"
                          % (persona["padron"], capacidad))
    return avisos


def _capacidad(valor: Any) -> Optional[int]:
    try:
        numero = int(str(valor).strip())
    except (TypeError, ValueError):
        return None
    return numero if numero > 0 else None


def unidad_de(persona: Dict[str, Any]) -> Dict[str, Any]:
    """La unidad tal como la guarda `__flota__`.

    Las fechas de SOAT, ATU, licencia y revisión se dejan vacías: el archivo
    no las trae y escribir una inventada haría pasar por vigente un documento
    que nadie ha visto.
    """
    return {
        "unidad_id": persona["padron"],
        "placa": persona.get("placa"),
        "chofer": persona.get("nombre"),
        "telefono": persona.get("celular"),
        "capacidad": _capacidad(persona.get("capacidad")),
        "tipo": (persona.get("tipo") or "").upper() or None,
        "marca": persona.get("marca"),
        "modelo": persona.get("modelo"),
        "ano": persona.get("anio"),
        "color": persona.get("color"),
        "base": persona.get("base"),
        "grupo": persona.get("grupo"),
        "soat": "", "atu": "", "licencia": "", "revision": "",
        "soat_doc": "", "atu_doc": "", "licencia_doc": "", "revision_doc": "",
    }


def clave_de_usuario(nombre: str, ocupadas) -> str:
    """`apellido.apellido@kapital.com`, como las 108 cuentas que ya existen."""
    partes = [p for p in (nombre or "").split() if p]
    base = ".".join(partes[:2]).lower() if partes else "conductor"
    base = unicodedata.normalize("NFD", base)
    base = "".join(c for c in base if unicodedata.category(c) != "Mn")
    base = "".join(c for c in base if c.isalnum() or c == ".") or "conductor"

    candidata = "%s@%s" % (base, DOMINIO)
    sufijo = 2
    while candidata in ocupadas:
        candidata = "%s%d@%s" % (base, sufijo, DOMINIO)
        sufijo += 1
    return candidata


def usuario_de(persona: Dict[str, Any], clave: str,
               contrasena: Optional[str] = None) -> Dict[str, Any]:
    """El usuario tal como lo guarda `app_state`.

    Sin `contrasena` devuelve solo los campos de datos, que es lo que hace
    falta para refrescar a alguien que ya tiene cuenta: construirle una
    contraseña vacía reventaba —`password_for_storage` rechaza la cadena
    vacía, y con razón— y pisársela dejaría fuera a quien ya estaba entrando.
    """
    usuario = {
        "rol": "Conductor",
        "estado": "Activo",
        "nombre": persona.get("nombre"),
        "email": persona.get("correo") or clave,
        "celular": persona.get("celular"),
        "unidad_id": persona["padron"],
        "perfil_conductor": {
            "tipoDoc": "DNI",
            "numDoc": persona["dni"],
            "correo": persona.get("correo"),
            "direccion": persona.get("direccion"),
            "telefonoDirecto": persona.get("celular"),
            "fechaNacimiento": persona.get("nacimiento"),
            "placa": persona.get("placa"),
            "vehiculoTipo": persona.get("tipo"),
            "vehiculoMarca": persona.get("marca"),
            "vehiculoModelo": persona.get("modelo"),
            "vehiculoAnio": persona.get("anio"),
            "vehiculoColor": persona.get("color"),
            "capacidadVehiculo": persona.get("capacidad"),
        },
    }
    if contrasena:
        usuario["password"] = backend.password_for_storage(contrasena)
        usuario["needs_password_change"] = True
    return usuario


def _url(recurso: str) -> str:
    return "%s/%s" % (str(backend.STORAGE_CONFIG.url).rstrip("/"), recurso)


def leer_estado() -> Dict[str, Any]:
    respuesta = httpx.get(_url("app_state"), headers=backend.HEADERS, timeout=120.0,
                          params={"select": "usuarios", "id": "eq.1"})
    respuesta.raise_for_status()
    return respuesta.json()[0]["usuarios"]


def escribir_estado(usuarios: Dict[str, Any]) -> None:
    """Reescribe la columna entera: PostgREST no sabe hacer escrituras parciales."""
    respuesta = httpx.patch(
        _url("app_state"), params={"id": "eq.1"},
        headers={**backend.HEADERS, "Content-Type": "application/json",
                 "Prefer": "return=minimal"},
        json={"usuarios": usuarios}, timeout=180.0,
    )
    if respuesta.status_code not in (200, 204):
        raise SystemExit("la escritura fue rechazada: %s %s"
                         % (respuesta.status_code, respuesta.text[:300]))


def indice_de_login(usuarios: Dict[str, Any]) -> Dict[str, str]:
    """El índice rehecho entero, con la misma regla que usa el backend.

    Sin esto nadie de la base nueva podría entrar: el login resuelve por este
    índice, no recorriendo los usuarios.
    """
    indice: Dict[str, str] = {}
    for clave, usuario in usuarios.items():
        if clave.startswith("__") or not isinstance(usuario, dict):
            continue
        for alias in backend._alias_de_login(clave, usuario):  # noqa: SLF001
            indice.setdefault(alias, clave)
    return indice


def planificar(personas, usuarios) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(altas, actualizaciones). Por padrón y por documento, para repetirse."""
    reales = {k: v for k, v in usuarios.items()
              if not k.startswith("__") and isinstance(v, dict)}
    por_dni = {}
    for clave, usuario in reales.items():
        perfil = usuario.get("perfil_conductor") or {}
        documento = dni_de(perfil.get("numDoc") or usuario.get("dni"))
        if documento:
            por_dni[documento] = clave

    ocupadas = set(reales)
    altas, actualizaciones = [], []
    for persona in personas:
        existente = por_dni.get(persona["dni"])
        if existente:
            actualizaciones.append({"persona": persona, "clave": existente})
        else:
            clave = clave_de_usuario(persona["nombre"], ocupadas)
            ocupadas.add(clave)
            altas.append({"persona": persona, "clave": clave})
    return altas, actualizaciones


def main() -> int:
    analizador = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    analizador.add_argument("archivo", help="El Excel de la base")
    analizador.add_argument("--aplicar", action="store_true",
                            help="Escribe; sin esto solo enseña qué haría")
    argumentos = analizador.parse_args()

    personas = leer_base(argumentos.archivo)
    print("%d motorizados en el archivo.\n" % len(personas))

    avisos = revisar(personas)
    if avisos:
        print("Revisar en el archivo (no se corrige solo):")
        for aviso in avisos:
            print("   - %s" % aviso)
        print()

    usuarios = leer_estado()
    flota = dict(usuarios.get("__flota__") or {})
    altas, actualizaciones = planificar(personas, usuarios)

    from collections import Counter
    grupos = Counter(p.get("grupo") or "sin grupo" for p in personas)
    print("grupos (cliente)     : %s" % dict(grupos))
    print("altas de usuario     : %d" % len(altas))
    print("cuentas ya existentes: %d" % len(actualizaciones))
    nuevas_unidades = [p["padron"] for p in personas if p["padron"] not in flota]
    print("unidades nuevas      : %d de %d" % (len(nuevas_unidades), len(personas)))
    print()
    for alta in altas[:5]:
        print("   %-7s %-34s -> %s" % (alta["persona"]["padron"],
                                       alta["persona"]["nombre"][:34], alta["clave"]))
    if len(altas) > 5:
        print("   … y %d más" % (len(altas) - 5))

    if not argumentos.aplicar:
        print("\nNada escrito. Repite con --aplicar.")
        return 0

    provisionales = []
    for alta in altas:
        contrasena = backend.contrasena_provisional()
        usuarios[alta["clave"]] = usuario_de(alta["persona"], alta["clave"], contrasena)
        provisionales.append({
            "padron": alta["persona"]["padron"],
            "nombre": alta["persona"]["nombre"],
            "dni": alta["persona"]["dni"],
            "usuario": alta["clave"],
            "contrasena_provisional": contrasena,
        })

    # A quien ya tiene cuenta se le refrescan los datos, nunca la contraseña:
    # cambiarla dejaría fuera a alguien que ya estaba entrando.
    for cambio in actualizaciones:
        usuarios[cambio["clave"]].update(
            usuario_de(cambio["persona"], cambio["clave"]))

    for persona in personas:
        flota[persona["padron"]] = {**flota.get(persona["padron"], {}),
                                    **unidad_de(persona)}
    usuarios["__flota__"] = flota
    usuarios["__login__"] = indice_de_login(usuarios)

    escribir_estado(usuarios)
    print("\nescrito: %d usuarios, %d unidades." % (len(altas), len(personas)))

    if provisionales:
        destino = os.path.join(
            RAIZ, "scratch",
            "accesos_%s_%s.csv" % (os.path.splitext(os.path.basename(argumentos.archivo))[0]
                                   .lower().replace(" ", "_"),
                                   datetime.now().strftime("%Y%m%d_%H%M")))
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino, "w", newline="", encoding="utf-8-sig") as archivo:
            escritor = csv.DictWriter(archivo, fieldnames=list(provisionales[0]))
            escritor.writeheader()
            escritor.writerows(provisionales)
        print("contrasenas provisionales en: %s" % destino)
        print("Es la unica copia: en la base quedan cifradas.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
