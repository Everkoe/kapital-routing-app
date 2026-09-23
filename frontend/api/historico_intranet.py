"""Lectura del reporte diario de la intranet y su carga en Supabase.

Por qué es un módulo aparte
---------------------------
Lo usan dos sitios: el endpoint por el que el Programador sube el Excel cada
día, y el script de carga masiva con el que se importaron los meses anteriores.
Tener la lógica en uno solo evita que se desvíen, que es exactamente lo que le
pasó a este repositorio con las listas de documentos.

Y no vive en `api/index.py` a propósito: ese archivo ya pasa de seis mil líneas,
muy por encima del techo de ochocientas.

Qué lee
-------
El Excel de «Historial Serv. multiusuarios → Detalle» de la intranet, con la
cabecera en la tercera fila. Una fila por pasajero transportado.

Cómo resuelve el domicilio
--------------------------
No con un geocodificador: falla en el 88% de estas direcciones, porque buena
parte del padrón vive en notación de manzana y lote, que no existe en ninguna
base de calles. El punto sale de la mediana del GPS de los recojos de cada
pasajero —29 m de error mediano contra domicilios conocidos— y los umbrales de
confianza están calibrados contra esos mismos domicilios:

    dispersión < 150 m   ->  error mediano    21 m
    dispersión 150-400 m ->  error mediano   155 m
    dispersión > 400 m   ->  error mediano   553 m o más

Por debajo de tres puntos el error se dispara a 915 m sea cual sea la
dispersión. Quien no alcanza el umbral no recibe una coordenada aproximada: se
marca para revisión humana. Una ubicación inventada que no se anuncia invalida
cualquier ruteo, y nadie puede corregir lo que no ve.
"""

from __future__ import annotations

import io
import math
import re
from datetime import datetime
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

# Lima metropolitana con holgura. Fuera de esto no es un domicilio de la operación.
LIMA_LAT = (-13.2, -11.0)
LIMA_LNG = (-77.6, -76.3)

# Umbrales calibrados. Ver la cabecera del módulo.
MINIMO_PUNTOS = 3
DISPERSION_FIABLE = 150.0
DISPERSION_DUDOSA = 400.0

# Mínimo de casos para que una celda de duración describa la ruta y no dos
# servicios sueltos.
MINIMO_CASOS_DURACION = 3

# La cabecera del reporte está en la tercera fila; las dos primeras son el
# membrete de la intranet.
FILA_CABECERA = 2

COLUMNAS_MINIMAS = ("Usuario", "DNI", "Fechaejecutada", "Modalidad", "Horaprogramada")

PAR_COORD = re.compile(r"^\s*(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})\s*$")

# El mismo dato llega con dos nombres según por dónde haya pasado el archivo.
# La intranet parte las cabeceras en dos líneas («Hora de<br>inicio»); al
# exportarlas Excel a veces deja el espacio y a veces no, y basta esa
# diferencia para que una columna desaparezca sin que nada avise. Se unifican
# aquí, contra la clave sin espacios, y no en cada uso.
ALIAS_COLUMNAS = {
    "fechaprogramada": "Fechaprogramada",
    "fechaejecutada": "Fechaejecutada",
    "sede": "Sede",
    "modalidad": "Modalidad",
    "horadeinicio": "Hora de inicio",
    "horaenelpunto": "Hora en el punto",
    "horaderegistro": "Hora deregistro",
    "dni": "DNI",
    "usuario": "Usuario",
    "direccion": "Direccion",
    "referencia": "Referencia",
    "distrito": "Distrito",
    "cobertura": "Cobertura",
    "horaprogramada": "Horaprogramada",
    "codigovehiculo": "CodigoVehiculo",
    "horallegada": "Horallegada",
    "incidencia": "Incidencia",
    "latitudinicio": "Latitudinicio",
    "longitudinicio": "Longitudinicio",
}

# Las fechas del export HTML vienen como «22/09/26», día primero. Dejar que
# pandas lo adivine es jugarse el mes: «05/09/26» es una fecha válida leída al
# revés, y nada la marcaría como error.
FORMATOS_FECHA = ("%d/%m/%y", "%d/%m/%Y")

# Firma del texto UTF-8 releído como cp1252. La intranet exporta UTF-8 sin
# declarar el juego de caracteres, así que Excel lo abre como cp1252 y «Ñ»
# (bytes C3 91) queda convertido en «Ã» + U+2018.
SENAL_MOJIBAKE = "Ã"


class ReporteInvalido(ValueError):
    """El archivo no es el reporte de la intranet."""


def reparar_acentos(texto: Optional[str]) -> Optional[str]:
    """Deshace el destrozo de leer UTF-8 como si fuera cp1252.

    «PEÃ‘A» vuelve a ser «PEÑA». La conversión es reversible porque solo se
    perdió la interpretación, no los bytes: se vuelven a componer y se
    decodifican bien. Se prueba cp1252 y, para los bytes que ese juego no
    define —0x81, el de la «Á»—, latin-1, que los mapea todos.

    Si el texto no era mojibake, no se toca: cualquier fallo al recomponer
    significa justamente eso, y devolver el original es lo correcto.
    """
    if not texto or SENAL_MOJIBAKE not in texto:
        return texto
    crudo = bytearray()
    for caracter in texto:
        try:
            crudo += caracter.encode("cp1252")
        except UnicodeEncodeError:
            if ord(caracter) > 0xFF:
                return texto
            crudo.append(ord(caracter))
    try:
        return crudo.decode("utf-8")
    except UnicodeDecodeError:
        return texto


class _TablaHTML(HTMLParser):
    """La tabla del export de la intranet, en filas de texto.

    Con la librería estándar y no con `read_html`, que exige lxml o
    BeautifulSoup: el backend evita dependencias por el límite de tamaño de
    Vercel, y para una tabla sin anidar no hacen falta.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.filas: List[List[str]] = []
        self._fila: Optional[List[str]] = None
        self._celda: Optional[List[str]] = None

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "tr":
            self._fila = []
        elif tag in ("td", "th") and self._fila is not None:
            self._celda = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._celda is not None and self._fila is not None:
            self._fila.append(" ".join("".join(self._celda).split()))
            self._celda = None
        elif tag == "tr" and self._fila is not None:
            if any(self._fila):
                self.filas.append(self._fila)
            self._fila = None

    def handle_data(self, data: str) -> None:
        if self._celda is not None:
            self._celda.append(data)


def en_lima(lat: float, lng: float) -> bool:
    return LIMA_LAT[0] <= lat <= LIMA_LAT[1] and LIMA_LNG[0] <= lng <= LIMA_LNG[1]


def coordenada_declarada(valor: Any) -> Optional[Tuple[float, float]]:
    """La coordenada de casa que trae la columna «Referencia», o `None`.

    La intranet usa ese campo para dos cosas distintas: a veces una referencia
    escrita («altura del mercado»), a veces el par `lat, lng`. Solo interesa lo
    segundo, y solo si cae en Lima.
    """
    m = PAR_COORD.match(str(valor))
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    return (lat, lng) if en_lima(lat, lng) else None


def metros(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Distancia aproximada entre dos coordenadas, en metros."""
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot((b[1] - a[1]) * 111_320 * math.cos(lat),
                      (b[0] - a[0]) * 110_540)


def _texto(valor: Any) -> Optional[str]:
    """Un texto utilizable, o `None`. Pandas devuelve `nan` por todas partes."""
    if valor is None:
        return None
    limpio = str(valor).strip()
    return limpio if limpio and limpio.lower() != "nan" else None


def hora_de(valor: Any) -> Optional[str]:
    """'HH:MM:SS' a partir de lo que sea que traiga la celda.

    La columna mezcla tipos: la mayoría son `datetime.time`, pero algunas filas
    llegan como fecha completa. Pasarla a texto y cortar los primeros
    caracteres daba '1900-' en esas, y ese turno inventado habría corrompido el
    conjunto entero sin que nada lo señalara.
    """
    if valor is None or (isinstance(valor, float) and math.isnan(valor)):
        return None
    hora = getattr(valor, "hour", None)
    if hora is not None:
        return "%02d:%02d:%02d" % (hora, valor.minute, getattr(valor, "second", 0))
    texto = _texto(valor)
    if not texto or ":" not in texto:
        return None
    if " " in texto:
        texto = texto.split(" ")[-1]
    return texto[:8]


def turno_de(valor: Any) -> Optional[str]:
    """'HH:MM' del turno programado, o `None`."""
    hora = hora_de(valor)
    return hora[:5] if hora else None


def _fecha(valor: Any) -> Optional[str]:
    """La fecha en ISO, o `None`.

    `pd.isna` y no una comprobacion de flotante: una celda vacia llega como
    `NaT`, que no es un flotante y se colaba. Postgres rechazaba el lote entero
    con «invalid input syntax for type date: NaT» por una sola fila.
    """
    if valor is None or pd.isna(valor):
        return None
    try:
        return pd.to_datetime(valor).date().isoformat()
    except (ValueError, TypeError):
        return None


def dni_de(valor: Any) -> Optional[str]:
    """El documento como texto limpio.

    Pandas lee la columna como numero y «74037492» se convierte en
    «74037492.0». Ese sufijo rompe cualquier cruce con el padron de la
    aplicacion, donde el mismo documento vive sin el.

    Tambien se quitan los ceros a la izquierda, porque la intranet registra a
    la misma persona de las dos formas: «007973292» y «7973292» son la misma
    Jessica Vidal, y sin normalizar aparecia dos veces en el padron. Un DNI
    peruano tiene ocho digitos, asi que dos documentos distintos no pueden
    diferenciarse solo por ceros delante.

    Consecuencia a tener presente: el padron de la aplicacion guarda «09704190»
    con su cero. Quien cruce ambas fuentes debe normalizar los dos lados.
    """
    texto = _texto(valor)
    if not texto:
        return None
    if texto.endswith(".0"):
        texto = texto[:-2]
    return texto.lstrip("0") or texto or None


def _minutos(valor: Any) -> float:
    hora = getattr(valor, "hour", None)
    return hora * 60 + valor.minute if hora is not None else float("nan")


def bytes_de(origen: Any) -> bytes:
    """El contenido del archivo, venga como venga.

    El script pasa una ruta y el endpoint un `BytesIO`; hay que mirar los
    primeros bytes para saber qué formato es, y eso obliga a tenerlo entero.
    Se rebobina lo que se pueda rebobinar, por si alguien vuelve a leerlo.
    """
    if isinstance(origen, (bytes, bytearray)):
        return bytes(origen)
    if hasattr(origen, "read"):
        contenido = origen.read()
        if hasattr(origen, "seek"):
            origen.seek(0)
        return contenido
    with open(origen, "rb") as archivo:
        return archivo.read()


def _texto_de_html(contenido: bytes) -> str:
    """El export decodificado.

    Es UTF-8, pero el archivo **no lo declara**, y de ahí venía todo el
    problema: sin declaración Excel asume cp1252 y parte los acentos. Aquí se
    prueba UTF-8 primero, que es lo que la intranet manda de verdad.
    """
    try:
        return contenido.decode("utf-8")
    except UnicodeDecodeError:
        return contenido.decode("cp1252", errors="replace")


def tabla_html_a_frame(contenido: bytes) -> pd.DataFrame:
    """El `.xls` de la intranet, que en realidad es una tabla HTML."""
    lector = _TablaHTML()
    lector.feed(_texto_de_html(contenido))
    filas = lector.filas
    if len(filas) < 2:
        raise ReporteInvalido("El archivo no contiene ninguna tabla con datos.")

    cabecera = filas[0]
    ancho = len(cabecera)
    datos = [f for f in filas[1:] if len(f) == ancho]
    if not datos:
        raise ReporteInvalido(
            "Ninguna fila del archivo coincide con su cabecera de %d columnas." % ancho
        )
    df = pd.DataFrame(datos, columns=cabecera)
    # La celda vacía del HTML es una cadena vacía o un espacio duro, no un
    # nulo. Sin esto, `notna()` las daría todas por buenas.
    return df.replace(r"^\s*$", np.nan, regex=True)


def _normalizar_columnas(df: pd.DataFrame) -> pd.DataFrame:
    """Los nombres de columna, unificados contra `ALIAS_COLUMNAS`."""
    nombres = []
    for columna in df.columns:
        limpio = " ".join(str(columna).split())
        clave = limpio.replace(" ", "").lower()
        nombres.append(ALIAS_COLUMNAS.get(clave, limpio))
    df.columns = nombres
    return df


def _fechas_a_datetime(df: pd.DataFrame, columnas: Sequence[str]) -> None:
    """Convierte las fechas de texto del HTML, con el día por delante.

    Solo toca lo que aún es texto: por el camino del `.xlsx` ya llegan como
    fechas y volver a convertirlas sería arriesgarse a nada bueno.
    """
    for columna in columnas:
        if columna not in df.columns or pd.api.types.is_datetime64_any_dtype(df[columna]):
            continue
        serie = df[columna]
        for formato in FORMATOS_FECHA:
            convertida = pd.to_datetime(serie, format=formato, errors="coerce")
            if convertida.notna().sum() >= serie.notna().sum() * 0.9:
                df[columna] = convertida
                break
        else:
            df[columna] = pd.to_datetime(serie, dayfirst=True, errors="coerce")


def parece_novedades(columnas: Any) -> bool:
    """Si esas columnas son las del archivo de Novedades del cliente."""
    limpias = {str(c).upper().strip().rstrip(".") for c in columnas}
    return "NOVEDAD" in limpias and "DNI" in limpias


def _por_que_no_es_el_historico(contenido: bytes) -> str:
    """El motivo concreto, para quien acaba de subir el archivo equivocado.

    «Falta la hoja Consolidado» no le dice a nadie qué hacer. Si lo que ha
    subido es el otro archivo que maneja a diario, hay que nombrarlo.
    """
    try:
        primera = pd.read_excel(io.BytesIO(contenido), sheet_name=0, header=0, nrows=1)
    except Exception:  # noqa: BLE001 - solo sirve para afinar el mensaje
        primera = None
    if primera is not None and parece_novedades(primera.columns):
        return ("Esto es el archivo de Novedades del cliente, no el histórico. "
                "Súbelo en «Novedades del cliente».")
    return ("El archivo es un Excel, pero no tiene la hoja «Consolidado» del "
            "reporte. Sube el archivo tal como lo descarga la intranet, sin "
            "abrirlo ni volver a guardarlo.")


def _frame_del_archivo(contenido: bytes) -> pd.DataFrame:
    """El reporte en bruto, sea cual sea de las dos formas en que llega.

    Tal como sale de la intranet es una tabla HTML con extensión `.xls`. Mucha
    gente la abre en Excel y la vuelve a guardar como `.xlsx`; ese paso es
    justamente el que rompía los acentos, así que se admite el archivo
    original y ya no hace falta.
    """
    if contenido[:2] == b"PK":
        try:
            # El documento se lee como texto a proposito: como numero,
            # «74037492» vuelve convertido en «74037492.0».
            return pd.read_excel(io.BytesIO(contenido), sheet_name="Consolidado",
                                 header=FILA_CABECERA, dtype={"DNI": str})
        except ValueError as exc:
            raise ReporteInvalido(_por_que_no_es_el_historico(contenido)) from exc

    principio = contenido[:4096].lower()
    if b"<tr" in principio or b"<table" in principio:
        return tabla_html_a_frame(contenido)

    if contenido[:4] == b"\xd0\xcf\x11\xe0":
        raise ReporteInvalido(
            "El archivo es un Excel antiguo (.xls binario). Vuelve a descargarlo "
            "de la intranet, o guárdalo como .xlsx."
        )
    raise ReporteInvalido("El archivo no es el reporte de la intranet.")


def leer_reporte(origen: Any) -> pd.DataFrame:
    """El reporte de la intranet, con las columnas derivadas que hacen falta.

    `origen` es una ruta, un archivo abierto o los bytes, así que sirve igual
    para el script que para el archivo que llega por HTTP.
    """
    df = _normalizar_columnas(_frame_del_archivo(bytes_de(origen)))

    faltan = [c for c in COLUMNAS_MINIMAS if c not in df.columns]
    if faltan:
        if parece_novedades(df.columns):
            raise ReporteInvalido(
                "Esto es el archivo de Novedades del cliente, no el histórico. "
                "Súbelo en «Novedades del cliente»."
            )
        raise ReporteInvalido(
            "Al archivo le faltan columnas del reporte: %s." % ", ".join(faltan)
        )
    _fechas_a_datetime(df, ("Fechaejecutada", "Fechaprogramada"))

    df = df[df["Usuario"].notna()].copy()
    if df.empty:
        raise ReporteInvalido("El reporte no tiene ninguna fila con pasajero.")

    # El documento se canoniza aqui y no mas abajo: todo lo que sigue agrupa
    # por el, asi que normalizarlo solo a la salida dejaba a la misma persona
    # partida en dos filas del padron.
    df["DNI"] = df["DNI"].apply(dni_de)

    df["casa"] = df["Referencia"].apply(coordenada_declarada) if "Referencia" in df.columns else None
    df["mod"] = df["Modalidad"].astype(str).str.upper().str.strip()
    df["turno"] = df["Horaprogramada"].apply(turno_de)
    df["dia"] = pd.to_datetime(df["Fechaejecutada"], errors="coerce").dt.date
    df["la"] = pd.to_numeric(df.get("Latitudinicio"), errors="coerce")
    df["lo"] = pd.to_numeric(df.get("Longitudinicio"), errors="coerce")
    df["gps_ok"] = df["la"].between(*LIMA_LAT) & df["lo"].between(*LIMA_LNG)
    return df


def estimar_por_rastro(grupo: pd.DataFrame) -> Tuple[float, float, float, int]:
    """(lat, lng, dispersión, n) desde el GPS de los recojos del pasajero.

    La mediana y no el promedio: un solo punto disparatado —el vehículo
    arrancando desde otro sitio— desplazaría un promedio, pero no una mediana.
    """
    lat = float(grupo["la"].median())
    lng = float(grupo["lo"].median())
    if len(grupo) > 1:
        dispersion = float(np.median([metros((lat, lng), (f.la, f.lo))
                                      for f in grupo.itertuples()]))
    else:
        dispersion = float("inf")
    return lat, lng, dispersion, len(grupo)


def clasificar_rastro(dispersion: float, n: int) -> Tuple[str, str]:
    """(estado, motivo) según los umbrales calibrados."""
    if n < MINIMO_PUNTOS:
        return ("no_resuelta",
                "Solo %d recojo(s) con GPS: por debajo de %d el error mediano es de 915 m."
                % (n, MINIMO_PUNTOS))
    if dispersion < DISPERSION_FIABLE:
        return "resuelta", ""
    if dispersion < DISPERSION_DUDOSA:
        return ("dudosa",
                "El rastro se dispersa %.0f m; a esa dispersion el error mediano es de 155 m."
                % dispersion)
    return ("no_resuelta",
            "El rastro se dispersa %.0f m: demasiado para situar un domicilio." % dispersion)


def construir_padron(df: pd.DataFrame) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(con coordenada declarada, sin ella). Dos listas, y por un buen motivo.

    La ubicación deducida del rastro **no sale de aquí**. Un reporte de un solo
    día tiene uno o dos puntos GPS por pasajero, muy por debajo de los tres que
    hacen falta, así que escribirla desde el archivo degradaba ubicaciones ya
    resueltas con meses de historia: medido, una sola carga diaria bajó de 768
    domicilios buenos a 481.

    Por eso quien no trae coordenada declarada se escribe **sin las columnas de
    ubicación**: al actualizar solo las columnas presentes, lo que ya había
    sobrevive. El domicilio lo recalcula después `recalcular_ubicaciones()`
    sobre el histórico acumulado, donde cada día que pasa solo puede mejorarlo.

    Una coordenada que el propio reporte declara sí se escribe: es el dato de
    la persona, no una deducción, y manda sobre cualquier estimación.
    """
    ahora = datetime.now().astimezone().isoformat()
    declarados: List[Dict[str, Any]] = []
    deducidos: List[Dict[str, Any]] = []

    for dni, grupo in df.groupby("DNI"):
        clave = dni_de(dni)
        if not clave:
            continue
        direcciones = [str(d).strip() for d in grupo["Direccion"].dropna()
                       if str(d).strip()] if "Direccion" in grupo else []
        registro: Dict[str, Any] = {
            "dni": clave,
            "nombre": reparar_acentos(str(grupo["Usuario"].iloc[0])),
            "direccion": reparar_acentos(max(direcciones, key=len)) if direcciones else None,
            "distrito": reparar_acentos(
                _texto(grupo["Distrito"].iloc[0])) if "Distrito" in grupo else None,
            "cobertura": _texto(grupo["Cobertura"].iloc[0]) if "Cobertura" in grupo else None,
            "actualizado_en": ahora,
        }

        declaradas = [c for c in grupo["casa"] if isinstance(c, tuple)]
        if declaradas:
            registro.update(lat=declaradas[0][0], lng=declaradas[0][1],
                            estado_ubicacion="resuelta", origen_ubicacion="declarada",
                            dispersion_m=None, puntos_rastro=None, motivo=None)
            declarados.append(registro)
        else:
            deducidos.append(registro)
    return declarados, deducidos


def construir_historico(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Una fila por pasajero transportado, deduplicada por su clave natural."""
    datos = df.copy()

    # Unas pocas filas del mes repiten la clave natural: son registros
    # duplicados de la intranet, no servicios distintos. Se conserva la más
    # completa, para no perder horas ni coordenadas al deduplicar.
    columnas = [c for c in ("Hora de inicio", "Horallegada", "Latitudinicio")
                if c in datos.columns]
    datos["_completitud"] = datos[columnas].notna().sum(axis=1) if columnas else 0
    datos = (datos.sort_values("_completitud", ascending=False)
                  .drop_duplicates(subset=["dia", "CodigoVehiculo", "turno", "DNI", "mod"]))

    # Por nombre y no por posición: los nombres con espacios —«Hora de
    # inicio»— no son identificadores válidos, y recorrer por tuplas los
    # renombra por orden. Bastaba con que el Excel moviera una columna para
    # que las horas se cruzaran en silencio.
    filas = []
    for reg in datos.to_dict("records"):
        if reg.get("mod") not in ("RECOJO", "SALIDA"):
            continue
        fecha = _fecha(reg.get("Fechaejecutada"))
        turno = reg.get("turno")
        if not fecha or not turno:
            continue
        filas.append({
            "fecha_ejecutada": fecha,
            "fecha_programada": _fecha(reg.get("Fechaprogramada")),
            "sede": _texto(reg.get("Sede")),
            "modalidad": reg["mod"],
            "turno": turno,
            "cobertura": _texto(reg.get("Cobertura")),
            "distrito": reparar_acentos(_texto(reg.get("Distrito"))),
            "codigo_vehiculo": _texto(reg.get("CodigoVehiculo")),
            "dni": dni_de(reg.get("DNI")),
            "hora_inicio": hora_de(reg.get("Hora de inicio")),
            "hora_en_punto": hora_de(reg.get("Hora en el punto")),
            "hora_llegada": hora_de(reg.get("Horallegada")),
            "incidencia": reparar_acentos(_texto(reg.get("Incidencia"))),
            "lat_inicio": float(reg["la"]) if pd.notna(reg.get("la")) else None,
            "lng_inicio": float(reg["lo"]) if pd.notna(reg.get("lo")) else None,
        })
    return filas


def construir_duraciones(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """Mediana y p90 de la duración real, por ruta y en dos niveles.

    Dos niveles porque casi la mitad de las combinaciones con turno tienen
    menos de cinco casos en un mes: ahí el nivel grueso —cobertura y
    modalidad, todos los turnos— es el único con datos suficientes.

    La mediana es lo que se espera; la distancia hasta el p90 es el margen, y
    de ahí sale el riesgo que se le muestra al programador. Ninguno es una
    estimación: son los cuantiles observados.
    """
    datos = df.copy()
    datos["_ini"] = datos["Hora de inicio"].apply(_minutos) if "Hora de inicio" in datos else np.nan
    datos["_fin"] = datos["Horallegada"].apply(_minutos) if "Horallegada" in datos else np.nan

    servicio = datos.groupby(["dia", "CodigoVehiculo", "turno", "mod"]).agg(
        ini=("_ini", "min"), fin=("_fin", "max"),
        cobertura=("Cobertura", "first")).dropna(subset=["ini", "fin"])
    servicio["dur"] = servicio["fin"] - servicio["ini"]
    # Fuera de este rango no es un servicio, es un registro mal cerrado.
    servicio = servicio[(servicio["dur"] > 5) & (servicio["dur"] < 300)].reset_index()
    if servicio.empty:
        return []

    ahora = datetime.now().astimezone().isoformat()
    filas = []
    for claves, con_turno in ((["cobertura", "mod", "turno"], True),
                              (["cobertura", "mod"], False)):
        for valores, grupo in servicio.groupby(claves):
            if len(grupo) < MINIMO_CASOS_DURACION:
                continue
            cobertura = valores[0] if isinstance(valores, tuple) else valores
            if not _texto(cobertura):
                continue
            filas.append({
                "cobertura": str(cobertura),
                "modalidad": grupo["mod"].iloc[0],
                "turno": str(valores[2]) if con_turno else "",
                "n_casos": len(grupo),
                "p50_minutos": round(float(np.median(grupo["dur"])), 1),
                "p90_minutos": round(float(np.percentile(grupo["dur"], 90)), 1),
                "actualizado_en": ahora,
            })
    return filas


def resumen(pasajeros: int, historico_filas, duraciones_filas,
            ubicaciones: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """Lo que se le enseña a quien acaba de subir el archivo.

    El recuento de ubicaciones lo da `recalcular_ubicaciones()` sobre el
    histórico entero, no este archivo: enseñar aquí lo que trae un solo día
    sería informar de un retroceso que no ocurrió.
    """
    dias = sorted({f["fecha_ejecutada"] for f in historico_filas})
    ubicaciones = ubicaciones or {}
    return {
        "servicios": len(historico_filas),
        "pasajeros": pasajeros,
        "dias": len(dias),
        "desde": dias[0] if dias else None,
        "hasta": dias[-1] if dias else None,
        "ubicacion_resuelta": ubicaciones.get("resueltas", 0),
        "ubicacion_dudosa": ubicaciones.get("dudosas", 0),
        "ubicacion_pendiente": ubicaciones.get("pendientes", 0),
        "celdas_duracion": len(duraciones_filas),
    }
