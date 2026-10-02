"""Disponibilidad de las unidades: las reglas que usa el backend.

La base resuelve la de cada día (supabase/018); aquí se prueba lo que hace el
backend alrededor: validar lo que manda la pantalla, ordenar los turnos, decir
por qué una unidad no puede llevar a nadie y que la IA no le dé un turno que no
trabaja.
"""

import unittest
from datetime import date

from api import disponibilidad as d
from api import propuesta_ia
from api import ruteo_vroom

HOY = date(2026, 10, 2)
HASTA = date(2026, 12, 31)


class TurnosTestCase(unittest.TestCase):
    """Los turnos van por horas: «el de las 3» es de 03:00 a 03:59."""

    def test_a_turno_belongs_to_its_hour(self):
        self.assertEqual(d.de_la_hora("3:40"), "03:00")
        self.assertEqual(d.de_la_hora(" 22:01 "), "22:00")
        for malo in ("24:00", "7:60", "7", "", None, "07h00"):
            self.assertIsNone(d.de_la_hora(malo), malo)

    def test_two_turnos_are_the_same_if_they_are_in_the_same_hour(self):
        self.assertTrue(d.misma_hora("22:00", "22:01"))
        self.assertTrue(d.misma_hora("00:00", "00:40"))
        self.assertFalse(d.misma_hora("23:59", "00:00"))
        self.assertFalse(d.misma_hora("22:00", "basura"))

    def test_the_hours_to_choose_from_are_the_used_ones_in_working_order(self):
        # Así llegan de la base: 22:00 y 22:01, 00:30 y 00:40, y horas que casi no se usan.
        filas = [{"turno": "22:01", "veces": 716}, {"turno": "22:00", "veces": 140},
                 {"turno": "00:40", "veces": 428}, {"turno": "00:30", "veces": 224},
                 {"turno": "03:00", "veces": 805}, {"turno": "07:00", "veces": 48},
                 {"turno": "17:00", "veces": 324}, {"turno": "12:50", "veces": 1},
                 {"turno": "21:35", "veces": 9}, {"turno": "x", "veces": 99}]
        # Con al menos un pasajero al día en 45 días: fuera 12:00 y 21:00.
        self.assertEqual(d.turnos_de_la_operacion(filas, minimo=45),
                         ["17:00", "22:00", "00:00", "03:00", "07:00"])
        self.assertEqual(len(d.turnos_de_la_operacion(filas)), 7)


class ValidacionTestCase(unittest.TestCase):
    def test_the_week_goes_by_day_with_a_list_or_null(self):
        # Cada turno cuenta por su hora: 03:30 es el de las 3.
        semana = d.validar_semana({"6": [], "7": None, "1": ["3:00", "22:00", "03:30"]})
        self.assertEqual(semana, {"6": [], "7": None, "1": ["22:00", "03:00"]})
        self.assertIsNone(d.validar_semana(None))
        for mala in ({"0": []}, {"8": []}, {"lunes": []}, {"1": "03:00"}, {"1": ["25:00"]}, ["1"]):
            with self.subTest(mala=mala), self.assertRaises(d.EntradaInvalida):
                d.validar_semana(mala)

    def test_a_date_can_rest_work_some_turnos_work_all_or_go_back_to_its_week(self):
        fechas = d.validar_fechas([
            {"fecha": "2026-10-04", "turnos": [], "nota": " Vacaciones "},
            {"fecha": "2026-10-05", "turnos": ["06:00"]},
            {"fecha": "2026-10-06", "turnos": None},
            {"fecha": "2026-10-07", "turnos": "semana"},
        ], HOY, HASTA)
        self.assertEqual([f["turnos"] for f in fechas], [[], ["06:00"], None, "semana"])
        self.assertEqual(fechas[0]["nota"], "Vacaciones")
        self.assertIsNone(fechas[1]["nota"])

    def test_the_past_far_dates_repeated_dates_and_bad_values_are_rejected(self):
        malas = [
            [{"fecha": "2026-10-01", "turnos": []}],          # ya pasó
            [{"fecha": "2027-01-15", "turnos": []}],          # demasiado lejos
            [{"fecha": "2026-02-30", "turnos": []}],          # no existe
            [{"fecha": "04/10/2026", "turnos": []}],
            [{"fecha": "2026-10-04"}],                        # no dice qué turnos
            [{"fecha": "2026-10-04", "turnos": "todos"}],
            [{"fecha": "2026-10-04", "turnos": []}, {"fecha": "2026-10-04", "turnos": None}],
            [{"fecha": "2026-10-04", "turnos": [], "nota": "x" * 201}],
            {"fecha": "2026-10-04"},
        ]
        for mala in malas:
            with self.subTest(mala=mala), self.assertRaises(d.EntradaInvalida):
                d.validar_fechas(mala, HOY, HASTA)
        # Hoy sí se puede cambiar: es el día que se está trabajando.
        self.assertEqual(len(d.validar_fechas([{"fecha": "2026-10-02", "turnos": []}], HOY, HASTA)), 1)


class MotivoTestCase(unittest.TestCase):
    REGLAS = {
        "K027": {"turnos": [], "origen": "fecha", "nota": "Vacaciones"},
        "K030": {"turnos": ["03:00", "22:00"], "origen": "semana", "nota": None},
    }

    def test_a_unit_without_a_rule_works_every_turno(self):
        self.assertIsNone(d.motivo_no_disponible(self.REGLAS, "K028", "K028", "06:00"))
        self.assertIsNone(d.motivo_no_disponible({}, "K027", "K027", "06:00"))

    def test_a_resting_unit_says_so_with_its_note(self):
        self.assertEqual(d.motivo_no_disponible(self.REGLAS, "K027", "K-027", "06:00"),
                         "La unidad K-027 descansa este día (Vacaciones).")

    def test_a_unit_with_some_turnos_says_which_and_counts_the_whole_hour(self):
        self.assertIsNone(d.motivo_no_disponible(self.REGLAS, "K030", "K030", "22:01"))
        self.assertIsNone(d.motivo_no_disponible(self.REGLAS, "K030", "K030", "03:40"))
        # En el orden de la jornada, no en el alfabético con que los da la base.
        self.assertEqual(d.motivo_no_disponible(self.REGLAS, "K030", "K030", "06:00"),
                         "La unidad K030 solo trabaja los turnos de las 22:00 y 03:00 este día.")
        solo_uno = {"K031": {"turnos": ["03:00"], "origen": "semana", "nota": None}}
        self.assertEqual(d.motivo_no_disponible(solo_uno, "K031", "K031", "04:00"),
                         "La unidad K031 solo trabaja el turno de las 03:00 este día.")

    def test_only_agregar_and_mover_take_someone_to_a_unit(self):
        cambios = [
            {"accion": "agregar", "vehiculo": "K027", "turno": "06:00"},
            {"accion": "mover", "hacia": {"vehiculo": "K030", "turno": "05:00"}},
            {"accion": "ordenar", "vehiculo": "K031", "turno": "06:00"},
            {"accion": "a_pendientes", "vehiculo": "K032"},
            "basura",
        ]
        self.assertEqual(d.destinos(cambios), [{"vehiculo": "K027", "turno": "06:00"},
                                               {"vehiculo": "K030", "turno": "05:00"}])

    def test_the_ai_gets_the_turnos_of_a_unit_or_none_for_all(self):
        self.assertEqual(d.turnos_permitidos(self.REGLAS, "K030"), ["03:00", "22:00"])
        self.assertEqual(d.turnos_permitidos(self.REGLAS, "K027"), [])
        self.assertIsNone(d.turnos_permitidos(self.REGLAS, "K028"))


class IaRespetaLaDisponibilidadTestCase(unittest.TestCase):
    """La IA no le da a una unidad un turno que no trabaja."""

    @staticmethod
    def _plan():
        def agente(n, lat):
            return {"id": str(n), "nombre": f"P{n}", "lat": lat, "lng": -77.10, "ubicacion": "resuelta"}
        sede = "TELEPERFORMANCE BELLAVISTA"
        return {"existe": True, "rutas": [
            {"conductor": "K001", "turno": "06:00", "modalidad": "RECOJO", "sede": sede,
             "micro_zona": "A", "agentes": [agente(1, -12.04), agente(2, -12.03)]},
            {"conductor": "K002", "turno": "06:00", "modalidad": "RECOJO", "sede": sede,
             "micro_zona": "A", "agentes": [agente(3, -12.02)]},
            {"conductor": "K002", "turno": "07:00", "modalidad": "RECOJO", "sede": sede,
             "micro_zona": "A", "agentes": [agente(4, -12.05)]},
        ]}

    def test_a_unit_knows_which_hours_it_works(self):
        minuto = propuesta_ia.minuto_del_turno
        unidad = ruteo_vroom.Unidad("K002", 4, 0, 2000, turnos=[minuto("07:00"), minuto("00:00")])
        self.assertFalse(unidad.trabaja(minuto("06:00")))
        self.assertFalse(unidad.trabaja(minuto("06:59")))
        self.assertTrue(unidad.trabaja(minuto("07:01")))
        self.assertTrue(unidad.trabaja(minuto("07:59")))
        self.assertFalse(unidad.trabaja(minuto("08:00")))
        # A través de la medianoche: 00:40 es del turno de las 12.
        self.assertTrue(unidad.trabaja(minuto("00:40")))
        self.assertFalse(unidad.trabaja(minuto("23:59")))
        self.assertTrue(ruteo_vroom.Unidad("K001", 4, 0, 2000).trabaja(minuto("06:00")))

    def test_a_resting_unit_is_left_out_and_the_others_get_only_their_turnos(self):
        solo_siete = {"K002": ["07:00"]}
        problema = propuesta_ia.construir(self._plan(), lambda codigo: 4,
                                          turnos_de=lambda codigo: solo_siete.get(codigo))
        k002 = next(u for u in problema.unidades if u.codigo == "K002")
        self.assertEqual(k002.turnos, [propuesta_ia.minuto_del_turno("07:00")])

        descansa = {"K002": []}
        problema = propuesta_ia.construir(self._plan(), lambda codigo: 4,
                                          turnos_de=lambda codigo: descansa.get(codigo))
        self.assertEqual([u.codigo for u in problema.unidades], ["K001"])

    def test_vroom_never_puts_the_06_00_people_in_a_unit_that_only_works_at_07_00(self):
        try:
            import vroom  # noqa: F401
        except ImportError:
            self.skipTest("pyvroom no está instalado")
        solo_siete = {"K002": ["07:00"]}
        problema = propuesta_ia.construir(self._plan(), lambda codigo: 4,
                                          turnos_de=lambda codigo: solo_siete.get(codigo))
        propuesta = ruteo_vroom.proponer(problema.km, problema.paradas, problema.unidades, "tiempo")
        seis = propuesta_ia.minuto_del_turno("06:00")
        for viaje in propuesta.viajes:
            if viaje.turno == seis:
                self.assertNotEqual(viaje.unidad, "K002")


if __name__ == "__main__":
    unittest.main()
