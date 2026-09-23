"""Pruebas de la lectura de la intranet y del cruce de novedades.

Lo que se protege aquí son decisiones que costó medir, no detalles de
implementación:

- que el `.xls` de la intranet, que es HTML sin declarar su codificación, se
  lea como UTF-8 y los acentos salgan enteros;
- que el cambio se deduzca del histórico y no de la etiqueta del cliente, que
  está comprobado que se equivoca;
- que la comparación de direcciones no invente traslados por una «Ñ» rota o
  por una referencia pegada al final.
"""

import unittest

import pandas as pd

from api import historico_intranet as hi
from api import novedades_intranet as nv


# El export de la intranet en miniatura: mismas cabeceras partidas en dos
# líneas, mismos acentos en UTF-8, misma fecha con el día por delante.
HTML_INTRANET = """
<table>
  <tr>
    <td>N&ordm;</td><td>Fecha<br>programada</td><td>Fecha<br>ejecutada</td>
    <td>Sede</td><td>Modalidad</td><td>Hora de<br>inicio</td>
    <td>Hora<br>en el<br>punto</td><td>DNI</td><td>Usuario</td>
    <td>Direccion</td><td>Referencia</td><td>Distrito</td><td>Cobertura</td>
    <td>Hora<br>programada</td><td>Codigo<br>Vehiculo</td><td>Hora<br>llegada</td>
    <td>Latitud<br>inicio</td><td>Longitud<br>inicio</td>
  </tr>
  <tr>
    <td>1</td><td>21/09/26</td><td>22/09/26</td><td>TELEPERFORMANCE BELLAVISTA</td>
    <td>Recojo</td><td>22:31</td><td>22:40</td><td>74323231</td>
    <td>BARBARAN PIÑA KEIKO</td><td>AV. SÁENZ PEÑA 756</td>
    <td>-12.018562, -77.011675</td><td>CALLAO</td><td>CLL1</td>
    <td>23:00</td><td>V218</td><td>23:10</td>
    <td>-12.018562</td><td>-77.011675</td>
  </tr>
</table>
"""


class LecturaDelExportTest(unittest.TestCase):
    """El archivo tal como lo descarga la intranet, sin pasar por Excel."""

    def test_lee_el_html_con_extension_xls(self):
        datos = hi.leer_reporte(HTML_INTRANET.encode("utf-8"))
        self.assertEqual(len(datos), 1)
        self.assertEqual(datos["DNI"].iloc[0], "74323231")
        self.assertEqual(datos["mod"].iloc[0], "RECOJO")
        self.assertEqual(datos["turno"].iloc[0], "23:00")

    def test_las_cabeceras_partidas_se_unifican(self):
        """«Hora de<br>inicio» llega como «Hora deinicio» o «Hora de inicio».

        Según haya pasado o no por Excel. Sin unificar, la columna desaparece
        sin que nada avise y las horas se quedan vacías.
        """
        datos = hi.leer_reporte(HTML_INTRANET.encode("utf-8"))
        self.assertIn("Hora de inicio", datos.columns)
        self.assertIn("Fechaejecutada", datos.columns)
        self.assertIn("CodigoVehiculo", datos.columns)

    def test_la_fecha_se_lee_con_el_dia_por_delante(self):
        """«22/09/26» es 22 de septiembre, no el mes 22.

        Dejárselo adivinar a pandas es jugarse el mes en las fechas donde
        ambas lecturas son válidas, y ahí el error no se ve.
        """
        datos = hi.leer_reporte(HTML_INTRANET.encode("utf-8"))
        self.assertEqual(str(datos["dia"].iloc[0]), "2026-09-22")

    def test_los_acentos_sobreviven(self):
        datos = hi.leer_reporte(HTML_INTRANET.encode("utf-8"))
        self.assertEqual(datos["Usuario"].iloc[0], "BARBARAN PIÑA KEIKO")
        self.assertEqual(datos["Direccion"].iloc[0], "AV. SÁENZ PEÑA 756")

    def test_el_padron_no_guarda_texto_roto(self):
        datos = hi.leer_reporte(HTML_INTRANET.encode("utf-8"))
        declarados, deducidos = hi.construir_padron(datos)
        for registro in declarados + deducidos:
            for campo in ("nombre", "direccion", "distrito"):
                self.assertNotIn("Ã", registro.get(campo) or "")


class ReparacionDeAcentosTest(unittest.TestCase):
    """UTF-8 releído como cp1252 se puede deshacer: no se perdió ningún byte."""

    def test_deshace_la_enie(self):
        self.assertEqual(hi.reparar_acentos("PEÃ‘A"), "PEÑA")

    def test_deshace_la_a_acentuada(self):
        """La «Á» usa el byte 0x81, que cp1252 no define.

        Por eso hay que recomponerla a mano; con `encode('cp1252')` a secas
        esta cadena se quedaba sin arreglar.
        """
        self.assertEqual(hi.reparar_acentos("SÃENZ"), "SÁENZ")

    def test_no_toca_el_texto_sano(self):
        self.assertEqual(hi.reparar_acentos("AV. SAENZ PEÑA"), "AV. SAENZ PEÑA")
        self.assertIsNone(hi.reparar_acentos(None))


class DireccionesTest(unittest.TestCase):
    """Comparar los textos tal cual daba cuatro traslados falsos de ocho."""

    def test_la_referencia_pegada_no_es_otra_casa(self):
        """El histórico concatena la referencia; el cliente la manda aparte."""
        self.assertGreaterEqual(
            nv.parecido("AVENIDA 01 ELMER FAUCETT 604 REF HOSPITAL SAN JOSE",
                        "AVENIDA ELMER FAUCETT 604"),
            nv.PARECIDO_MINIMO)

    def test_la_enie_rota_no_es_otra_casa(self):
        self.assertGreaterEqual(
            nv.parecido("AV. SAENZ PEÃ‘A 756", "AV. SAENZ PEÑA 756"),
            nv.PARECIDO_MINIMO)

    def test_una_mudanza_real_se_ve(self):
        self.assertLess(
            nv.parecido("MZ H LT 17 RESIDENCIAL CALIFORNIA",
                        "CALLE LOS ROBLES MZ C LT 2, OQUENDO, CALLAO"),
            nv.PARECIDO_MINIMO)

    def test_sin_material_no_se_afirma_un_cambio(self):
        """Una dirección vacía no es una mudanza; es que no hay con qué."""
        self.assertEqual(nv.parecido(None, "JR. LIMA 540"), 1.0)


class EtiquetaDeBajaTest(unittest.TestCase):
    """El único bit que se lee del archivo, y hay siete formas de escribirlo."""

    def test_reconoce_las_variantes(self):
        for texto in ("Eliminar ruta", "ELIMINAR RUTA", "Anular Ruta",
                      "anular ruta", "Baja"):
            self.assertTrue(nv.es_baja(texto), texto)

    def test_lo_demas_viaja(self):
        for texto in ("Asignar Ruta", "Modificar ruta", "Cambio de Direccion",
                      "Cambio Domicilio", "", None):
            self.assertFalse(nv.es_baja(texto), texto)


def _novedad(**campos):
    base = {"DNI": "12345678", "NOMBRES": "PEREZ JUAN", "DIRECCION": "JR. LIMA 540",
            "COBERTURA": "CLL1", "SENTIDO": "INGRESO", "HORA": "03:00",
            "FECHA": "05/09/2026", "NOVEDAD": "Asignar Ruta"}
    base.update(campos)
    return base


def _servicio(**campos):
    base = {"dni": "12345678", "cobertura": "CLL1", "turno": "03:00",
            "modalidad": "RECOJO", "fecha_ejecutada": "2026-08-15"}
    base.update(campos)
    return base


def _analizar(novedades, servicios, padron=None):
    marco = pd.DataFrame(novedades)
    marco["dni"] = marco["DNI"].apply(nv.dni_de)
    marco["fecha"] = pd.to_datetime(marco["FECHA"], dayfirst=True).dt.date
    marco["turno"] = marco["HORA"].apply(nv.turno_de)
    return nv.analizar(marco, servicios, padron or [])


class DeteccionContraElHistoricoTest(unittest.TestCase):
    """El cambio sale del histórico, no de lo que diga el archivo."""

    def test_la_etiqueta_asignar_no_convierte_en_alta_a_quien_ya_viajaba(self):
        """Medido: 6 de 23 filas dicen «Asignar Ruta» de gente con historial.

        Si se creyera la etiqueta, el sistema daría de alta a alguien que
        lleva semanas viajando y perdería su historial de zona y turno.
        """
        resultado = _analizar([_novedad(NOVEDAD="Asignar Ruta")],
                              [_servicio() for _ in range(20)])
        self.assertEqual(resultado["altas"], 0)
        self.assertEqual(resultado["sin_cambio"], 1)
        self.assertTrue(resultado["entradas"][0]["conocido"])

    def test_alta_de_verdad_cuando_no_hay_historial(self):
        resultado = _analizar([_novedad()], [])
        self.assertEqual(resultado["altas"], 1)
        self.assertFalse(resultado["entradas"][0]["conocido"])

    def test_detecta_el_cambio_de_zona(self):
        resultado = _analizar([_novedad(COBERTURA="VEN1")],
                              [_servicio(cobertura="VEN2") for _ in range(16)])
        cambios = resultado["entradas"][0]["cambios"]
        self.assertEqual([c["tipo"] for c in cambios], [nv.CAMBIO_ZONA])
        self.assertEqual(cambios[0]["antes"], "VEN2")
        self.assertEqual(cambios[0]["ahora"], "VEN1")

    def test_detecta_el_cambio_de_turno_aunque_la_etiqueta_diga_otra_cosa(self):
        resultado = _analizar([_novedad(HORA="05:00", NOVEDAD="Asignar Ruta")],
                              [_servicio(turno="06:00") for _ in range(7)])
        cambios = resultado["entradas"][0]["cambios"]
        self.assertEqual([c["tipo"] for c in cambios], [nv.CAMBIO_TURNO])

    def test_detecta_la_mudanza_y_avisa_de_la_ubicacion(self):
        """Quien se muda deja obsoleta la ubicación aprendida de su casa.

        Es lo más caro de no ver: el vehículo seguiría yendo a la dirección
        anterior sin que nada fallara visiblemente.
        """
        resultado = _analizar(
            [_novedad(DIRECCION="AV. LOS ALAMOS 220")],
            [_servicio() for _ in range(5)],
            [{"dni": "12345678", "nombre": "PEREZ JUAN",
              "direccion": "MZ H LT 17 RESIDENCIAL CALIFORNIA",
              "estado_ubicacion": "resuelta"}])
        entrada = resultado["entradas"][0]
        self.assertIn(nv.CAMBIO_DIRECCION, [c["tipo"] for c in entrada["cambios"]])
        self.assertTrue(entrada["ubicacion_obsoleta"])

    def test_la_baja_no_se_deduce_pero_se_respeta(self):
        """Una baja es idéntica al histórico: no hay nada que detectar.

        Por eso es el único dato que se toma de la etiqueta. Si esto deja de
        cumplirse, alguien se queda sin movilidad sin que nadie lo vea.
        """
        resultado = _analizar([_novedad(NOVEDAD="Eliminar ruta")],
                              [_servicio() for _ in range(20)])
        entrada = resultado["entradas"][0]
        self.assertFalse(entrada["viaja"])
        self.assertEqual(entrada["clasificacion"], "baja")
        self.assertEqual(entrada["cambios"], [])

    def test_solo_cuenta_el_historial_anterior_a_la_novedad(self):
        """Una novedad habla del futuro; el histórico posterior no vale.

        Sin el corte, al recargar un archivo ya pasado el histórico contiene
        el cambio que la novedad anunciaba y la detección se queda muda.
        """
        resultado = _analizar(
            [_novedad(COBERTURA="VEN1", FECHA="05/09/2026")],
            [_servicio(cobertura="VEN2", fecha_ejecutada="2026-08-15"),
             _servicio(cobertura="VEN1", fecha_ejecutada="2026-09-20")])
        self.assertEqual([c["tipo"] for c in resultado["entradas"][0]["cambios"]],
                         [nv.CAMBIO_ZONA])


class LecturaDeNovedadesTest(unittest.TestCase):
    def test_rechaza_el_historico_con_un_motivo_util(self):
        with self.assertRaises(nv.ReporteInvalido) as fallo:
            nv.leer_novedades(HTML_INTRANET.encode("utf-8"))
        self.assertIn("Novedades", str(fallo.exception))

    def test_reconoce_las_columnas_del_archivo_del_cliente(self):
        self.assertTrue(hi.parece_novedades(["DNI.", "NOMBRES", "NOVEDAD"]))
        self.assertFalse(hi.parece_novedades(["DNI", "Usuario", "Modalidad"]))


if __name__ == "__main__":
    unittest.main()
