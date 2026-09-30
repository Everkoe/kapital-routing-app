"""La IA de rutas: VROOM turno por turno y su paso al plan.

Estas pruebas ejecutan VROOM de verdad (pyvroom, en `requirements.txt`) sobre
problemas pequeños hechos a mano: lo que se comprueba es que las reglas de la
operación se cumplan en lo que devuelve, no cómo lo calcula.
"""

import unittest

from api import propuesta_ia as pia
from api import ruteo_vroom as rv

SEDE = (-12.055, -77.1075)
CERCA = [(-12.045, -77.100), (-12.047, -77.098), (-12.050, -77.095), (-12.044, -77.104)]
LEJOS = (-11.55, -77.25)  # unos 58 km: ni en viaje directo baja de 80 min
DIA = 24 * 60 + 400  # un horario que cubre todo el día desde el origen


def turno(hhmm):
    return pia.minuto_del_turno(hhmm)


class RuteoTestCase(unittest.TestCase):
    def setUp(self):
        self.km = rv.matriz_km([SEDE, *CERCA, LEJOS])

    def unidad(self, codigo, capacidad=4, ocupado=None):
        return rv.Unidad(codigo, capacidad, 0, DIA, ocupado or [])

    def test_blocks_are_one_direction_and_one_shift_in_start_order(self):
        paradas = [rv.Parada("a", rv.SALIDA, turno("22:01"), 1), rv.Parada("b", rv.SALIDA, turno("22:00"), 2),
                   rv.Parada("c", rv.RECOJO, turno("06:00"), 3), rv.Parada("d", rv.RECOJO, turno("05:00"), 4)]
        grupos = [[p.id for p in b] for b in rv.bloques(paradas)]
        # 22:00 y 22:01 son el mismo turno; los RECOJO empiezan antes que sus turnos.
        self.assertEqual(grupos, [["d"], ["c"], ["b", "a"]])

    def test_two_people_nearby_go_in_one_unit_within_the_rules(self):
        paradas = [rv.Parada("a", rv.RECOJO, turno("06:00"), 1), rv.Parada("b", rv.RECOJO, turno("06:00"), 2)]
        propuesta = rv.proponer(self.km, paradas, [self.unidad("K1"), self.unidad("K2")], "unidades")
        self.assertEqual(propuesta.unidades, 1)
        self.assertEqual(propuesta.sin_asignar, [])
        reglas = rv.Reglas()
        self.assertTrue(all(0 < x <= reglas.a_bordo_plan for x in propuesta.a_bordo))
        (viaje,) = propuesta.viajes
        for _, minuto in viaje.paradas:
            self.assertGreaterEqual(minuto, turno("06:00") - reglas.a_bordo_plan - reglas.antes_plan)
        self.assertLessEqual(viaje.fin, turno("06:00"))

    def test_a_trip_never_mixes_shifts(self):
        """Resolviendo el día de una vez, VROOM subía a los de las 06:00 con los de las 05:00."""
        paradas = [rv.Parada("a", rv.RECOJO, turno("05:00"), 1), rv.Parada("b", rv.RECOJO, turno("06:00"), 2),
                   rv.Parada("c", rv.RECOJO, turno("05:00"), 3), rv.Parada("d", rv.RECOJO, turno("06:00"), 4)]
        propuesta = rv.proponer(self.km, paradas, [self.unidad("K1")], "unidades")
        por_id = {p.id: p for p in paradas}
        self.assertEqual(propuesta.sin_asignar, [])
        for viaje in propuesta.viajes:
            self.assertEqual({por_id[i].turno for i, _ in viaje.paradas}, {viaje.turno})
        # La misma unidad hace los dos turnos, uno detrás de otro.
        self.assertEqual(propuesta.unidades, 1)
        self.assertEqual(len(propuesta.viajes), 2)

    def test_one_unit_makes_one_trip_per_shift(self):
        """El plan guarda un servicio por unidad y turno: no caben dos viajes."""
        paradas = [rv.Parada(x, rv.RECOJO, turno("06:00"), i) for x, i in (("a", 1), ("b", 2), ("c", 3))]
        sola = rv.proponer(self.km, paradas, [self.unidad("K1", capacidad=2)], "unidades")
        self.assertEqual(len(sola.viajes), 1)
        self.assertEqual(len(sola.sin_asignar), 1)
        self.assertIn("Ninguna unidad libre", sola.sin_asignar[0][1])
        dos = rv.proponer(self.km, paradas, [self.unidad("K1", capacidad=2), self.unidad("K2", capacidad=2)],
                          "unidades")
        self.assertEqual(dos.sin_asignar, [])
        self.assertEqual(sorted(len(v.paradas) for v in dos.viajes), [1, 2])

    def test_someone_who_lives_too_far_still_travels_and_is_flagged(self):
        paradas = [rv.Parada("lejos", rv.RECOJO, turno("06:00"), 5)]
        propuesta = rv.proponer(self.km, paradas, [self.unidad("K1")], "tiempo")
        self.assertEqual(propuesta.sin_asignar, [])
        self.assertEqual([i for i, _ in propuesta.excepciones], ["lejos"])
        self.assertIn("demasiado lejos", propuesta.excepciones[0][1])
        self.assertGreater(propuesta.a_bordo[0], rv.Reglas().max_a_bordo)

    def test_a_unit_busy_elsewhere_is_not_used_then(self):
        paradas = [rv.Parada("a", rv.RECOJO, turno("06:00"), 1)]
        ocupada = self.unidad("K1", ocupado=[(turno("04:00"), turno("06:30"))])
        propuesta = rv.proponer(self.km, paradas, [ocupada, self.unidad("K2")], "unidades")
        self.assertEqual([v.unidad for v in propuesta.viajes], ["K2"])

    def test_a_salida_leaves_the_site_at_its_time(self):
        paradas = [rv.Parada("a", rv.SALIDA, turno("22:01"), 1), rv.Parada("b", rv.SALIDA, turno("22:01"), 2)]
        propuesta = rv.proponer(self.km, paradas, [self.unidad("K1")], "unidades")
        (viaje,) = propuesta.viajes
        self.assertGreaterEqual(viaje.inicio, turno("22:01"))
        self.assertTrue(all(minuto > turno("22:01") for _, minuto in viaje.paradas))

    def test_the_current_plan_is_measured_with_the_same_times(self):
        km = rv.matriz_km([SEDE, CERCA[0]])
        reglas = rv.Reglas()
        actual = rv.evaluar(km, [rv.ServicioActual("K1", rv.RECOJO, turno("06:00"), [1])], reglas)
        esperado = reglas.parada_recojo + km[1][0] * reglas.min_por_km + reglas.entrada_sede
        self.assertEqual(actual["unidades"], 1)
        self.assertAlmostEqual(actual["a_bordo"][0], esperado)

    def test_only_two_objectives(self):
        with self.assertRaises(ValueError):
            rv.proponer(self.km, [], [], "barato")


def _plan():
    def agente(dni, punto, ubicacion="resuelta"):
        lat, lng = punto if punto else (None, None)
        return {"id": dni, "nombre": f"Persona {dni}", "lat": lat, "lng": lng, "ubicacion": ubicacion}
    bella = "TELEPERFORMANCE BELLAVISTA"
    return {"fecha": "2026-09-30", "existe": True, "rutas": [
        {"conductor": "K001", "turno": "06:00", "modalidad": "RECOJO", "sede": bella, "micro_zona": "BLL",
         "agentes": [agente("1", CERCA[0]), agente("2", CERCA[1])]},
        {"conductor": "K002", "turno": "06:00", "modalidad": "RECOJO", "sede": bella, "micro_zona": "BLL",
         "agentes": [agente("3", CERCA[2])]},
        # Alguien sin domicilio ubicado: el servicio no se toca.
        {"conductor": "K003", "turno": "06:00", "modalidad": "RECOJO", "sede": bella, "micro_zona": "BLL",
         "agentes": [agente("4", CERCA[3]), agente("5", None, "no_resuelta")]},
        # Otra sede: ocupa a su unidad, no se toca.
        {"conductor": "K002", "turno": "08:00", "modalidad": "RECOJO", "sede": "TELEPERFORMANCE MAGDALENA",
         "micro_zona": "MAG", "agentes": [agente("6", CERCA[0])], "estimacion": {"hasta": 50}},
    ]}


class PropuestaDelPlanTestCase(unittest.TestCase):
    def test_turn_times_round_trip_through_the_origin(self):
        self.assertEqual(pia.minuto_del_turno("00:00"), pia.ORIGEN)
        self.assertEqual(pia.hora(pia.minuto_del_turno("22:01")), "22:01")
        self.assertEqual(pia.hora(pia.minuto_del_turno("00:00") - 95), "22:25")
        self.assertIsNone(pia.minuto_del_turno("mañana"))

    def test_the_plan_becomes_a_problem_without_touching_what_cannot_be_computed(self):
        problema = pia.construir(_plan(), lambda codigo: {"K001": 4}.get(codigo))
        self.assertEqual(problema.sede, "TELEPERFORMANCE BELLAVISTA")
        self.assertEqual(sorted(p.id.split("|")[0] for p in problema.paradas), ["1", "2", "3"])
        self.assertEqual(problema.intactos, [{"unidad": "K003", "turno": "06:00", "modalidad": "RECOJO",
                                              "personas": 2, "sin_ubicar": 1}])
        unidades = {u.codigo: u for u in problema.unidades}
        self.assertEqual(unidades["K001"].capacidad, 4)
        # Sin capacidad declarada, lo más que lleva en el plan.
        self.assertEqual(unidades["K002"].capacidad, 1)
        # Su servicio en Magdalena le ocupa ese rato, y el intacto a la K003.
        self.assertEqual(len(unidades["K002"].ocupado), 1)
        self.assertEqual(len(unidades["K003"].ocupado), 1)

    def test_no_known_site_no_proposal(self):
        plan = {"rutas": [{**r, "sede": "OTRA"} for r in _plan()["rutas"]]}
        self.assertIsNone(pia.construir(plan, lambda codigo: None))

    def test_the_proposal_becomes_moves_and_orders_and_its_undo(self):
        problema = pia.construir(_plan(), lambda codigo: 4)
        clave = {p.id.split("|")[0]: p.id for p in problema.paradas}
        propuesta = rv.Propuesta(
            viajes=[rv.Viaje("K002", rv.RECOJO, pia.minuto_del_turno("06:00"),
                             [(clave["3"], 0), (clave["1"], 1), (clave["2"], 2)], 0, 3)],
            sin_asignar=[], a_bordo=[10, 20, 30], minutos_trabajo=40, segundos=0.1)
        aplicar, deshacer = pia.cambios(problema, propuesta)
        movidos = [c for c in aplicar if c["accion"] == "mover"]
        self.assertEqual(sorted(c["dni"] for c in movidos), ["1", "2"])
        self.assertEqual(movidos[0]["desde"], {"vehiculo": "K001", "turno": "06:00", "modalidad": "RECOJO"})
        self.assertEqual(movidos[0]["hacia"]["vehiculo"], "K002")
        self.assertIn({"accion": "ordenar", "vehiculo": "K002", "turno": "06:00", "modalidad": "RECOJO",
                       "dnis": ["3", "1", "2"]}, aplicar)
        # Deshacer: cada uno vuelve a su unidad y cada servicio a su orden.
        vuelta = {c["dni"]: c["hacia"]["vehiculo"] for c in deshacer if c["accion"] == "mover"}
        self.assertEqual(vuelta, {"1": "K001", "2": "K001"})
        self.assertIn({"accion": "ordenar", "vehiculo": "K001", "turno": "06:00", "modalidad": "RECOJO",
                       "dnis": ["1", "2"]}, deshacer)
        self.assertIn({"accion": "ordenar", "vehiculo": "K002", "turno": "06:00", "modalidad": "RECOJO",
                       "dnis": ["3"]}, deshacer)

    def test_the_answer_compares_like_with_like_and_counts_what_stays(self):
        problema = pia.construir(_plan(), lambda codigo: 4)
        propuesta = rv.proponer(problema.km, problema.paradas, problema.unidades, "unidades")
        respuesta = pia.respuesta(problema, propuesta, "unidades")
        self.assertEqual(respuesta["propuesta"]["unidades"], 1)
        self.assertEqual(respuesta["actual"]["unidades"], 2)
        # La K003 sigue con su servicio intacto: cuenta en las dos columnas.
        self.assertEqual(respuesta["unidades_de_la_sede"], {"actual": 3, "propuesta": 2})
        self.assertEqual(respuesta["intactos"], {"servicios": 1, "personas": 2, "sin_ubicar": 1})
        self.assertEqual(respuesta["sin_asignar"], [])
        self.assertTrue(all(c["accion"] in ("mover", "ordenar") for c in respuesta["cambios"]))
        (servicio,) = respuesta["servicios"]
        self.assertEqual(servicio["turno"], "06:00")
        self.assertEqual(sorted(a["id"] for a in servicio["agentes"]), ["1", "2", "3"])


if __name__ == "__main__":
    unittest.main()
