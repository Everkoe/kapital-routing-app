"""Entrena el modelo de duración de los servicios y lo deja listo para el backend.

Qué hace
--------
Pide a la base una fila por servicio ejecutado (`muestras_de_duracion()`, sin
DNI ni coordenadas), entrena con CatBoost tres modelos —la duración esperada y
los cuantiles 10 y 90— y los exporta a código Python puro en
`frontend/api/modelo_duracion/`, que es lo que lee el backend
(`api/estimador_duracion.py`). CatBoost no va a Vercel: pesa 97 MB y el
modelo exportado no lo necesita.

Cómo se sabe que sirve
----------------------
Antes de escribir nada se mide, con el mismo procedimiento, sobre la última
semana cargada, que el modelo no ve: entrena con lo anterior a las dos últimas
semanas, calibra la banda con la penúltima y compara con la última contra la
tabla de medianas que usa hoy la aplicación (`duraciones_base`). Esas cifras
van al modelo (`META["prueba"]`) y son las que enseña la pantalla: el acierto
de la banda y el error medio no se prometen, se miden. Medido el 2026-09-29
con agosto y el 22 de septiembre: en RECOJO el error medio bajó de 20,5 a
17,2 minutos y la banda acertó el 80%; en SALIDA casi empata con la tabla
(19,2 frente a 18,2).
Más de dos semanas de historial ya no mejoran el error: lo que queda son
esperas y tráfico del día, que el reporte de la intranet no registra.

El modelo final entrena con todo salvo la última semana, que calibra su banda.

Cómo se usa
-----------
    python scripts/entrenar_duracion.py --revisar     # mide y no escribe
    python scripts/entrenar_duracion.py --escribir    # además exporta el modelo

Desde la raíz del repositorio, con el entorno de `frontend/` y CatBoost
instalado (`pip install -r scripts/requirements-modelo.txt`). Volver a
entrenar tras cargar más histórico es repetir `--escribir` y desplegar.
"""

from __future__ import annotations

import argparse
import math
import os
import pprint
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date
from typing import Any, Dict, List, Sequence, Tuple

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "frontend"))

import httpx  # noqa: E402

from api import estimador_duracion as est  # noqa: E402
from api import index as backend  # noqa: E402

DESTINO = os.path.join(RAIZ, "frontend", "api", "modelo_duracion")

# 500 árboles de profundidad 4: 1,1 MB por modelo exportado y el mismo error
# que 1.500 de profundidad 6 (4,9 MB), medido sobre la misma semana.
PARAMETROS = {"iterations": 500, "learning_rate": 0.08, "depth": 4, "random_seed": 7}
PERDIDAS = {"p50": "MAE", "p10": "Quantile:alpha=0.1", "p90": "Quantile:alpha=0.9"}
DIAS_CALIBRACION = 7
DIAS_PRUEBA = 7
BANDA = 0.8
# El mismo mínimo que `construir_duraciones`, para comparar con la tabla real.
MINIMO_CASOS_TABLA = 3

Filas = List[Dict[str, Any]]


def bajar_muestras() -> List[Dict[str, Any]]:
    url = f"{str(backend.STORAGE_CONFIG.url).rstrip('/')}/rpc/muestras_de_duracion"
    cuerpo = {"p_desde": "2000-01-01", "p_hasta": date.today().isoformat()}
    respuesta = httpx.post(url, headers=backend.HEADERS, json=cuerpo, timeout=120)
    respuesta.raise_for_status()
    return respuesta.json()


def partir_por_dias(filas: Filas, dias_al_final: int) -> Tuple[Filas, Filas]:
    """Lo anterior y los últimos `dias_al_final` días con datos (no de calendario)."""
    dias = sorted({f["fecha"] for f in filas})
    if len(dias) <= dias_al_final:
        raise SystemExit(f"Hacen falta más de {dias_al_final} días de histórico; hay {len(dias)}.")
    corte = dias[-dias_al_final]
    return [f for f in filas if f["fecha"] < corte], [f for f in filas if f["fecha"] >= corte]


def _pool(filas: Filas, con_duracion: bool = True):
    from catboost import Pool
    datos = [list(f["textos"]) + list(f["numeros"]) for f in filas]
    etiquetas = [f["duracion"] for f in filas] if con_duracion else None
    return Pool(datos, etiquetas, cat_features=list(range(len(est.CATEGORICAS))))


def entrenar(filas: Filas) -> Dict[str, Any]:
    from catboost import CatBoostRegressor
    modelos = {}
    for nombre, perdida in PERDIDAS.items():
        modelo = CatBoostRegressor(loss_function=perdida, verbose=False,
                                   allow_writing_files=False, **PARAMETROS)
        modelo.fit(_pool(filas))
        modelos[nombre] = modelo
    return modelos


def predecir(modelos: Dict[str, Any], filas: Filas) -> Dict[str, List[float]]:
    pool = _pool(filas, con_duracion=False)
    # Como `float` de Python: un `np.float64` acabaría escrito tal cual en
    # `meta.py`, que no importa numpy.
    return {nombre: [float(v) for v in modelo.predict(pool)] for nombre, modelo in modelos.items()}


def ensanche(modelos: Dict[str, Any], calibracion: Filas) -> Dict[str, float]:
    """Cuánto ensanchar la banda de cada sentido para que acierte el 80% (CQR)."""
    pred = predecir(modelos, calibracion)
    fallos = defaultdict(list)
    for i, fila in enumerate(calibracion):
        y = fila["duracion"]
        fallos[fila["modalidad"]].append(max(pred["p10"][i] - y, y - pred["p90"][i]))
    resultado = {}
    for modalidad, valores in fallos.items():
        valores.sort()
        n = len(valores)
        posicion = min(n, math.ceil((n + 1) * BANDA)) - 1
        resultado[modalidad] = round(valores[posicion], 2)
    return resultado


def tabla_de_medianas(entreno: Filas, prueba: Filas) -> List[float]:
    """La mediana que daría hoy `duraciones_base`, para comparar."""
    fino, grueso, sentido = defaultdict(list), defaultdict(list), defaultdict(list)
    for f in entreno:
        fino[f["clave"]].append(f["duracion"])
        grueso[f["clave"].rsplit("|", 1)[0]].append(f["duracion"])
        sentido[f["modalidad"]].append(f["duracion"])
    medianas = []
    for f in prueba:
        for valores in (fino.get(f["clave"]), grueso.get(f["clave"].rsplit("|", 1)[0])):
            if valores and len(valores) >= MINIMO_CASOS_TABLA:
                medianas.append(statistics.median(valores))
                break
        else:
            medianas.append(statistics.median(sentido[f["modalidad"]]))
    return medianas


def _porcentaje(aciertos: Sequence[bool]) -> int:
    return round(100 * sum(aciertos) / len(aciertos)) if aciertos else 0


def _media(valores: Sequence[float]) -> float:
    return round(statistics.fmean(valores), 1) if valores else 0.0


def medir(modelos: Dict[str, Any], ens: Dict[str, float], casos: Counter,
          prueba: Filas, tabla: List[float]) -> Dict[str, Any]:
    """Lo que la pantalla puede decir de la estimación, medido en la prueba."""
    pred = predecir(modelos, prueba)
    por_sentido = defaultdict(lambda: defaultdict(list))
    por_confianza = defaultdict(list)
    for i, f in enumerate(prueba):
        y = f["duracion"]
        minutos, desde, hasta = est.banda_calibrada(
            pred["p50"][i], pred["p10"][i], pred["p90"][i], ens.get(f["modalidad"], 0.0))
        grupo = por_sentido[f["modalidad"]]
        grupo["error"].append(abs(y - minutos))
        grupo["tabla"].append(abs(y - tabla[i]))
        grupo["banda"].append(desde <= y <= hasta)
        grupo["a_tiempo"].append(y <= hasta)
        por_confianza[est.confianza(casos[f["clave"]])].append(abs(y - minutos))
    return {
        "dias": sorted({f["fecha"] for f in prueba}),
        "servicios": len(prueba),
        "error_medio": {m: _media(g["error"]) for m, g in por_sentido.items()},
        "error_tabla": {m: _media(g["tabla"]) for m, g in por_sentido.items()},
        "banda": {m: _porcentaje(g["banda"]) for m, g in por_sentido.items()},
        "a_tiempo": {m: _porcentaje(g["a_tiempo"]) for m, g in por_sentido.items()},
        "error_por_confianza": {n: _media(v) for n, v in por_confianza.items()},
    }


def probar(filas: Filas) -> Dict[str, Any]:
    """Entrena, calibra y mide sin tocar la última semana hasta el final."""
    previo, prueba = partir_por_dias(filas, DIAS_PRUEBA)
    entreno, calibracion = partir_por_dias(previo, DIAS_CALIBRACION)
    modelos = entrenar(entreno)
    ens = ensanche(modelos, calibracion)
    casos = Counter(f["clave"] for f in previo)
    return medir(modelos, ens, casos, prueba, tabla_de_medianas(previo, prueba))


def exportar(modelos: Dict[str, Any], entreno: Filas, meta: Dict[str, Any]) -> None:
    os.makedirs(DESTINO, exist_ok=True)
    cabecera = ('"""Modelo {nombre} de duración. Generado por scripts/entrenar_duracion.py '
                'el {fecha}; no editar a mano."""\n\n')
    for nombre, modelo in modelos.items():
        ruta = os.path.join(DESTINO, f"{nombre}.py")
        modelo.save_model(ruta, format="python", pool=_pool(entreno))
        with open(ruta, encoding="utf-8") as fh:
            codigo = fh.read()
        with open(ruta, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(cabecera.format(nombre=nombre, fecha=meta["entrenado_el"]) + codigo)
    with open(os.path.join(DESTINO, "meta.py"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write('"""Qué sabe el modelo de duración y cómo se midió. Generado por '
                 'scripts/entrenar_duracion.py."""\n\n')
        fh.write("META = " + pprint.pformat(meta, width=100, sort_dicts=True) + "\n")
    with open(os.path.join(DESTINO, "__init__.py"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write('"""Modelo de duración exportado por scripts/entrenar_duracion.py. '
                 'Ver api/estimador_duracion.py."""\n\n'
                 "from . import p10, p50, p90  # noqa: F401\n"
                 "from .meta import META  # noqa: F401\n")


def comprobar_exportado(modelos: Dict[str, Any], filas: Filas) -> None:
    """El código exportado tiene que dar lo mismo que CatBoost, servicio a servicio.

    No es una formalidad: con una «Ñ» en un texto, el exportado daba otra cifra
    (ver `normalizar`). Si vuelve a pasar con cualquier otro dato, se para aquí
    y no en la pantalla del Programador.
    """
    import importlib.util

    nativo = predecir(modelos, filas)
    for nombre in modelos:
        spec = importlib.util.spec_from_file_location(
            f"_comprobar_{nombre}", os.path.join(DESTINO, f"{nombre}.py"))
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        est.ajustar_cortes(modulo)
        diferencia = max(abs(modulo.apply_catboost_model(list(f["numeros"]), list(f["textos"])) - v)
                         for f, v in zip(filas, nativo[nombre]))
        if diferencia > 0.01:
            raise SystemExit(f"El modelo {nombre} exportado difiere hasta {diferencia:.3f} min del original.")
    print(f"Exportado comprobado: coincide con CatBoost en los {len(filas)} servicios.")


def informar(prueba: Dict[str, Any]) -> None:
    print(f"\nPrueba sobre {prueba['servicios']} servicios de {prueba['dias'][0]} a {prueba['dias'][-1]}:")
    for modalidad in sorted(prueba["error_medio"]):
        print(f"  {modalidad:<7} error medio {prueba['error_medio'][modalidad]:5.1f} min "
              f"(tabla de hoy {prueba['error_tabla'][modalidad]:5.1f}) · banda acierta "
              f"{prueba['banda'][modalidad]}% · a tiempo con el extremo alto "
              f"{prueba['a_tiempo'][modalidad]}%")
    print("  error por confianza:", prueba["error_por_confianza"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    modo = parser.add_mutually_exclusive_group(required=True)
    modo.add_argument("--revisar", action="store_true", help="Mide y no escribe")
    modo.add_argument("--escribir", action="store_true", help="Además exporta el modelo")
    args = parser.parse_args()

    muestras = bajar_muestras()
    filas = est.filas_de_entrenamiento(muestras)
    dias = sorted({f["fecha"] for f in filas})
    print(f"{len(muestras)} servicios, {len(filas)} válidos, {len(dias)} días ({dias[0]} a {dias[-1]}).")
    prueba = probar(filas)
    informar(prueba)
    if not args.escribir:
        return 0

    entreno, calibracion = partir_por_dias(filas, DIAS_CALIBRACION)
    modelos = entrenar(entreno)
    meta = {
        "entrenado_el": date.today().isoformat(),
        "datos": {"desde": dias[0], "hasta": dias[-1], "dias": len(dias), "servicios": len(filas)},
        "parametros": PARAMETROS,
        "ensanche": ensanche(modelos, calibracion),
        "casos": dict(Counter(f["clave"] for f in filas)),
        "prueba": prueba,
    }
    exportar(modelos, entreno, meta)
    comprobar_exportado(modelos, filas)
    print(f"\nModelo escrito en {os.path.relpath(DESTINO, RAIZ)}; ensanche {meta['ensanche']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
