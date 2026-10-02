import copy
import asyncio
from pathlib import Path
import hashlib
import io
import random
import time
import json
import unittest
from unittest import mock
from unittest.mock import AsyncMock, patch

import httpx
import pandas as pd
from fastapi import HTTPException, Response, UploadFile

from api import index as backend

# Las pruebas que sustituyen `httpx.AsyncClient` del backend no deben sustituir
# también el cliente con el que las pruebas llaman al API.
_CLIENTE_HTTP_REAL = httpx.AsyncClient


async def actor_de(token):
    """El actor que ve esta instancia para un token, o `None`.

    Sustituye a `session_actor_from_index`, que desapareció con el índice.
    """
    entrada = await backend.sesion_de(token)
    return backend._actor_de_entrada(entrada) if entrada else None


class BackendStateTestCase(unittest.IsolatedAsyncioTestCase):
    """Protect the observable MVP behavior without contacting Supabase."""

    def setUp(self):
        self._random_state = random.getstate()
        self._password_hash_write_enabled = backend.PASSWORD_HASH_WRITE_ENABLED
        self._auth_enforced = backend.AUTH_ENFORCED
        self._db_loaded = backend.db_loaded
        self._storage_config = backend.STORAGE_CONFIG
        self._almacen_sesiones = backend.almacen_sesiones
        backend.almacen_sesiones = backend.sesiones.SesionesEnMemoria()
        self._almacen_intentos = backend.almacen_intentos
        backend.almacen_intentos = backend.intentos_acceso.IntentosEnMemoria()
        backend.sesiones_en_cache.clear()
        backend._reset_db_runtime_state()
        backend._activate_storage_config(backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "OLD",
            "KAPITAL_OLD_SUPABASE_URL": "https://unit-test.invalid/rest/v1",
            "KAPITAL_OLD_SUPABASE_KEY": "unit-test-key",
        }))
        backend.PASSWORD_HASH_WRITE_ENABLED = True
        backend.AUTH_ENFORCED = False
        self._state = {
            "usuarios_db": copy.deepcopy(backend.usuarios_db),
            "conductores_db": copy.deepcopy(backend.conductores_db),
            "notifications_db": copy.deepcopy(backend.notifications_db),
            "rutas_estado_actual": copy.deepcopy(backend.rutas_estado_actual),
            "routes_summary": copy.deepcopy(backend.routes_summary),
            "historial_rutas": copy.deepcopy(backend.historial_rutas),
            "board_lock": copy.deepcopy(backend.board_lock),
            "actividad_db": copy.deepcopy(backend.actividad_db),
        }
        backend.usuarios_db.clear()
        backend.conductores_db.clear()
        backend.notifications_db.clear()
        backend.actividad_db = []
        backend.rutas_estado_actual = []
        backend.routes_summary = []
        backend.historial_rutas = []
        backend.board_lock = {}

    def tearDown(self):
        random.setstate(self._random_state)
        backend.PASSWORD_HASH_WRITE_ENABLED = self._password_hash_write_enabled
        backend.AUTH_ENFORCED = self._auth_enforced
        backend._reset_db_runtime_state()
        backend.db_loaded = self._db_loaded
        backend.usuarios_db.clear()
        backend.usuarios_db.update(self._state["usuarios_db"])
        backend.conductores_db.clear()
        backend.conductores_db.update(self._state["conductores_db"])
        backend.notifications_db.clear()
        backend.notifications_db.extend(self._state["notifications_db"])
        backend.rutas_estado_actual = self._state["rutas_estado_actual"]
        backend.routes_summary = self._state["routes_summary"]
        backend.historial_rutas = self._state["historial_rutas"]
        backend.board_lock = self._state["board_lock"]
        backend.actividad_db = self._state.get("actividad_db", backend.actividad_db)
        backend._activate_storage_config(self._storage_config)
        backend.almacen_sesiones = self._almacen_sesiones
        backend.almacen_intentos = self._almacen_intentos
        backend.sesiones_en_cache.clear()

    async def test_first_registered_user_becomes_active_administration(self):
        request = backend.UsuarioRegistro(
            identifier="Admin@Example.com",
            password="safe-password",
            nombre="Admin Baseline",
            rol="Programador de rutas",
        )

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            response = await backend.register_user(request)

        self.assertEqual(response["estado"], "Activo")
        self.assertEqual(backend.usuarios_db["admin@example.com"]["rol"], "Administración")
        stored_password = backend.usuarios_db["admin@example.com"]["password"]
        self.assertNotEqual(stored_password, "safe-password")
        self.assertTrue(backend.verify_password("safe-password", stored_password))

    async def test_later_registration_remains_pending(self):
        backend.usuarios_db["admin@example.com"] = {
            "identifier": "admin@example.com",
            "password": "safe-password",
            "nombre": "Admin Baseline",
            "rol": "Administración",
            "estado": "Activo",
        }
        request = backend.UsuarioRegistro(
            identifier="planner@example.com",
            password="safe-password",
            nombre="Planner Baseline",
            rol="Programador de rutas",
        )

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            response = await backend.register_user(request)

        self.assertEqual(response["estado"], "Pendiente")
        self.assertEqual(backend.usuarios_db["planner@example.com"]["estado"], "Pendiente")

    async def test_a_driver_logs_in_with_the_dni_whether_or_not_it_keeps_its_leading_zero(self):
        """La importación guardó 25 DNI sin su cero; quien lo tecleaba entero no entraba."""
        backend.usuarios_db["perez.gomez@kapital.com"] = {
            "rol": "Conductor", "estado": "Activo", "nombre": "Pérez",
            "password": backend.hash_password("provisional-segura"),
            "perfil_conductor": {"tipoDoc": "DNI", "numDoc": "4567891"},
        }
        backend.usuarios_db["con.cero@kapital.com"] = {
            "rol": "Conductor", "estado": "Activo", "nombre": "Cero", "dni": "09704190",
            "password": backend.hash_password("otra-segura"),
        }
        with patch.object(backend, "reload_db", new=AsyncMock()), \
                patch.object(backend, "persist_users_only", new=AsyncMock()):
            for tecleado, contrasena, nombre in (
                ("04567891", "provisional-segura", "Pérez"),
                ("4567891", "provisional-segura", "Pérez"),
                ("9704190", "otra-segura", "Cero"),
            ):
                respuesta = await backend.login_user(
                    backend.UsuarioLogin(identifier=tecleado, password=contrasena), Response())
                self.assertEqual(respuesta["nombre"], nombre, tecleado)
            with self.assertRaises(HTTPException) as fallo:
                await backend.login_user(
                    backend.UsuarioLogin(identifier="04567891", password="otra-segura"), Response())
        self.assertEqual(fallo.exception.status_code, 401)

    def test_only_a_dni_is_the_same_with_and_without_leading_zeros(self):
        self.assertEqual(backend._formas_de_identificador(" 04567891 "), ["04567891", "4567891"])
        self.assertEqual(backend._formas_de_identificador("4567891"), ["4567891", "04567891"])
        # Uno de los importados perdió dos ceros: le quedan seis cifras.
        self.assertEqual(backend._formas_de_identificador("00796328"), ["00796328", "796328"])
        # Un carné de extranjería (más de ocho cifras) se busca tal cual.
        self.assertEqual(backend._formas_de_identificador("001234567"), ["001234567"])
        self.assertEqual(backend._formas_de_identificador("Ana@K.com"), ["ana@k.com"])
        self.assertEqual(backend._formas_de_identificador(""), [])
        # Lo que no llega a DNI no se estira hasta ocho cifras.
        for corto in ("0", "12", "00000000", "0012345"):
            self.assertEqual(backend._formas_de_identificador(corto), [corto], corto)
        # Solo cifras ASCII: `isdigit` también acepta otras escrituras.
        self.assertEqual(backend._formas_de_identificador("١٢٣٤٥٦٧"), ["١٢٣٤٥٦٧"])

    def test_the_exact_alias_wins_over_a_zero_variant(self):
        """Quien tiene «01234567» entraba en la cuenta de «1234567» si esa iba antes."""
        sin_cero = {"rol": "Conductor", "perfil_conductor": {"numDoc": "1234567"}}
        con_cero = {"rol": "Conductor", "dni": "01234567"}
        backend.usuarios_db["sin.cero@kapital.com"] = sin_cero
        backend.usuarios_db["con.cero@kapital.com"] = con_cero
        self.assertIs(backend.get_user_by_identifier("01234567"), con_cero)
        self.assertIs(backend.get_user_by_identifier("1234567"), sin_cero)

    def test_zero_variants_that_point_to_two_accounts_resolve_to_none(self):
        backend.usuarios_db["a@kapital.com"] = {"rol": "Conductor", "dni": "234567"}
        backend.usuarios_db["b@kapital.com"] = {"rol": "Conductor", "dni": "00234567"}
        self.assertIsNone(backend.get_user_by_identifier("0234567"))

    async def test_the_login_index_prefers_the_exact_alias_and_refuses_ambiguity(self):
        backend.login_index = {
            "1234567": "sin.cero@kapital.com",
            "01234567": "con.cero@kapital.com",
            "234567": "a@kapital.com",
            "00234567": "b@kapital.com",
        }
        backend._login_index_loaded_at = time.monotonic()
        usuario = {"rol": "Conductor", "estado": "Activo"}
        with patch.object(backend, "_fetch_usuario_por_clave", new=AsyncMock(return_value=usuario)) as leer:
            self.assertIs(await backend._usuario_por_indice("01234567"), usuario)
            leer.assert_awaited_once_with("con.cero@kapital.com")
            leer.reset_mock()
            self.assertIsNone(await backend._usuario_por_indice("0234567"))
            leer.assert_not_awaited()

    async def test_the_login_answers_with_an_identifier_the_account_owns(self):
        """Devolvía lo tecleado; con el cero, las comprobaciones de propiedad lo rechazaban."""
        backend.usuarios_db["perez.gomez@kapital.com"] = {
            "rol": "Conductor", "estado": "Activo", "nombre": "Pérez",
            "password": backend.hash_password("provisional-segura"),
            "perfil_conductor": {"tipoDoc": "DNI", "numDoc": "4567891"},
        }
        with patch.object(backend, "reload_db", new=AsyncMock()), \
                patch.object(backend, "persist_users_only", new=AsyncMock()):
            respuesta = await backend.login_user(
                backend.UsuarioLogin(identifier="04567891", password="provisional-segura"), Response())
        usuario = backend.usuarios_db["perez.gomez@kapital.com"]
        self.assertTrue(backend._owner_matches(usuario, backend._IDENTITY_FIELDS, respuesta["identifier"]))

    async def test_the_login_index_also_finds_a_dni_typed_with_its_zero(self):
        backend.login_index = {"4567891": "perez.gomez@kapital.com"}
        backend._login_index_loaded_at = time.monotonic()
        usuario = {"rol": "Conductor", "estado": "Activo"}
        with patch.object(backend, "_fetch_usuario_por_clave", new=AsyncMock(return_value=usuario)) as leer:
            encontrado = await backend._usuario_por_indice("04567891")
        self.assertIs(encontrado, usuario)
        leer.assert_awaited_once_with("perez.gomez@kapital.com")

    async def test_pending_user_cannot_log_in(self):
        backend.usuarios_db["planner@example.com"] = {
            "identifier": "planner@example.com",
            "email": "planner@example.com",
            "password": "safe-password",
            "nombre": "Planner Baseline",
            "rol": "Programador de rutas",
            "estado": "Pendiente",
        }

        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.login_user(
                    backend.UsuarioLogin(identifier="planner@example.com", password="safe-password"),
                    Response(),
                )

        self.assertEqual(caught.exception.status_code, 403)

    async def test_active_login_keeps_frontend_contract(self):
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "email": None,
            "dni": "driver-001",
            "password": "safe-password",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "unidad_id": "K-001",
            "empresa_id": None,
            "estado": "Activo",
            "perfil_conductor": {"numDoc": "driver-001"},
        }

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            http_response = Response()
            response = await backend.login_user(
                backend.UsuarioLogin(identifier="driver-001", password="safe-password"),
                http_response,
            )

        expected_fields = {
            "identifier", "email", "dni", "nombre", "rol", "unidad_id",
            "empresa_id", "avatar", "estado", "needs_password_change", "profileComplete",
        }
        self.assertEqual(set(response), expected_fields)
        self.assertTrue(response["profileComplete"])
        self.assertTrue(backend.usuarios_db["driver-001"]["password"].startswith("pbkdf2_sha256$"))
        self.assertIn("HttpOnly", http_response.headers["set-cookie"])
        token = http_response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
        self.assertNotIn(token, json.dumps(backend.almacen_sesiones.filas))
        self.assertIn(hashlib.sha256(token.encode("utf-8")).hexdigest(),
                      backend.almacen_sesiones.filas)

    async def test_route_assignment_preserves_passengers_and_capacity(self):
        backend.conductores_db["K-001"] = {
            "capacidad": 15,
            "tipo": "Sprinter",
            "chofer": "Driver Baseline",
        }
        passenger_count = 17
        dataframe = pd.DataFrame({
            "FECHA.": ["13/09/2026"] * passenger_count,
            "HORA.": ["08:00"] * passenger_count,
            "SENTIDO.": ["ENTRADA"] * passenger_count,
            "SEDE.": ["LIMA"] * passenger_count,
            "COORDENADAS": [f"{-12.00 - i * 0.001},{-77.00 - i * 0.001}" for i in range(passenger_count)],
            "DISTRITO": ["SURCO"] * passenger_count,
            "DNI": [f"PAX-{i:03d}" for i in range(passenger_count)],
            "NOMBRES": [f"Passenger {i:03d}" for i in range(passenger_count)],
            "DIRECCION": [f"Street {i:03d}" for i in range(passenger_count)],
            "PROVEEDOR": ["CLIENTE BASELINE"] * passenger_count,
        })
        stream = io.BytesIO()
        dataframe.to_excel(stream, index=False)
        stream.seek(0)
        upload = UploadFile(filename="baseline-routes.xlsx", file=stream)
        random.seed(20260913)

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_routes_summary", new=AsyncMock()),
            patch.object(backend, "persist", new=AsyncMock()),
        ):
            routes = await backend.assign_routes_from_excel(
                upload,
                fecha="13/09/2026",
                hora="08:00",
                sentido="ENTRADA",
                sede="LIMA",
            )

        passengers = [passenger for route in routes for passenger in route["agentes"]]
        passenger_ids = [passenger["id"] for passenger in passengers]
        self.assertEqual(len(passengers), passenger_count)
        self.assertEqual(len(set(passenger_ids)), passenger_count)
        for route in routes:
            if route["conductor"] != "SIN ASIGNAR":
                self.assertLessEqual(len(route["agentes"]), 15)

    def test_route_summary_does_not_expose_passenger_details(self):
        routes = [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "agentes": [{"id": "PAX-001", "nombre": "Private Name"}],
        }]

        summary = backend._build_routes_summary(routes)

        self.assertEqual(summary, [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "count": 1,
        }])

    async def test_admin_resubmission_does_not_notify_admins(self):
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Documentos Observados",
            "perfil_conductor": {
                "dniScaneado": "old-document",
                "revision_docs": {
                    "dniScaneado": {"estado": "rechazado", "nota": "Unreadable"},
                },
            },
        }

        with (
            patch.object(backend, "persist_users_only", new=AsyncMock()),
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
            patch.object(backend.ws_manager, "broadcast_to_role", new=AsyncMock()) as broadcast,
        ):
            response = await backend.resubmit_driver_docs(
                backend.ResubmitDocsPayload(
                    email="driver-001",
                    docs={"dniScaneado": "new-document"},
                    uploaded_by="admin",
                )
            )

        self.assertEqual(response["estado"], "Pendiente Revisión")
        self.assertEqual(backend.notifications_db, [])
        broadcast.assert_not_awaited()

    async def test_driver_resubmission_notifies_admins_once_in_persistent_list(self):
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Documentos Observados",
            "perfil_conductor": {
                "dniScaneado": "old-document",
                "revision_docs": {
                    "dniScaneado": {"estado": "rechazado", "nota": "Unreadable"},
                },
            },
        }

        avisos_al_guardar = []

        async def guardar():
            avisos_al_guardar.append(len(backend.notifications_db))

        with (
            patch.object(backend, "persist_users_only", new=AsyncMock(side_effect=guardar)),
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
            patch.object(backend.ws_manager, "broadcast_to_role", new=AsyncMock()) as broadcast,
        ):
            await backend.resubmit_driver_docs(
                backend.ResubmitDocsPayload(
                    email="driver-001",
                    docs={"dniScaneado": "new-document"},
                    uploaded_by="conductor",
                )
            )

        self.assertEqual(len(backend.notifications_db), 1)
        self.assertEqual(backend.notifications_db[0]["para"], "admin")
        self.assertEqual(broadcast.await_count, 3)
        # El aviso tiene que ir en el mismo guardado; antes se añadía después y
        # solo llegaba a la base si otra acción guardaba más tarde.
        self.assertEqual(avisos_al_guardar, [1])

    async def test_clear_routes_archives_current_board(self):
        original_routes = [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "agentes": [{"id": "PAX-001"}],
        }]
        backend.rutas_estado_actual = copy.deepcopy(original_routes)

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist", new=AsyncMock()) as persist,
        ):
            await backend.clear_routes()

        self.assertEqual(backend.rutas_estado_actual, [])
        self.assertEqual(len(backend.historial_rutas), 1)
        self.assertEqual(backend.historial_rutas[0]["rutas"], original_routes)
        persist.assert_awaited_once()

    async def test_admin_user_list_never_returns_passwords(self):
        backend.usuarios_db.update({
            "admin@example.com": {
                "identifier": "admin@example.com",
                "password": "admin-secret",
                "nombre": "Admin Baseline",
                "rol": "Administración",
                "estado": "Activo",
            },
            "driver-001": {
                "identifier": "driver-001",
                "password": "driver-secret",
                "nombre": "Driver Baseline",
                "rol": "Conductor",
                "estado": "Activo",
            },
        })

        with patch.object(backend, "reload_db", new=AsyncMock()):
            response = await backend.get_all_users("admin@example.com")

        self.assertEqual(len(response["usuarios"]), 2)
        self.assertTrue(all("password" not in user for user in response["usuarios"]))

    async def test_driver_onboarding_moves_profile_to_review(self):
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "nombre": "Pending Driver",
            "rol": "Conductor",
            "estado": "Activo",
        }
        profile = {
            "nombres": "Driver Baseline",
            "numDoc": "driver-001",
            "dniScaneado": "data:application/pdf;base64,baseline",
        }

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            response = await backend.driver_onboarding(
                backend.DriverProfilePayload(email="driver-001", perfilData=profile)
            )

        self.assertEqual(response["estado"], "Pendiente Revisión")
        self.assertEqual(backend.usuarios_db["driver-001"]["perfil_conductor"], profile)
        self.assertEqual(backend.usuarios_db["driver-001"]["nombre"], "Driver Baseline")
        persist.assert_awaited_once()

    async def test_uploading_a_document_keeps_an_active_driver_active(self):
        # Pasó con la K-163 y la K-170: Administración les subió documentos desde
        # la ficha y quedaron «Pendiente Revisión», y aprobarlos pedía un padrón
        # que ya tenían.
        conductor = self._unidad_con_conductor()
        conductor["estado"] = "Activo"
        a, b, c, d = self._parches_de_envio()
        with a, b, c, d:
            for quien in ("admin", "conductor"):
                respuesta = await backend.resubmit_driver_docs(backend.ResubmitDocsPayload(
                    email="dni-K-027", docs={"cv": {"path": "K-027/cv-1.pdf"}}, uploaded_by=quien,
                ))
                self.assertEqual(respuesta["estado"], "Activo", quien)
            # Quien corrigió lo que le observaron sí vuelve a la cola.
            conductor["estado"] = "Documentos Observados"
            respuesta = await backend.resubmit_driver_docs(backend.ResubmitDocsPayload(
                email="dni-K-027", docs={"cv": {"path": "K-027/cv-2.pdf"}}, uploaded_by="conductor",
            ))
        self.assertEqual(respuesta["estado"], "Pendiente Revisión")

    async def test_the_accesos_list_carries_each_drivers_padron(self):
        self._unidad_con_conductor()
        backend.usuarios_db["admin@example.com"] = {
            "identifier": "admin@example.com", "rol": "Administración", "estado": "Activo",
        }
        with patch.object(backend, "reload_db", new=AsyncMock()):
            respuesta = await backend.get_all_users("admin@example.com")
        filas = {u["email"]: u for u in respuesta["usuarios"]}
        self.assertEqual(filas["dni-K-027"]["unidad_id"], "K-027")
        self.assertIsNone(filas["admin@example.com"]["unidad_id"])

    def _parches_de_envio(self):
        return (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
            patch.object(backend.ws_manager, "broadcast_to_role", new=AsyncMock()),
        )

    async def test_the_alta_requires_the_dates_of_the_documents_that_expire(self):
        # Pedido del usuario (2026-09-29): el SOAT, la licencia y la revisión
        # técnica van con su fecha de vencimiento, obligatoria, y pasan al panel.
        conductor = self._unidad_con_conductor()
        perfil = {
            "nombres": "CHAVEZ", "soat": {"path": "K-027/soat-1.jpg"},
            "licenciaConducirCompleto": {"path": "K-027/licenciaConducirCompleto-1.jpg"},
        }
        casos = [
            ({"licenciaConducirVence": "2027-05-01"}, "del SOAT"),
            ({"soatVence": "2027-01-31"}, "de la licencia"),
            ({"soatVence": "31/01/2027", "licenciaConducirVence": "2027-05-01"}, "AAAA-MM-DD"),
        ]
        a, b, c, d = self._parches_de_envio()
        with a, b, c, d:
            for fechas, detalle in casos:
                with self.assertRaises(HTTPException) as caught:
                    await backend.driver_onboarding(
                        backend.DriverProfilePayload(email="dni-K-027", perfilData={**perfil, **fechas}),
                    )
                self.assertEqual(caught.exception.status_code, 400, fechas)
                self.assertIn(detalle, caught.exception.detail)
            await backend.driver_onboarding(backend.DriverProfilePayload(
                email="dni-K-027",
                perfilData={**perfil, "soatVence": "2027-01-31", "licenciaConducirVence": "2027-05-01"},
            ))

        self.assertEqual(conductor["perfil_conductor"]["soatVence"], "2027-01-31")
        # Llegan al panel: la unidad es de donde lee su semáforo.
        unidad = backend.conductores_db["K-027"]
        self.assertEqual((unidad["soat"], unidad["licencia"]), ("2027-01-31", "2027-05-01"))

    async def test_uploading_an_expiring_document_from_the_portal_asks_its_date(self):
        conductor = self._unidad_con_conductor()
        revision = {"path": "K-027/revisionTecnica-1.pdf"}
        a, b, c, d = self._parches_de_envio()
        with a, b, c, d:
            with self.assertRaises(HTTPException) as caught:
                await backend.resubmit_driver_docs(backend.ResubmitDocsPayload(
                    email="dni-K-027", docs={"revisionTecnica": revision}, uploaded_by="conductor",
                ))
            self.assertEqual(caught.exception.status_code, 400)
            await backend.resubmit_driver_docs(backend.ResubmitDocsPayload(
                email="dni-K-027", docs={"revisionTecnica": revision, "revisionTecnicaVence": "2027-03-15"},
                uploaded_by="conductor",
            ))
            self.assertEqual(conductor["perfil_conductor"]["revisionTecnicaVence"], "2027-03-15")
            self.assertEqual(backend.conductores_db["K-027"]["revision"], "2027-03-15")
            # Administración sube sin fecha: la pone en la ficha, junto al documento.
            await backend.resubmit_driver_docs(backend.ResubmitDocsPayload(
                email="dni-K-027", docs={"soat": {"path": "K-027/soat-2.jpg"}}, uploaded_by="admin",
            ))
        self.assertEqual(conductor["perfil_conductor"]["soat"]["path"], "K-027/soat-2.jpg")

    async def test_the_panel_shows_the_date_the_driver_wrote(self):
        conductor = self._unidad_con_conductor()
        conductor["perfil_conductor"]["soatVence"] = "2027-01-31"
        backend.conductores_db["K-027"]["licencia"] = "2026-12-01"
        conductor["perfil_conductor"]["licenciaConducirVence"] = "2030-01-01"
        with patch.object(backend, "reload_db", new=AsyncMock()):
            respuesta = await backend.get_flota_status()
        fila = next(f for f in respuesta["flota"] if f["unidad_id"] == "K-027")
        self.assertEqual(fila["soat"], "2027-01-31", "si la unidad no la tiene, la del conductor")
        self.assertEqual(fila["licencia"], "2026-12-01", "manda la unidad, como en todo")

    async def test_a_date_edited_in_the_ficha_reaches_the_drivers_profile(self):
        conductor = self._unidad_con_conductor()
        await self._editar_unidad("K-027", soat="2027-06-30")
        self.assertEqual(conductor["perfil_conductor"]["soatVence"], "2027-06-30")

    def test_approving_a_driver_brings_their_dates_to_the_unit(self):
        conductor = {
            "nombre": "X",
            "perfil_conductor": {"soatVence": "2027-01-31", "licenciaConducirVence": "2027-05-01"},
        }
        with mock.patch.dict(backend.conductores_db, {"KAP-011": {"soat": "2020-01-01"}}, clear=True):
            backend._sembrar_unidad("KAP-011", conductor)
            unidad = dict(backend.conductores_db["KAP-011"])
        self.assertEqual((unidad["soat"], unidad["licencia"]), ("2027-01-31", "2027-05-01"))

    async def test_rejected_document_observes_driver_and_notifies_them(self):
        backend.usuarios_db.update({
            "admin@example.com": {
                "identifier": "admin@example.com",
                "nombre": "Admin Baseline",
                "rol": "Administración",
                "estado": "Activo",
            },
            "driver-001": {
                "identifier": "driver-001",
                "nombre": "Driver Baseline",
                "rol": "Conductor",
                "estado": "Pendiente Revisión",
                "perfil_conductor": {"revision_docs": {}},
            },
        })

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
            patch.object(backend.ws_manager, "send", new=AsyncMock()) as send,
        ):
            response = await backend.review_driver_doc(
                backend.DriverDocReviewPayload(
                    admin_email="admin@example.com",
                    conductor_email="driver-001",
                    campo="dniScaneado",
                    estado="rechazado",
                    nota="Documento ilegible",
                )
            )

        self.assertEqual(response["estado_conductor"], "Documentos Observados")
        self.assertEqual(len(backend.notifications_db), 1)
        self.assertEqual(backend.notifications_db[0]["para"], "driver-001")
        send.assert_awaited_once()

    async def test_mark_notification_read_preserves_notification(self):
        backend.notifications_db.append({
            "id": 101,
            "para": "driver-001",
            "mensaje": "Baseline",
            "leido": False,
        })

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            await backend.mark_notification_read(backend.MarkReadPayload(notif_id=101))

        self.assertEqual(len(backend.notifications_db), 1)
        self.assertTrue(backend.notifications_db[0]["leido"])
        persist.assert_awaited_once()

    async def test_fleet_response_is_enriched_from_driver_profile(self):
        backend.conductores_db["K-001"] = {
            "placa": "OLD-001",
            "capacidad": 15,
            "tipo": "Sprinter",
            "chofer": "Driver Baseline",
            "telefono": "900000000",
        }
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "unidad_id": "K-001",
            "perfil_conductor": {
                "placa": "NEW-001",
                "direccion": "Baseline address",
                "numDoc": "driver-001",
                "fechaNacimiento": "1990-01-01",
                "telefonoDirecto": "911111111",
            },
        }

        backend.conductores_db["K-002"] = {"capacidad": 4, "chofer": "Sin copia"}
        backend.usuarios_db["driver-002"] = {
            "identifier": "driver-002", "rol": "Conductor", "unidad_id": "K-002",
            "perfil_conductor": {"placa": "PER-002", "telefonoDirecto": "922222222"},
        }

        with patch.object(backend, "reload_db", new=AsyncMock()):
            response = await backend.get_flota_status()

        por_unidad = {v["unidad_id"]: v for v in response["flota"]}
        vehicle = por_unidad["K-001"]
        self.assertEqual(vehicle["placa"], "K-001")
        self.assertEqual(vehicle["unidad_id"], "K-001")
        # Cualquier rol con sesión lee esta lista: el DNI, la dirección y el
        # nacimiento del conductor ya no viajan en ella.
        for personal in ("dni", "direccion", "fecha_nacimiento"):
            self.assertNotIn(personal, vehicle)
        # La unidad manda, que es lo que se edita desde la ficha: antes ganaba
        # el perfil y un teléfono cambiado en la página salía viejo.
        self.assertEqual(vehicle["real_placa"], "OLD-001")
        self.assertEqual(vehicle["celular"], "900000000")
        # Lo que la unidad no tiene lo pone el perfil.
        self.assertEqual(por_unidad["K-002"]["real_placa"], "PER-002")
        self.assertEqual(por_unidad["K-002"]["celular"], "922222222")

    async def test_manager_summary_uses_compact_persisted_shape(self):
        backend.routes_summary = [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "count": 12,
        }]

        with patch.object(backend, "reload_routes_summary", new=AsyncMock()):
            summary = await backend.get_routes_summary()

        self.assertEqual(summary, backend.routes_summary)
        self.assertNotIn("agentes", summary[0])

    async def test_password_change_accepts_legacy_password_and_stores_hash(self):
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "password": "legacy-password",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
            "needs_password_change": True,
        }

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            await backend.change_password(backend.ChangePasswordRequest(
                identifier="driver-001",
                old_password="legacy-password",
                new_password="new-safe-password",
            ))

        stored_password = backend.usuarios_db["driver-001"]["password"]
        self.assertNotEqual(stored_password, "new-safe-password")
        self.assertTrue(backend.verify_password("new-safe-password", stored_password))
        self.assertFalse(backend.usuarios_db["driver-001"]["needs_password_change"])
        persist.assert_awaited_once()

    async def test_profile_endpoint_rejects_direct_role_change(self):
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "password": backend.hash_password("safe-password"),
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }

        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.update_profile(backend.UsuarioUpdate(
                    identifier="driver-001",
                    rol="Administración",
                ))

        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(backend.usuarios_db["driver-001"]["rol"], "Conductor")

    async def test_hash_compatibility_mode_reads_hashes_without_rewriting_plaintext(self):
        hashed = backend.hash_password("already-hashed-password")
        self.assertTrue(backend.verify_password("already-hashed-password", hashed))

        backend.PASSWORD_HASH_WRITE_ENABLED = False
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001",
            "email": None,
            "dni": "driver-001",
            "password": "legacy-password",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            await backend.login_user(
                backend.UsuarioLogin(identifier="driver-001", password="legacy-password"),
                Response(),
            )

        self.assertEqual(backend.usuarios_db["driver-001"]["password"], "legacy-password")

    async def test_session_lookup_accepts_valid_token_and_rejects_unknown_token(self):
        user = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.usuarios_db["driver-001"] = user
        raw_token = await backend.abrir_sesion(user)

        self.assertIs(await backend.get_user_by_session(raw_token), user)
        self.assertIsNone(await backend.get_user_by_session("unknown-token"))

    async def test_current_user_dependency_accepts_session_cookie(self):
        user = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.usuarios_db["driver-001"] = user
        raw_token = await backend.abrir_sesion(user)

        with patch.object(backend, "reload_db", new=AsyncMock()):
            current_user = await backend.get_current_user(raw_token)

        self.assertIs(current_user, user)

    async def test_enforced_profile_access_rejects_another_users_session(self):
        backend.AUTH_ENFORCED = True
        owner = {
            "identifier": "driver-001",
            "email": None,
            "nombre": "Owner Driver",
            "rol": "Conductor",
            "estado": "Activo",
        }
        other = {
            "identifier": "driver-002",
            "email": None,
            "nombre": "Other Driver",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.usuarios_db.update({"driver-001": owner, "driver-002": other})
        other_token = await backend.abrir_sesion(other)

        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.get_profile("driver-001", other_token)

        self.assertEqual(caught.exception.status_code, 403)

    async def test_enforced_admin_access_rejects_spoofed_admin_identifier(self):
        backend.AUTH_ENFORCED = True
        admin = {
            "identifier": "admin@example.com",
            "email": "admin@example.com",
            "nombre": "Admin Baseline",
            "rol": "Administración",
            "estado": "Activo",
        }
        driver = {
            "identifier": "driver-001",
            "email": None,
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.usuarios_db.update({"admin@example.com": admin, "driver-001": driver})
        driver_token = await backend.abrir_sesion(driver)

        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.get_all_users("admin@example.com", driver_token)

        self.assertEqual(caught.exception.status_code, 403)

    async def test_reload_db_fails_closed_on_supabase_402_without_clearing_state(self):
        backend.db_loaded = False
        backend.usuarios_db["sentinel"] = {"identifier": "sentinel"}

        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(
            402,
            json={"message": "secret provider response"},
        )

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                await backend.reload_db()

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)
        self.assertNotIn("secret provider response", str(caught.exception.detail))
        self.assertFalse(backend.db_loaded)
        self.assertIn("sentinel", backend.usuarios_db)

    async def test_persist_users_only_fails_closed_without_echoing_provider_body(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.patch.return_value = httpx.Response(
            500,
            json={"message": "secret provider response"},
        )

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                await backend.persist_users_only()

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_WRITE_UNAVAILABLE_DETAIL)
        self.assertNotIn("secret provider response", str(caught.exception.detail))

    async def test_old_read_only_target_blocks_writes_before_http_request(self):
        read_only_config = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "OLD",
            "KAPITAL_OLD_SUPABASE_URL": "https://old-read-only.invalid/rest/v1",
            "KAPITAL_OLD_SUPABASE_KEY": "old-read-only-key",
            "KAPITAL_OLD_READ_ONLY": "true",
        })
        backend._activate_storage_config(read_only_config)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.patch.return_value = httpx.Response(204)

        try:
            with patch.object(backend.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(HTTPException) as caught:
                    await backend.persist_users_only()
        finally:
            backend._activate_storage_config(self._storage_config)

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_WRITE_UNAVAILABLE_DETAIL)
        client.patch.assert_not_awaited()

    async def test_v2_staged_target_does_not_call_remote_without_opt_in(self):
        staged_v2 = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-staged.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "v2-staged-key",
        })
        backend._activate_storage_config(staged_v2)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None

        try:
            with patch.object(backend.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(HTTPException) as caught:
                    await backend.reload_db()
        finally:
            backend._activate_storage_config(self._storage_config)

        self.assertEqual(caught.exception.status_code, 503)
        client.get.assert_not_awaited()

    async def test_login_propagates_database_unavailable_as_503(self):
        database_error = HTTPException(
            status_code=503,
            detail=backend.DATABASE_UNAVAILABLE_DETAIL,
        )
        with patch.object(
            backend,
            "reload_db",
            new=AsyncMock(side_effect=database_error),
        ):
            with self.assertRaises(HTTPException) as caught:
                await backend.login_user(
                    backend.UsuarioLogin(identifier="user@example.com", password="password"),
                    Response(),
                )

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)

    async def test_reload_notifications_accepts_partial_app_state_response(self):
        notifications = [{"id": 7, "type": "info", "message": "Baseline"}]
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(
            200,
            json=[{"usuarios": {"__notifications__": notifications}}],
        )

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.reload_notifications()

        self.assertEqual(backend.notifications_db, notifications)

    async def test_routes_summary_persist_keeps_notifications_snapshot(self):
        notifications = [{"id": 11, "type": "success", "message": "Keep me"}]
        backend.notifications_db.extend(notifications)
        summary = [{"conductor": "K-001", "micro_zona": "SURCO", "horario": "08:00", "count": 1}]

        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.patch.return_value = httpx.Response(204)

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.persist_routes_summary(summary)

        payload = client.patch.call_args.kwargs["json"]
        self.assertEqual(payload["usuarios"]["__notifications__"], notifications)
        self.assertEqual(backend.routes_summary, summary)

    async def test_publish_routes_persists_canonical_user_snapshot(self):
        backend.usuarios_db.update({
            "driver-001": {"identifier": "driver-001", "rol": "Conductor"},
            "__custom_meta__": {"keep": True},
        })
        backend.historial_rutas[:] = [{"id": "history-1"}]
        backend.board_lock.update({"existing": "lock"})
        backend.conductores_db["K-001"] = {"capacidad": 15, "tipo": "Sprinter"}
        backend.notifications_db.append({"id": 1, "type": "info"})
        summary = [{"conductor": "K-001", "micro_zona": "SURCO", "horario": "08:00", "count": 1}]

        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.patch.return_value = httpx.Response(204)

        with (
            patch.object(backend, "ensure_db_loaded", new=AsyncMock()),
            patch.object(backend.httpx, "AsyncClient", return_value=client),
        ):
            response = await backend.publish_routes_summary([
                {"conductor": "K-001", "micro_zona": "SURCO", "horario": "08:00", "agentes": [{"id": "PAX-1"}]},
            ])

        payload = client.patch.call_args.kwargs["json"]
        snapshot = payload["usuarios"]
        self.assertEqual(response["total_routes"], 1)
        self.assertEqual(payload["id"], 1)
        self.assertEqual(snapshot["driver-001"]["identifier"], "driver-001")
        self.assertEqual(snapshot["__custom_meta__"], {"keep": True})
        self.assertEqual(backend.usuarios_db["__custom_meta__"], {"keep": True})
        self.assertEqual(snapshot["__routes_summary__"], summary)
        self.assertEqual(snapshot["__historial_rutas__"], backend.historial_rutas)
        self.assertEqual(snapshot["__flota__"], backend.conductores_db)
        self.assertEqual(snapshot["__notifications__"], backend.notifications_db)
        self.assertEqual(snapshot["__lock__"]["existing"], "lock")
        self.assertEqual(snapshot["__lock__"]["routes_summary"], summary)

    async def test_publish_routes_cold_start_keeps_canonical_supabase_metadata(self):
        canonical_flota = {"REAL-001": {"capacidad": 19, "tipo": "Van"}}
        canonical_history = [{"id": "history-real"}]
        canonical_lock = {"owner": "planner-real"}
        canonical_notifications = [{"id": 77, "type": "info"}]
        canonical_state = {
            "usuarios": {
                "driver-real": {"identifier": "driver-real", "rol": "Conductor"},
                "__routes_summary__": [{"conductor": "OLD", "count": 2}],
                "__historial_rutas__": canonical_history,
                "__lock__": canonical_lock,
                "__flota__": canonical_flota,
                "__notifications__": canonical_notifications,
            },
            "rutas": [],
        }
        summary = [{"conductor": "REAL-001", "micro_zona": "SURCO", "horario": "08:00", "count": 1}]
        backend.db_loaded = False

        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(200, json=[canonical_state])
        client.patch.return_value = httpx.Response(204)

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.publish_routes_summary([
                {"conductor": "REAL-001", "micro_zona": "SURCO", "horario": "08:00", "agentes": [{"id": "PAX-REAL"}]},
            ])

        payload = client.patch.call_args.kwargs["json"]["usuarios"]
        self.assertEqual(payload["__routes_summary__"], summary)
        self.assertEqual(payload["__historial_rutas__"], canonical_history)
        self.assertEqual(payload["__lock__"]["owner"], "planner-real")
        self.assertEqual(payload["__lock__"]["routes_summary"], summary)
        self.assertEqual(payload["__flota__"], canonical_flota)
        self.assertNotIn("KAP-001", payload["__flota__"])
        self.assertEqual(payload["__notifications__"], canonical_notifications)

    async def test_assign_routes_repropagates_persistence_503(self):
        backend.conductores_db["K-001"] = {"capacidad": 15, "tipo": "Sprinter"}
        dataframe = pd.DataFrame({
            "FECHA.": ["13/09/2026"],
            "HORA.": ["08:00"],
            "SENTIDO.": ["ENTRADA"],
            "SEDE.": ["LIMA"],
            "COORDENADAS": ["-12.0,-77.0"],
            "DISTRITO": ["SURCO"],
            "DNI": ["PAX-001"],
            "NOMBRES": ["Passenger"],
            "DIRECCION": ["Street"],
            "PROVEEDOR": ["CLIENTE"],
        })
        stream = io.BytesIO()
        dataframe.to_excel(stream, index=False)
        stream.seek(0)
        upload = UploadFile(filename="routes.xlsx", file=stream)
        database_error = HTTPException(
            status_code=503,
            detail=backend.DATABASE_WRITE_UNAVAILABLE_DETAIL,
        )

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_routes_summary", new=AsyncMock(side_effect=database_error)),
            patch.object(backend, "persist", new=AsyncMock()),
        ):
            with self.assertRaises(HTTPException) as caught:
                await backend.assign_routes_from_excel(
                    upload,
                    fecha="13/09/2026",
                    hora="08:00",
                    sentido="ENTRADA",
                    sede="LIMA",
                )

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_WRITE_UNAVAILABLE_DETAIL)

    async def test_loaders_reject_invalid_reserved_state_as_503(self):
        for loader in (backend.reload_db, backend.ensure_db_loaded):
            backend.db_loaded = False
            backend.usuarios_db["sentinel"] = {"identifier": "sentinel"}
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.__aexit__.return_value = None
            client.get.return_value = httpx.Response(
                200,
                json=[{"usuarios": {"__flota__": []}, "rutas": []}],
            )

            with patch.object(backend.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(HTTPException) as caught:
                    await loader()

            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)
            self.assertFalse(backend.db_loaded)
            self.assertIn("sentinel", backend.usuarios_db)

    async def test_reload_db_uses_fresh_ttl_cache(self):
        state = {
            "usuarios": {
                "driver-001": {"identifier": "driver-001", "rol": "Conductor"},
                "__routes_summary__": [],
                "__historial_rutas__": [],
                "__lock__": {},
                "__flota__": {},
                "__notifications__": [],
            },
            "rutas": [],
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(200, json=[state])

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.reload_db()
            await backend.reload_db()

        self.assertEqual(client.get.await_count, 1)
        self.assertTrue(backend.db_loaded)
        self.assertGreater(backend._db_cache_loaded_at, 0)

    async def test_reload_db_single_flight_avoids_duplicate_full_reads(self):
        state = {
            "usuarios": {
                "driver-001": {"identifier": "driver-001", "rol": "Conductor"},
                "__routes_summary__": [],
                "__historial_rutas__": [],
                "__lock__": {},
                "__flota__": {},
                "__notifications__": [],
            },
            "rutas": [],
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(200, json=[state])

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await asyncio.gather(backend.reload_db(), backend.reload_db())

        self.assertEqual(client.get.await_count, 1)
        self.assertEqual(backend.usuarios_db["driver-001"]["identifier"], "driver-001")

    async def test_successful_write_invalidates_all_read_caches(self):
        backend.db_loaded = True
        now = time.monotonic()
        backend._db_cache_loaded_at = now
        backend._notifications_cache_loaded_at = now
        backend._routes_summary_cache_loaded_at = now
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.patch.return_value = httpx.Response(204)

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.persist_users_only()

        self.assertFalse(backend.db_loaded)
        self.assertEqual(backend._db_cache_loaded_at, 0.0)
        self.assertEqual(backend._notifications_cache_loaded_at, 0.0)
        self.assertEqual(backend._routes_summary_cache_loaded_at, 0.0)

    async def test_reload_notifications_requests_reserved_json_projection(self):
        notifications = [{"id": 7, "type": "info", "message": "Baseline"}]
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(
            200,
            json=[{"usuarios": {"__notifications__": notifications}}],
        )

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.reload_notifications()

        requested_url = client.get.call_args.args[0]
        self.assertIn("select=usuarios->__notifications__", requested_url)
        self.assertEqual(backend.notifications_db, notifications)

    async def test_reload_routes_summary_requests_compact_json_projection(self):
        summary = [{"conductor": "K-001", "micro_zona": "SURCO", "horario": "08:00", "count": 2}]
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(
            200,
            json=[{"usuarios": {"__routes_summary__": summary}}],
        )

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.reload_routes_summary()

        requested_url = client.get.call_args.args[0]
        self.assertIn("select=usuarios->__routes_summary__", requested_url)
        self.assertEqual(backend.routes_summary, summary)

    async def test_projection_falls_back_to_users_object_when_json_path_is_unsupported(self):
        notifications = [{"id": 8, "type": "warning", "message": "Fallback"}]
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.side_effect = [
            httpx.Response(406, json={"message": "projection unsupported"}),
            httpx.Response(200, json=[{"usuarios": {"__notifications__": notifications}}]),
        ]

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            await backend.reload_notifications()

        self.assertEqual(client.get.await_count, 2)
        self.assertIn("select=usuarios", client.get.call_args_list[1].args[0])
        self.assertEqual(backend.notifications_db, notifications)

    async def test_compat_routes_use_top_level_projection_and_cache_independently(self):
        routes = [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "agentes": [{"id": "PAX-001", "empresa": "CLIENT A"}],
        }]
        compat = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        })
        backend._activate_storage_config(compat)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(200, json=[{"rutas": routes}])

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            self.assertEqual(await backend.get_routes(), routes)
            self.assertEqual(await backend.get_routes(), routes)

        self.assertEqual(client.get.await_count, 1)
        requested_url = client.get.call_args.args[0]
        self.assertIn("select=rutas", requested_url)
        self.assertNotIn("select=usuarios%2Crutas", requested_url)
        self.assertFalse(backend.db_loaded)

    async def test_compat_login_uses_users_projection_without_json_path_identifier(self):
        user = {
            "identifier": "driver@example.com",
            "email": "driver@example.com",
            "password": "safe-password",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }
        compat = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        })
        backend._activate_storage_config(compat)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(200, json=[{"usuarios": user}])

        with (
            patch.object(backend.httpx, "AsyncClient", return_value=client),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            response = await backend.login_user(
                backend.UsuarioLogin(identifier="driver@example.com", password="safe-password"),
                Response(),
            )

        self.assertEqual(response["identifier"], "driver@example.com")
        requested_url = client.get.call_args.args[0]
        self.assertIn("select=usuarios", requested_url)
        self.assertNotIn("usuarios->driver", requested_url)
        self.assertNotIn("select=usuarios%2Crutas", requested_url)
        self.assertFalse(backend.db_loaded)

    async def test_compat_cold_login_writes_only_the_upgraded_password(self):
        """Un login que cifra la contraseña escribe ese campo y nada más.

        Antes descargaba el estado completo para poder reescribir la fila
        entera sin perder las claves reservadas. Ahora la escritura lleva solo
        lo que cambió, así que ni hace falta la descarga ni puede pisar nada.
        """
        user = {
            "identifier": "admin@example.com",
            "email": "admin@example.com",
            "password": "safe-password",
            "nombre": "Admin Baseline",
            "rol": "Administración",
            "estado": "Activo",
        }
        canonical_state = {
            "usuarios": {
                "admin@example.com": dict(user),
                "__routes_summary__": [{"conductor": "K-001", "count": 1}],
                "__historial_rutas__": [{"id": "history-1"}],
                "__lock__": {"routes_summary": [{"conductor": "K-001", "count": 1}]},
                "__flota__": {"K-001": {"capacidad": 15, "tipo": "Sprinter"}},
                "__notifications__": [{"id": 9, "type": "info", "message": "Keep me"}],
            },
            "rutas": [{"conductor": "K-001", "agentes": [{"id": "PAX-001"}]}],
        }
        compat = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        })
        backend._activate_storage_config(compat)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        # Primero se tantea el índice de acceso, que en una fila sin él
        # devuelve nulo y se abandona en diecinueve bytes. Después la lectura
        # de usuarios, y ya: nada de estado completo.
        client.get.side_effect = [
            httpx.Response(200, json=[{"usuarios": None}]),
            httpx.Response(200, json=[{"usuarios": {"admin@example.com": user}}]),
        ]
        client.post.return_value = httpx.Response(200, json={"aplicados": 1, "omitidos": 0})

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            response = await backend.login_user(
                backend.UsuarioLogin(identifier="admin@example.com", password="safe-password"),
                Response(),
            )

        self.assertEqual(response["identifier"], "admin@example.com")
        self.assertEqual(client.get.await_count, 2)  # índice + usuarios
        client.patch.assert_not_awaited()
        self.assertTrue(client.post.call_args.args[0].endswith("/rpc/guardar_estado"))
        cambios = client.post.call_args.kwargs["json"]["p_cambios"]
        tocado = {tuple(op["ruta"][:2]) for op in cambios["poner"] if op["ruta"][0] != "__login__"}
        self.assertEqual(tocado, {("admin@example.com", "password")})
        self.assertTrue(cambios["poner"][0]["valor"].startswith(f"{backend.PASSWORD_SCHEME}$"))
        self.assertNotIn("quitar", cambios)
        self.assertNotIn("listas", cambios)
        for reserved_key in canonical_state["usuarios"]:
            if reserved_key.startswith("__"):
                self.assertNotIn(reserved_key, json.dumps(cambios))

    async def test_a_login_through_the_index_never_drops_the_other_users(self):
        """El atajo trae un solo usuario, y la escritura no puede borrar al resto.

        Es el riesgo real de resolver un login sin leer el bloque entero: si la
        persistencia usara lo que hay en memoria —una única cuenta—, un acceso
        cualquiera borraría a los ciento y pico restantes. Antes lo impedía
        descargar el estado completo antes del PATCH; ahora, que solo viaja lo
        que cambió y nada de lo que no se leyó cuenta como borrado.
        """
        entrando = {
            "identifier": "09704190", "email": "chofer@kapital.com",
            "password": "su-clave", "nombre": "Conductor Uno",
            "rol": "Conductor", "estado": "Activo",
        }
        otros = {
            f"conductor{n}@kapital.com": {
                "identifier": f"conductor{n}@kapital.com", "password": "x",
                "nombre": f"Conductor {n}", "rol": "Conductor", "estado": "Activo",
            }
            for n in range(40)
        }
        estado_completo = {
            "usuarios": {
                "chofer@kapital.com": dict(entrando),
                **otros,
                "__routes_summary__": [], "__historial_rutas__": [],
                "__lock__": {}, "__flota__": {"K-001": {"capacidad": 4}},
                "__notifications__": [],
                "__login__": {"09704190": "chofer@kapital.com"},
            },
            "rutas": [],
        }
        backend._activate_storage_config(backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        }))
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        # Índice y el usuario suelto. PostgREST nombra la columna con el último
        # tramo del camino, así que una proyección vuelve como
        # {"__login__": ...}, no anidada bajo "usuarios". Comprobado contra la
        # base real.
        client.get.side_effect = [
            httpx.Response(200, json=[{"__login__": {"09704190": "chofer@kapital.com"}}]),
            httpx.Response(200, json=[{"chofer@kapital.com": dict(entrando)}]),
        ]
        client.post.return_value = httpx.Response(200, json={"aplicados": 1, "omitidos": 0})

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            respuesta = await backend.login_user(
                backend.UsuarioLogin(identifier="09704190", password="su-clave"),
                Response(),
            )

        self.assertEqual(respuesta["identifier"], "09704190")
        self.assertEqual(client.get.await_count, 2, "ni una lectura del estado completo")
        cambios = client.post.call_args.kwargs["json"]["p_cambios"]
        escrito = json.dumps(cambios)
        # Ninguno de los que no participan en este login viaja, ni para borrarlo.
        self.assertNotIn("quitar", cambios)
        for clave in otros:
            self.assertNotIn(clave, escrito)
        self.assertEqual(
            {op["ruta"][0] for op in cambios["poner"]}, {"chofer@kapital.com", "__login__"})
        # Y las claves reservadas tampoco: son el tablero, la flota y el resto.
        self.assertNotIn("__flota__", escrito)
        self.assertNotIn(estado_completo["usuarios"]["__flota__"]["K-001"], cambios["poner"])

    def test_passwords_are_hashed_on_write_by_default(self):
        """Guardar en claro tiene que ser una decisión explícita, no el defecto.

        Estuvo apagado por seguridad de rollback: cifrar antes de desplegar la
        lectura compatible habría dejado fuera a todo el mundo. Esa lectura
        lleva desplegada desde el PR #3, así que apagado solo significaba
        contraseñas en claro.
        """
        self.assertTrue(backend.PASSWORD_HASH_WRITE_ENABLED,
                        "el valor por defecto debe cifrar")

        guardada = backend.password_for_storage("una-clave")
        self.assertTrue(guardada.startswith(f"{backend.PASSWORD_SCHEME}$"))
        self.assertNotIn("una-clave", guardada)
        self.assertTrue(backend.verify_password("una-clave", guardada))
        self.assertFalse(backend.verify_password("otra-clave", guardada))

        # Y lo de antes se sigue leyendo: nadie se queda fuera por la migración.
        self.assertTrue(backend.verify_password("vieja", "vieja"))

    def test_no_account_is_conjured_out_of_a_hardcoded_password(self):
        """Ninguna cuenta puede nacer de una contraseña escrita en el código.

        Los dos decodificadores sembraban «TELEPERFORMANCE» con la clave
        «1234» en cada lectura del estado. Era una credencial conocida sobre
        una cuenta real y en uso, y como se reinyectaba siempre, borrarla no
        servía de nada: volvía sola en la siguiente lectura.
        """
        fila = {"usuarios": {"real@kapital.com": {"identifier": "real@kapital.com",
                                                  "password": "x", "rol": "Conductor"}}}

        decodificado = backend._decode_full_state(fila, include_defaults=True)
        self.assertEqual(list(decodificado["usuarios"]), ["real@kapital.com"])

        proyectado = backend._compat_users_from_projection(fila["usuarios"], "prueba")
        self.assertEqual(list(proyectado), ["real@kapital.com"])

        # Y por si alguien la reintroduce con otro nombre: ninguna contraseña
        # puede estar escrita en el módulo.
        fuente = Path(backend.__file__).read_text(encoding="utf-8")
        self.assertNotIn('"password": "1234"', fuente)

    async def test_compat_profile_and_admin_users_use_users_projection(self):
        users = {
            "admin@example.com": {
                "identifier": "admin@example.com",
                "email": "admin@example.com",
                "password": "admin-secret",
                "nombre": "Admin Baseline",
                "rol": "Administración",
                "estado": "Activo",
            },
            "driver@example.com": {
                "identifier": "driver@example.com",
                "email": "driver@example.com",
                "password": "driver-secret",
                "nombre": "Driver Baseline",
                "rol": "Conductor",
                "estado": "Activo",
            },
        }
        compat = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
        })
        backend._activate_storage_config(compat)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(200, json=[{"usuarios": users}])

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            profile = await backend.get_profile("driver@example.com")
            listing = await backend.get_all_users("admin@example.com")

        self.assertEqual(profile["identifier"], "driver@example.com")
        # Solo los dos de la fila. Antes salían tres: el decodificador sembraba
        # una cuenta «TELEPERFORMANCE» con la contraseña escrita en el código.
        self.assertEqual(len(listing["usuarios"]), 2)
        self.assertNotIn("TELEPERFORMANCE", {u.get("identifier") for u in listing["usuarios"]},
                         "ninguna cuenta puede aparecer de la nada")
        # Dos lecturas: el tanteo del índice de acceso —que en una fila sin él
        # no devuelve nada y se abandona— y la del bloque de usuarios, que
        # queda cacheada para la segunda llamada.
        self.assertEqual(client.get.await_count, 2)
        self.assertIn("select=usuarios->%22__login__%22", client.get.call_args_list[0].args[0])
        self.assertIn("select=usuarios", client.get.call_args_list[1].args[0])

    async def test_compat_fleet_uses_reserved_fleet_projection(self):
        fleet = {"K-001": {"placa": "PLATE-001", "capacidad": 15, "tipo": "Sprinter"}}
        compat = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
        })
        backend._activate_storage_config(compat)
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(
            200,
            json=[{"usuarios": {"__flota__": fleet}}],
        )

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            response = await backend.get_flota_status()

        self.assertEqual(response["flota"][0]["unidad_id"], "K-001")
        requested_url = client.get.call_args.args[0]
        self.assertIn("select=usuarios->__flota__", requested_url)
        self.assertFalse(backend.db_loaded)

    async def test_temporary_provider_503_retries_with_backoff(self):
        state = {
            "usuarios": {
                "__routes_summary__": [],
                "__historial_rutas__": [],
                "__lock__": {},
                "__flota__": {},
                "__notifications__": [],
            },
            "rutas": [],
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.side_effect = [
            httpx.Response(503, json={"message": "provider detail"}),
            httpx.Response(200, json=[state]),
        ]

        with (
            patch.object(backend.httpx, "AsyncClient", return_value=client),
            patch.object(backend.asyncio, "sleep", new=AsyncMock()) as sleep,
        ):
            await backend.reload_db()

        self.assertEqual(client.get.await_count, 2)
        sleep.assert_awaited_once()
        self.assertTrue(backend.db_loaded)

    async def test_timeout_retries_then_returns_sanitized_503(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.side_effect = [
            httpx.ReadTimeout("secret timeout"),
            httpx.ReadTimeout("secret timeout"),
        ]

        with (
            patch.object(backend.httpx, "AsyncClient", return_value=client),
            patch.object(backend.asyncio, "sleep", new=AsyncMock()) as sleep,
        ):
            with self.assertRaises(HTTPException) as caught:
                await backend.reload_db()

        self.assertEqual(client.get.await_count, 2)
        self.assertEqual(sleep.await_count, 1)
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)
        self.assertNotIn("secret timeout", str(caught.exception.detail))

    async def test_circuit_breaker_short_circuits_repeated_quota_failures(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get.return_value = httpx.Response(402, json={"message": "provider quota detail"})

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            for _ in range(backend.DB_CIRCUIT_FAILURE_THRESHOLD):
                with self.assertRaises(HTTPException) as caught:
                    await backend.reload_db()
                self.assertEqual(caught.exception.status_code, 503)
            with self.assertRaises(HTTPException) as caught:
                await backend.reload_db()

        self.assertEqual(client.get.await_count, backend.DB_CIRCUIT_FAILURE_THRESHOLD)
        self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)
        self.assertNotIn("provider quota detail", str(caught.exception.detail))

    async def test_http_metrics_do_not_log_query_strings_or_request_bodies(self):
        transport = httpx.ASGITransport(app=backend.app)
        with patch("builtins.print") as emit:
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api?email=private@example.com&token=secret-token")

        self.assertEqual(response.status_code, 200)
        emitted = " ".join(str(call.args[0]) for call in emit.call_args_list if call.args)
        self.assertIn('"component":"http"', emitted)
        self.assertIn('"endpoint":"/api"', emitted)
        self.assertIn('"status":200', emitted)
        self.assertNotIn("private@example.com", emitted)
        self.assertNotIn("secret-token", emitted)

    async def test_fleet_update_persists_multiple_dates_and_preserves_metadata(self):
        backend.conductores_db["K-027"] = {
            "capacidad": 15, "tipo": "Van", "chofer": "Driver",
            "soat": "", "revision": "", "atu": "", "licencia": "",
            "base": "MASIVO", "marca": "Mercedes", "modelo": "Sprinter",
            "ano": 2024, "color": "Blanco", "soat_doc": "private://soat",
            "metadata": {"source": "migration"},
        }
        persist_state = AsyncMock()
        with (
            patch.object(backend, "reload_db", new=AsyncMock()) as reload_db,
            patch.object(backend, "_persist_app_state", new=persist_state),
            patch.object(backend, "_load_compat_fleet", new=AsyncMock()),
        ):
            response = await backend.update_flota("K-027", backend.FlotaUpdate(
                soat="2027-05-20", revision="2026-09-30",
                atu="2028-01-01", licencia="2029-12-31", capacidad=18,
                # El ATU se manda a propósito: un cliente viejo puede seguir
                # enviándolo y no debe guardarse ni romper el resto.
            ))

        reload_db.assert_awaited_once_with(force=True)
        persist_state.assert_awaited_once()
        payload = persist_state.await_args.args[0]
        stored = payload["usuarios"]["__flota__"]["K-027"]
        self.assertEqual(stored["soat"], "2027-05-20")
        self.assertEqual(stored["revision"], "2026-09-30")
        self.assertEqual(stored.get("atu", ""), "", "el T.U.C. (ATU) ya no se guarda")
        self.assertEqual(stored["licencia"], "2029-12-31")
        self.assertEqual(stored["soat_doc"], "private://soat")
        self.assertEqual(stored["metadata"], {"source": "migration"})
        self.assertEqual(stored["base"], "MASIVO")
        self.assertFalse(response["unchanged"])

    async def test_fleet_update_noop_does_not_persist(self):
        backend.conductores_db["K-001"] = {
            "capacidad": 15, "tipo": "Van", "chofer": "Driver", "soat": "2027-01-01"
        }
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=AsyncMock()) as persist_state,
        ):
            response = await backend.update_flota(
                "K-001", backend.FlotaUpdate(capacidad=15, soat="2027-01-01")
            )
        persist_state.assert_not_awaited()
        self.assertTrue(response["unchanged"])

    async def test_fleet_update_rejects_non_iso_or_impossible_date(self):
        backend.conductores_db["K-001"] = {"soat": ""}
        for invalid in ("20/05/2027", "2027-02-30", "2027-5-02"):
            with patch.object(backend, "reload_db", new=AsyncMock()):
                with self.assertRaises(HTTPException) as caught:
                    await backend.update_flota("K-001", backend.FlotaUpdate(soat=invalid))
            self.assertEqual(caught.exception.status_code, 400)

    async def test_fleet_update_rolls_back_memory_when_persist_fails(self):
        original = {"capacidad": 15, "soat": "", "soat_doc": "private://keep"}
        backend.conductores_db["K-001"] = copy.deepcopy(original)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(
                backend, "_persist_app_state",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            with self.assertRaises(HTTPException):
                await backend.update_flota("K-001", backend.FlotaUpdate(soat="2027-05-20"))
        self.assertEqual(backend.conductores_db["K-001"], original)

    async def test_fleet_update_requires_admin_session_when_enforced(self):
        backend.AUTH_ENFORCED = True
        driver = {
            "identifier": "driver-1", "rol": "Conductor", "estado": "Activo",
        }
        backend.usuarios_db["driver-1"] = driver
        token = await backend.abrir_sesion(driver)
        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.update_flota(
                    "K-001", backend.FlotaUpdate(soat="2027-05-20"), token
                )
        self.assertEqual(caught.exception.status_code, 403)

    def _unidad_con_conductor(self, padron="K-027", **unidad):
        backend.conductores_db[padron] = {
            "base": "MASIVO", "chofer": "CHAVEZ CHAVEZ JUAN", "placa": "BUR-628",
            "tipo": "AUTO", "capacidad": 4, "marca": "KIA", "modelo": "CERATO",
            "ano": "2020", "color": "GRIS", "grupo": "TP", "telefono": "922551637",
            **unidad,
        }
        conductor = {
            "identifier": f"dni-{padron}", "nombre": "Chavez", "rol": "Conductor",
            "unidad_id": padron, "celular": "922551637",
            "perfil_conductor": {
                "tipoDoc": "DNI", "numDoc": "8179107", "direccion": "MZ K LOTE 3",
                "fechaNacimiento": "1989-05-26", "telefonoDirecto": "922551637",
                "placa": "BUR-628", "vehiculoMarca": "KIA", "vehiculoModelo": "CERATO",
                "vehiculoAnio": "2020", "vehiculoColor": "GRIS",
            },
        }
        backend.usuarios_db[f"dni-{padron}"] = conductor
        return conductor

    async def _exportar(self, base):
        from openpyxl import load_workbook
        with patch.object(backend, "reload_db", new=AsyncMock()):
            respuesta = await backend.export_flota(base=base)
        contenido = b"".join([parte async for parte in respuesta.body_iterator])
        hoja = load_workbook(io.BytesIO(contenido)).active
        self.ultima_hoja = hoja
        return respuesta, [list(fila) for fila in hoja.iter_rows(min_row=2, values_only=True)]

    async def _editar_unidad(self, padron, **campos):
        persist_state = AsyncMock()
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=persist_state),
            patch.object(backend, "_load_compat_fleet", new=AsyncMock()),
        ):
            respuesta = await backend.update_flota(padron, backend.FlotaUpdate(**campos))
        return respuesta, persist_state

    async def test_export_takes_the_phone_edited_in_the_page(self):
        # Pasó con la K-027: se le cambió el teléfono en la ficha y el Excel
        # seguía sacando el del perfil del conductor.
        self._unidad_con_conductor(telefono="999999999")
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][5], 999999999)

    async def test_export_rows_follow_the_base_order_and_types(self):
        self._unidad_con_conductor("K-142")
        self._unidad_con_conductor("K-27")
        self._unidad_con_conductor("KV-013")
        self._unidad_con_conductor("M-056", base="REMISSE", grupo="REMISSE")
        self._unidad_con_conductor("SM002", base="Sharf Motorizado", grupo="SHARF MOTORIZADO")
        self._unidad_con_conductor("SM001", base="Sharf Motorizado", grupo="SHARF MOTORIZADO")
        backend.conductores_db["K-999"] = {"chofer": "PRUEBA", "capacidad": 4}

        _, filas = await self._exportar("TODAS")

        # Por base, en el orden del filtro, y dentro por padrón como número.
        self.assertEqual([f[6] for f in filas],
                         ["K-27", "K-142", "KV-013", "M-056", "SM001", "SM002", "K-999"])
        primera = filas[0]
        self.assertEqual(primera[3], "08179107", "el DNI con el cero que perdió al importarse")
        self.assertEqual(primera[4].date().isoformat(), "1989-05-26", "la fecha, como fecha")
        self.assertEqual((primera[9], primera[12]), (4, 2020), "capacidad y año, como números")
        # El grupo sale de lo guardado: la plantilla no conocía las de Sharf.
        self.assertEqual(filas[4][14], "SHARF MOTORIZADO")
        # Una unidad sin cuenta sale con lo que tiene, sin inventar nada.
        self.assertEqual(filas[-1][:4], [None, "PRUEBA", None, None])

    async def test_export_has_filters_a_fixed_header_and_readable_columns(self):
        self._unidad_con_conductor("K-027")
        self._unidad_con_conductor("K-142", chofer="X" * 90)
        await self._exportar("MASIVO")
        hoja = self.ultima_hoja
        self.assertEqual(hoja.auto_filter.ref, "A1:O3")
        self.assertEqual(hoja.freeze_panes, "C2")
        anchos = {letra: hoja.column_dimensions[letra].width for letra in "BEI"}
        # «FECHA DE NACIMIENTO» y «TIPO DE VEHÍCULO» ya no salen cortados, y un
        # nombre desmesurado no se come la pantalla.
        self.assertGreaterEqual(anchos["E"], len("FECHA DE NACIMIENTO"))
        self.assertGreaterEqual(anchos["I"], len("TIPO DE VEHÍCULO"))
        self.assertEqual(anchos["B"], backend._ANCHO_MAXIMO)

    async def test_export_has_its_own_sharf_base(self):
        self._unidad_con_conductor("K-027")
        self._unidad_con_conductor("SM001", base="Sharf Motorizado", grupo="SHARF MOTORIZADO")
        respuesta, filas = await self._exportar("sharf")
        self.assertEqual([f[6] for f in filas], ["SM001"])
        self.assertIn("SHARF", respuesta.headers["content-disposition"])
        with self.assertRaises(HTTPException) as caught:
            await self._exportar("OTRA")
        self.assertEqual(caught.exception.status_code, 400)

    async def test_fleet_phone_edit_also_updates_the_driver(self):
        conductor = self._unidad_con_conductor()
        respuesta, persist_state = await self._editar_unidad("K-027", telefono=" 999999999 ")

        self.assertEqual(backend.conductores_db["K-027"]["telefono"], "999999999")
        # El conductor ve el mismo número en su perfil, y ninguna copia queda vieja.
        self.assertEqual(conductor["perfil_conductor"]["telefonoDirecto"], "999999999")
        self.assertEqual(conductor["celular"], "999999999")
        guardado = persist_state.await_args.args[0]["usuarios"]["dni-K-027"]
        self.assertEqual(guardado["perfil_conductor"]["telefonoDirecto"], "999999999")
        self.assertEqual(respuesta["perfil_conductor"]["telefonoDirecto"], "999999999")
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][5], 999999999)

    async def test_fleet_edit_writes_the_rest_of_the_base_columns(self):
        conductor = self._unidad_con_conductor()
        await self._editar_unidad(
            "K-027", marca=" toyota ", modelo="yaris", ano="2021", color="rojo", grupo="tp/konecta",
            direccion="CALLE NUEVA 123", fecha_nacimiento="1990-02-03",
        )

        unidad = backend.conductores_db["K-027"]
        self.assertEqual((unidad["marca"], unidad["modelo"], unidad["ano"], unidad["color"], unidad["grupo"]),
                         ("TOYOTA", "YARIS", "2021", "ROJO", "TP/KONECTA"))
        perfil = conductor["perfil_conductor"]
        self.assertEqual((perfil["vehiculoMarca"], perfil["vehiculoAnio"]), ("TOYOTA", "2021"))
        self.assertEqual((perfil["direccion"], perfil["fechaNacimiento"]), ("CALLE NUEVA 123", "1990-02-03"))
        self.assertNotIn("direccion", unidad, "lo personal va a la cuenta, no a la unidad")
        cambios = {c["campo"]: c["nuevo"] for c in backend.actividad_db[0]["changes"]}
        self.assertEqual(cambios["Dirección"], "CALLE NUEVA 123")
        self.assertEqual(cambios["Marca"], "TOYOTA")

        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][2], "CALLE NUEVA 123")
        self.assertEqual(filas[0][10:15], ["TOYOTA", "YARIS", 2021, "ROJO", "TP/KONECTA"])

    async def test_fleet_edit_rejects_bad_values_and_units_without_driver(self):
        self._unidad_con_conductor()
        for campos in ({"ano": "21"}, {"fecha_nacimiento": "03/02/1990"}, {"direccion": "x" * 201}):
            with self.assertRaises(HTTPException) as caught:
                await self._editar_unidad("K-027", **campos)
            self.assertEqual(caught.exception.status_code, 400, campos)
        backend.conductores_db["K-999"] = {"chofer": "PRUEBA"}
        with self.assertRaises(HTTPException) as caught:
            await self._editar_unidad("K-999", direccion="CALLE 1")
        self.assertEqual(caught.exception.status_code, 409)

    async def test_fleet_edit_resyncs_a_stale_driver_copy(self):
        # La unidad ya tenía el número y el perfil no: volver a guardarlo lo iguala.
        conductor = self._unidad_con_conductor(telefono="999999999")
        respuesta, persist_state = await self._editar_unidad("K-027", telefono="999999999")
        self.assertFalse(respuesta["unchanged"])
        persist_state.assert_awaited_once()
        self.assertEqual(conductor["perfil_conductor"]["telefonoDirecto"], "999999999")

    async def test_fleet_edit_failure_restores_the_driver_too(self):
        conductor = self._unidad_con_conductor()
        antes = copy.deepcopy(conductor)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(
                backend, "_persist_app_state",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            with self.assertRaises(HTTPException):
                await backend.update_flota("K-027", backend.FlotaUpdate(telefono="999999999", direccion="OTRA"))
        self.assertEqual(conductor, antes)
        self.assertEqual(backend.conductores_db["K-027"]["telefono"], "922551637")

    async def _resolver(self, campo, valor, accion="approve"):
        conductor = backend.usuarios_db["dni-K-027"]
        conductor["perfil_conductor"]["solicitudes_cambio"] = {
            campo: {"new_value": valor, "status": "pendiente"},
        }
        backend.usuarios_db["admin@example.com"] = {"identifier": "admin@example.com", "rol": "Administración"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            respuesta = await backend.resolve_data_update(backend.ResolveDataRequestPayload(
                admin_email="admin@example.com", conductor_email="dni-K-027", field=campo, action=accion,
            ))
        persist.assert_awaited_once()
        return respuesta

    async def test_approving_the_drivers_new_phone_reaches_the_unit(self):
        # Sin esto, el teléfono de la unidad tapaba el que pidió el conductor.
        conductor = self._unidad_con_conductor()
        respuesta = await self._resolver("telefonoDirecto", "955555555")
        self.assertEqual(backend.conductores_db["K-027"]["telefono"], "955555555")
        self.assertEqual(conductor["celular"], "955555555")
        self.assertEqual(respuesta["unidad"]["telefono"], "955555555")
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][5], 955555555)

    async def test_approving_other_requests_keeps_the_unit_where_it_should(self):
        self._unidad_con_conductor()
        await self._resolver("vehiculoColor", "azul")
        self.assertEqual(backend.conductores_db["K-027"]["color"], "AZUL")
        # La capacidad que declara el conductor no es la que usa el ruteo.
        respuesta = await self._resolver("capacidadVehiculo", "7")
        self.assertIsNone(respuesta["unidad"])
        self.assertEqual(backend.conductores_db["K-027"]["capacidad"], 4)
        # Rechazar no toca nada.
        await self._resolver("telefonoDirecto", "900000000", accion="reject")
        self.assertEqual(backend.conductores_db["K-027"]["telefono"], "922551637")

    async def test_a_request_for_a_field_the_profile_does_not_offer_cannot_be_approved(self):
        # Una solicitud podía nombrar cualquier campo del perfil —sus revisiones,
        # el CAMO, el estado— y aprobarla lo escribía. Las que ya estén
        # pendientes se pueden rechazar, no aprobar.
        conductor = self._unidad_con_conductor()
        for campo in ("revision_docs", "camo", "estado"):
            with self.assertRaises(HTTPException) as caught:
                await self._resolver(campo, "x")
            self.assertEqual(caught.exception.status_code, 400, campo)
            self.assertNotEqual(conductor["perfil_conductor"].get(campo), "x", campo)
            self.assertEqual(conductor["perfil_conductor"]["solicitudes_cambio"][campo]["status"], "pendiente")
        await self._resolver("camo", "x", accion="reject")
        self.assertEqual(conductor["perfil_conductor"]["solicitudes_cambio"]["camo"]["status"], "rechazado")
        self.assertNotIn("camo", conductor["perfil_conductor"])

    def test_the_requestable_fields_are_the_ones_the_profile_offers(self):
        """Si la pantalla ofrece un dato que el servidor no admite, la solicitud daría 400."""
        perfil = Path(__file__).resolve().parents[1] / "src" / "perfil"
        import re
        claves = set()
        modelo = (perfil / "modeloPerfil.js").read_text(encoding="utf-8")
        for base, por_vehiculo in re.findall(r"clave: [`']([A-Za-z]+)(\$\{n\})?[`']", modelo):
            claves.add(base)
            if por_vehiculo:
                claves.add(f"{base}2")  # el segundo vehículo
        # Y lo que se pide sin formulario, como habilitar el segundo vehículo.
        pantalla = (perfil / "DatosConductor.jsx").read_text(encoding="utf-8")
        claves.update(re.findall(r"onSolicitarCambio\('([A-Za-z0-9_]+)'", pantalla))
        self.assertIn("placa2", claves)
        self.assertIn("vehiculo2_habilitado", claves)
        # El nombre no lo ofrece la pantalla: puede quedar alguna solicitud de antes.
        self.assertEqual(claves | {"nombres"}, set(backend._CAMPOS_SOLICITABLES))

    async def test_export_never_writes_a_formula(self):
        # Buena parte de estos datos los teclea el conductor en su alta: un «=»
        # delante no puede convertirse en una fórmula que se ejecute al abrir.
        conductor = self._unidad_con_conductor()
        conductor["perfil_conductor"]["direccion"] = '=HYPERLINK("http://x.invalid/?"&D2,"ver")'
        _, filas = await self._exportar("MASIVO")
        celda = self.ultima_hoja.cell(2, 3)
        self.assertEqual(celda.data_type, "s")
        self.assertEqual(filas[0][2], '=HYPERLINK("http://x.invalid/?"&D2,"ver")')

    async def test_export_colours_each_group_with_its_own_colour(self):
        self._unidad_con_conductor("K-027")
        self._unidad_con_conductor("M-056", base="REMISSE", grupo="REMISSE")
        self._unidad_con_conductor("SM001", base="Sharf Motorizado", grupo="SHARF MOTORIZADO")
        await self._exportar("TODAS")
        hoja = self.ultima_hoja
        relleno = {hoja.cell(r, 15).value: hoja.cell(r, 15).fill for r in (2, 3, 4)}
        # Antes, todo lo que no era de masivo salía con el color de TP.
        self.assertEqual(relleno["TP"].fgColor.theme, 4)
        self.assertEqual(relleno["REMISSE"].fgColor.theme, 9)
        self.assertIsNone(relleno["SHARF MOTORIZADO"].fill_type)

    async def test_a_plate_equal_to_the_padron_is_not_a_plate(self):
        # El alta antigua mandaba el padrón como placa; la de verdad está en el perfil.
        self._unidad_con_conductor("K-050", placa="K-050")
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][7], "BUR-628")

    async def test_units_created_in_the_page_export_their_drivers_dni(self):
        backend.conductores_db["KV-001"] = {"chofer": "NUEVO", "base": "MASIVO", "capacidad": 4}
        backend.usuarios_db["08179107"] = {
            "identifier": "08179107", "dni": "08179107", "rol": "Conductor", "unidad_id": "KV-001",
        }
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][3], "08179107")

    async def test_the_base_decides_the_group(self):
        self._unidad_con_conductor("K-027")
        await self._editar_unidad("K-027", base="sharf")
        unidad = backend.conductores_db["K-027"]
        self.assertEqual((unidad["base"], unidad["grupo"]), ("Sharf Motorizado", "SHARF MOTORIZADO"))
        # De vuelta a masivo, el grupo de otra base se vacía para elegir el cliente.
        await self._editar_unidad("K-027", base="MASIVO")
        self.assertEqual(backend.conductores_db["K-027"]["grupo"], "")
        await self._editar_unidad("K-027", grupo="konecta")
        self.assertEqual(backend.conductores_db["K-027"]["grupo"], "KONECTA")
        for campos in ({"grupo": "REMISSE"}, {"base": "OTRA"}):
            with self.assertRaises(HTTPException) as caught:
                await self._editar_unidad("K-027", **campos)
            self.assertEqual(caught.exception.status_code, 400, campos)

    async def test_a_unit_created_in_the_page_gets_its_base(self):
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=AsyncMock()),
            patch.object(backend, "_load_compat_fleet", new=AsyncMock()),
        ):
            await backend.add_flota(backend.FlotaRegistro(
                padron="KV-300", placa="ABC-123", capacidad=4, tipo="AUTO", chofer="Nuevo",
                base="MASIVO", grupo="tp",
            ))
            await backend.add_flota(backend.FlotaRegistro(
                padron="M-900", placa="ABC-124", capacidad=4, tipo="AUTO", chofer="Nuevo", base="remisse",
            ))
        self.assertEqual(backend.conductores_db["KV-300"]["base"], "MASIVO")
        self.assertEqual(backend.conductores_db["KV-300"]["grupo"], "TP")
        self.assertEqual(backend.conductores_db["M-900"]["grupo"], "REMISSE")
        _, filas = await self._exportar("MASIVO")
        self.assertEqual([f[6] for f in filas], ["KV-300"])

    async def test_a_stale_loose_phone_in_the_account_is_resynced(self):
        conductor = self._unidad_con_conductor(telefono="999999999")
        conductor["perfil_conductor"]["telefonoDirecto"] = "999999999"
        await self._editar_unidad("K-027", telefono="999999999")
        self.assertEqual(conductor["celular"], "999999999")

    async def test_a_driver_cannot_change_their_document_by_request(self):
        # El documento es con lo que se entra: por solicitud se saltaría la
        # comprobación de que no sea de otra cuenta.
        conductor = self._unidad_con_conductor()
        with self.assertRaises(HTTPException) as caught:
            await self._resolver("numDoc", "45757485")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(conductor["perfil_conductor"]["numDoc"], "8179107")

    async def test_an_approved_name_changes_the_account_too(self):
        conductor = self._unidad_con_conductor()
        await self._resolver("nombres", "CHAVEZ CHAVEZ JUAN MANUEL")
        self.assertEqual(backend.conductores_db["K-027"]["chofer"], "CHAVEZ CHAVEZ JUAN MANUEL")
        self.assertEqual(conductor["nombre"], "CHAVEZ CHAVEZ JUAN MANUEL")

    async def test_approving_validates_before_touching_anything(self):
        conductor = self._unidad_con_conductor()
        with self.assertRaises(HTTPException) as caught:
            await self._resolver("vehiculoAnio", "2O21")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(conductor["perfil_conductor"]["vehiculoAnio"], "2020")
        self.assertEqual(backend.conductores_db["K-027"]["ano"], "2020")
        # Lo aprobado queda igual en las dos copias.
        await self._resolver("vehiculoMarca", " toyota ")
        self.assertEqual(conductor["perfil_conductor"]["vehiculoMarca"], "TOYOTA")
        self.assertEqual(backend.conductores_db["K-027"]["marca"], "TOYOTA")

    async def test_a_failed_approval_leaves_nothing_behind(self):
        conductor = self._unidad_con_conductor()
        conductor["perfil_conductor"]["solicitudes_cambio"] = {
            "telefonoDirecto": {"new_value": "955555555", "status": "pendiente"},
        }
        antes_conductor, antes_unidad = copy.deepcopy(conductor), dict(backend.conductores_db["K-027"])
        backend.usuarios_db["admin@example.com"] = {"identifier": "admin@example.com", "rol": "Administración"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(
                backend, "persist_users_only",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            with self.assertRaises(HTTPException):
                await backend.resolve_data_update(backend.ResolveDataRequestPayload(
                    admin_email="admin@example.com", conductor_email="dni-K-027",
                    field="telefonoDirecto", action="approve",
                ))
        self.assertEqual(conductor, antes_conductor)
        self.assertEqual(backend.conductores_db["K-027"], antes_unidad)

    def _conductor_creado_en_la_pagina(self, dni="45757485", padron="KV-001"):
        # Así deja la cuenta el alta de «+ Nueva Unidad»: la clave y el
        # identificador son el DNI, y no hay perfil hasta que el conductor
        # completa su alta en la aplicación.
        backend.conductores_db[padron] = {"chofer": "NUEVO CONDUCTOR", "base": "MASIVO", "telefono": "987654321"}
        conductor = {
            "identifier": dni, "dni": dni, "nombre": "NUEVO CONDUCTOR", "rol": "Conductor",
            "unidad_id": padron, "telefono": "987654321", "estado": "Activo",
        }
        backend.usuarios_db[dni] = conductor
        return conductor

    async def test_administration_can_change_the_drivers_document(self):
        conductor = self._conductor_creado_en_la_pagina()
        with patch.object(backend, "revocar_sesiones_de", new=AsyncMock(return_value=1)) as revocar:
            respuesta, persist_state = await self._editar_unidad("KV-001", documento=" 4575 7486 ")
        self.assertEqual(conductor["perfil_conductor"]["numDoc"], "45757486")
        self.assertEqual((conductor["dni"], conductor["identifier"]), ("45757486", "45757486"))
        # La cuenta tenía el DNI por clave: se muda entera. Entra con el nuevo,
        # el viejo deja de servir y queda libre, y quien estaba dentro vuelve a
        # entrar (las sesiones se cierran con la clave vieja, antes de mudarla).
        self.assertIs(backend.usuarios_db.get("45757486"), conductor)
        self.assertNotIn("45757485", backend.usuarios_db)
        self.assertIs(backend.get_user_by_identifier("45757486"), conductor)
        self.assertIsNone(backend.get_user_by_identifier("45757485"))
        revocar.assert_awaited_once_with(conductor)
        guardado = persist_state.await_args.args[0]["usuarios"]
        self.assertIn("45757486", guardado)
        self.assertNotIn("45757485", guardado)
        # Accesos usa `identifier` como clave para desactivar o reiniciar: tiene
        # que seguir siendo la clave de la cuenta.
        self.assertEqual(conductor["identifier"], "45757486")
        self.assertEqual(respuesta["perfil_conductor"]["numDoc"], "45757486")
        aviso = next(e for e in backend.actividad_db if e["action_type"] == "Documento del conductor cambiado")
        self.assertEqual(aviso["status"], "warning")
        self.assertEqual((aviso["changes"][0]["anterior"], aviso["changes"][0]["nuevo"]), ("45757485", "45757486"))
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][3], "45757486")

    async def test_an_imported_account_keeps_its_key_when_the_document_changes(self):
        # Su clave es un correo inventado, no el DNI: no hace falta mudarla.
        conductor = self._unidad_con_conductor()
        with patch.object(backend, "revocar_sesiones_de", new=AsyncMock()) as revocar:
            await self._editar_unidad("K-027", documento="45757499")
        self.assertIs(backend.usuarios_db["dni-K-027"], conductor)
        self.assertEqual(conductor["perfil_conductor"]["numDoc"], "45757499")
        self.assertIs(backend.get_user_by_identifier("45757499"), conductor)
        self.assertIsNone(backend.get_user_by_identifier("08179107"))
        revocar.assert_not_awaited()

    async def test_the_same_dni_with_other_leading_zeros_is_refused(self):
        self._conductor_creado_en_la_pagina()
        otro = self._unidad_con_conductor("K-027")
        otro["perfil_conductor"]["numDoc"] = "0123456"
        with self.assertRaises(HTTPException) as caught:
            await self._editar_unidad("KV-001", documento="00123456")
        self.assertEqual(caught.exception.status_code, 409)

    async def test_only_administration_changes_a_document(self):
        self._conductor_creado_en_la_pagina()
        backend.AUTH_ENFORCED = True
        programador = {"identifier": "prog@example.com", "rol": "Programador de rutas", "estado": "Activo"}
        backend.usuarios_db["prog@example.com"] = programador
        token = await backend.abrir_sesion(programador)
        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.update_flota("KV-001", backend.FlotaUpdate(documento="45757486"), token)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(backend.usuarios_db["45757485"]["dni"], "45757485")

    async def test_a_failed_document_change_moves_the_account_back(self):
        conductor = self._conductor_creado_en_la_pagina()
        antes = copy.deepcopy(conductor)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "revocar_sesiones_de", new=AsyncMock()),
            patch.object(
                backend, "_persist_app_state",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            with self.assertRaises(HTTPException):
                await backend.update_flota("KV-001", backend.FlotaUpdate(documento="45757486"))
        self.assertIs(backend.usuarios_db.get("45757485"), conductor)
        self.assertNotIn("45757486", backend.usuarios_db)
        self.assertEqual(conductor, antes)

    async def test_a_document_that_belongs_to_another_account_is_refused(self):
        self._conductor_creado_en_la_pagina()
        otro = self._unidad_con_conductor("K-027")
        otro["nombre"] = "CHAVEZ"
        with self.assertRaises(HTTPException) as caught:
            # Esa cuenta lo guardó sin el cero de delante: es el mismo documento.
            await self._editar_unidad("KV-001", documento="08179107")
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("CHAVEZ", caught.exception.detail)
        for campos in ({"documento": "1234"}, {"tipo_documento": "Licencia"}, {"documento": ""}):
            with self.assertRaises(HTTPException) as caught:
                await self._editar_unidad("KV-001", **campos)
            self.assertEqual(caught.exception.status_code, 400, campos)
        with patch.object(backend, "revocar_sesiones_de", new=AsyncMock()):
            await self._editar_unidad("KV-001", tipo_documento="ce", documento="ab-123456")
        perfil = backend.usuarios_db["AB-123456"]["perfil_conductor"]
        self.assertEqual((perfil["tipoDoc"], perfil["numDoc"]), ("CE", "AB-123456"))

    async def test_administration_fills_in_a_driver_who_never_did_the_alta(self):
        # Para quien no se maneja con la aplicación: lo que llena Administración
        # le crea el perfil, y ya no se le pide el formulario de alta.
        conductor = self._conductor_creado_en_la_pagina()
        await self._editar_unidad(
            "KV-001", direccion="CALLE 1", fecha_nacimiento="1990-01-02", telefono_emergencia="999888777",
        )
        perfil = conductor["perfil_conductor"]
        self.assertEqual(
            (perfil["direccion"], perfil["fechaNacimiento"], perfil["telefonoEmergencia"]),
            ("CALLE 1", "1990-01-02", "999888777"),
        )
        self.assertIn("perfil_conductor", conductor, "profileComplete sale de que exista")

    async def test_the_drivers_name_changes_everywhere(self):
        conductor = self._unidad_con_conductor()
        await self._editar_unidad("K-027", chofer="CHAVEZ CHAVEZ JUAN M.")
        self.assertEqual(conductor["nombre"], "CHAVEZ CHAVEZ JUAN M.")
        self.assertEqual(conductor["perfil_conductor"]["nombres"], "CHAVEZ CHAVEZ JUAN M.")
        # Una cuenta sin perfil cambia el nombre de la cuenta, sin crearle uno.
        sin_alta = self._conductor_creado_en_la_pagina()
        await self._editar_unidad("KV-001", chofer="OTRO NOMBRE", telefono="911222333")
        self.assertEqual((sin_alta["nombre"], sin_alta["telefono"]), ("OTRO NOMBRE", "911222333"))
        self.assertNotIn("perfil_conductor", sin_alta)

    async def test_a_failed_save_restores_the_whole_account(self):
        conductor = self._conductor_creado_en_la_pagina()
        antes = copy.deepcopy(conductor)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(
                backend, "_persist_app_state",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            with self.assertRaises(HTTPException):
                await backend.update_flota("KV-001", backend.FlotaUpdate(
                    documento="45757486", chofer="OTRO", direccion="CALLE 1",
                ))
        self.assertEqual(conductor, antes)

    async def test_the_plate_from_the_alta_counts_as_the_drivers(self):
        # El alta en la aplicación la guarda como `vehiculoPlaca`.
        conductor = self._conductor_creado_en_la_pagina()
        conductor["perfil_conductor"] = {"vehiculoPlaca": "CDE-456", "numDoc": "45757485"}
        _, filas = await self._exportar("MASIVO")
        self.assertEqual(filas[0][7], "CDE-456")

    async def _eliminar_documento(self, campo, borrado_en_bucket=True):
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
            patch.object(
                backend, "delete_document_from_storage", new=AsyncMock(return_value=borrado_en_bucket),
            ) as borrar,
        ):
            respuesta = await backend.eliminar_documento_del_conductor(
                backend.DocumentoEliminado(conductor="dni-K-027", campo=campo),
            )
        guardar.assert_awaited_once()
        return respuesta, borrar

    async def test_administration_removes_a_wrongly_uploaded_image(self):
        # Rechazar solo le pide al conductor que lo arregle: el archivo erróneo
        # se quedaba, y quien da de alta por él no tenía cómo quitarlo.
        conductor = self._unidad_con_conductor()
        perfil = conductor["perfil_conductor"]
        perfil["dniScaneado"] = {"name": "dni.jpg", "path": "K-027/dniScaneado-aaaa1111.jpg"}
        perfil["dniScaneadoCompleto"] = {"name": "dni.jpg", "path": "K-027/dniScaneadoCompleto-bbbb2222.jpg"}
        perfil["revision_docs"] = {"dniScaneado": {"estado": "aprobado"}, "soat": {"estado": "aprobado"}}

        respuesta, borrar = await self._eliminar_documento("dniScaneado")

        nuevo = conductor["perfil_conductor"]
        self.assertIsNone(nuevo["dniScaneado"])
        self.assertEqual(nuevo["dniScaneadoCompleto"]["path"], "K-027/dniScaneadoCompleto-bbbb2222.jpg",
                         "solo la cara que se quita")
        self.assertEqual(nuevo["revision_docs"], {"soat": {"estado": "aprobado"}})
        borrar.assert_awaited_once_with("K-027/dniScaneado-aaaa1111.jpg")
        self.assertTrue(respuesta["archivo_borrado"])
        self.assertEqual(respuesta["perfil_conductor"], nuevo)
        aviso = backend.notifications_db[-1]
        self.assertEqual((aviso["campo"], aviso["estado"]), ("dniScaneado", "faltante"))
        self.assertEqual(backend.actividad_db[-1]["action_type"], "Documento eliminado")

    async def test_removing_the_camo_asks_the_driver_for_nothing(self):
        # El CAMO lo sube Administración: decirle al conductor que lo vuelva a
        # subir sería pedirle algo que no puede hacer.
        conductor = self._unidad_con_conductor()
        conductor["perfil_conductor"]["camo"] = {"name": "camo.pdf", "path": "K-027/camo-aaaa1111.pdf"}
        avisos = len(backend.notifications_db)

        respuesta, borrar = await self._eliminar_documento("camo")

        self.assertIsNone(conductor["perfil_conductor"]["camo"])
        borrar.assert_awaited_once_with("K-027/camo-aaaa1111.pdf")
        self.assertTrue(respuesta["archivo_borrado"])
        self.assertEqual(len(backend.notifications_db), avisos)
        self.assertNotIn("conductor", backend.actividad_db[-1]["description"])

    async def test_removing_a_document_never_erases_someone_elses_file(self):
        # El perfil lo escribe el conductor: podría apuntar su documento al de
        # otra unidad, y quitarlo borraría el archivo de otro.
        conductor = self._unidad_con_conductor()
        conductor["perfil_conductor"]["cv"] = {"path": "K-142/cv-cccc3333.pdf"}
        otro = self._unidad_con_conductor("K-050")
        conductor["perfil_conductor"]["recordConductor"] = {"path": "K-027/recordConductor-dddd4444.pdf"}
        otro["perfil_conductor"]["recordConductor"] = {"path": "K-027/recordConductor-dddd4444.pdf"}
        # Empieza por su carpeta, pero sale de ella.
        conductor["perfil_conductor"]["soat"] = {"path": "K-027/../K-142/soat-ffff6666.pdf"}

        for campo in ("cv", "recordConductor", "soat"):
            respuesta, borrar = await self._eliminar_documento(campo)
            self.assertIsNone(conductor["perfil_conductor"][campo], campo)
            borrar.assert_not_awaited()
            self.assertFalse(respuesta["archivo_borrado"])

    async def test_removing_a_document_checks_what_it_is_asked(self):
        conductor = self._unidad_con_conductor()
        casos = [("revision_docs", 400), ("password", 400), ("dniScaneado", 404)]
        for campo, estado in casos:
            with self.assertRaises(HTTPException) as caught:
                await self._eliminar_documento(campo)
            self.assertEqual(caught.exception.status_code, estado, campo)
        backend.usuarios_db["admin@example.com"] = {"identifier": "admin@example.com", "rol": "Administración"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            self.assertRaises(HTTPException) as caught,
        ):
            await backend.eliminar_documento_del_conductor(
                backend.DocumentoEliminado(conductor="admin@example.com", campo="cv"),
            )
        self.assertEqual(caught.exception.status_code, 404, "solo cuentas de conductor")
        self.assertNotIn("dniScaneado", conductor["perfil_conductor"])

    async def test_a_failed_removal_leaves_the_document_where_it_was(self):
        conductor = self._unidad_con_conductor()
        conductor["perfil_conductor"]["cv"] = {"path": "K-027/cv-eeee5555.pdf"}
        antes = copy.deepcopy(conductor)
        avisos = len(backend.notifications_db)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(
                backend, "persist_users_only",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
            patch.object(backend, "delete_document_from_storage", new=AsyncMock()) as borrar,
        ):
            with self.assertRaises(HTTPException):
                await backend.eliminar_documento_del_conductor(
                    backend.DocumentoEliminado(conductor="dni-K-027", campo="cv"),
                )
        self.assertEqual(conductor, antes)
        self.assertEqual(len(backend.notifications_db), avisos)
        borrar.assert_not_awaited()

    async def _cambiar_foto(self, unidad, tipo, tipo_archivo="image/jpeg"):
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
            patch.object(backend, "upload_document_to_storage", new=AsyncMock()) as subir,
        ):
            respuesta = await backend.cambiar_foto_del_conductor(backend.FotoDelConductor(
                unidad=unidad, tipo=tipo, nombre="foto.jpg", tipo_archivo=tipo_archivo, base64="AA==",
            ))
        guardar.assert_awaited_once()
        return respuesta, subir

    async def test_administration_changes_the_drivers_photos(self):
        # Solo las cambiaba el conductor desde su perfil; quien lo da de alta
        # por él tiene que poder hacerlo todo.
        conductor = self._unidad_con_conductor()
        respuesta, subir = await self._cambiar_foto("K-027", "avatar")
        ruta = conductor["avatar"]["path"]
        # En la carpeta de fotos de perfil del conductor, no en la de quien la sube.
        self.assertTrue(ruta.startswith(backend.CARPETA_AVATARES + "/usuario-"), ruta)
        self.assertEqual(ruta.count("/"), 1)
        subir.assert_awaited_once_with("AA==", ruta, "image/jpeg")
        self.assertEqual(respuesta["foto"]["path"], ruta)

        respuesta, _ = await self._cambiar_foto("K-027", "vehiculo")
        ruta = conductor["perfil_conductor"]["fotoVehiculo"]["path"]
        self.assertTrue(ruta.startswith("K-027/fotoVehiculo-"), ruta)
        self.assertEqual(respuesta["perfil_conductor"]["fotoVehiculo"]["path"], ruta)
        self.assertEqual(backend.actividad_db[-1]["action_type"], "Foto del vehículo cambiada")

    async def test_a_photo_needs_an_image_and_a_driver(self):
        self._unidad_con_conductor()
        backend.conductores_db["K-999"] = {"chofer": "PRUEBA"}
        casos = [("K-027", "otra", "image/jpeg", 400), ("K-027", "avatar", "application/pdf", 400),
                 ("K-999", "avatar", "image/jpeg", 409)]
        for unidad, tipo, tipo_archivo, estado in casos:
            with self.assertRaises(HTTPException) as caught:
                await self._cambiar_foto(unidad, tipo, tipo_archivo)
            self.assertEqual(caught.exception.status_code, estado, (unidad, tipo, tipo_archivo))

    async def test_a_failed_photo_change_leaves_the_account_as_it_was(self):
        conductor = self._unidad_con_conductor()
        antes = copy.deepcopy(conductor)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "upload_document_to_storage", new=AsyncMock()),
            patch.object(
                backend, "persist_users_only",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            for tipo in ("avatar", "vehiculo"):
                with self.assertRaises(HTTPException):
                    await backend.cambiar_foto_del_conductor(backend.FotoDelConductor(
                        unidad="K-027", tipo=tipo, nombre="f.jpg", tipo_archivo="image/jpeg", base64="AA==",
                    ))
        self.assertEqual(conductor, antes)

    async def test_fleet_create_accepts_empty_dates_and_verifies_persistence(self):
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=AsyncMock()) as persist_state,
            patch.object(backend, "_load_compat_fleet", new=AsyncMock()),
        ):
            response = await backend.add_flota(backend.FlotaRegistro(
                placa="K-NEW", capacidad=12, tipo="Van", chofer="New Driver",
                soat=None, revision="", atu=None, licencia="",
            ))
        persist_state.assert_awaited_once()
        self.assertEqual(response["unidad"]["soat"], "")
        self.assertEqual(response["unidad"]["licencia"], "")
        # El T.U.C. (ATU) se retiró del seguimiento: aunque venga en la
        # petición, la unidad no lo guarda.
        self.assertNotIn("atu", response["unidad"])

    # --- Lote 4: endpoints administrativos y de coste ---

    async def test_admin_write_endpoints_reject_anonymous(self):
        """`clear_routes` borraba el tablero entero sin pedir nada."""
        backend.AUTH_ENFORCED = True
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for coro in (
                backend.clear_routes(None),
                backend.save_history(None),
                backend.update_routes([], None),
            ):
                with self.assertRaises(HTTPException) as caught:
                    await coro
                self.assertEqual(caught.exception.status_code, 401)

    async def test_admin_write_endpoints_reject_a_driver(self):
        backend.AUTH_ENFORCED = True
        driver = {"identifier": "drv", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv"] = driver
        token = await backend.abrir_sesion(driver)
        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.clear_routes(token)
        self.assertEqual(caught.exception.status_code, 403)

    async def test_paid_integrations_require_a_session(self):
        """Gemini y la API de verificación se cobran: no deben quedar abiertas."""
        backend.AUTH_ENFORCED = True
        for coro in (
            backend.verify_soat("ABC-123", None),
            backend.verify_citv("ABC-123", None),
            backend.verify_licencia("12345678", None),
            backend.chat_with_copilot(backend.ChatRequest(message="hola"), None),
        ):
            with self.assertRaises(HTTPException) as caught:
                await coro
            self.assertEqual(caught.exception.status_code, 401)

    async def test_gating_admin_endpoints_costs_no_users_read(self):
        backend.AUTH_ENFORCED = True
        admin = {"identifier": "adm", "rol": "Administrador", "estado": "Activo"}
        backend.usuarios_db["adm"] = admin
        token = await backend.abrir_sesion(admin)
        with patch.object(backend, "_load_compat_users", new=AsyncMock()) as heavy:
            self.assertIs(await backend.require_admin_session(token), admin)
        heavy.assert_not_awaited()

    # --- Sesiones en su propia tabla ---
    #
    # Antes vivían dentro de la fila única de `app_state` y abrir una obligaba a
    # reescribirla entera. Estas pruebas cuidan lo que ganamos al sacarlas: que
    # entrar, salir y validar no toquen la fila compartida, y que ninguna
    # instancia autorice con lo que no está en la tabla.

    def _fila_de(self, token):
        return backend.almacen_sesiones.filas[hashlib.sha256(token.encode("utf-8")).hexdigest()]

    async def test_a_session_stores_only_the_hash_and_an_authorization_snapshot(self):
        user = {
            "identifier": "drv-1", "rol": "Conductor", "estado": "Activo", "nombre": "Uno",
            "unidad_id": "K-001", "empresa_id": None, "email": "d@e.com",
            "password": "secret",
        }
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)

        fila = self._fila_de(token)
        self.assertEqual(fila["usuario"], "drv-1")
        self.assertEqual(fila["instantanea"]["unidad_id"], "K-001")
        self.assertEqual(fila["instantanea"]["nombre"], "Uno", "el historial lo necesita")
        self.assertNotIn("password", fila["instantanea"])
        # Quien lea la tabla no puede entrar con lo que ve.
        self.assertNotIn(token, json.dumps(backend.almacen_sesiones.filas))
        self.assertGreater(backend.sesiones.epoch_de_iso(fila["expira_en"]),
                           int(time.time()) + 11 * 3600)

    async def test_session_resolves_without_loading_the_users_blob(self):
        """Autorizar sin los usuarios cargados: es lo que hace una instancia en frío."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo", "unidad_id": "K-001"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        backend.usuarios_db.clear()

        actor = await actor_de(token)
        self.assertEqual(actor["identifier"], "drv-1")
        self.assertEqual(actor["unidad_id"], "K-001")
        self.assertEqual(actor["estado"], "Activo")

    async def test_a_cold_instance_reads_the_session_from_the_table(self):
        """Otra instancia de Vercel no tiene la sesión en su caché, y aun así vale."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        backend.sesiones_en_cache.clear()

        self.assertIs(await backend.get_user_by_session(token), user)
        self.assertIsNone(await backend.get_user_by_session("un-token-que-nadie-emitio"))

    async def test_deactivation_reaches_the_table_not_only_this_instance(self):
        """Desactivar tiene que valer en todas las instancias, no solo en la que lo hizo."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        user["estado"] = "Inactivo"
        await backend.refrescar_sesiones_de(user)
        backend.usuarios_db.clear()
        backend.sesiones_en_cache.clear()  # otra instancia

        actor = await actor_de(token)
        self.assertEqual(actor["estado"], "Inactivo")
        self.assertIsNotNone(backend.account_block_reason(actor))

    async def test_logout_marks_the_row_and_keeps_it_as_a_record(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        await backend.logout_user(Response(), token)

        backend.sesiones_en_cache.clear()  # también en otra instancia
        self.assertIsNone(await actor_de(token))
        self.assertIsNone(await backend.get_user_by_session(token))
        # No se borra: es el registro de ese acceso.
        self.assertIsNotNone(self._fila_de(token)["revocada_en"])

    async def test_an_expired_session_never_authorizes_even_when_cached(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        backend.sesiones_en_cache[digest]["expires_at"] = 1
        self.assertIsNone(await actor_de(token))

        backend.sesiones_en_cache.clear()
        self._fila_de(token)["expira_en"] = "2020-01-01T00:00:00+00:00"
        self.assertIsNone(await actor_de(token), "tampoco leyendo la tabla")

    async def test_a_driver_without_the_identifier_field_can_log_in(self):
        """124 de las 128 cuentas reales no llevan `identifier`: son casi todos los conductores.

        Las pruebas de siempre crean usuarios con ese campo y no lo veían. La
        sesión tiene que ser de la clave de la cuenta, que es lo que existe
        siempre, o esos conductores no podrían entrar.
        """
        backend.AUTH_ENFORCED = True
        chofer = {  # tal cual está en la base: sin `identifier`
            "email": "de.los@kapital.com", "dni": "74538840", "nombre": "De Los",
            "rol": "Conductor", "estado": "Activo", "unidad_id": "K-001",
            "password": backend.hash_password("clave-segura"),
        }
        backend.usuarios_db["de.los@kapital.com"] = chofer
        respuesta = Response()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            await backend.login_user(
                backend.UsuarioLogin(identifier="74538840", password="clave-segura"), respuesta)
        token = respuesta.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]

        fila = self._fila_de(token)
        self.assertEqual(fila["usuario"], "de.los@kapital.com", "la clave, no el DNI tecleado")

        # En otra instancia, sin caché ni usuarios cargados, sigue valiendo.
        backend.sesiones_en_cache.clear()
        backend.usuarios_db.clear()
        actor = await backend.require_any_session(token)
        self.assertEqual(actor["unidad_id"], "K-001")

        # Y desactivarlo le alcanza igual que a una cuenta con `identifier`.
        backend.usuarios_db["de.los@kapital.com"] = chofer
        chofer["estado"] = "Inactivo"
        await backend.refrescar_sesiones_de(chofer)
        backend.sesiones_en_cache.clear()
        backend.usuarios_db.clear()
        with self.assertRaises(HTTPException) as caught:
            await backend.require_any_session(token)
        self.assertEqual(caught.exception.status_code, 403)

        # Y reiniciarle la contraseña le cierra la sesión.
        backend.usuarios_db["de.los@kapital.com"] = chofer
        self.assertEqual(await backend.revocar_sesiones_de(chofer), 1)

    async def test_logging_in_no_longer_rewrites_the_shared_row(self):
        """Lo que motivó el cambio: dos inicios cercanos ya no pueden pisarse."""
        backend.usuarios_db["drv-1"] = {
            "identifier": "drv-1", "rol": "Conductor", "estado": "Activo", "nombre": "Uno",
            "password": backend.hash_password("clave-segura"),
        }
        actividad_antes = list(backend.actividad_db)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            await backend.login_user(
                backend.UsuarioLogin(identifier="drv-1", password="clave-segura"), Response())

        persist.assert_not_awaited()
        self.assertEqual(len(backend.almacen_sesiones.filas), 1)
        self.assertEqual(backend.actividad_db, actividad_antes, "el acceso ya no se apunta en la fila")
        self.assertNotIn("last_login", backend.usuarios_db["drv-1"])

    async def test_a_login_that_upgrades_the_password_still_saves_it(self):
        """La única escritura de la fila que queda al entrar, y solo si hace falta."""
        backend.usuarios_db["drv-1"] = {
            "identifier": "drv-1", "rol": "Conductor", "estado": "Activo",
            "password": "en-claro",
        }
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            await backend.login_user(
                backend.UsuarioLogin(identifier="drv-1", password="en-claro"), Response())

        persist.assert_awaited_once()
        self.assertTrue(backend.usuarios_db["drv-1"]["password"].startswith("pbkdf2_sha256$"))

    async def test_logout_no_longer_downloads_or_rewrites_the_state(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()) as recarga,
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist,
        ):
            result = await backend.logout_user(Response(), token)

        self.assertTrue(result["revoked"])
        recarga.assert_not_awaited()
        persist.assert_not_awaited()

    async def test_auth_me_reads_one_user_not_the_whole_state(self):
        """Se llama cada vez que alguien abre la aplicación: no puede costar el estado entero."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo", "nombre": "Uno"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()) as recarga,
            patch.object(backend, "_usuario_para_sesion", new=AsyncMock(return_value=user)) as uno,
        ):
            payload = await backend.get_authenticated_user(token)

        self.assertEqual(payload["identifier"], "drv-1")
        recarga.assert_not_awaited()
        uno.assert_awaited_once_with("drv-1")

    async def test_a_database_outage_is_a_503_never_a_logout(self):
        """Si la tabla no responde no se echa a todo el mundo ni se deja entrar a nadie."""
        backend.AUTH_ENFORCED = True

        class Caida(backend.sesiones.SesionesEnMemoria):
            async def buscar(self, token_hash):
                raise backend.sesiones.SesionesNoDisponibles("sesion_buscar", 503)

        backend.almacen_sesiones = Caida()
        with self.assertRaises(HTTPException) as caught:
            await backend.require_any_session("cualquier-token")
        self.assertEqual(caught.exception.status_code, 503)

    async def test_last_login_comes_from_the_sessions_table(self):
        admin = {"identifier": "admin@e.com", "rol": "Administración", "estado": "Activo"}
        chofer = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo",
                  "last_login": "2026-09-01T10:00:00"}
        antiguo = {"identifier": "drv-2", "rol": "Conductor", "estado": "Activo",
                   "last_login": "2026-08-01T10:00:00"}
        backend.usuarios_db.update({"admin@e.com": admin, "drv-1": chofer, "drv-2": antiguo})
        await backend.abrir_sesion(chofer)

        with patch.object(backend, "_load_compat_users", new=AsyncMock()), \
                patch.object(backend, "reload_db", new=AsyncMock()):
            listado = await backend.get_all_users("admin@e.com")
        por_clave = {u["email"]: u for u in listado["usuarios"]}

        self.assertTrue(por_clave["drv-1"]["last_login"].startswith(time.strftime("%Y-")))
        self.assertNotEqual(por_clave["drv-1"]["last_login"], "2026-09-01T10:00:00")
        # La fecha escrita en el usuario es de antes de la tabla y la dejaron las
        # pruebas de las importaciones: quien no ha entrado desde entonces, nunca.
        self.assertIsNone(por_clave["drv-2"]["last_login"])

    async def test_the_access_list_shows_the_persons_email_not_the_invented_account_key(self):
        """Los importados tienen por clave un `apellido.apellido@kapital.com` inventado."""
        backend.usuarios_db.update({
            "admin@e.com": {"identifier": "admin@e.com", "rol": "Administración", "estado": "Activo"},
            "silva.roncal@kapital.com": {
                "rol": "Conductor", "estado": "Activo", "email": "rsilva@gmail.com",
                "perfil_conductor": {"numDoc": "11111111", "correo": "rsilva@gmail.com"}},
            "jara.quiliche@kapital.com": {
                "rol": "Conductor", "estado": "Activo", "email": "jara.quiliche@kapital.com",
                "perfil_conductor": {"numDoc": "22222222", "correo": None}},
            "propio@gmail.com": {
                "identifier": "propio@gmail.com", "rol": "Conductor", "estado": "Pendiente",
                "email": "propio@gmail.com", "perfil_conductor": {"numDoc": "33333333"}},
        })
        with patch.object(backend, "_load_compat_users", new=AsyncMock()), \
                patch.object(backend, "reload_db", new=AsyncMock()):
            listado = await backend.get_all_users("admin@e.com")
        por_clave = {u["email"]: u for u in listado["usuarios"]}

        self.assertEqual(por_clave["silva.roncal@kapital.com"]["correo"], "rsilva@gmail.com")
        # Sin correo en su base, la importación dejó la clave: no es su correo.
        self.assertIsNone(por_clave["jara.quiliche@kapital.com"]["correo"])
        # Quien se dio de alta él mismo tiene por clave su propio correo.
        self.assertEqual(por_clave["propio@gmail.com"]["correo"], "propio@gmail.com")
        self.assertEqual(por_clave["admin@e.com"]["correo"], "admin@e.com")

    async def test_logins_still_appear_in_the_activity_history(self):
        admin = {"identifier": "admin@e.com", "rol": "Administración", "estado": "Activo",
                 "nombre": "Admin", "email": "admin@e.com"}
        backend.usuarios_db["admin@e.com"] = admin
        await backend.abrir_sesion(admin)
        backend.actividad_db.clear()

        with patch.object(backend, "reload_actividad", new=AsyncMock()):
            historial = await backend.listar_actividad(None, tipo="Usuario inició sesión")

        self.assertEqual(historial["resumen"]["total"], 1)
        evento = historial["eventos"][0]
        self.assertEqual(evento["actor_name"], "Admin")
        self.assertEqual(evento["description"], "Acceso al sistema como Administración.")
        self.assertIn("Usuario inició sesión", historial["tipos"])

    async def test_sessions_no_longer_travel_inside_the_users_payload(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        await backend.abrir_sesion(user)
        with patch.object(backend, "_persist_app_state", new=AsyncMock()) as persisted:
            await backend.persist_users_only()
        payload = persisted.await_args.args[0]
        self.assertNotIn("__sessions__", payload["usuarios"])
        self.assertNotIn("_auth_sessions", payload["usuarios"]["drv-1"])

    async def test_the_old_index_left_in_the_row_is_never_taken_for_a_user(self):
        decoded = backend._decode_full_state(
            {"usuarios": {"drv-1": {"identifier": "drv-1"}, "__sessions__": {"abc": {"identifier": "drv-1"}}}},
            include_defaults=False,
        )
        self.assertNotIn("__sessions__", decoded["usuarios"])

    def test_supabase_timestamps_are_read_whatever_their_precision(self):
        """Supabase recorta decimales; leerlos mal daría todas las sesiones por caducadas."""
        epoch = backend.sesiones.epoch_de_iso
        referencia = epoch("2026-09-27T05:15:00.356720+00:00")
        self.assertEqual(epoch("2026-09-27T05:15:00.35672+00:00"), referencia)
        self.assertEqual(epoch("2026-09-27T05:15:00.3567201234+00:00"), referencia)
        self.assertEqual(epoch("2026-09-27T05:15:00Z"), epoch("2026-09-27T05:15:00+00:00"))
        self.assertEqual(epoch("2026-09-27T00:15:00-05:00"), epoch("2026-09-27T05:15:00+00:00"))
        self.assertEqual(epoch("no es una fecha"), 0, "ilegible se da por caducada")
        self.assertEqual(epoch(None), 0)

    async def test_the_table_store_builds_safe_requests_and_fails_loudly(self):
        """El almacén de verdad: filtros bien escapados y un error que no pase por éxito."""
        llamadas = []

        class Respuesta:
            def __init__(self, estado, cuerpo):
                self.status_code, self._cuerpo = estado, cuerpo

            def json(self):
                return self._cuerpo

        async def pedir(metodo, url, **kwargs):
            llamadas.append((metodo, url, kwargs))
            if "revocada_en=is.null" in url and metodo == "PATCH":
                return Respuesta(200, [{"token_hash": "x"}, {"token_hash": "y"}])
            return Respuesta(200, [])

        almacen = backend.sesiones.SesionesEnTabla(
            pedir=pedir, url_base=lambda: "https://x.test/rest/v1/",
            cabeceras=lambda prefer=None: {"prefer": prefer or ""})

        self.assertEqual(await almacen.revocar_de("ana+prueba@e.com"), 2)
        metodo, url, kwargs = llamadas[-1]
        self.assertEqual(metodo, "PATCH")
        self.assertIn("usuario=eq.ana%2Bprueba%40e.com", url, "un + sin escapar sería un espacio")
        self.assertIn("revocada_en", kwargs["json_payload"])

        await almacen.refrescar("drv-1", {"estado": "Inactivo"})
        self.assertRegex(llamadas[-1][1], r"expira_en=gt\.\d{4}-\d{2}-\d{2}T[^&]*%2B00%3A00")

        self.assertIsNone(await almacen.buscar("a" * 64))
        self.assertIn("select=usuario,instantanea,expira_en,revocada_en", llamadas[-1][1])

        async def caida(metodo, url, **kwargs):
            return Respuesta(500, {"message": "boom"})

        rota = backend.sesiones.SesionesEnTabla(
            pedir=caida, url_base=lambda: "https://x.test/rest/v1",
            cabeceras=lambda prefer=None: {})
        with self.assertRaises(backend.sesiones.SesionesNoDisponibles):
            await rota.buscar("a" * 64)

    # --- Lote 3: acceso cruzado ---

    async def _session_for(self, identifier, **extra):
        user = {"identifier": identifier, "rol": "Conductor", "estado": "Activo", **extra}
        backend.usuarios_db[identifier] = user
        return user, await backend.abrir_sesion(user)

    async def test_driver_cannot_read_another_units_services(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._session_for("drv-1", unidad_id="K-001")
        with patch.object(backend, "_rpc_programador", new=AsyncMock()) as base:
            with self.assertRaises(HTTPException) as caught:
                await backend.servicios_del_conductor("K-002", token)
        self.assertEqual(caught.exception.status_code, 403)
        base.assert_not_awaited()

    async def test_driver_reads_their_own_unit_services(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._session_for("drv-1", unidad_id="K-001")
        with patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})) as base:
            respuesta = await backend.servicios_del_conductor(None, token)
        self.assertEqual(respuesta["unidad"], "K001")
        self.assertEqual(base.await_args.args[1]["p_clave"], "K001")

    async def test_admin_may_read_any_units_services(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._session_for("adm", rol="Administrador")
        with patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})):
            self.assertEqual((await backend.servicios_del_conductor("K-002", token))["unidad"], "K002")

    async def test_client_cannot_read_another_companys_services(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._session_for("cli", rol="Cliente", empresa_id="GLOBO_AZUL")
        with patch.object(backend, "_rpc_programador", new=AsyncMock()) as base:
            with self.assertRaises(HTTPException) as caught:
                await backend.servicios_del_cliente(None, "OTRA_EMPRESA", token)
        self.assertEqual(caught.exception.status_code, 403)
        base.assert_not_awaited()

    async def test_driver_reads_own_notifications_by_any_login_alias(self):
        """El login acepta correo o DNI: la propiedad debe aceptar los mismos
        alias, o entrar con el DNI da 403 sobre los propios datos."""
        backend.AUTH_ENFORCED = True
        user = {
            "identifier": "anyelo@kapital.com", "rol": "Conductor", "estado": "Activo",
            "email": "anyelo@kapital.com", "dni": "74538840",
            "perfil_conductor": {"numDoc": "74538840"},
        }
        backend.usuarios_db["anyelo@kapital.com"] = user
        token = await backend.abrir_sesion(user)
        backend.notifications_db.append({"id": 1, "para": "anyelo@kapital.com", "fecha": "2026-01-01"})
        for alias in ("anyelo@kapital.com", "74538840", "ANYELO@KAPITAL.COM"):
            with self.subTest(alias=alias):
                with patch.object(backend, "reload_notifications", new=AsyncMock()):
                    await backend.get_conductor_notifications(alias, token)

    async def test_ownership_is_rechecked_against_the_full_user_before_denying(self):
        """Una instantánea sin todos los alias no debe producir un 403 falso."""
        backend.AUTH_ENFORCED = True
        user = {
            "identifier": "drv-1", "rol": "Conductor", "estado": "Activo",
            "dni": "74538840",
        }
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        backend.sesiones_en_cache[digest].pop("dni")  # instantánea antigua, sin dni
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
        ):
            await backend.get_conductor_notifications("74538840", token)

    async def test_driver_cannot_read_another_drivers_notifications(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._session_for("drv-1", email="uno@e.com")
        backend.notifications_db.append({"id": 1, "para": "otro@e.com", "fecha": "2026-01-01"})
        with self.assertRaises(HTTPException) as caught:
            await backend.get_conductor_notifications("otro@e.com", token)
        self.assertEqual(caught.exception.status_code, 403)

    async def test_anonymous_cannot_read_protected_resources(self):
        backend.AUTH_ENFORCED = True
        with patch.object(backend, "_load_compat_users", new=AsyncMock()):
            for coro in (
                backend.servicios_del_conductor("K-001", None),
                backend.servicios_del_cliente(None, "GLOBO_AZUL", None),
                backend.get_conductor_notifications("a@e.com", None),
            ):
                with self.assertRaises(HTTPException) as caught:
                    await coro
                self.assertEqual(caught.exception.status_code, 401)

    async def test_gating_does_not_load_the_users_blob(self):
        """El objetivo del lote: gatear sin volver a los ~3,42 MB de usuarios."""
        backend.AUTH_ENFORCED = True
        _, token = await self._session_for("drv-1", unidad_id="K-001")
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()) as heavy,
            patch.object(backend, "reload_db", new=AsyncMock()) as completa,
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})),
        ):
            await backend.servicios_del_conductor("K-001", token)
        heavy.assert_not_awaited()
        completa.assert_not_awaited()

    # --- Lote 3: acceso cruzado (parcial; ver relevo §8) ---

    async def test_sos_notification_requires_a_session(self):
        backend.AUTH_ENFORCED = True
        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.add_notification({"title": "falsa"}, None)
        self.assertEqual(caught.exception.status_code, 401)

    async def test_notification_ids_stay_unique_past_the_cap(self):
        """len(notifications_db) + 1 repetía el id 51 para siempre."""
        backend.notifications_db.extend({"id": i + 1} for i in range(50))
        seen = {n["id"] for n in backend.notifications_db}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            for _ in range(5):
                created = await backend.add_notification({"title": "t"}, None)
                self.assertNotIn(created["id"], seen)
                seen.add(created["id"])

    # --- Reinicio de contraseña ---

    def _escenario_de_reinicio(self):
        """Un administrador, un gerente y un conductor con sesión abierta."""
        backend.AUTH_ENFORCED = True
        admin = {"identifier": "admin@kapital.com", "nombre": "Admin",
                 "rol": "Administrador", "estado": "Activo", "password": "x"}
        gerente = {"identifier": "gerente@kapital.com", "nombre": "Gerente",
                   "rol": "Gerente de Operaciones", "estado": "Activo", "password": "x"}
        chofer = {"identifier": "chofer@kapital.com", "nombre": "Chofer",
                  "rol": "Conductor", "estado": "Activo", "password": "la-que-olvido"}
        backend.usuarios_db.update({u["identifier"]: u for u in (admin, gerente, chofer)})
        return admin, gerente, chofer

    async def test_a_reset_hands_over_a_one_time_password_and_forces_a_change(self):
        """Es la única salida a un olvido desde que las contraseñas se cifran."""
        admin, _gerente, chofer = self._escenario_de_reinicio()
        token_admin = await backend.abrir_sesion(admin)
        token_chofer = await backend.abrir_sesion(chofer)
        anterior = chofer["password"]

        with patch.object(backend, "reload_db", new=AsyncMock()),              patch.object(backend, "persist_users_only", new=AsyncMock()):
            respuesta = await backend.reset_user_password(
                backend.ReinicioDeContrasena(admin_email=admin["identifier"],
                                             target=chofer["identifier"]),
                token_admin,
            )

        provisional = respuesta["password"]
        self.assertEqual(len(provisional), backend.LARGO_CONTRASENA_PROVISIONAL)
        self.assertNotEqual(chofer["password"], anterior)
        self.assertTrue(backend.verify_password(provisional, chofer["password"]))
        self.assertFalse(backend.verify_password("la-que-olvido", chofer["password"]))
        self.assertTrue(chofer["needs_password_change"], "debe elegir la suya al entrar")

        # La sesión que tuviera abierta se cierra: si no, seguiría dentro doce
        # horas más con la contraseña que acaba de dejar de ser válida.
        self.assertEqual(respuesta["sesiones_cerradas"], 1)
        self.assertIsNone(await actor_de(token_chofer))

        # Y la provisional no se queda escrita en el historial.
        for evento in backend.actividad_db:
            self.assertNotIn(provisional, json.dumps(evento, ensure_ascii=False))

    async def test_a_reset_never_becomes_a_way_to_take_over_an_admin(self):
        """Reiniciar la contraseña de quien tiene más permisos es tomar su cuenta."""
        admin, gerente, chofer = self._escenario_de_reinicio()
        token_gerente = await backend.abrir_sesion(gerente)

        with patch.object(backend, "reload_db", new=AsyncMock()),              patch.object(backend, "persist_users_only", new=AsyncMock()):
            # Un gerente sí puede con un conductor: es el caso cotidiano.
            await backend.reset_user_password(
                backend.ReinicioDeContrasena(admin_email=gerente["identifier"],
                                             target=chofer["identifier"]),
                token_gerente,
            )
            # Pero no con la administración principal.
            with self.assertRaises(HTTPException) as caught:
                await backend.reset_user_password(
                    backend.ReinicioDeContrasena(admin_email=gerente["identifier"],
                                                 target=admin["identifier"]),
                    token_gerente,
                )
            self.assertEqual(caught.exception.status_code, 403)
            self.assertEqual(admin["password"], "x", "intacta")

            # Ni consigo mismo: para eso está cambiarla sabiendo la actual.
            with self.assertRaises(HTTPException) as caught:
                await backend.reset_user_password(
                    backend.ReinicioDeContrasena(admin_email=gerente["identifier"],
                                                 target=gerente["identifier"]),
                    token_gerente,
                )
            self.assertEqual(caught.exception.status_code, 400)

    async def test_a_reset_needs_an_administration_session(self):
        """Sin sesión, o con la de un conductor, no se reinicia nada."""
        _admin, _gerente, chofer = self._escenario_de_reinicio()
        otro = {"identifier": "otro@kapital.com", "rol": "Conductor",
                "estado": "Activo", "password": "y"}
        backend.usuarios_db["otro@kapital.com"] = otro
        token_chofer = await backend.abrir_sesion(chofer)

        with patch.object(backend, "reload_db", new=AsyncMock()),              patch.object(backend, "persist_users_only", new=AsyncMock()):
            for etiqueta, admin_email, token in (
                ("un conductor haciéndose pasar por admin", chofer["identifier"], token_chofer),
                ("sin cookie ninguna", "admin@kapital.com", None),
            ):
                with self.subTest(etiqueta):
                    with self.assertRaises(HTTPException) as caught:
                        await backend.reset_user_password(
                            backend.ReinicioDeContrasena(admin_email=admin_email,
                                                         target="otro@kapital.com"),
                            token,
                        )
                    self.assertIn(caught.exception.status_code, (401, 403))
        self.assertEqual(otro["password"], "y", "intacta")

    def test_a_provisional_password_can_be_read_out_loud(self):
        """Se dicta por teléfono, así que no puede tener caracteres ambiguos."""
        vistas = {backend.contrasena_provisional() for _ in range(200)}
        self.assertGreater(len(vistas), 190, "no puede repetirse")
        for clave in vistas:
            self.assertEqual(len(clave), backend.LARGO_CONTRASENA_PROVISIONAL)
            # Ni O ni 0, ni l ni I ni 1: se confunden al cantarlas.
            self.assertFalse(set(clave) & set("O0lI1"), clave)

    # --- Lote 1: identidad de sesión ---

    async def test_document_states_do_not_block_driver_operations(self):
        """Un conductor en revisión documental debe seguir operando: su portal
        es donde sube y resube documentos."""
        backend.AUTH_ENFORCED = True
        for estado in ("Pendiente Revisión", "Documentos Observados", "Activo"):
            with self.subTest(estado=estado):
                user = {"identifier": "drv", "rol": "Conductor", "estado": estado}
                backend.usuarios_db["drv"] = user
                token = await backend.abrir_sesion(user)
                self.assertIs(await backend.require_request_actor(token, expected_user=user), user)

    async def test_account_lifecycle_states_block_operations(self):
        backend.AUTH_ENFORCED = True
        for estado in ("Pendiente", "Rechazado", "Inactivo"):
            with self.subTest(estado=estado):
                user = {"identifier": "u", "rol": "Conductor", "estado": estado}
                backend.usuarios_db["u"] = user
                token = await backend.abrir_sesion(user)
                with self.assertRaises(HTTPException) as caught:
                    await backend.require_request_actor(token, expected_user=user)
                self.assertEqual(caught.exception.status_code, 403)

    async def test_auth_me_returns_server_side_identity(self):
        user = {
            "identifier": "drv-1", "nombre": "Driver", "rol": "Conductor",
            "estado": "Pendiente Revisión", "password": "secret",
            "perfil_conductor": {},
        }
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        with patch.object(backend, "reload_db", new=AsyncMock()):
            payload = await backend.get_authenticated_user(token)
        self.assertEqual(payload["identifier"], "drv-1")
        self.assertEqual(payload["rol"], "Conductor")
        self.assertTrue(payload["profileComplete"])
        self.assertNotIn("password", payload)
        self.assertNotIn("_auth_sessions", payload)

    async def test_auth_me_rejects_missing_or_invalid_session(self):
        for token in (None, "not-a-real-token"):
            with self.subTest(token=token):
                with patch.object(backend, "reload_db", new=AsyncMock()):
                    with self.assertRaises(HTTPException) as caught:
                        await backend.get_authenticated_user(token)
                self.assertEqual(caught.exception.status_code, 401)

    async def test_logout_revokes_session_server_side(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = await backend.abrir_sesion(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist_users,
        ):
            result = await backend.logout_user(Response(), token)
        persist_users.assert_not_awaited()
        self.assertTrue(result["revoked"])
        # La sesión revocada ya no resuelve, aunque el token siga sin caducar.
        self.assertIsNone(await backend.get_user_by_session(token))

    async def test_logout_is_idempotent_without_a_valid_session(self):
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist_users,
        ):
            result = await backend.logout_user(Response(), "expired-token")
        persist_users.assert_not_awaited()
        self.assertFalse(result["revoked"])

    async def test_logout_only_revokes_the_presented_session(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        phone = await backend.abrir_sesion(user)
        laptop = await backend.abrir_sesion(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            await backend.logout_user(Response(), phone)
        self.assertIsNone(await backend.get_user_by_session(phone))
        self.assertIs(await backend.get_user_by_session(laptop), user)

    async def test_fleet_delete_requires_admin_session_when_enforced(self):
        backend.AUTH_ENFORCED = True
        unit = {"capacidad": 15, "tipo": "Van", "chofer": "Driver"}
        backend.conductores_db["K-001"] = copy.deepcopy(unit)
        driver = {"identifier": "driver-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["driver-1"] = driver
        token = await backend.abrir_sesion(driver)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=AsyncMock()) as persist_state,
        ):
            with self.assertRaises(HTTPException) as caught:
                await backend.delete_flota("K-001", token)
        self.assertEqual(caught.exception.status_code, 403)
        persist_state.assert_not_awaited()
        self.assertEqual(backend.conductores_db["K-001"], unit)

    async def test_fleet_delete_rejects_anonymous_request_when_enforced(self):
        backend.AUTH_ENFORCED = True
        backend.conductores_db["K-001"] = {"capacidad": 15}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=AsyncMock()) as persist_state,
        ):
            with self.assertRaises(HTTPException) as caught:
                await backend.delete_flota("K-001")
        self.assertEqual(caught.exception.status_code, 401)
        persist_state.assert_not_awaited()
        self.assertIn("K-001", backend.conductores_db)

    async def test_fleet_delete_verifies_removal_with_a_fresh_read(self):
        backend.conductores_db["K-001"] = {"capacidad": 15}
        backend.conductores_db["K-002"] = {"capacidad": 20}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_app_state", new=AsyncMock()) as persist_state,
            patch.object(backend, "_load_compat_fleet", new=AsyncMock()),
        ):
            response = await backend.delete_flota("K-001")
        persist_state.assert_awaited_once()
        self.assertEqual(response["unidad_id"], "K-001")
        self.assertNotIn("K-001", backend.conductores_db)
        self.assertIn("K-002", backend.conductores_db)

    async def test_fleet_delete_rolls_back_memory_when_persist_fails(self):
        original = {"capacidad": 15, "soat": "", "soat_doc": "private://keep"}
        backend.conductores_db["K-001"] = copy.deepcopy(original)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(
                backend, "_persist_app_state",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="unavailable")),
            ),
        ):
            with self.assertRaises(HTTPException):
                await backend.delete_flota("K-001")
        self.assertEqual(backend.conductores_db["K-001"], original)


    async def test_fleet_writes_reject_without_session_before_reading_the_database(self):
        """Una escritura de flota sin sesión no debe costar ni una lectura.

        `reload_db(force=True)` salta el caché TTL y descarga el estado completo
        (~3,95 MB). Mientras corría antes del gate, cada petición anónima pagaba
        esa lectura entera para acabar rechazada con 401: cien sondas eran
        ~400 MB de egress tirados. Si alguien vuelve a poner el reload por
        delante de la autorización, esta prueba falla.
        """
        backend.AUTH_ENFORCED = True
        registro = backend.FlotaRegistro(
            placa="KAP-999", capacidad=12, tipo="Sprinter", chofer="Nadie"
        )
        actualizacion = backend.FlotaUpdate(capacidad=14)

        llamadas = [
            ("POST", lambda: backend.add_flota(registro, session_token=None)),
            ("PUT", lambda: backend.update_flota("KAP-999", actualizacion, session_token=None)),
            ("DELETE", lambda: backend.delete_flota("KAP-999", session_token=None)),
        ]

        for verbo, llamada in llamadas:
            with self.subTest(verbo=verbo):
                reload_db = AsyncMock()
                with patch.object(backend, "reload_db", new=reload_db):
                    with self.assertRaises(HTTPException) as caught:
                        await llamada()

                self.assertEqual(caught.exception.status_code, 401)
                reload_db.assert_not_awaited()

    async def test_fleet_writes_still_reload_once_the_caller_is_authorized(self):
        """El reload no se elimina, solo se mueve: la escritura lo necesita.

        Una instancia caliente no debe escribir sobre un snapshot viejo, así que
        tras autorizar se sigue releyendo con `force=True`.
        """
        backend.AUTH_ENFORCED = True
        admin = {
            "identifier": "admin@example.com",
            "email": "admin@example.com",
            "nombre": "Admin Flota",
            "rol": "Administración",
            "estado": "Activo",
        }
        backend.usuarios_db["admin@example.com"] = admin
        token = await backend.abrir_sesion(admin)
        backend.conductores_db.clear()

        reload_db = AsyncMock()
        with (
            patch.object(backend, "reload_db", new=reload_db),
            patch.object(
                backend,
                "_persist_and_verify_fleet",
                new=AsyncMock(return_value={"capacidad": 12}),
            ),
        ):
            await backend.add_flota(
                backend.FlotaRegistro(
                    placa="KAP-777", capacidad=12, tipo="Sprinter", chofer="Alguien"
                ),
                session_token=token,
            )

        reload_db.assert_awaited_once()
        self.assertEqual(reload_db.await_args.kwargs.get("force"), True)


    async def _generar_rutas(self, filas, *, fecha="13/09/2026", hora="08:00",
                             sentido="INGRESO", sede="LIMA"):
        """Ejecuta la generación con un Excel en memoria y devuelve las rutas."""
        backend.AUTH_ENFORCED = False
        backend.conductores_db.clear()
        backend.conductores_db["K-001"] = {"capacidad": 10, "tipo": "Van", "chofer": "Chofer"}

        dataframe = pd.DataFrame(filas)
        stream = io.BytesIO()
        dataframe.to_excel(stream, index=False)
        stream.seek(0)

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist", new=AsyncMock()),
            patch.object(backend, "persist_routes_summary", new=AsyncMock()),
        ):
            return await backend.assign_routes_from_excel(
                UploadFile(filename="rutas.xlsx", file=stream),
                fecha=fecha, hora=hora, sentido=sentido, sede=sede,
            )

    @staticmethod
    def _fila(dni, coordenadas):
        return {
            "FECHA": "13/09/2026", "HORA": "08:00", "SENTIDO": "INGRESO", "SEDE": "LIMA",
            "DISTRITO": "CALLAO", "DNI": dni, "NOMBRES": f"Agente {dni}",
            "DIRECCION": "Calle 1", "EMPRESA": "KAPITAL", "COORDENADAS": coordenadas,
        }

    async def test_a_passenger_without_readable_coordinates_is_flagged_not_hidden(self):
        """Una ubicación inventada que no se anuncia invalida el ruteo.

        El respaldo al centro de Lima se conserva para que una celda sucia no
        tumbe la generación, pero el agente queda marcado: en la base actual el
        70 % del padrón cayó a ese punto sin que nadie pudiera verlo.
        """
        rutas = await self._generar_rutas([
            self._fila("111", "-12.05,-77.10"),
            self._fila("222", "basura"),
            self._fila("333", ""),
        ])

        agentes = {a["id"]: a for r in rutas for a in r["agentes"]}
        self.assertEqual(len(agentes), 3, "no se pierde ningún pasajero")

        self.assertFalse(agentes["111"]["ubicacion_estimada"])
        self.assertAlmostEqual(agentes["111"]["lat"], -12.05)

        for dni in ("222", "333"):
            self.assertTrue(
                agentes[dni]["ubicacion_estimada"],
                f"{dni} recibió la ubicación de respaldo y debe decirlo",
            )
            self.assertAlmostEqual(agentes[dni]["lat"], backend.COORD_RESPALDO_LAT)
            self.assertAlmostEqual(agentes[dni]["lng"], backend.COORD_RESPALDO_LNG)

    async def test_generated_routes_keep_the_shift_that_produced_them(self):
        """Sin fecha ni sentido, dos generaciones son indistinguibles.

        `fecha`, `sentido` y `sede` solo servían para filtrar el Excel y se
        descartaban, así que un tablero no sabía de qué día era. Acumular varias
        generaciones sobre el mismo tablero dejaba de ser detectable.
        """
        rutas = await self._generar_rutas(
            [self._fila("111", "-12.05,-77.10")],
            fecha="13/09/2026", sentido="INGRESO", sede="LIMA",
        )

        self.assertTrue(rutas)
        for ruta in rutas:
            self.assertEqual(ruta["fecha"], "13/09/2026")
            self.assertEqual(ruta["sentido"], "INGRESO")
            self.assertEqual(ruta["sede"], "LIMA")
            self.assertEqual(ruta["horario"], "08:00")

    async def test_empty_shift_fields_do_not_write_blank_keys(self):
        """Un filtro vacío no debe ensuciar el snapshot con claves sin valor."""
        rutas = await self._generar_rutas(
            [self._fila("111", "-12.05,-77.10")],
            fecha="13/09/2026", sentido="INGRESO", sede="",
        )

        self.assertTrue(rutas)
        for ruta in rutas:
            self.assertNotIn("sede", ruta)
            self.assertEqual(ruta["fecha"], "13/09/2026")


    async def _preparar_renombrado(self):
        """Deja una unidad con su conductor asociado y una sesión abierta."""
        backend.AUTH_ENFORCED = True
        backend.conductores_db.clear()
        backend.conductores_db["K-001"] = {"capacidad": 4, "tipo": "AUTO", "chofer": "Chofer Uno"}

        admin = {
            "identifier": "admin@example.com", "email": "admin@example.com",
            "nombre": "Admin", "rol": "Administración", "estado": "Activo",
        }
        conductor = {
            "identifier": "driver-001", "email": None, "nombre": "Chofer Uno",
            "rol": "Conductor", "estado": "Activo", "unidad_id": "K-001",
        }
        backend.usuarios_db.update({"admin@example.com": admin, "driver-001": conductor})
        return admin, conductor, await backend.abrir_sesion(admin), await backend.abrir_sesion(conductor)

    async def test_renaming_a_unit_keeps_its_driver_able_to_see_their_routes(self):
        """El padrón es la clave con la que se autoriza al conductor.

        Migrar solo la flota dejaría al conductor apuntando a una unidad
        inexistente, y su sesión abierta conservaría el padrón viejo: perdería
        el acceso a sus propias rutas sin que nada lo explicara.
        """
        _admin, conductor, admin_token, driver_token = await self._preparar_renombrado()

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_and_verify_fleet", new=AsyncMock(return_value={})),
        ):
            resultado = await backend.rename_flota(
                "K-001", backend.FlotaRenombrar(nuevo_id="K-999"), session_token=admin_token,
            )

        self.assertEqual(resultado["unidad_id"], "K-999")
        self.assertEqual(resultado["usuarios_actualizados"], 1)
        self.assertIn("K-999", backend.conductores_db)
        self.assertNotIn("K-001", backend.conductores_db)
        self.assertEqual(conductor["unidad_id"], "K-999")

        # Lo esencial: la INSTANTÁNEA del índice también migra.
        #
        # No vale comprobarlo con `session_actor_from_index` teniendo los
        # usuarios cargados: esa función devuelve el usuario real cuando lo
        # está, y pasaría igual sin refrescar. El índice importa justo cuando
        # no lo están —el arranque en frío de Vercel—, así que se mira la
        # entrada directamente.
        token_hash = hashlib.sha256(driver_token.encode("utf-8")).hexdigest()
        entrada = backend.sesiones_en_cache[token_hash]
        self.assertEqual(entrada.get("unidad_id"), "K-999",
                         "sin refrescar el índice, el conductor pierde su unidad en frío")

        # Y con los usuarios descargados, la autorización sigue resolviendo bien.
        backend.usuarios_db.clear()
        actor = await actor_de(driver_token)
        self.assertEqual(actor.get("unidad_id"), "K-999")

    async def test_only_administration_may_rename_a_unit(self):
        """`_ADMIN_ROLES` incluye Gerente y Programador; renombrar no es para ellos."""
        await self._preparar_renombrado()

        for rol in ("Gerente de Operaciones", "Programador de rutas", "Conductor"):
            with self.subTest(rol=rol):
                otro = {
                    "identifier": f"{rol}@example.com", "email": f"{rol}@example.com",
                    "nombre": rol, "rol": rol, "estado": "Activo",
                }
                backend.usuarios_db[otro["identifier"]] = otro
                token = await backend.abrir_sesion(otro)

                reload_db = AsyncMock()
                with patch.object(backend, "reload_db", new=reload_db):
                    with self.assertRaises(HTTPException) as caught:
                        await backend.rename_flota(
                            "K-001", backend.FlotaRenombrar(nuevo_id="K-999"), session_token=token,
                        )

                self.assertEqual(caught.exception.status_code, 403)
                reload_db.assert_not_awaited()

    async def test_renaming_onto_an_existing_padron_is_rejected(self):
        """Aceptarlo fusionaría dos unidades y perdería una sin aviso."""
        _admin, _conductor, admin_token, _ = await self._preparar_renombrado()
        backend.conductores_db["K-002"] = {"capacidad": 10, "tipo": "VAN", "chofer": "Otro"}

        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.rename_flota(
                    "K-001", backend.FlotaRenombrar(nuevo_id="K-002"), session_token=admin_token,
                )

        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("K-001", backend.conductores_db, "no se toca nada al rechazar")
        self.assertEqual(backend.conductores_db["K-002"]["chofer"], "Otro")

    async def test_a_failed_rename_leaves_everything_as_it_was(self):
        """Si la escritura no se confirma, no puede quedar a medias."""
        _admin, conductor, admin_token, _ = await self._preparar_renombrado()
        fallo = HTTPException(status_code=503, detail="sin base")

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_and_verify_fleet", new=AsyncMock(side_effect=fallo)),
        ):
            with self.assertRaises(HTTPException):
                await backend.rename_flota(
                    "K-001", backend.FlotaRenombrar(nuevo_id="K-999"), session_token=admin_token,
                )

        self.assertIn("K-001", backend.conductores_db)
        self.assertNotIn("K-999", backend.conductores_db)
        self.assertEqual(conductor["unidad_id"], "K-001", "el conductor vuelve a su unidad")


    def test_document_paths_never_escape_their_unit_folder(self):
        """El nombre del archivo lo elige el usuario: no puede decidir la ruta.

        Sin saneado, un nombre con barras o puntos permitiría escribir fuera de
        la carpeta de la unidad, o pisar el documento de otro conductor.
        """
        casos = [
            ("K-027", "dniScaneado", "foto.png", "K-027/dniScaneado.png"),
            # Intento de salir del directorio.
            ("../../otro", "dni", "x.png", "otro/dni.png"),
            ("K-027", "../licencia", "a.png", "K-027/licencia.png"),
            # Nombre con ruta dentro.
            ("K-027", "dni", "/etc/passwd", "K-027/dni"),
            # Acentos y espacios no llegan al almacenamiento.
            ("K-027", "dni", "mi documento ñ.JPG", "K-027/dni.jpg"),
            # Sin unidad no se queda en la raíz del bucket.
            ("", "dni", "a.png", "sin-unidad/dni.png"),
        ]
        for unidad, campo, nombre, esperado in casos:
            with self.subTest(nombre=nombre):
                ruta = backend._ruta_de_documento(unidad, campo, nombre)
                self.assertEqual(ruta, esperado)
                self.assertNotIn("..", ruta)
                self.assertEqual(ruta.count("/"), 1, "siempre unidad/archivo")

    async def test_replacing_a_document_uploads_it_to_a_new_path(self):
        """Con la misma ruta, la ficha seguía enseñando la imagen anterior.

        La página guarda la URL firmada de cada ruta unos minutos, y reemplazar
        sobrescribía el mismo archivo: nada cambiaba de nombre y nada se volvía
        a pedir.
        """
        datos = backend.DocumentoSubida(
            unidad_id="K-027", campo="recordConductor", nombre="record.PDF",
            tipo="application/pdf", base64="JVBERi0=",
        )
        with patch.object(backend, "upload_document_to_storage", new=AsyncMock()) as subir:
            primera = await backend.subir_documento(datos)
            segunda = await backend.subir_documento(datos)

        self.assertNotEqual(primera["path"], segunda["path"])
        for respuesta in (primera, segunda):
            ruta = respuesta["path"]
            # Sigue siendo de su unidad —el permiso para verla sale de ahí— y
            # conserva la extensión.
            self.assertTrue(ruta.startswith("K-027/recordConductor-"), ruta)
            self.assertTrue(ruta.endswith(".pdf"), ruta)
            self.assertEqual(ruta.count("/"), 1)
        self.assertEqual([c.args[1] for c in subir.await_args_list], [primera["path"], segunda["path"]])
        self.assertEqual(backend._ruta_unica("K-027/cv").count("-"), 2, "sin extensión, también")

    async def test_administration_uploads_for_a_driver_without_a_unit(self):
        """En Accesos, un conductor pendiente de aprobar todavía no tiene unidad.

        Subirle un documento daba «Falta la unidad de destino»; ahora va a su
        carpeta personal, la misma en la que lo subiría él, y él lo puede ver.
        """
        backend.AUTH_ENFORCED = True
        admin = {"identifier": "admin@example.com", "rol": "Administración", "estado": "Activo"}
        conductor = {"identifier": "45757485", "dni": "45757485", "rol": "Conductor", "estado": "Pendiente Revisión"}
        backend.usuarios_db.update({"admin@example.com": admin, "45757485": conductor})
        token = await backend.abrir_sesion(admin)
        datos = dict(unidad_id="", campo="licenciaConducir", nombre="lic.jpg", tipo="image/jpeg", base64="AA==")
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "upload_document_to_storage", new=AsyncMock()),
        ):
            respuesta = await backend.subir_documento(
                backend.DocumentoSubida(**datos, conductor="45757485"), token,
            )
            carpeta = respuesta["path"].split("/", 1)[0]
            self.assertEqual(carpeta, backend._carpetas_del_actor(conductor)[0])
            self.assertTrue(carpeta.startswith("usuario-"))
            # El conductor, con su sesión, alcanza esa carpeta.
            self.assertTrue(backend._puede_ver_unidad(conductor, carpeta))
            # Sin decir por quién, sigue sin saber dónde guardarlo.
            with self.assertRaises(HTTPException) as caught:
                await backend.subir_documento(backend.DocumentoSubida(**datos), token)
            self.assertEqual(caught.exception.status_code, 400)

    def test_a_driver_can_only_reach_their_own_unit_documents(self):
        """Conocer una ruta no puede bastar para ver el DNI de otro."""
        conductor = {"rol": "Conductor", "unidad_id": "K-027"}
        admin = {"rol": "Administración"}

        self.assertTrue(backend._puede_ver_unidad(conductor, "K-027"))
        self.assertTrue(backend._puede_ver_unidad(conductor, "k-027"), "el padrón no distingue mayúsculas")
        self.assertFalse(backend._puede_ver_unidad(conductor, "K-142"))

        # Administración revisa cualquier unidad: es su trabajo.
        self.assertTrue(backend._puede_ver_unidad(admin, "K-142"))

        # Con la exigencia desactivada no hay actor: se conserva el rollback.
        self.assertTrue(backend._puede_ver_unidad(None, "K-142"))

    def test_a_profile_photo_is_reachable_by_anyone_with_a_session(self):
        """La foto de perfil no hereda el gateo por unidad de los documentos.

        El cliente ve la foto del conductor de su ruta, y así era cuando la
        foto viajaba incrustada en la fila. Si al llevarla al bucket pasara a
        pedir permiso sobre la unidad, se rompería justo para quien más la mira.
        """
        cliente = {"rol": "Cliente", "email": "cliente@empresa.com"}
        conductor = {"rol": "Conductor", "unidad_id": "K-027"}

        self.assertTrue(backend._puede_ver_unidad(cliente, backend.CARPETA_AVATARES))
        self.assertTrue(backend._puede_ver_unidad(conductor, backend.CARPETA_AVATARES))

        # Lo que no cambia: los documentos de otra unidad siguen cerrados.
        self.assertFalse(backend._puede_ver_unidad(cliente, "K-027"))

    def test_a_profile_photo_goes_to_the_uploaders_own_folder(self):
        """Nadie sube la foto de otro, así que el destino sale de la sesión.

        Un administrador no tiene unidad: por la vía de los documentos se
        quedaba sin destino y la subida fallaba con «Falta la unidad».
        """
        admin = {"rol": "Administrador", "email": "admin@kapital.com"}
        conductor = {"rol": "Conductor", "unidad_id": "K-027", "email": "c@kapital.com"}

        ruta_admin = backend._ruta_de_avatar(admin, "foto.JPG")
        ruta_conductor = backend._ruta_de_avatar(conductor, "foto.jpg")

        for ruta in (ruta_admin, ruta_conductor):
            self.assertTrue(ruta.startswith(backend.CARPETA_AVATARES + "/"))
            self.assertEqual(ruta.count("/"), 1)
            self.assertNotIn("..", ruta)

        self.assertNotEqual(ruta_admin, ruta_conductor, "cada uno la suya")
        # El correo no puede aparecer en claro: la ruta viaja al navegador.
        self.assertNotIn("admin", ruta_admin.split("/")[1])
        self.assertNotIn("kapital.com", ruta_admin)

    def test_saving_a_photo_never_puts_its_bytes_back_in_the_row(self):
        """Tres fotos incrustadas pesaban 484 KB de los 571 KB de la fila.

        Si al guardar se colara otra vez el base64, el ahorro se desharía solo.
        """
        guardada = backend._foto_guardable({
            "name": "yo.jpg", "size": 1234, "type": "image/jpeg",
            "path": "avatares/usuario-abc.jpg",
            "base64": "data:image/jpeg;base64," + "A" * 100000,
            "url": "blob:http://localhost/9f8e",
        })

        self.assertEqual(guardada, {"name": "yo.jpg", "size": 1234,
                                    "type": "image/jpeg",
                                    "path": "avatares/usuario-abc.jpg"})
        self.assertNotIn("base64", guardada)
        self.assertNotIn("url", guardada, "la vista previa solo vive en su pestaña")

        # El formato viejo se deja pasar: una pestaña abierta desde antes del
        # despliegue debe poder seguir guardando.
        vieja = "data:image/jpeg;base64,AAAA"
        self.assertEqual(backend._foto_guardable(vieja), vieja)
        self.assertIsNone(backend._foto_guardable(None))

    def test_resubmitting_a_profile_never_orphans_a_stored_document(self):
        """El formulario reenviaba fichas sin ruta y el archivo quedaba huérfano.

        El conductor veía «Documento no disponible» aunque el fichero seguía
        en el bucket: lo único que se había perdido era el puntero.
        """
        anterior = {
            "dniScaneado": {"name": "dni.png", "size": 38943, "path": "usuario-ab12/dniScaneado.png"},
            "soat": {"name": "soat.png", "path": "usuario-ab12/soat.png"},
            "direccion": "AV. SIEMPRE VIVA 123",
        }
        # Lo que mandaba el formulario tras restaurar el borrador.
        entrante = {
            "dniScaneado": {"name": "dni.png", "size": 38943, "type": "image/png", "isRestored": True},
            "soat": {"name": "soat-nuevo.png", "path": "usuario-ab12/soat-nuevo.png"},
            "direccion": "AV. NUEVA 456",
        }

        resultado = backend.conservar_documentos(anterior, entrante)

        self.assertEqual(resultado["dniScaneado"], anterior["dniScaneado"], "la ficha vacía no pisa la ruta")
        self.assertEqual(resultado["soat"]["path"], "usuario-ab12/soat-nuevo.png", "un documento nuevo sí sustituye")
        self.assertEqual(resultado["direccion"], "AV. NUEVA 456", "los datos de texto se actualizan igual")

    def test_a_document_can_still_be_removed_on_purpose(self):
        anterior = {"cv": {"name": "cv.pdf", "path": "usuario-ab12/cv.pdf"}}
        for retirado in (None, ""):
            with self.subTest(retirado=retirado):
                resultado = backend.conservar_documentos(anterior, {"cv": retirado})
                self.assertEqual(resultado["cv"], retirado)

    def test_the_first_profile_of_a_driver_is_stored_as_sent(self):
        entrante = {"dniScaneado": {"name": "dni.png", "path": "usuario-ab12/dniScaneado.png"}}
        self.assertEqual(backend.conservar_documentos(None, entrante), entrante)

    def _historial_de_prueba(self):
        """Veinticinco eventos de mentira para ejercitar filtros y páginas."""
        eventos = []
        for i in range(25):
            eventos.append({
                "id": f"act_{i}",
                "action_type": "Unidad actualizada" if i % 2 else "Usuario inició sesión",
                "actor_id": "admin@kapital.com" if i % 3 else "gerente@kapital.com",
                "actor_email": "admin@kapital.com" if i % 3 else "gerente@kapital.com",
                "entity_label": f"K-{i:03d}",
                "status": "success",
                "created_at": f"2026-09-{(i % 20) + 1:02d}T10:00:00+00:00",
            })
        return eventos

    def test_the_activity_endpoint_pages_without_losing_or_repeating_events(self):
        async def ejecutar():
            with mock.patch.object(backend, "actividad_db", self._historial_de_prueba()),                     mock.patch.object(backend, "require_admin_session", new=AsyncMock(return_value={})),                     mock.patch.object(backend, "reload_actividad", new=AsyncMock()):
                vistos = []
                primera = await backend.listar_actividad(pagina=1, limite=10)
                for numero in range(1, primera["paginas"] + 1):
                    pagina = await backend.listar_actividad(pagina=numero, limite=10)
                    vistos.extend(e["id"] for e in pagina["eventos"])
                return primera, vistos

        primera, vistos = asyncio.run(ejecutar())
        self.assertEqual(primera["resumen"]["total"], 25)
        self.assertEqual(primera["paginas"], 3)
        self.assertEqual(len(vistos), 25, "ninguna página se salta eventos")
        self.assertEqual(len(set(vistos)), 25, "ni los repite entre páginas")
        # Más reciente primero.
        self.assertEqual(primera["eventos"][0]["created_at"][:10], "2026-09-20")

    def test_the_activity_filters_combine(self):
        async def ejecutar(**filtros):
            with mock.patch.object(backend, "actividad_db", self._historial_de_prueba()),                     mock.patch.object(backend, "require_admin_session", new=AsyncMock(return_value={})),                     mock.patch.object(backend, "reload_actividad", new=AsyncMock()):
                return await backend.listar_actividad(limite=100, **filtros)

        por_tipo = asyncio.run(ejecutar(tipo="Unidad actualizada"))
        self.assertTrue(all(e["action_type"] == "Unidad actualizada" for e in por_tipo["eventos"]))

        # Tipo y fecha a la vez: el filtro se acumula, no se sustituye.
        combinado = asyncio.run(ejecutar(tipo="Unidad actualizada", desde="2026-09-15"))
        self.assertTrue(combinado["eventos"], "el caso de prueba debe dejar algo")
        for evento in combinado["eventos"]:
            self.assertEqual(evento["action_type"], "Unidad actualizada")
            self.assertGreaterEqual(evento["created_at"][:10], "2026-09-15")
        self.assertLess(len(combinado["eventos"]), len(por_tipo["eventos"]))

        # La búsqueda no distingue mayúsculas.
        self.assertEqual(
            len(asyncio.run(ejecutar(q="k-007"))["eventos"]),
            len(asyncio.run(ejecutar(q="K-007"))["eventos"]),
        )

    def test_the_activity_endpoint_offers_only_the_filters_that_exist(self):
        async def ejecutar():
            with mock.patch.object(backend, "actividad_db", self._historial_de_prueba()),                     mock.patch.object(backend, "require_admin_session", new=AsyncMock(return_value={})),                     mock.patch.object(backend, "reload_actividad", new=AsyncMock()):
                return await backend.listar_actividad()

        datos = asyncio.run(ejecutar())
        self.assertEqual(datos["tipos"], ["Unidad actualizada", "Usuario inició sesión"])
        self.assertEqual(datos["responsables"], ["admin@kapital.com", "gerente@kapital.com"])

    async def _alta(self, **campos):
        with (
            patch.object(backend, "require_admin_session", new=AsyncMock(return_value={})),
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_persist_and_verify_fleet", new=AsyncMock(side_effect=lambda uid, v: v)),
        ):
            return await backend.add_flota(backend.FlotaRegistro(**campos))

    def test_the_padron_and_the_plate_are_stored_apart(self):
        """El formulario mandaba el padrón en el campo de la placa.

        Resultado: la unidad se llamaba bien pero se quedaba sin matrícula.
        """
        with mock.patch.dict(backend.conductores_db, {}, clear=True):
            respuesta = asyncio.run(self._alta(
                padron="k-500", placa="bur-628", chofer="JUAN PEREZ", tipo="AUTO", capacidad=4,
            ))
            guardada = backend.conductores_db["K-500"]

        self.assertEqual(respuesta["unidad"]["unidad_id"], "K-500", "el padrón identifica la unidad")
        self.assertEqual(guardada["placa"], "BUR-628", "y la matrícula se guarda aparte")
        self.assertEqual(guardada["chofer"], "JUAN PEREZ")

    def test_an_old_client_that_only_sends_the_plate_still_registers(self):
        """El formulario anterior mandaba solo `placa`, con el padrón dentro."""
        with mock.patch.dict(backend.conductores_db, {}, clear=True):
            asyncio.run(self._alta(placa="K-501", chofer="X", tipo="AUTO", capacidad=4))
            self.assertIn("K-501", backend.conductores_db)

    def test_a_duplicated_padron_or_plate_is_refused_by_name(self):
        existente = {"K-500": {"chofer": "Otro", "placa": "BUR-628"}}
        with mock.patch.dict(backend.conductores_db, existente, clear=True):
            with self.assertRaises(HTTPException) as padron:
                asyncio.run(self._alta(padron="K-500", placa="XYZ-111", chofer="X", tipo="AUTO", capacidad=4))
            with self.assertRaises(HTTPException) as placa:
                asyncio.run(self._alta(padron="K-999", placa="bur-628", chofer="X", tipo="AUTO", capacidad=4))

        self.assertEqual(padron.exception.status_code, 409)
        self.assertIn("K-500", padron.exception.detail)
        self.assertEqual(placa.exception.status_code, 409)
        self.assertIn("BUR-628", placa.exception.detail)
        self.assertIn("K-500", placa.exception.detail, "dice en qué unidad está esa placa")

    def test_registering_a_unit_creates_the_driver_account(self):
        """Una unidad sin cuenta deja a su conductor sin poder entrar."""
        with mock.patch.dict(backend.conductores_db, {}, clear=True),                 mock.patch.dict(backend.usuarios_db, {}, clear=True):
            asyncio.run(self._alta(
                padron="K-600", placa="AAA-222", chofer="JUAN PEREZ", tipo="AUTO",
                capacidad=4, telefono="987654321", dni="45757485", password="kapital1",
            ))
            cuenta = backend.usuarios_db["45757485"]

        self.assertEqual(cuenta["rol"], "Conductor")
        self.assertEqual(cuenta["estado"], "Activo")
        self.assertEqual(cuenta["unidad_id"], "K-600", "queda ligada a su unidad")
        self.assertEqual(cuenta["nombre"], "JUAN PEREZ")
        # La contraseña la pone Administración, así que es provisional.
        self.assertTrue(cuenta["needs_password_change"])

    def test_a_duplicated_document_never_overwrites_an_existing_account(self):
        existente = {"45757485": {"rol": "Conductor", "nombre": "OTRO", "dni": "45757485"}}
        with mock.patch.dict(backend.conductores_db, {}, clear=True),                 mock.patch.dict(backend.usuarios_db, existente, clear=True):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(self._alta(
                    padron="K-601", placa="BBB-333", chofer="JUAN", tipo="AUTO",
                    capacidad=4, dni="45757485", password="kapital1",
                ))
            self.assertEqual(backend.usuarios_db["45757485"]["nombre"], "OTRO", "intacta")
            self.assertNotIn("K-601", backend.conductores_db, "ni se crea la unidad")
        self.assertEqual(error.exception.status_code, 409)

    def test_a_unit_without_an_account_still_registers(self):
        """Las 108 del Excel se dieron de alta sin cuenta: sigue siendo válido."""
        with mock.patch.dict(backend.conductores_db, {}, clear=True),                 mock.patch.dict(backend.usuarios_db, {}, clear=True):
            asyncio.run(self._alta(padron="K-602", placa="CCC-444", chofer="X", tipo="AUTO", capacidad=4))
            self.assertIn("K-602", backend.conductores_db)
            self.assertEqual(backend.usuarios_db, {})

    def test_an_account_without_a_usable_password_is_refused(self):
        for dni, password in [("45757485", ""), ("45757485", "abc"), ("", "kapital1")]:
            with self.subTest(dni=dni, password=password):
                with mock.patch.dict(backend.conductores_db, {}, clear=True),                         mock.patch.dict(backend.usuarios_db, {}, clear=True):
                    with self.assertRaises(HTTPException) as error:
                        asyncio.run(self._alta(
                            padron="K-603", placa="DDD-555", chofer="X", tipo="AUTO",
                            capacidad=4, dni=dni, password=password,
                        ))
                    self.assertEqual(error.exception.status_code, 400)
                    self.assertNotIn("K-603", backend.conductores_db)

    def test_registering_a_unit_no_longer_asks_for_the_atu(self):
        with mock.patch.dict(backend.conductores_db, {}, clear=True):
            asyncio.run(self._alta(padron="K-502", placa="AAA-111", chofer="X", tipo="AUTO", capacidad=4))
            guardada = backend.conductores_db["K-502"]
        self.assertNotIn("atu", guardada)
        self.assertIn("soat", guardada)

    def test_the_login_index_maps_every_way_a_person_can_identify(self):
        """Los 108 importados entran con su DNI, pero su clave es otro correo."""
        usuarios = {
            "de.los@kapital.com": {
                "rol": "Conductor", "email": "richard@gmail.com",
                "perfil_conductor": {"numDoc": "09876543"},
            },
            "77777777": {"rol": "Conductor", "identifier": "77777777", "dni": "77777777"},
            "__flota__": {"K-001": {}},
        }
        with mock.patch.dict(backend.usuarios_db, usuarios, clear=True):
            indice = backend.construir_indice_login()

        # Cualquiera de sus identificadores lleva a la misma clave.
        for alias in ("de.los@kapital.com", "richard@gmail.com", "09876543"):
            self.assertEqual(indice[alias], "de.los@kapital.com", alias)
        self.assertEqual(indice["77777777"], "77777777")
        # Las pseudo-claves no son cuentas.
        self.assertNotIn("__flota__", indice)

    def test_the_login_index_is_case_insensitive_like_the_full_lookup(self):
        usuarios = {"Admin@Kapital.com": {"rol": "Administrador", "email": "Admin@Kapital.com"}}
        with mock.patch.dict(backend.usuarios_db, usuarios, clear=True):
            indice = backend.construir_indice_login()
        self.assertEqual(indice["admin@kapital.com"], "Admin@Kapital.com")

    def test_the_login_index_never_holds_credentials_or_permissions(self):
        """Solo dice dónde mirar. La contraseña se lee del usuario real."""
        usuarios = {"77777777": {
            "rol": "Administrador", "estado": "Activo", "password": "kap9810", "dni": "77777777",
        }}
        with mock.patch.dict(backend.usuarios_db, usuarios, clear=True):
            indice = backend.construir_indice_login()
        serializado = json.dumps(indice)
        self.assertNotIn("kap9810", serializado)
        self.assertNotIn("Administrador", serializado)
        self.assertNotIn("Activo", serializado)

    def test_a_missing_or_broken_index_still_lets_everyone_in(self):
        """El atajo es un atajo: si no resuelve, se sigue por el camino largo."""
        async def ejecutar(valor_del_indice):
            with mock.patch.dict(backend.login_index, {}, clear=True),                     mock.patch.object(backend, "_fetch_proyeccion_sin_respaldo",
                                      new=AsyncMock(return_value=valor_del_indice)):
                return await backend._usuario_por_indice("77777777")

        # Índice ausente, vacío, de otro tipo, o sin ese identificador.
        for valor in (backend._MISSING, {}, [], "no-soy-un-indice", {"otro": "K-1"}):
            self.assertIsNone(asyncio.run(ejecutar(valor)), repr(valor))

    def test_the_shortcut_never_breaks_a_login_when_the_provider_misbehaves(self):
        async def ejecutar():
            with mock.patch.object(backend, "_fetch_proyeccion_sin_respaldo",
                                   new=AsyncMock(return_value={"77777777": "77777777"})),                     mock.patch.object(backend, "_fetch_usuario_por_clave",
                                      new=AsyncMock(side_effect=RuntimeError("boom"))):
                return await backend._usuario_por_indice("77777777")

        self.assertIsNone(asyncio.run(ejecutar()), "un fallo del atajo devuelve None, no revienta")

    def test_the_activity_log_never_grows_past_its_cap(self):
        """Todo el estado vive en una fila: un historial sin tope la hincharía."""
        with mock.patch.object(backend, "actividad_db", []):
            for i in range(backend.MAX_ACTIVIDAD + 25):
                backend.registrar_actividad("Unidad actualizada", entity_id=f"K-{i:03d}")
            self.assertEqual(len(backend.actividad_db), backend.MAX_ACTIVIDAD)
            # Se descartan los más viejos, no los recientes.
            self.assertEqual(backend.actividad_db[-1]["entity_id"], f"K-{backend.MAX_ACTIVIDAD + 24:03d}")

    def test_recording_an_activity_never_breaks_the_action(self):
        """Apuntar lo que pasó no puede impedir que pase."""
        with mock.patch.object(backend, "actividad_db", []),                 mock.patch.object(backend, "_actor_visible", side_effect=RuntimeError("boom")):
            backend.registrar_actividad("Unidad actualizada")  # no debe lanzar
            self.assertEqual(backend.actividad_db, [])

    def test_a_change_row_only_appears_when_the_value_really_changed(self):
        self.assertIsNone(backend.cambio("Capacidad", 4, 4))
        self.assertIsNone(backend.cambio("Capacidad", "4", 4), "mismo valor con otro tipo")
        self.assertEqual(
            backend.cambio("Capacidad", 15, 4),
            {"campo": "Capacidad", "anterior": "15", "nuevo": "4"},
        )

    def test_the_activity_log_never_stores_credentials(self):
        """El historial se enseña entero en pantalla: no es sitio para secretos."""
        usuario = {"nombre": "Admin", "email": "admin@kapital.com", "password": "kap9810",
                   "identifier": "admin@kapital.com"}
        with mock.patch.object(backend, "actividad_db", []):
            backend.registrar_actividad("Usuario inició sesión", actor=usuario)
            evento = backend.actividad_db[0]
        self.assertNotIn("password", json.dumps(evento))
        self.assertNotIn("kap9810", json.dumps(evento))
        self.assertEqual(evento["actor_email"], "admin@kapital.com")

    def test_the_date_filter_includes_both_ends(self):
        evento = {"created_at": "2026-09-17T12:00:00+00:00"}
        self.assertTrue(backend._dentro_del_rango(evento, "2026-09-17", "2026-09-17"))
        self.assertTrue(backend._dentro_del_rango(evento, "", ""))
        self.assertFalse(backend._dentro_del_rango(evento, "2026-09-18", ""))
        self.assertFalse(backend._dentro_del_rango(evento, "", "2026-09-16"))

    def test_the_search_looks_at_every_field_the_table_shows(self):
        evento = {
            "action_type": "Unidad actualizada", "actor_name": "Admin",
            "actor_email": "admin@kapital.com", "entity_label": "KAP-TESTV3",
            "description": "Capacidad corregida",
        }
        for buscado in ("unidad", "kap-testv3", "ADMIN@KAPITAL.COM".lower(), "capacidad"):
            self.assertTrue(backend._coincide_texto(evento, buscado), buscado)
        self.assertFalse(backend._coincide_texto(evento, "documento"))

    def test_a_real_email_is_stored_beside_the_account_key(self):
        """Los 108 conductores del Excel tienen por clave un correo inventado.

        Cambiar esa clave sería migrar la cuenta entera. El correo real se
        guarda al lado, en `email` y en el perfil, que es lo que se muestra y
        lo que `get_user_by_identifier` reconoce para entrar.
        """
        conductor = {"rol": "Conductor", "email": "de.los@kapital.com", "perfil_conductor": {}}
        usuarios = {"de.los@kapital.com": conductor}
        with mock.patch.dict(backend.usuarios_db, usuarios, clear=True):
            cambio = backend.asignar_correo(conductor, "  Richard.DeLosSantos@Gmail.com ")
            claves = list(backend.usuarios_db)

        self.assertTrue(cambio)
        self.assertEqual(conductor["email"], "richard.delossantos@gmail.com")
        self.assertEqual(conductor["perfil_conductor"]["correo"], "richard.delossantos@gmail.com")
        # La instantánea de la sesión la refrescan los endpoints que llaman a
        # esta función, porque refrescarla es escribir en la tabla de sesiones.
        # Y la clave de la cuenta sigue siendo la de siempre.
        self.assertEqual(claves, ["de.los@kapital.com"])

    def test_an_email_that_belongs_to_another_account_is_refused(self):
        conductor = {"rol": "Conductor", "email": "de.los@kapital.com"}
        usuarios = {
            "de.los@kapital.com": conductor,
            "otro@kapital.com": {"rol": "Conductor", "email": "ya.tomado@gmail.com"},
        }
        with mock.patch.dict(backend.usuarios_db, usuarios, clear=True):
            with self.assertRaises(HTTPException) as error:
                backend.asignar_correo(conductor, "ya.tomado@gmail.com")
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(conductor["email"], "de.los@kapital.com", "no debe quedar a medias")

    def test_an_unusable_email_is_refused_before_touching_the_account(self):
        for entrada in ("", "   ", None, "no-es-un-correo", "falta@dominio", "a b@c.com"):
            with self.subTest(entrada=entrada):
                conductor = {"rol": "Conductor", "email": "previo@kapital.com"}
                with mock.patch.dict(backend.usuarios_db, {"k": conductor}, clear=True):
                    with self.assertRaises(HTTPException) as error:
                        backend.asignar_correo(conductor, entrada)
                self.assertEqual(error.exception.status_code, 400)
                self.assertEqual(conductor["email"], "previo@kapital.com")

    def test_an_approved_driver_seeds_their_unit_with_what_they_declared(self):
        """La flota leía `chofer` y la aprobación escribía `nombre`.

        El resultado era una unidad sin nombre de chofer, con 15 plazas que
        nadie declaró y con el tipo en blanco.
        """
        conductor = {
            "nombre": "ANYELO BILL",
            "rol": "Conductor",
            "unidad_id": "KAP-TESTV3",
            "perfil_conductor": {
                "nombres": "ANYELO BILL",
                "telefonoDirecto": " 906916715 ",
                "vehiculoCapacidad": "12",
            },
        }
        with mock.patch.dict(backend.conductores_db, {}, clear=True):
            backend._sembrar_unidad("KAP-TESTV3", conductor)
            unidad = backend.conductores_db["KAP-TESTV3"]

        self.assertEqual(unidad["chofer"], "ANYELO BILL")
        self.assertEqual(unidad["telefono"], "906916715")
        self.assertEqual(unidad["capacidad"], 12)
        # Nadie pregunta estos datos en el alta: inventarlos marcaba como
        # vigente un SOAT que nadie había revisado.
        for campo in backend._FLEET_EXPIRY_FIELDS:
            self.assertNotIn(campo, unidad)
        self.assertNotIn("tipo", unidad)

    def test_seeding_a_unit_never_overwrites_what_administration_set(self):
        conductor = {
            "nombre": "ANYELO BILL",
            "perfil_conductor": {
                "nombres": "ANYELO BILL", "vehiculoCapacidad": 12, "telefonoDirecto": "955555555",
            },
        }
        existente = {"KAP-009": {
            "chofer": "NOMBRE CORREGIDO A MANO", "capacidad": 20, "tipo": "Sprinter",
            "telefono": "900000000",
        }}
        with mock.patch.dict(backend.conductores_db, existente, clear=True):
            backend._sembrar_unidad("KAP-009", conductor)
            unidad = backend.conductores_db["KAP-009"]

        self.assertEqual(unidad["chofer"], "NOMBRE CORREGIDO A MANO")
        self.assertEqual(unidad["capacidad"], 20)
        self.assertEqual(unidad["tipo"], "Sprinter")
        # El teléfono sí: es el de quien maneja la unidad, y el del conductor
        # anterior se quedaba en la ficha y en el Excel.
        self.assertEqual(unidad["telefono"], "955555555")

    def test_seeding_a_unit_ignores_a_capacity_that_is_not_usable(self):
        for declarada in ("", None, "cero", 0, -3):
            with self.subTest(declarada=declarada):
                conductor = {"nombre": "X", "perfil_conductor": {"vehiculoCapacidad": declarada}}
                with mock.patch.dict(backend.conductores_db, {}, clear=True):
                    backend._sembrar_unidad("KAP-010", conductor)
                    self.assertNotIn("capacidad", backend.conductores_db["KAP-010"])

    def test_two_drivers_without_a_unit_do_not_share_a_folder(self):
        """El destino sale de la sesión, no de lo que mande el navegador.

        Un conductor en alta todavía no tiene unidad y enviaba `unidad_id`
        vacío, que caía en la carpeta común `sin-unidad`: el DNI del segundo
        conductor sobrescribía el del primero.
        """
        uno = {"rol": "Conductor", "unidad_id": "", "dni": "13245678"}
        otro = {"rol": "Conductor", "unidad_id": "", "dni": "87654321"}

        carpeta_uno = backend._carpeta_destino(uno, "")
        carpeta_otro = backend._carpeta_destino(otro, "")

        self.assertNotEqual(carpeta_uno, carpeta_otro)
        self.assertNotIn("sin-unidad", (carpeta_uno, carpeta_otro))
        # La ruta viaja al navegador: no debe llevar el documento en claro.
        self.assertNotIn("13245678", carpeta_uno)
        # Y cada uno ve lo suyo y solo lo suyo.
        self.assertTrue(backend._puede_ver_unidad(uno, carpeta_uno))
        self.assertFalse(backend._puede_ver_unidad(otro, carpeta_uno))

    def test_a_driver_keeps_their_documents_after_getting_a_unit(self):
        """Sube en el alta, recibe la unidad después: debe seguir viéndolos."""
        alta = {"rol": "Conductor", "unidad_id": "", "dni": "13245678"}
        carpeta_alta = backend._carpeta_destino(alta, "")

        asignado = {"rol": "Conductor", "unidad_id": "K-500", "dni": "13245678"}
        self.assertEqual(backend._carpeta_destino(asignado, ""), "K-500")
        self.assertTrue(backend._puede_ver_unidad(asignado, carpeta_alta))

    def test_a_driver_cannot_choose_where_their_document_lands(self):
        """Mandar la unidad de otro no debe escribir en la carpeta de otro."""
        conductor = {"rol": "Conductor", "unidad_id": "K-027", "dni": "13245678"}
        self.assertEqual(backend._carpeta_destino(conductor, "K-142"), "K-027")

    def test_administration_uploads_on_behalf_of_a_unit(self):
        admin = {"rol": "Administración"}
        self.assertEqual(backend._carpeta_destino(admin, "K-142"), "K-142")
        # Sin unidad no hay dónde guardarlo: mejor fallar que inventar carpeta.
        with self.assertRaises(HTTPException) as error:
            backend._carpeta_destino(admin, "")
        self.assertEqual(error.exception.status_code, 400)


    # --- Endpoints que no pedían sesión --------------------------------------------

    async def _llamar(self, metodo, ruta, token=None, **kwargs):
        cookies = {backend.SESSION_COOKIE_NAME: token} if token else None
        transport = httpx.ASGITransport(app=backend.app)
        async with _CLIENTE_HTTP_REAL(transport=transport, base_url="http://test", cookies=cookies) as client:
            return await client.request(metodo, ruta, **kwargs)

    async def _sesion(self, clave, **campos):
        usuario = {"identifier": clave, "email": clave, "nombre": clave, "estado": "Activo", **campos}
        backend.usuarios_db[clave] = usuario
        return usuario, await backend.abrir_sesion(usuario)

    async def test_endpoints_that_never_asked_for_a_session_now_do(self):
        """Con la exigencia activa, ninguno responde a quien no ha entrado.

        Estos once se quedaron fuera cuando se activó la sesión, y no eran
        todos de lectura: tres escribían y uno subía fotos a un bucket público.
        """
        backend.AUTH_ENFORCED = True
        abiertos = [
            ("GET", "/api/notifications", {}),
            ("POST", "/api/conductor/notifications/mark-read", {"json": {"notif_id": 1}}),
            ("POST", "/api/conductor/resubmit-docs", {"json": {"email": "x@k.com", "docs": {}}}),
            ("POST", "/api/conductor/request-update",
             {"json": {"email": "x@k.com", "field": "telefono", "new_value": "1"}}),
            ("POST", "/api/driver/onboarding", {"json": {"email": "x@k.com", "perfilData": {}}}),
            ("POST", "/api/programador/plan/borrar", {"json": {"fecha": "2026-09-29"}}),
            ("POST", "/api/programador/plan/proponer", {"json": {"fecha": "2026-09-29"}}),
            ("POST", "/api/programador/plan/aplicar-propuesta",
             {"json": {"fecha": "2026-09-29", "cambios": [{"accion": "ordenar"}]}}),
            ("POST", "/api/admin/driver/documento/eliminar",
             {"json": {"conductor": "x@k.com", "campo": "dniScaneado"}}),
            ("POST", "/api/admin/driver/foto",
             {"json": {"unidad": "K-001", "tipo": "avatar", "nombre": "a.jpg",
                       "tipo_archivo": "image/jpeg", "base64": "AA=="}}),
            ("GET", "/api/flota/export", {}),
            ("GET", "/api/routes", {}),
            ("GET", "/api/routes/summary", {}),
            ("GET", "/api/reportes", {}),
            ("GET", "/api/conductor/info/K-001", {}),
            ("GET", "/api/conductor/servicios?unidad=K-001", {}),
            ("POST", "/api/conductor/servicios/marcar", {"json": {"id": 1, "estado": "a_bordo"}}),
            ("GET", "/api/cliente/servicios?empresa=TELEPERFORMANCE", {}),
        ]
        with (
            patch.object(backend, "reload_db", new=AsyncMock()) as recarga,
            patch.object(backend, "persist", new=AsyncMock()) as guardar,
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar_usuarios,
            patch.object(backend, "_rpc_programador", new=AsyncMock()) as base,
        ):
            for metodo, ruta, extra in abiertos:
                respuesta = await self._llamar(metodo, ruta, **extra)
                self.assertEqual(respuesta.status_code, 401, f"{metodo} {ruta}")
        recarga.assert_not_awaited()
        guardar.assert_not_awaited()
        guardar_usuarios.assert_not_awaited()
        base.assert_not_awaited()

    async def test_the_admin_notifications_are_for_administration_only(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("chofer@k.com", rol="Conductor")
        respuesta = await self._llamar("GET", "/api/notifications", token)
        self.assertEqual(respuesta.status_code, 403)

    async def test_a_driver_cannot_touch_another_drivers_documents(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("chofer@k.com", rol="Conductor")
        await self._sesion("otro@k.com", rol="Conductor",
                           perfil_conductor={"revision_docs": {}})
        with patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar:
            respuesta = await self._llamar(
                "POST", "/api/conductor/resubmit-docs", token,
                json={"email": "otro@k.com", "docs": {"dniScaneado": "mio.pdf"}})
        self.assertEqual(respuesta.status_code, 403)
        guardar.assert_not_awaited()

    async def test_a_driver_cannot_approve_their_own_review_through_resubmit(self):
        """`revision_docs` no es un documento: mandarlo como tal era aprobarse solo."""
        backend.AUTH_ENFORCED = True
        chofer, token = await self._sesion(
            "chofer@k.com", rol="Conductor",
            perfil_conductor={"revision_docs": {"dniScaneado": {"estado": "rechazado"}}})
        with patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar:
            respuesta = await self._llamar(
                "POST", "/api/conductor/resubmit-docs", token,
                json={"email": "chofer@k.com",
                      "docs": {"revision_docs": {"dniScaneado": {"estado": "aprobado"}}}})
        self.assertEqual(respuesta.status_code, 400)
        guardar.assert_not_awaited()
        self.assertEqual(chofer["perfil_conductor"]["revision_docs"]["dniScaneado"]["estado"], "rechazado")

    async def test_only_administration_uploads_the_camo(self):
        """El certificado médico lo pone Administración: al conductor no se le pide."""
        backend.AUTH_ENFORCED = True
        chofer, token_chofer = await self._sesion(
            "chofer@k.com", rol="Conductor", perfil_conductor={"revision_docs": {}})
        _, token_admin = await self._sesion("admin@k.com", rol="Administración")
        camo = {"name": "camo.pdf", "path": "K-027/camo-1.pdf"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            # Tampoco por hojas: la segunda y la de las dos juntas.
            for campo in ("camo", "camoReverso", "camoCompleto"):
                propio = await self._llamar(
                    "POST", "/api/conductor/resubmit-docs", token_chofer,
                    json={"email": "chofer@k.com", "docs": {campo: camo}, "uploaded_by": "admin"})
                self.assertEqual(propio.status_code, 403, f"declararse admin no basta ({campo})")
            guardar.assert_not_awaited()
            self.assertNotIn("camo", chofer["perfil_conductor"])

            de_admin = await self._llamar(
                "POST", "/api/conductor/resubmit-docs", token_admin,
                json={"email": "chofer@k.com", "docs": {"camo": camo, "camoReverso": camo},
                      "uploaded_by": "admin"})
        self.assertEqual(de_admin.status_code, 200, de_admin.text)
        self.assertEqual(chofer["perfil_conductor"]["camo"], camo)
        self.assertEqual(chofer["perfil_conductor"]["camoReverso"], camo)
        self.assertEqual(backend.notifications_db, [], "no hay nada que revisar")

    async def test_a_driver_only_requests_the_fields_the_profile_offers(self):
        """El campo lo elegía el conductor: podía pedir sus revisiones, el CAMO o su estado."""
        backend.AUTH_ENFORCED = True
        chofer, token = await self._sesion("chofer@k.com", rol="Conductor", perfil_conductor={})
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
            patch.object(backend.ws_manager, "broadcast_to_role", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            pedir = lambda campo, valor="x": self._llamar(  # noqa: E731
                "POST", "/api/conductor/request-update", token,
                json={"email": "chofer@k.com", "field": campo, "new_value": valor})
            for campo in ("revision_docs", "camo", "estado", "numDoc", "unidad_id", "solicitudes_cambio"):
                self.assertEqual((await pedir(campo)).status_code, 400, campo)
            self.assertEqual((await pedir("direccion", "x" * 1000)).status_code, 400, "sin límite de largo")
            guardar.assert_not_awaited()
            for campo in ("telefonoDirecto", "placa2"):
                self.assertEqual((await pedir(campo, "ABC-123")).status_code, 200, campo)
        self.assertEqual(set(chofer["perfil_conductor"]["solicitudes_cambio"]), {"telefonoDirecto", "placa2"})

    async def test_the_onboarding_never_writes_what_administration_decides(self):
        """El alta reescribe el perfil entero con lo que manda el conductor.

        Así podía ponerse un CAMO —o aprobarse sus propios documentos con
        `revision_docs`— y, al reenviarla, borraba el CAMO que había subido
        Administración.
        """
        backend.AUTH_ENFORCED = True
        camo = {"name": "camo.pdf", "path": "K-027/camo-1.pdf"}
        chofer, token = await self._sesion(
            "chofer@k.com", rol="Conductor",
            perfil_conductor={"numDoc": "22222222", "camo": camo,
                              "revision_docs": {"dniScaneado": {"estado": "rechazado"}}})
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar(
                "POST", "/api/driver/onboarding", token,
                json={"email": "chofer@k.com", "perfilData": {
                    "numDoc": "22222222", "nombres": "Chofer",
                    "camo": {"name": "otro.pdf", "path": "K-027/otro.pdf"},
                    "revision_docs": {"dniScaneado": {"estado": "aprobado"}},
                }})
        self.assertEqual(respuesta.status_code, 200)
        perfil = chofer["perfil_conductor"]
        self.assertEqual(perfil["camo"], camo)
        self.assertNotIn("revision_docs", perfil)
        self.assertEqual(perfil["nombres"], "Chofer")

    async def test_the_camo_is_not_reviewed(self):
        """Lo sube Administración: rechazarlo le pediría al conductor algo que no puede subir."""
        backend.AUTH_ENFORCED = True
        chofer, _ = await self._sesion(
            "chofer@k.com", rol="Conductor", perfil_conductor={"camo": {"path": "K-027/camo-1.pdf"}})
        _, token = await self._sesion("admin@k.com", rol="Administración")
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            respuesta = await self._llamar(
                "POST", "/api/admin/driver/review", token,
                json={"admin_email": "admin@k.com", "conductor_email": "chofer@k.com",
                      "campo": "camo", "estado": "rechazado"})
        self.assertEqual(respuesta.status_code, 400)
        guardar.assert_not_awaited()
        self.assertNotIn("revision_docs", chofer["perfil_conductor"])

    async def test_a_driver_submits_only_their_own_onboarding(self):
        """No pedía sesión: cualquiera cambiaba el perfil y el estado de otro conductor."""
        backend.AUTH_ENFORCED = True
        chofer, token = await self._sesion("chofer@k.com", rol="Conductor")
        otro, _ = await self._sesion("otro@k.com", rol="Conductor", perfil_conductor={"numDoc": "11111111"})
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            ajeno = await self._llamar(
                "POST", "/api/driver/onboarding", token,
                json={"email": "otro@k.com", "perfilData": {"numDoc": "999", "nombres": "X"}})
            propio = await self._llamar(
                "POST", "/api/driver/onboarding", token,
                json={"email": "chofer@k.com", "perfilData": {"numDoc": "22222222", "nombres": "Chofer"}})
        self.assertEqual(ajeno.status_code, 403)
        self.assertEqual(otro["estado"], "Activo")
        self.assertEqual(otro["perfil_conductor"], {"numDoc": "11111111"})
        self.assertEqual(propio.status_code, 200)
        self.assertEqual(chofer["estado"], "Pendiente Revisión")
        guardar.assert_awaited_once()

    async def test_onboarding_rejects_a_document_that_is_another_accounts(self):
        """Declararse el DNI de otro le quitaba a esa persona la entrada con su DNI."""
        backend.AUTH_ENFORCED = True
        await self._sesion("otro@k.com", rol="Conductor", perfil_conductor={"numDoc": "1234567"})
        chofer, token = await self._sesion("chofer@k.com", rol="Conductor")
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            for documento in ("1234567", "01234567"):
                respuesta = await self._llamar(
                    "POST", "/api/driver/onboarding", token,
                    json={"email": "chofer@k.com", "perfilData": {"numDoc": documento}})
                self.assertEqual(respuesta.status_code, 409, documento)
        guardar.assert_not_awaited()
        self.assertNotIn("perfil_conductor", chofer)

    async def test_resubmitting_the_same_document_is_not_a_duplicate(self):
        """Si ya había otra cuenta con la otra forma del DNI, el dueño no podía reenviar el suyo."""
        backend.AUTH_ENFORCED = True
        await self._sesion("duplicada@k.com", rol="Conductor", estado="Pendiente", dni="01234567")
        chofer, token = await self._sesion(
            "chofer@k.com", rol="Conductor", perfil_conductor={"numDoc": "1234567"})
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar(
                "POST", "/api/driver/onboarding", token,
                json={"email": "chofer@k.com", "perfilData": {"numDoc": " 1234567 ", "nombres": "Chofer"}})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(chofer["estado"], "Pendiente Revisión")

    async def test_the_email_change_asks_for_a_session_before_reading_anything(self):
        """Sin sesión respondía 401 o 404 según existiera la cuenta, y leía a todos."""
        backend.AUTH_ENFORCED = True
        with patch.object(backend, "_load_compat_users", new=AsyncMock()) as leer:
            existe = await self._llamar(
                "PUT", "/api/conductor/correo", json={"identificador": "x@k.com", "correo": "a@b.com"})
        self.assertEqual(existe.status_code, 401)
        leer.assert_not_awaited()

    async def test_a_bulk_delete_closes_the_sessions_too(self):
        backend.AUTH_ENFORCED = True
        _, token_admin = await self._sesion("admin@k.com", rol="Administración")
        _, token_otro = await self._sesion("otro@k.com", rol="Conductor")
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar(
                "POST", "/api/admin/users/bulk", token_admin,
                json={"admin_email": "admin@k.com", "target_emails": ["otro@k.com"], "action": "delete"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertIsNone(await backend.sesion_de(token_otro))

    async def test_ownership_is_checked_on_the_account_that_is_changed(self):
        """Comprobar la propiedad con lo tecleado no basta.

        Si dos cuentas comparten documento, el texto es «de» quien pregunta pero
        la búsqueda devuelve la primera, y se cambiaba esa otra cuenta.
        """
        backend.AUTH_ENFORCED = True
        victima, _ = await self._sesion(
            "victima@k.com", rol="Conductor",
            perfil_conductor={"numDoc": "12345678", "dniScaneado": "real.pdf", "revision_docs": {}})
        _, token = await self._sesion(
            "chofer@k.com", rol="Conductor",
            perfil_conductor={"numDoc": "12345678", "revision_docs": {}})
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            for metodo, ruta, cuerpo in (
                ("POST", "/api/conductor/resubmit-docs",
                 {"email": "12345678", "docs": {"dniScaneado": "falso.pdf"}}),
                ("POST", "/api/conductor/request-update",
                 {"email": "12345678", "field": "telefonoDirecto", "new_value": "1"}),
                ("PUT", "/api/conductor/correo",
                 {"identificador": "12345678", "correo": "atacante@evil.com"}),
                ("POST", "/api/driver/onboarding",
                 {"email": "12345678", "perfilData": {"nombres": "X"}}),
            ):
                respuesta = await self._llamar(metodo, ruta, token, json=cuerpo)
                self.assertEqual(respuesta.status_code, 403, ruta)
        guardar.assert_not_awaited()
        self.assertEqual(victima["perfil_conductor"]["dniScaneado"], "real.pdf")
        self.assertNotIn("solicitudes_cambio", victima["perfil_conductor"])
        self.assertEqual(victima["email"], "victima@k.com")
        self.assertEqual(victima["estado"], "Activo")

    async def test_administration_still_edits_any_drivers_email(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("admin@k.com", rol="Administración")
        chofer, _ = await self._sesion("chofer@k.com", rol="Conductor")
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar(
                "PUT", "/api/conductor/correo", token,
                json={"identificador": "chofer@k.com", "correo": "real@gmail.com"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(chofer["email"], "real@gmail.com")

    async def test_deleting_an_account_closes_its_sessions(self):
        """Borrada la cuenta, su sesión seguía abierta hasta caducar: doce horas."""
        backend.AUTH_ENFORCED = True
        _, token_admin = await self._sesion("admin@k.com", rol="Administración")
        _, token_otro = await self._sesion("otro@k.com", rol="Conductor", estado="Inactivo")
        _, token_pendiente = await self._sesion("nuevo@k.com", rol="Conductor", estado="Pendiente")
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            borrado = await self._llamar(
                "DELETE", "/api/admin/users/permanent/otro@k.com?admin_email=admin@k.com", token_admin)
            rechazado = await self._llamar(
                "DELETE", "/api/admin/users/reject/nuevo@k.com?admin_email=admin@k.com", token_admin)
        self.assertEqual(borrado.status_code, 200)
        self.assertEqual(rechazado.status_code, 200)
        self.assertIsNone(await backend.sesion_de(token_otro))
        self.assertIsNone(await backend.sesion_de(token_pendiente))
        self.assertIsNotNone(await backend.sesion_de(token_admin))

    async def test_document_fields_accept_both_faces(self):
        self.assertTrue(backend._es_campo_documento("dniScaneado"))
        self.assertTrue(backend._es_campo_documento("dniScaneadoReverso"))
        self.assertTrue(backend._es_campo_documento("licenciaConducirCompleto"))
        for ajeno in ("revision_docs", "estado", "solicitudes_cambio", "Reverso", ""):
            self.assertFalse(backend._es_campo_documento(ajeno), ajeno)

    def test_the_backend_document_list_matches_the_frontend_one(self):
        """Si se añade un documento en la interfaz y no aquí, no se podría resubir."""
        fuente = (Path(__file__).resolve().parents[1] / "src" / "constants" / "documentosConductor.js")
        texto = fuente.read_text(encoding="utf-8")
        bloque = texto.split("export const DOCUMENTOS_CONDUCTOR = [", 1)[1].split("];", 1)[0]
        import re
        claves = set(re.findall(r"key:\s*'([^']+)'", bloque))
        self.assertTrue(claves)
        self.assertEqual(claves, set(backend._CAMPOS_DOCUMENTO))
        # Y los que solo sube Administración: si la pantalla se lo ofreciera al
        # conductor, el servidor se lo rechazaría.
        de_administracion = {
            re.search(r"key:\s*'([^']+)'", entrada).group(1)
            for entrada in re.findall(r"\{[^{}]*\}", bloque)
            if re.search(r"soloAdministracion:\s*true", entrada)
        }
        self.assertEqual(de_administracion, set(backend._DOCUMENTOS_DE_ADMINISTRACION))

    async def test_a_driver_marks_only_their_own_notifications(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("chofer@k.com", rol="Conductor")
        backend.notifications_db.extend([
            {"id": 10, "para": "chofer@k.com", "leido": False},
            {"id": 11, "para": "otro@k.com", "leido": False},
        ])
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            ajeno = await self._llamar("POST", "/api/conductor/notifications/mark-read", token,
                                       json={"notif_id": 11})
            propio = await self._llamar("POST", "/api/conductor/notifications/mark-read", token,
                                        json={"notif_id": 10})
        self.assertEqual(ajeno.status_code, 404, "igual que si no existiera")
        self.assertEqual(propio.status_code, 200)
        self.assertEqual([n["leido"] for n in backend.notifications_db], [True, False])

    async def test_the_driver_card_is_for_administration_and_its_own_driver(self):
        """El cliente veía la ficha entera: documento, nacimiento, domicilio y teléfonos.

        Ahora recibe con sus servicios quién conduce y en qué vehículo.
        """
        backend.AUTH_ENFORCED = True
        backend.conductores_db["K-001"] = {"capacidad": 4}
        _, propio = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        _, ajeno = await self._sesion("otro@k.com", rol="Conductor", unidad_id="K-002")
        _, cliente = await self._sesion("cliente@k.com", rol="Cliente")
        _, admin = await self._sesion("admin@k.com", rol="Administración")
        with patch.object(backend, "reload_db", new=AsyncMock()):
            self.assertEqual((await self._llamar("GET", "/api/conductor/info/K-001", propio)).status_code, 200)
            self.assertEqual((await self._llamar("GET", "/api/conductor/info/K-001", admin)).status_code, 200)
            self.assertEqual((await self._llamar("GET", "/api/conductor/info/K-001", ajeno)).status_code, 403)
            self.assertEqual((await self._llamar("GET", "/api/conductor/info/K-001", cliente)).status_code, 403)

    async def test_a_driver_reads_the_services_of_their_own_unit_from_yesterday_to_tomorrow(self):
        """Ayer sin pestaña: una salida de las 23:00 sigue dejando gente pasada la medianoche."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        servicios = [{"fecha": "2026-09-28", "turno": "00:30", "pasajeros": []}]
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 27)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={
                "servicios": servicios, "dias_con_plan": ["2026-09-28"]})) as base,
        ):
            respuesta = await self._llamar("GET", "/api/conductor/servicios", token)
        self.assertEqual(respuesta.status_code, 200)
        base.assert_awaited_once_with("servicios_de_unidad", {
            "p_clave": "K001", "p_desde": "2026-09-26", "p_hasta": "2026-09-28"})
        cuerpo = respuesta.json()
        self.assertEqual(cuerpo["hoy"], "2026-09-27")
        self.assertEqual(cuerpo["dias"], ["2026-09-27", "2026-09-28"])
        self.assertEqual(cuerpo["servicios"], servicios)
        self.assertEqual(cuerpo["dias_con_plan"], ["2026-09-28"])

    async def test_a_driver_cannot_read_another_unit_and_needs_one_assigned(self):
        backend.AUTH_ENFORCED = True
        _, propio = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        _, sin_unidad = await self._sesion("nuevo@k.com", rol="Conductor", unidad_id="")
        _, cliente = await self._sesion("cliente@k.com", rol="Cliente", empresa_id="TELEPERFORMANCE")
        with patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})) as base:
            ajena = await self._llamar("GET", "/api/conductor/servicios?unidad=K-002", propio)
            misma = await self._llamar("GET", "/api/conductor/servicios?unidad=K001", propio)
            ninguna = await self._llamar("GET", "/api/conductor/servicios", sin_unidad)
            de_cliente = await self._llamar("GET", "/api/conductor/servicios?unidad=K-001", cliente)
        self.assertEqual(ajena.status_code, 403)
        self.assertEqual(misma.status_code, 200)
        self.assertEqual(ninguna.status_code, 409)
        self.assertEqual(de_cliente.status_code, 403)
        base.assert_awaited_once()

    async def test_the_programador_deletes_the_plan_of_a_day_to_come(self):
        """Crear una programación no tenía vuelta atrás, y una de prueba les llegaba a los conductores."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        _, chofer = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        with (
            patch.object(backend, "_rpc_programador", new=AsyncMock(
                return_value={"fecha": "2026-09-29", "borradas": 396})) as base,
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar(
                "POST", "/api/programador/plan/borrar", token, json={"fecha": "2026-09-29"})
            de_conductor = await self._llamar(
                "POST", "/api/programador/plan/borrar", chofer, json={"fecha": "2026-09-29"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["borradas"], 396)
        self.assertEqual(de_conductor.status_code, 403)
        base.assert_awaited_once_with("borrar_programacion", {"dia": "2026-09-29"}, write=True)
        self.assertEqual(backend.actividad_db[0]["action_type"], "Programación borrada")

    async def test_deleting_a_plan_needs_the_day_to_be_named(self):
        """Sin fecha borraba el plan de hoy: con un borrado, nada se da por supuesto."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        with patch.object(backend, "_rpc_programador", new=AsyncMock()) as base:
            respuesta = await self._llamar("POST", "/api/programador/plan/borrar", token, json={})
        self.assertEqual(respuesta.status_code, 400)
        base.assert_not_awaited()

    async def test_redoing_a_plan_is_logged_as_redone_not_created(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 28)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={
                "fecha": "2026-09-29", "creadas": 396, "sembrado_desde": "2026-09-22"})) as base,
            patch.object(backend, "_retirar_no_disponibles", new=AsyncMock(
                return_value={"personas": 0, "servicios": []})),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar(
                "POST", "/api/programador/plan/sembrar", token,
                json={"fecha": "2026-09-29", "rehacer": True})
        self.assertEqual(respuesta.status_code, 200)
        self.assertTrue(base.await_args.args[1]["rehacer"])
        self.assertEqual(backend.actividad_db[0]["action_type"], "Programación rehecha")

    # --- Disponibilidad de las unidades (descansos y turnos) --------------------

    async def test_only_the_programador_saves_the_availability_of_a_unit(self):
        """«Solo programador» (el usuario): ni Administración ni el conductor."""
        backend.AUTH_ENFORCED = True
        _, programador = await self._sesion("prog@k.com", rol="Programador de rutas")
        _, admin = await self._sesion("admin@k.com", rol="Administración")
        _, chofer = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-027")
        cuerpo = {"unidad": "K-027", "semana": {"7": []}}
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(
                return_value={"unidad": "K027", "personas": 0, "retiradas": []})) as base,
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            de_admin = await self._llamar("POST", "/api/programador/disponibilidad", admin, json=cuerpo)
            de_chofer = await self._llamar("POST", "/api/programador/disponibilidad", chofer, json=cuerpo)
            sin_sesion = await self._llamar("POST", "/api/programador/disponibilidad", None, json=cuerpo)
            bueno = await self._llamar("POST", "/api/programador/disponibilidad", programador, json=cuerpo)
        self.assertEqual(de_admin.status_code, 403)
        self.assertEqual(de_chofer.status_code, 403)
        self.assertEqual(sin_sesion.status_code, 401)
        self.assertEqual(bueno.status_code, 200)
        base.assert_awaited_once()
        nombre, argumentos = base.await_args.args
        self.assertEqual(nombre, "guardar_disponibilidad")
        # La unidad va por su clave normalizada, que es con la que se cruza el plan.
        self.assertEqual(argumentos["p_unidad"], "K027")
        self.assertEqual(argumentos["p_semana"], {"7": []})
        self.assertEqual(argumentos["p_hoy"], "2026-10-02")
        self.assertEqual(backend.actividad_db[0]["action_type"], "Disponibilidad cambiada")

    async def test_saving_availability_checks_what_it_gets_before_touching_the_base(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        malos = [
            {"semana": {"7": []}},                                         # sin unidad
            {"unidad": "K-027"},                                           # nada que guardar
            {"unidad": "K-027", "semana": {"9": []}},
            {"unidad": "K-027", "fechas": [{"fecha": "2026-10-01", "turnos": []}]},  # ya pasó
            {"unidad": "K-027", "fechas": [{"fecha": "2026-10-04", "turnos": ["25:00"]}]},
        ]
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock()) as base,
        ):
            for malo in malos:
                with self.subTest(malo=malo):
                    respuesta = await self._llamar("POST", "/api/programador/disponibilidad", token, json=malo)
                    self.assertEqual(respuesta.status_code, 400)
        base.assert_not_awaited()

    async def test_saving_availability_says_how_many_went_to_pendientes(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        resultado = {"unidad": "K027", "personas": 5, "retiradas": [
            {"fecha": "2026-10-04", "personas": 5, "servicios": [
                {"vehiculo": "K027", "turno": "03:00", "modalidad": "RECOJO", "personas": 5}]}]}
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value=resultado)),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar("POST", "/api/programador/disponibilidad", token, json={
                "unidad": "K-027", "fechas": [{"fecha": "2026-10-04", "turnos": [], "nota": "Vacaciones"}]})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["personas"], 5)
        self.assertIn("5 pasajeros a pendientes", backend.actividad_db[0]["description"])

    async def test_without_migration_018_saving_availability_says_what_is_missing(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        caida = HTTPException(status_code=503, detail="Servicio no disponible.")
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(side_effect=caida)),
        ):
            respuesta = await self._llamar("POST", "/api/programador/disponibilidad", token,
                                           json={"unidad": "K-027", "semana": {"7": []}})
        self.assertEqual(respuesta.status_code, 503)
        self.assertIn("018", respuesta.json()["detail"])

    async def test_reading_availability_brings_the_turnos_of_the_operation_in_order(self):
        backend.AUTH_ENFORCED = True
        _, programador = await self._sesion("prog@k.com", rol="Programador de rutas")
        _, admin = await self._sesion("admin@k.com", rol="Administración")
        datos = {"semanal": [{"unidad": "K027", "dia": 7, "turnos": []}], "fechas": [],
                 "dias_con_plan": ["2026-10-03"],
                 "turnos": [{"turno": "22:01", "veces": 400}, {"turno": "22:00", "veces": 20},
                            {"turno": "03:00", "veces": 90}]}
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(side_effect=lambda *a, **k: dict(datos))) as base,
        ):
            del_programador = await self._llamar("GET", "/api/programador/disponibilidad", programador)
            de_admin = await self._llamar("GET", "/api/programador/disponibilidad", admin)
        self.assertEqual(del_programador.status_code, 200)
        cuerpo = del_programador.json()
        self.assertEqual(cuerpo["turnos"], ["22:00", "03:00"])
        self.assertEqual(cuerpo["hoy"], "2026-10-02")
        self.assertTrue(cuerpo["puede_editar"])
        # Administración la ve, pero no la cambia.
        self.assertFalse(de_admin.json()["puede_editar"])
        nombre, argumentos = base.await_args.args
        self.assertEqual(nombre, "leer_disponibilidad")
        self.assertEqual(argumentos["p_desde"], "2026-10-02")
        self.assertEqual(argumentos["p_turnos_desde"], "2026-08-18")

    async def test_the_plan_tells_which_units_do_not_work_all_day(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        reglas = {"K027": {"turnos": [], "origen": "fecha", "nota": None}}

        async def base(nombre, cuerpo, **_):
            if nombre == "disponibilidad_del_dia":
                return reglas
            return {"fecha": "2026-10-04", "existe": True, "rutas": [], "dias_con_plan": []}

        with patch.object(backend, "_rpc_programador", new=AsyncMock(side_effect=base)):
            respuesta = await self._llamar("GET", "/api/programador/plan?fecha=2026-10-04", token)
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["disponibilidad"], reglas)

    async def test_without_migration_018_the_plan_still_opens(self):
        """Una base sin la 018 no puede dejar al Programador sin su mesa."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")

        async def base(nombre, cuerpo, **_):
            if nombre == "disponibilidad_del_dia":
                raise HTTPException(status_code=503, detail="Servicio no disponible.")
            return {"fecha": "2026-10-04", "existe": True, "rutas": [], "dias_con_plan": []}

        with patch.object(backend, "_rpc_programador", new=AsyncMock(side_effect=base)):
            respuesta = await self._llamar("GET", "/api/programador/plan?fecha=2026-10-04", token)
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["disponibilidad"], {})

    async def test_nobody_is_put_in_a_unit_that_does_not_work_that_turno(self):
        """«Avisa que no se va a poder»: el servidor tampoco lo deja."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        reglas = {"K027": {"turnos": ["03:00"], "origen": "semana", "nota": None}}
        llamadas = []

        async def base(nombre, cuerpo, **_):
            llamadas.append(nombre)
            if nombre == "disponibilidad_del_dia":
                return reglas
            return {"fecha": "2026-10-04", "aplicados": 1, "ignorados": 0}

        mover = {"accion": "mover", "dni": "1",
                 "desde": {"vehiculo": "K028", "turno": "06:00", "modalidad": "RECOJO"},
                 "hacia": {"vehiculo": "K027", "turno": "06:00", "modalidad": "RECOJO"}}
        agregar_bien = {"accion": "agregar", "dni": "2", "vehiculo": "K027", "turno": "03:00",
                        "modalidad": "RECOJO"}
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(side_effect=base)),
        ):
            rechazado = await self._llamar("POST", "/api/programador/plan/editar", token,
                                           json={"fecha": "2026-10-04", "cambios": [mover]})
            aceptado = await self._llamar("POST", "/api/programador/plan/editar", token,
                                          json={"fecha": "2026-10-04", "cambios": [agregar_bien]})
        self.assertEqual(rechazado.status_code, 409)
        self.assertIn("K027 solo trabaja a las 03:00", rechazado.json()["detail"])
        self.assertEqual(aceptado.status_code, 200)
        self.assertEqual(llamadas.count("editar_programacion"), 1)

    async def test_creating_a_plan_moves_the_passengers_of_resting_units_to_pendientes(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        llamadas = []

        async def base(nombre, cuerpo, **_):
            llamadas.append(nombre)
            if nombre == "retirar_no_disponibles":
                return {"fecha": "2026-10-04", "personas": 6, "servicios": [
                    {"vehiculo": "K027", "turno": "03:00", "modalidad": "RECOJO", "personas": 6}]}
            return {"fecha": "2026-10-04", "creadas": 396, "sembrado_desde": "2026-09-27"}

        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(side_effect=base)),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar("POST", "/api/programador/plan/sembrar", token,
                                           json={"fecha": "2026-10-04"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(llamadas, ["sembrar_programacion", "retirar_no_disponibles"])
        self.assertEqual(respuesta.json()["no_disponibles"]["personas"], 6)
        self.assertIn("6 pasajeros a pendientes", backend.actividad_db[0]["description"])

    async def test_the_button_moves_to_pendientes_what_slipped_into_resting_units(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 10, 2)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(
                return_value={"fecha": "2026-10-04", "personas": 2, "servicios": []})) as base,
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._llamar("POST", "/api/programador/plan/no-disponibles", token,
                                           json={"fecha": "2026-10-04"})
            sin_sesion = await self._llamar("POST", "/api/programador/plan/no-disponibles", None,
                                            json={"fecha": "2026-10-04"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(sin_sesion.status_code, 401)
        base.assert_awaited_once_with("retirar_no_disponibles", {"dia": "2026-10-04"}, write=True)
        self.assertEqual(backend.actividad_db[0]["action_type"],
                         "Pasados a pendientes por unidad no disponible")

    def test_a_day_already_run_or_with_marks_is_neither_deleted_nor_redone(self):
        for codigo in ("dia_pasado", "con_marcas", "sin_programacion"):
            with self.subTest(codigo=codigo), self.assertRaises(HTTPException) as ctx:
                backend._raise_programador_result_error("borrar_programacion", {"error": codigo})
            self.assertEqual(ctx.exception.status_code, 409)
            # Un motivo, no el «no se pudo completar» genérico.
            self.assertNotIn("No se pudo completar", ctx.exception.detail)

    # --- Carga del histórico: avisar de lo ya cargado ---------------------------

    class _ClienteFalso:
        """Lo mínimo de `httpx.AsyncClient` que usan la carga y el estado."""

        def __init__(self, *args, **kwargs):
            self.posts = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            self.posts.append(url)
            return httpx.Response(200, json=[{"resueltas": 1, "dudosas": 0, "pendientes": 0}])

        async def get(self, url, **kwargs):
            return httpx.Response(200, json=[{"fecha_ejecutada": "2026-09-22"}],
                                  headers={"content-range": "0-0/518"})

    SERVICIOS_DE_CARGA = [{"fecha_ejecutada": "2026-09-27", "dni": "1"},
                          {"fecha_ejecutada": "2026-09-27", "dni": "2"}]

    def _parches_de_carga(self, ya_cargados, servicios=None):
        servicios = servicios or self.SERVICIOS_DE_CARGA
        hi = backend.historico_intranet
        return (
            patch.object(hi, "leer_reporte", return_value=object()),
            patch.object(hi, "construir_padron", return_value=([], [])),
            patch.object(hi, "construir_historico", return_value=servicios),
            patch.object(hi, "construir_duraciones", return_value=[]),
            patch.object(hi, "resumen", return_value={
                "servicios": 2, "desde": "2026-09-27", "hasta": "2026-09-27",
                "pasajeros": 2, "ubicacion_pendiente": 0}),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value=ya_cargados)),
            patch.object(backend, "_upsert_tabla", new=AsyncMock(return_value=2)),
            patch.object(backend.httpx, "AsyncClient", new=self._ClienteFalso),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        )

    async def _subir(self, token, **datos):
        return await self._llamar(
            "POST", "/api/programador/historico", token,
            files={"file": ("historial.xls", b"<table></table>", "application/vnd.ms-excel")},
            data=datos)

    async def test_uploading_a_day_already_loaded_stops_before_writing(self):
        """Volver a subir el mismo día no avisaba: rehacía el trabajo sin decirlo."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        cargado = [{"fecha": "2026-09-27", "servicios": 518, "cargado_en": "2026-09-28T13:15:00+00:00"}]
        parches = self._parches_de_carga(cargado)
        with parches[0], parches[1], parches[2], parches[3], parches[4], parches[5] as base, \
                parches[6] as escribir, parches[7], parches[8]:
            respuesta = await self._subir(token)
        self.assertEqual(respuesta.status_code, 409)
        detalle = respuesta.json()["detail"]
        self.assertEqual(detalle["ya_cargados"], cargado)
        self.assertIn("27", detalle["mensaje"])
        # Cuántos trae el archivo de cada día: 518 cargados contra 2 en el
        # archivo es un reporte a medias, y la pantalla tiene que poder decirlo.
        self.assertEqual(detalle["en_archivo"], {"2026-09-27": 2})
        escribir.assert_not_awaited()
        base.assert_awaited_once_with("dias_cargados", {"p_desde": "2026-09-27", "p_hasta": "2026-09-27"})

    async def test_uploading_it_again_on_purpose_replaces_the_day(self):
        """Volver a cargar hacía un upsert: no quitaba lo que el reporte corregido ya no trae."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        parches = self._parches_de_carga([{"fecha": "2026-09-27", "servicios": 518, "cargado_en": None}])
        with parches[0], parches[1], parches[2], parches[3], parches[4], parches[5] as base, \
                parches[6] as escribir, parches[7], parches[8]:
            respuesta = await self._subir(token, reemplazar="true")
        self.assertEqual(respuesta.status_code, 200)
        base.assert_awaited_once_with("reemplazar_dia_historico", {
            "p_dia": "2026-09-27", "p_filas": self.SERVICIOS_DE_CARGA}, write=True)
        self.assertNotIn("servicios_historicos", [c.args[1] for c in escribir.await_args_list])

    async def test_a_new_day_loads_without_asking(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        parches = self._parches_de_carga([])
        with parches[0], parches[1], parches[2], parches[3], parches[4], parches[5] as base, \
                parches[6], parches[7], parches[8]:
            respuesta = await self._subir(token)
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()["hasta"], "2026-09-27")
        self.assertEqual([c.args[0] for c in base.await_args_list],
                         ["dias_cargados", "reemplazar_dia_historico"])

    async def test_a_file_with_several_days_replaces_each_day_on_its_own(self):
        """Un día por transacción: el fallo de uno no deja otro a medias."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        servicios = [{"fecha_ejecutada": "2026-09-27", "dni": "1"},
                     {"fecha_ejecutada": "2026-09-26", "dni": "2"},
                     {"fecha_ejecutada": "2026-09-27", "dni": "3"}]
        parches = self._parches_de_carga([], servicios=servicios)
        with parches[0], parches[1], parches[2], parches[3], parches[4], parches[5] as base, \
                parches[6], parches[7], parches[8]:
            respuesta = await self._subir(token)
        self.assertEqual(respuesta.status_code, 200)
        dias = [c.args[1] for c in base.await_args_list if c.args[0] == "reemplazar_dia_historico"]
        self.assertEqual(dias, [
            {"p_dia": "2026-09-26", "p_filas": [servicios[1]]},
            {"p_dia": "2026-09-27", "p_filas": [servicios[0], servicios[2]]},
        ])

    def test_a_report_with_rows_of_another_day_is_a_clear_400(self):
        with self.assertRaises(HTTPException) as ctx:
            backend._raise_programador_result_error("reemplazar_dia_historico", {"error": "otro_dia"})
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("día distinto", ctx.exception.detail)

    async def test_the_history_status_says_which_day_is_due_and_the_last_week(self):
        """El reporte que toca es el del día que ya terminó: ayer, en Lima."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        dias = [{"fecha": "2026-09-22", "servicios": 518, "cargado_en": "2026-09-23T04:12:46+00:00"}]
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 28)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value=dias)) as base,
            patch.object(backend.httpx, "AsyncClient", new=self._ClienteFalso),
        ):
            respuesta = await self._llamar("GET", "/api/programador/estado-historico", token)
        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()
        self.assertEqual(cuerpo["hoy"], "2026-09-28")
        self.assertEqual(cuerpo["esperado"], "2026-09-27")
        self.assertEqual(cuerpo["dias"], dias)
        self.assertEqual(cuerpo["ultimo_dia"], "2026-09-22")
        base.assert_awaited_once_with("dias_cargados", {"p_desde": "2026-09-21", "p_hasta": "2026-09-28"})

    def test_the_masivo_base_kv_units_are_the_intranets_v_units(self):
        """La base MASIVO escribe «KV-026» y la intranet «V026»: es la misma unidad."""
        self.assertEqual(backend._clave_de_vehiculo("KV-026"), "V026")
        self.assertEqual(backend._clave_de_vehiculo("V026"), "V026")
        self.assertEqual(backend._clave_de_vehiculo("K-027"), "K027")
        self.assertEqual(backend._clave_de_vehiculo("KV TEST"), "KVTEST")
        self.assertEqual(backend._clave_de_vehiculo("SM001"), "SM001")

    async def test_a_kv_driver_reads_the_services_the_intranet_files_under_v(self):
        """23 conductores con cuenta no recibían nada: su unidad era KV-### y el plan decía V###."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("quispe@k.com", rol="Conductor", unidad_id="KV-026")
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 27)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})) as base,
        ):
            propia = await self._llamar("GET", "/api/conductor/servicios", token)
            con_v = await self._llamar("GET", "/api/conductor/servicios?unidad=V026", token)
        self.assertEqual(propia.status_code, 200)
        self.assertEqual(con_v.status_code, 200)
        self.assertEqual([llamada.args[1]["p_clave"] for llamada in base.await_args_list], ["V026", "V026"])

    async def test_administration_reads_any_unit_but_has_to_name_it(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        with patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})) as base:
            sin_unidad = await self._llamar("GET", "/api/conductor/servicios", token)
            con_unidad = await self._llamar("GET", "/api/conductor/servicios?unidad=V-026", token)
        self.assertEqual(sin_unidad.status_code, 400)
        self.assertEqual(con_unidad.status_code, 200)
        self.assertEqual(base.await_args.args[1]["p_clave"], "V026")

    async def test_a_driver_marks_only_with_their_own_unit_and_session(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 27)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={
                "id": 7, "viaje": "a_bordo", "marcado_en": "x"})) as base,
        ):
            # La unidad del cuerpo no cuenta: manda la de la sesión.
            respuesta = await self._llamar("POST", "/api/conductor/servicios/marcar", token,
                                           json={"id": 7, "estado": "a_bordo", "unidad": "K-999"})
            desmarcar = await self._llamar("POST", "/api/conductor/servicios/marcar", token,
                                           json={"id": 7, "estado": None})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(desmarcar.status_code, 200)
        self.assertEqual(base.await_args_list[0].args, ("marcar_viaje", {
            "p_id": 7, "p_clave": "K001", "p_estado": "a_bordo", "p_por": "chofer@k.com",
            "p_desde": "2026-09-26", "p_hasta": "2026-09-28"}))
        self.assertEqual(base.await_args_list[0].kwargs, {"write": True})
        self.assertIsNone(base.await_args_list[1].args[1]["p_estado"])

    async def test_marking_rejects_other_roles_and_malformed_marks_without_touching_the_db(self):
        backend.AUTH_ENFORCED = True
        _, chofer = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        _, admin = await self._sesion("admin@k.com", rol="Administración")
        _, cliente = await self._sesion("cliente@k.com", rol="Cliente", empresa_id="TELEPERFORMANCE")
        with patch.object(backend, "_rpc_programador", new=AsyncMock()) as base:
            casos = [
                (admin, {"id": 1, "estado": "a_bordo"}, 403),
                (cliente, {"id": 1, "estado": "a_bordo"}, 403),
                (chofer, {"id": 1, "estado": "Recogido"}, 400),
                (chofer, {"id": True, "estado": "a_bordo"}, 400),
                (chofer, {"id": "1", "estado": "a_bordo"}, 400),
                (chofer, {"id": 0, "estado": "a_bordo"}, 400),
                # Fuera de `bigint` Postgres lo rechazaba y llegaba como 503.
                (chofer, {"id": 2 ** 63, "estado": "a_bordo"}, 400),
                (chofer, {"estado": "a_bordo"}, 400),
            ]
            for token, cuerpo, esperado in casos:
                respuesta = await self._llamar("POST", "/api/conductor/servicios/marcar", token, json=cuerpo)
                self.assertEqual(respuesta.status_code, esperado, cuerpo)
        base.assert_not_awaited()

    async def test_a_mark_is_signed_with_the_account_key_not_the_identifier_field(self):
        """124 de 128 cuentas no llevan `identifier`: la marca quedaba sin autor."""
        backend.AUTH_ENFORCED = True
        conductor = {"rol": "Conductor", "estado": "Activo", "unidad_id": "K-001", "nombre": "Sin id"}
        backend.usuarios_db["perez.lopez@kapital.com"] = conductor
        token = await backend.abrir_sesion(conductor)
        with patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})) as base:
            respuesta = await self._llamar("POST", "/api/conductor/servicios/marcar", token,
                                           json={"id": 5, "estado": "a_bordo"})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(base.await_args.args[1]["p_por"], "perez.lopez@kapital.com")

    async def test_without_session_enforcement_the_new_routes_stay_closed(self):
        """El modo de vuelta atrás abre las rutas viejas; estas no tienen a quién servir así."""
        backend.AUTH_ENFORCED = False
        with patch.object(backend, "_rpc_programador", new=AsyncMock()) as base:
            for metodo, ruta, extra in (
                ("GET", "/api/conductor/servicios?unidad=K-001", {}),
                ("POST", "/api/conductor/servicios/marcar", {"json": {"id": 1, "estado": "a_bordo", "unidad": "K-001"}}),
                ("GET", "/api/cliente/servicios?empresa=TELEPERFORMANCE", {}),
            ):
                self.assertEqual((await self._llamar(metodo, ruta, **extra)).status_code, 401, ruta)
        base.assert_not_awaited()

    def test_marking_outside_the_service_hours_is_a_409_that_says_why(self):
        with self.assertRaises(HTTPException) as fallo:
            backend._raise_programador_result_error("marcar_viaje", {"error": "fuera_de_hora"})
        self.assertEqual(fallo.exception.status_code, 409)
        self.assertIn("6 horas", fallo.exception.detail)

    async def test_registration_ignores_a_self_declared_unit_or_company(self):
        """Declararse de la K-027 al registrarse y que alguien pulsara «Aprobar» daba sus pasajeros."""
        backend.usuarios_db["admin@example.com"] = {
            "identifier": "admin@example.com", "rol": "Administración", "estado": "Activo",
        }
        for identificador, rol in (("12345678", "Conductor"), ("cli@otra.com", "Cliente")):
            with (
                patch.object(backend, "reload_db", new=AsyncMock()),
                patch.object(backend, "persist_users_only", new=AsyncMock()),
                patch.object(backend, "_load_compat_fleet", new=AsyncMock()) as flota,
                patch.object(backend, "_sembrar_unidad") as sembrar,
            ):
                await backend.register_user(backend.UsuarioRegistro(
                    identifier=identificador, password="safe-password", nombre="Quien sea", rol=rol,
                    unidad_id="K-027", empresa_id="TELEPERFORMANCE"))
            guardado = backend.usuarios_db[identificador]
            self.assertIsNone(guardado["unidad_id"], rol)
            self.assertIsNone(guardado["empresa_id"], rol)
            sembrar.assert_not_called()
            flota.assert_not_awaited()

    async def test_approving_refreshes_the_session_after_assigning_the_unit(self):
        """Refrescar antes dejaba en la sesión la unidad vieja hasta 12 horas."""
        backend.usuarios_db["admin@e.com"] = {"identifier": "admin@e.com", "rol": "Administración", "estado": "Activo"}
        backend.usuarios_db["drv@e.com"] = {"identifier": "drv@e.com", "rol": "Conductor",
                                            "estado": "Pendiente Revisión", "unidad_id": "K-999"}
        vistas = []

        async def refrescar(user):
            vistas.append(user.get("unidad_id"))

        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
            patch.object(backend, "_sembrar_unidad"),
            patch.object(backend, "refrescar_sesiones_de", new=refrescar),
        ):
            await backend.approve_user("drv@e.com", "admin@e.com", "K-027")
        self.assertEqual(vistas, ["K-027"])

    async def test_a_rejected_unit_change_leaves_nothing_else_changed_in_memory(self):
        """El 403 llegaba después de aplicar nombre y contraseña, y el siguiente guardado los escribía."""
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001", "rol": "Conductor", "estado": "Activo", "unidad_id": "K-001",
            "nombre": "Antes", "password": backend.hash_password("vieja-segura"),
        }
        antes = dict(backend.usuarios_db["driver-001"])
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            with self.assertRaises(HTTPException) as fallo:
                await backend.update_profile(backend.UsuarioUpdate(
                    identifier="driver-001", unidad_id="K-002", nombre="Después",
                    current_password="vieja-segura", new_password="nueva-segura"))
        self.assertEqual(fallo.exception.status_code, 403)
        self.assertEqual(backend.usuarios_db["driver-001"], antes)
        guardar.assert_not_awaited()

    def test_a_mark_the_db_refuses_is_a_404_the_driver_can_act_on(self):
        """Si el Programador sacó a esa persona del servicio, la marca no se guarda y se dice."""
        with self.assertRaises(HTTPException) as fallo:
            backend._raise_programador_result_error("marcar_viaje", {"error": "no_esta_en_el_plan"})
        self.assertEqual(fallo.exception.status_code, 404)
        self.assertIn("Actualiza", fallo.exception.detail)

    async def test_a_client_reads_the_services_of_its_own_company(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("cliente@k.com", rol="Cliente", empresa_id="Teleperformance")
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 27)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={
                "existe": True, "servicios": [{"unidad": "K027"}], "pendientes": []})) as base,
        ):
            hoy = await self._llamar("GET", "/api/cliente/servicios", token)
            ayer = await self._llamar("GET", "/api/cliente/servicios?fecha=2026-09-26", token)
            otra = await self._llamar("GET", "/api/cliente/servicios?empresa=KONECTA", token)
            lejos = await self._llamar("GET", "/api/cliente/servicios?fecha=2026-01-01", token)
            mal = await self._llamar("GET", "/api/cliente/servicios?fecha=27-09-2026", token)
        self.assertEqual(hoy.status_code, 200)
        # La empresa va tal cual: la base la compara por palabras enteras.
        self.assertEqual(base.await_args_list[0].args, ("servicios_de_empresa", {
            "p_prefijo": "Teleperformance", "p_dia": "2026-09-27"}))
        self.assertEqual(hoy.json()["servicios"], [{"unidad": "K027"}])
        self.assertTrue(hoy.json()["existe"])
        self.assertEqual(ayer.status_code, 200)
        self.assertEqual(base.await_args_list[1].args[1]["p_dia"], "2026-09-26")
        self.assertEqual(otra.status_code, 403)
        self.assertEqual(lejos.status_code, 400)
        self.assertEqual(mal.status_code, 400)
        self.assertEqual(base.await_count, 2)

    async def test_only_clients_and_administration_read_a_company(self):
        backend.AUTH_ENFORCED = True
        _, chofer = await self._sesion("chofer@k.com", rol="Conductor", unidad_id="K-001")
        _, sin_empresa = await self._sesion("cliente@k.com", rol="Cliente", empresa_id=None)
        _, gerente = await self._sesion("gerente@k.com", rol="Gerente de Operaciones")
        with patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={})) as base:
            self.assertEqual((await self._llamar(
                "GET", "/api/cliente/servicios?empresa=TELEPERFORMANCE", chofer)).status_code, 403)
            self.assertEqual((await self._llamar("GET", "/api/cliente/servicios", sin_empresa)).status_code, 409)
            self.assertEqual((await self._llamar("GET", "/api/cliente/servicios", gerente)).status_code, 400)
            self.assertEqual((await self._llamar(
                "GET", "/api/cliente/servicios?empresa=TELEPERFORMANCE", gerente)).status_code, 200)
        base.assert_awaited_once()

    async def test_a_driver_cannot_move_to_another_unit_from_their_profile(self):
        """La unidad decide qué pasajeros ve: cambiársela uno mismo era ver los de otro."""
        backend.usuarios_db["driver-001"] = {
            "identifier": "driver-001", "rol": "Conductor", "estado": "Activo", "unidad_id": "K-001",
        }
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            with self.assertRaises(HTTPException) as fallo:
                await backend.update_profile(backend.UsuarioUpdate(identifier="driver-001", unidad_id="K-002"))
            # La misma unidad escrita de otra forma no es un cambio.
            await backend.update_profile(backend.UsuarioUpdate(identifier="driver-001", unidad_id="K001"))
        self.assertEqual(fallo.exception.status_code, 403)
        self.assertEqual(backend.usuarios_db["driver-001"]["unidad_id"], "K-001")
        guardar.assert_awaited_once()

    def test_a_notification_id_never_restarts_from_one(self):
        """Sin avisos cargados, «el mayor más uno» daba 1 y pisaba al aviso 1 al fusionar."""
        backend.notifications_db.clear()
        antes = time.time_ns() // 1000
        self.assertGreaterEqual(backend._next_notification_id(), antes)
        # Creciente aunque el reloj vaya por detrás del último id visto.
        backend.notifications_db.append({"id": 10 ** 17})
        self.assertEqual(backend._next_notification_id(), 10 ** 17 + 1)

    def test_the_websocket_refuses_a_handshake_without_a_session(self):
        from fastapi.testclient import TestClient
        from starlette.websockets import WebSocketDisconnect as Desconexion

        backend.AUTH_ENFORCED = True
        with TestClient(backend.app) as cliente:
            with self.assertRaises(Desconexion) as caught:
                with cliente.websocket_connect("/ws/chofer@k.com") as ws:
                    ws.receive_text()
        self.assertEqual(caught.exception.code, 1008)
        self.assertNotIn("chofer@k.com", backend.ws_manager.active)

    # --- Tope de intentos de acceso ----------------------------------------------------

    def _cuenta_con_clave(self, clave="chofer@k.com", contrasena="la-buena", **campos):
        backend.usuarios_db[clave] = {
            "identifier": clave, "email": clave, "rol": "Conductor", "estado": "Activo",
            "password": backend.hash_password(contrasena), **campos,
        }

    async def _entrar(self, identificador, contrasena, ip="203.0.113.7"):
        transport = httpx.ASGITransport(app=backend.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/api/auth/login",
                                     json={"identifier": identificador, "password": contrasena},
                                     headers={"x-forwarded-for": ip})

    async def test_too_many_failed_logins_lock_the_account_even_with_the_right_password(self):
        """Agotado el tope, ni la buena entra: si no, seguir probando diría cuándo se acierta."""
        self._cuenta_con_clave()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                self.assertEqual((await self._entrar("chofer@k.com", "otra")).status_code, 401)
            with patch.object(backend, "verify_password", wraps=backend.verify_password) as verificar:
                bloqueado = await self._entrar("chofer@k.com", "la-buena")
        self.assertEqual(bloqueado.status_code, 429)
        self.assertIn("Espera", bloqueado.json()["detail"])
        verificar.assert_not_called()  # ni se llega a comprobar la contraseña

    async def test_an_attacker_cannot_lock_out_the_owner_from_elsewhere(self):
        """Diez fallos desde un sitio bloquean ese sitio, no a la persona en el suyo."""
        self._cuenta_con_clave()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                await self._entrar("chofer@k.com", "otra", ip="198.51.100.66")
            self.assertEqual((await self._entrar("chofer@k.com", "la-buena", ip="198.51.100.66")).status_code, 429)
            self.assertEqual((await self._entrar("chofer@k.com", "la-buena", ip="203.0.113.7")).status_code, 200)

    async def test_spreading_attempts_across_many_addresses_still_hits_a_limit(self):
        self._cuenta_con_clave()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for n in range(backend.intentos_acceso.MAX_POR_CUENTA):
                self.assertEqual((await self._entrar("chofer@k.com", "otra", ip=f"198.51.100.{n}")).status_code, 401)
            self.assertEqual((await self._entrar("chofer@k.com", "la-buena", ip="203.0.113.99")).status_code, 429)

    async def test_a_burst_of_simultaneous_attempts_cannot_slip_past_the_limit(self):
        """Contar y anotar por separado dejaba pasar una ráfaga entera: 40 a la vez, 40 respuestas 401."""
        self._cuenta_con_clave()
        rafaga = 4 * backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN
        with patch.object(backend, "reload_db", new=AsyncMock()):
            respuestas = await asyncio.gather(*(self._entrar("chofer@k.com", "otra") for _ in range(rafaga)))
        codigos = [r.status_code for r in respuestas]
        self.assertEqual(codigos.count(401), backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN)
        self.assertEqual(codigos.count(429), rafaga - backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN)

    async def test_every_alias_of_an_account_shares_one_limit(self):
        """DNI, correo y clave son la misma cuenta: alternarlos no multiplica los intentos."""
        self._cuenta_con_clave(email="otro-correo@k.com", dni="74538840")
        del backend.usuarios_db["chofer@k.com"]["identifier"]
        alias = ["74538840", "otro-correo@k.com", "chofer@k.com"]
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for n in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                self.assertEqual((await self._entrar(alias[n % 3], "otra")).status_code, 401)
            self.assertEqual((await self._entrar("74538840", "la-buena")).status_code, 429)

    async def test_the_limit_counts_however_the_identifier_is_typed(self):
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for n in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                await self._entrar(" NADIE@k.com " if n % 2 else "nadie@K.COM", "otra")
            self.assertEqual((await self._entrar("nadie@k.com", "x")).status_code, 429)

    async def test_a_successful_login_forgets_the_accounts_failures(self):
        self._cuenta_con_clave()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN - 1):
                await self._entrar("chofer@k.com", "otra")
            self.assertEqual((await self._entrar("chofer@k.com", "la-buena")).status_code, 200)
            self.assertEqual(backend.almacen_intentos.filas, [], "ni los fallos ni el intento que acertó")
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                self.assertEqual((await self._entrar("chofer@k.com", "otra")).status_code, 401)

    async def test_one_origin_trying_many_accounts_is_stopped(self):
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for n in range(backend.intentos_acceso.MAX_POR_ORIGEN):
                await self._entrar(f"cuenta{n}@k.com", "x", ip="198.51.100.9")
            desde_ahi = await self._entrar("otra@k.com", "x", ip="198.51.100.9")
            desde_otro = await self._entrar("otra@k.com", "x", ip="198.51.100.10")
        self.assertEqual(desde_ahi.status_code, 429)
        self.assertEqual(desde_otro.status_code, 401)

    async def _registrar(self, identificador, ip="203.0.113.7", **campos):
        transport = httpx.ASGITransport(app=backend.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.post("/api/auth/register", headers={"x-forwarded-for": ip}, json={
                "identifier": identificador, "password": "segura", "rol": "Conductor", **campos})

    async def test_public_registration_has_its_own_limit_checked_before_reading_anything(self):
        """Cada alta deja una cuenta para siempre: sin tope, cualquiera podía llenar la fila."""
        backend.usuarios_db["ya@k.com"] = {"identifier": "ya@k.com", "rol": "Cliente"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            for n in range(backend.intentos_acceso.MAX_REGISTROS_POR_ORIGEN):
                self.assertEqual((await self._registrar(f"4000000{n}")).status_code, 200)
            with patch.object(backend, "_load_compat_user", new=AsyncMock()) as leer:
                frenado = await self._registrar("40000099")
        self.assertEqual(frenado.status_code, 429)
        self.assertIn("solicitudes", frenado.json()["detail"])
        leer.assert_not_awaited()  # ni se mira si existe

    async def test_registration_has_a_total_limit_across_addresses(self):
        backend.usuarios_db["ya@k.com"] = {"identifier": "ya@k.com", "rol": "Cliente"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            for n in range(backend.intentos_acceso.MAX_REGISTROS):
                self.assertEqual((await self._registrar(f"5000000{n}", ip=f"198.51.100.{n}")).status_code, 200)
            self.assertEqual((await self._registrar("50000099", ip="198.51.100.200")).status_code, 429)

    async def test_registering_again_with_another_alias_of_an_account_is_refused(self):
        """Un conductor importado tiene de clave un correo inventado; con su DNI no puede duplicarse."""
        backend.usuarios_db["inventado@kapital.com"] = {
            "email": "inventado@kapital.com", "dni": "74538840", "rol": "Conductor"}
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            respuesta = await self._registrar("74538840")
        self.assertEqual(respuesta.status_code, 400)
        guardar.assert_not_awaited()

    async def test_a_cold_instance_never_makes_the_registrant_an_administrator(self):
        """Con la memoria vacía no se sabe si es la primera cuenta: se lee entera antes de regalar el rol."""
        async def lectura_completa(*args, **kwargs):
            backend.usuarios_db["ya@k.com"] = {"identifier": "ya@k.com", "rol": "Administración"}

        with (
            patch.object(backend, "reload_db", new=AsyncMock(side_effect=lectura_completa)),
            patch.object(backend, "_load_compat_user", new=AsyncMock(return_value=None)),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            respuesta = await self._registrar("60000001")
        self.assertEqual(respuesta.json()["estado"], "Pendiente")
        self.assertEqual(backend.usuarios_db["60000001"]["rol"], "Conductor")

    async def test_the_owner_logging_in_does_not_give_an_attacker_their_attempts_back(self):
        """Acertar borra lo de su origen, no lo de quien la ataca desde otro."""
        self._cuenta_con_clave()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN - 1):
                await self._entrar("chofer@k.com", "otra", ip="198.51.100.66")
            self.assertEqual((await self._entrar("chofer@k.com", "la-buena", ip="203.0.113.7")).status_code, 200)
            self.assertEqual((await self._entrar("chofer@k.com", "otra", ip="198.51.100.66")).status_code, 401)
            self.assertEqual((await self._entrar("chofer@k.com", "otra", ip="198.51.100.66")).status_code, 429)

    async def _cambiar_desde_el_perfil(self, token, actual, nueva="nueva-clave", ip="203.0.113.7"):
        return await self._llamar("PUT", "/api/user/profile", token, headers={"x-forwarded-for": ip}, json={
            "identifier": "chofer@k.com", "current_password": actual, "new_password": nueva})

    async def test_a_wrong_current_password_in_the_profile_is_a_400_not_a_logout(self):
        """Con un 401 el cliente daba la sesión por caducada y echaba a quien se equivocaba al teclear."""
        backend.AUTH_ENFORCED = True
        self._cuenta_con_clave()
        token = await backend.abrir_sesion(backend.usuarios_db["chofer@k.com"])
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            respuesta = await self._cambiar_desde_el_perfil(token, "otra")
        self.assertEqual(respuesta.status_code, 400)
        self.assertIn("actual", respuesta.json()["detail"])
        guardar.assert_not_awaited()
        self.assertTrue(backend.verify_password("la-buena", backend.usuarios_db["chofer@k.com"]["password"]))

    async def test_guessing_the_current_password_from_the_profile_hits_the_limit(self):
        """Con una sesión ajena abierta se podía probar la contraseña actual sin límite."""
        backend.AUTH_ENFORCED = True
        self._cuenta_con_clave()
        token = await backend.abrir_sesion(backend.usuarios_db["chofer@k.com"])
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                self.assertEqual((await self._cambiar_desde_el_perfil(token, "otra")).status_code, 400)
            self.assertEqual((await self._cambiar_desde_el_perfil(token, "la-buena")).status_code, 429)

    async def test_changing_the_password_from_the_profile_ends_the_provisional_one(self):
        backend.AUTH_ENFORCED = True
        self._cuenta_con_clave(needs_password_change=True)
        token = await backend.abrir_sesion(backend.usuarios_db["chofer@k.com"])
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            respuesta = await self._cambiar_desde_el_perfil(token, "la-buena")
        self.assertEqual(respuesta.status_code, 200)
        guardar.assert_awaited()
        cuenta = backend.usuarios_db["chofer@k.com"]
        self.assertTrue(backend.verify_password("nueva-clave", cuenta["password"]))
        self.assertFalse(cuenta["needs_password_change"])
        self.assertEqual(backend.almacen_intentos.filas, [], "acertar olvida el intento")

    async def test_the_profile_without_a_session_does_not_tell_which_accounts_exist(self):
        """Sin sesión daba 404 si la cuenta no existía y 401 si existía."""
        backend.AUTH_ENFORCED = True
        self._cuenta_con_clave()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            respuestas = [
                await self._llamar("GET", f"/api/user/profile?email={cuenta}")
                for cuenta in ("chofer@k.com", "nadie@k.com")
            ] + [
                await self._llamar("PUT", "/api/user/profile", json={"identifier": cuenta, "nombre": "x"})
                for cuenta in ("chofer@k.com", "nadie@k.com")
            ]
        self.assertEqual([r.status_code for r in respuestas], [401, 401, 401, 401])

    async def test_the_user_list_asks_for_a_session_before_loading_every_account(self):
        """Sin sesión cargaba todas las cuentas y el 403 o el 401 decía si el correo era de Administración."""
        backend.AUTH_ENFORCED = True
        backend.usuarios_db["jefa@k.com"] = {"identifier": "jefa@k.com", "rol": "Administración"}
        self._cuenta_con_clave()
        with (
            patch.object(backend, "reload_db", new=AsyncMock()) as recargar,
            patch.object(backend, "_load_compat_users", new=AsyncMock()) as cargar,
        ):
            respuestas = [await self._llamar("GET", f"/api/admin/users?email={cuenta}")
                          for cuenta in ("jefa@k.com", "chofer@k.com", "nadie@k.com")]
        self.assertEqual([r.status_code for r in respuestas], [401, 401, 401])
        cargar.assert_not_awaited()
        recargar.assert_not_awaited()

    async def test_nothing_readable_is_stored_about_a_failed_attempt(self):
        with patch.object(backend, "reload_db", new=AsyncMock()):
            await self._entrar("74538840", "x", ip="198.51.100.9")
        (clave, origen), = backend.almacen_intentos.filas
        self.assertEqual(len(clave), 64)
        self.assertNotIn("74538840", clave + origen)
        self.assertNotIn("198.51.100.9", clave + origen)

    async def test_the_limit_failing_never_locks_everyone_out(self):
        self._cuenta_con_clave()

        class Caida(backend.intentos_acceso.IntentosEnMemoria):
            async def registrar(self, clave, origen):
                raise httpx.ReadTimeout("caída")

        backend.almacen_intentos = Caida()
        with patch.object(backend, "reload_db", new=AsyncMock()):
            self.assertEqual((await self._entrar("chofer@k.com", "la-buena")).status_code, 200)
            self.assertEqual((await self._entrar("chofer@k.com", "otra")).status_code, 401)

    async def test_the_limiter_request_never_retries_nor_trips_the_database_breaker(self):
        """Con los reintentos de siempre, un tope caído alargaba el login ~20 s y abría el cortacircuitos."""
        backend._activate_storage_config(backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        }))
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.request.side_effect = httpx.ConnectTimeout("lenta")
        fallos_antes = backend._db_circuit_failures
        with patch.object(backend.httpx, "AsyncClient", return_value=client) as creado:
            with self.assertRaises(httpx.ConnectTimeout):
                await backend._pedir_sin_reintentos(
                    "POST", "https://v2-compat.invalid/rest/v1/rpc/registrar_intento",
                    operation="intentos_registrar_intento", headers={}, timeout=2.0, json_payload={})
        self.assertEqual(client.request.await_count, 1)
        self.assertEqual(creado.call_args.kwargs["timeout"], 2.0)
        self.assertEqual(backend._db_circuit_failures, fallos_antes)

    async def test_changing_the_password_shares_the_limit(self):
        """Pide la actual sin sesión: es otra puerta para adivinarla."""
        self._cuenta_con_clave()
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            for _ in range(backend.intentos_acceso.MAX_POR_CUENTA_Y_ORIGEN):
                with self.assertRaises(HTTPException):
                    await backend.change_password(backend.ChangePasswordRequest(
                        identifier="chofer@k.com", old_password="otra", new_password="nueva-clave"))
            with self.assertRaises(HTTPException) as caught:
                await backend.change_password(backend.ChangePasswordRequest(
                    identifier="chofer@k.com", old_password="la-buena", new_password="nueva-clave"))
        self.assertEqual(caught.exception.status_code, 429)
        guardar.assert_not_awaited()

    async def test_the_table_store_calls_the_009_functions(self):
        llamadas = []

        async def pedir(metodo, url, **kwargs):
            llamadas.append((metodo, url.rsplit("/", 1)[-1], kwargs["json_payload"], kwargs["timeout"]))
            return httpx.Response(200, json={"cuenta": 3, "cuenta_origen": 2, "origen": 5})

        almacen = backend.intentos_acceso.IntentosEnTabla(
            pedir=pedir, url_base=lambda: "https://x.invalid/rest/v1/", cabeceras=lambda: {})
        self.assertEqual(await almacen.registrar("a" * 64, "b" * 64),
                         {"cuenta": 3, "cuenta_origen": 2, "origen": 5})
        await almacen.olvidar("a" * 64, "b" * 64)
        self.assertEqual(llamadas[1][2], {"p_clave": "a" * 64, "p_origen": "b" * 64})
        self.assertEqual([(m, f) for m, f, _, _ in llamadas],
                         [("POST", "registrar_intento"), ("POST", "olvidar_intentos")])
        self.assertEqual(llamadas[0][2]["p_minutos"], backend.intentos_acceso.VENTANA_MINUTOS)
        self.assertEqual(llamadas[0][3], backend.intentos_acceso.TIEMPO_LIMITE_S)

        async def rota(metodo, url, **kwargs):
            return httpx.Response(404, json={})

        with self.assertRaises(backend.intentos_acceso.IntentosNoDisponibles):
            await backend.intentos_acceso.IntentosEnTabla(
                pedir=rota, url_base=lambda: "https://x.invalid", cabeceras=lambda: {}).registrar("a" * 64, None)

    async def test_the_ai_proposal_reads_the_plan_and_writes_nothing(self):
        """Proponer solo lee: la propuesta vuelve con la tanda para aplicarla y deshacerla."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        agente = {"id": "1", "nombre": "Persona 1", "lat": -12.045, "lng": -77.1, "ubicacion": "resuelta"}
        plan = {"fecha": "2026-09-30", "existe": True, "rutas": [
            {"conductor": "K001", "turno": "06:00", "modalidad": "RECOJO", "sede": "TELEPERFORMANCE BELLAVISTA",
             "micro_zona": "BLL", "agentes": [agente]}]}
        with (
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value=plan)) as base,
            patch.object(backend, "_disponibilidad_del_dia", new=AsyncMock(return_value={})),
            patch.object(backend, "_cargar_flota", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as guardar,
        ):
            malo = await self._llamar("POST", "/api/programador/plan/proponer", token,
                                      json={"fecha": "2026-09-30", "objetivo": "barato"})
            bueno = await self._llamar("POST", "/api/programador/plan/proponer", token,
                                       json={"fecha": "2026-09-30", "objetivo": "tiempo"})
        self.assertEqual(malo.status_code, 400)
        self.assertEqual(bueno.status_code, 200)
        cuerpo = bueno.json()
        self.assertEqual(cuerpo["sede"], "TELEPERFORMANCE BELLAVISTA")
        self.assertEqual(cuerpo["objetivo"], "tiempo")
        self.assertEqual(cuerpo["propuesta"]["unidades"], 1)
        self.assertTrue(all(c["accion"] in ("mover", "ordenar") for c in cuerpo["cambios"]))
        self.assertTrue(cuerpo["deshacer"])
        self.assertEqual({c.args[0] for c in base.await_args_list}, {"leer_programacion"})
        guardar.assert_not_awaited()

    async def test_the_ai_proposal_needs_a_plan_and_a_known_site(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        otra_sede = {"existe": True, "rutas": [{"conductor": "K001", "turno": "06:00", "modalidad": "RECOJO",
                                                "sede": "OTRA", "agentes": [{"id": "1"}]}]}
        # «Hoy» fijo: con la fecha del reloj, la prueba caducó el 1 de octubre,
        # cuando el 30 de septiembre pasó a ser un día ya ejecutado.
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 30)),
            patch.object(backend, "_cargar_flota", new=AsyncMock()),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={"existe": False})),
        ):
            sin_plan = await self._llamar("POST", "/api/programador/plan/proponer", token,
                                          json={"fecha": "2026-09-30"})
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 30)),
            patch.object(backend, "_cargar_flota", new=AsyncMock()),
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value=otra_sede)),
        ):
            sin_sede = await self._llamar("POST", "/api/programador/plan/proponer", token,
                                          json={"fecha": "2026-09-30"})
        self.assertEqual(sin_plan.status_code, 409)
        self.assertEqual(sin_sede.status_code, 409)
        self.assertIn("Bellavista", sin_sede.json()["detail"])

    async def test_applying_a_proposal_accepts_only_moves_and_orders_and_is_logged(self):
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        mover = {"accion": "mover", "dni": "1", "desde": {"vehiculo": "K001", "turno": "06:00", "modalidad": "RECOJO"},
                 "hacia": {"vehiculo": "K002", "turno": "06:00", "modalidad": "RECOJO"}}
        with (
            patch.object(backend, "_hoy_en_lima", return_value=backend.date(2026, 9, 30)),
            patch.object(backend, "_rpc_programador", new=AsyncMock(
                return_value={"fecha": "2026-09-30", "aplicados": 1, "ignorados": 0})) as base,
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            colada = await self._llamar("POST", "/api/programador/plan/aplicar-propuesta", token, json={
                "fecha": "2026-09-30", "cambios": [mover, {"accion": "retirar", "dni": "2"}]})
            vacia = await self._llamar("POST", "/api/programador/plan/aplicar-propuesta", token,
                                       json={"fecha": "2026-09-30", "cambios": []})
            buena = await self._llamar("POST", "/api/programador/plan/aplicar-propuesta", token,
                                       json={"fecha": "2026-09-30", "cambios": [mover]})
            deshecha = await self._llamar("POST", "/api/programador/plan/aplicar-propuesta", token,
                                          json={"fecha": "2026-09-30", "cambios": [mover], "deshacer": True})
        self.assertEqual(colada.status_code, 400)
        self.assertEqual(vacia.status_code, 400)
        self.assertEqual(buena.status_code, 200)
        self.assertEqual(deshecha.status_code, 200)
        base.assert_awaited_with("editar_programacion", {"dia": "2026-09-30", "cambios": [mover]}, write=True)
        acciones = [a.get("action_type") for a in backend.actividad_db[-2:]]
        self.assertEqual(acciones, ["Propuesta de la IA aplicada", "Propuesta de la IA deshecha"])

    async def test_the_plan_brings_the_model_estimate_next_to_the_measured_duration(self):
        """La estimación va aparte de `duracion`, y si no hay no rompe el plan."""
        backend.AUTH_ENFORCED = True
        _, token = await self._sesion("prog@k.com", rol="Programador de rutas")
        rutas = [{"conductor": "K027", "turno": "06:00", "modalidad": "RECOJO", "agentes": [],
                  "duracion": {"p50": 60, "p90": 80, "casos": 9}},
                 {"conductor": "K028", "turno": "07:00", "modalidad": "RECOJO", "agentes": []}]
        estimaciones = [{"minutos": 55, "desde": 40, "hasta": 70}, None]
        with (
            patch.object(backend, "_rpc_programador", new=AsyncMock(return_value={
                "fecha": "2026-09-30", "existe": True, "rutas": rutas, "dias_con_plan": []})),
            patch.object(backend, "_disponibilidad_del_dia", new=AsyncMock(return_value={})),
            patch.object(backend.estimador_duracion, "estimar", side_effect=estimaciones) as estimar,
        ):
            respuesta = await self._llamar("GET", "/api/programador/plan?fecha=2026-09-30", token)
        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()["rutas"]
        self.assertEqual(cuerpo[0]["estimacion"], {"minutos": 55, "desde": 40, "hasta": 70})
        self.assertEqual(cuerpo[0]["duracion"], {"p50": 60, "p90": 80, "casos": 9})
        self.assertIsNone(cuerpo[1]["estimacion"])
        self.assertEqual(estimar.call_args_list[0].args[1], "2026-09-30")


class EstimadorDuracionTestCase(unittest.TestCase):
    """El modelo de duración: mismas características al entrenar y al estimar."""

    def setUp(self):
        self.est = backend.estimador_duracion
        self.est._predecir.cache_clear()
        self.addCleanup(self.est._predecir.cache_clear)

    def _modelo_falso(self, p50=60.0, p10=45.0, p90=80.0, falla=False):
        def aplicar(valor):
            def apply_catboost_model(numeros, textos):
                if falla:
                    raise ValueError("modelo roto")
                return valor
            return type("Modelo", (), {"apply_catboost_model": staticmethod(apply_catboost_model)})
        meta = {
            "ensanche": {"RECOJO": 5.0, "SALIDA": 3.0},
            "casos": {"VEN1|RECOJO|00:00": 3, "VEN1|SALIDA|22:01": 40},
            "prueba": {"banda": {"RECOJO": 80, "SALIDA": 77}, "a_tiempo": {"RECOJO": 87},
                       "error_por_confianza": {"baja": 21.8, "alta": 15.7}},
            "entrenado_el": "2026-09-29",
        }
        return type("Paquete", (), {"META": meta, "p50": aplicar(p50), "p10": aplicar(p10), "p90": aplicar(p90)})

    def _ruta(self, **cambios):
        ruta = {"conductor": "K027", "micro_zona": "VEN1", "turno": "00:00", "modalidad": "RECOJO",
                "sede": "TELEPERFORMANCE BELLAVISTA", "agentes": [
                    {"ubicacion": "resuelta", "lat": -12.0, "lng": -77.0},
                    {"ubicacion": "resuelta", "lat": "-12.0", "lng": "-77.01"},
                    {"ubicacion": "dudosa", "lat": -12.5, "lng": -77.5},
                    {"ubicacion": "resuelta", "lat": "", "lng": None}]}
        return {**ruta, **cambios}

    def test_texts_lose_accents_and_broken_characters_before_the_hash(self):
        """El hash de una «Ñ» no coincidía con el de CatBoost."""
        self.assertEqual(self.est.normalizar("BREÑA"), "BRENA")
        self.assertEqual(self.est.normalizar(" ate "), "ATE")
        self.assertEqual(self.est.normalizar("BREÃ‘A"), "BREAA")
        self.assertEqual(self.est.normalizar(None), "NA")
        self.assertEqual(self.est.normalizar(""), "NA")

    def test_the_route_is_measured_in_a_straight_line_between_resolved_homes(self):
        km, extension = self.est.recorrido([(-12.0, -77.0), (-12.0, -77.01)])
        self.assertAlmostEqual(km, 1.09, places=2)
        self.assertAlmostEqual(extension, 1.09, places=2)
        self.assertEqual(self.est.recorrido([]), (0.0, 0.0))
        self.assertEqual(self.est.recorrido([(-12.0, -77.0)]), (0.0, 0.0))

    def test_a_plan_service_has_the_shape_of_a_training_sample(self):
        muestra = self.est.muestra_del_plan(self._ruta(), "2026-09-26")
        self.assertEqual(muestra["dia_semana"], 6)  # sábado
        self.assertEqual(muestra["cobertura"], "VEN1")
        self.assertEqual(muestra["vehiculo"], "K027")
        self.assertEqual(muestra["programados"], 4)
        # Ni la dudosa ni la que no tiene punto entran en el recorrido.
        self.assertEqual(muestra["paradas_ubicadas"], 2)
        self.assertAlmostEqual(muestra["km"], 1.09, places=2)
        self.assertIsNone(self.est.muestra_del_plan(self._ruta(), "no es fecha"))

    def test_features_come_in_a_fixed_order_and_in_catboost_precision(self):
        numeros, textos = self.est.caracteristicas(self.est.muestra_del_plan(self._ruta(), "2026-09-26"))
        self.assertEqual(len(numeros), len(self.est.NUMERICAS))
        self.assertEqual(textos, ("RECOJO", "TELEPERFORMANCE BELLAVISTA", "VEN1", "00:00", "K027", "6"))
        self.assertEqual(numeros[0], 0.0)
        self.assertEqual(numeros[3], 0.5)
        self.assertEqual(numeros[4], self.est._en_float32(1.09))
        self.assertIsNone(self.est.caracteristicas({"turno": "mañana"}))
        self.assertIsNone(self.est.caracteristicas({"turno": "25:00"}))

    def test_a_salida_is_measured_from_leaving_the_site(self):
        salida = {"modalidad": "SALIDA", "inicio": -40, "primer_punto": 0, "llegada": 45}
        recojo = {"modalidad": "RECOJO", "inicio": -95, "primer_punto": -72, "llegada": -26}
        self.assertEqual(self.est.duracion_observada(salida), 45)
        self.assertEqual(self.est.duracion_observada(recojo), 69)
        self.assertIsNone(self.est.duracion_observada({**recojo, "llegada": -93}))
        self.assertIsNone(self.est.duracion_observada({**recojo, "llegada": None}))

    def test_without_a_model_there_is_no_estimate(self):
        with patch.object(self.est, "_modelo", return_value=None):
            self.assertIsNone(self.est.estimar(self._ruta(), "2026-09-26"))

    def test_a_recojo_says_when_to_leave_with_the_calibrated_band(self):
        with patch.object(self.est, "_modelo", return_value=self._modelo_falso()):
            estimacion = self.est.estimar(self._ruta(), "2026-09-26")
        self.assertEqual((estimacion["minutos"], estimacion["desde"], estimacion["hasta"]), (60, 40, 85))
        # Turno de las 00:00 y hasta 85 minutos: salir la víspera.
        self.assertEqual(estimacion["salir_antes"], "22:35")
        self.assertEqual(estimacion["a_tiempo"], 87)
        self.assertEqual(estimacion["acierto_banda"], 80)
        self.assertEqual((estimacion["casos"], estimacion["confianza"]), (3, "baja"))
        self.assertEqual(estimacion["error_medio"], 21.8)
        self.assertNotIn("ultima_entrega", estimacion)

    def test_a_salida_says_when_the_last_drop_off_is(self):
        ruta = self._ruta(modalidad="SALIDA", turno="22:01")
        with patch.object(self.est, "_modelo", return_value=self._modelo_falso(p50=50.0)):
            estimacion = self.est.estimar(ruta, "2026-09-26")
        self.assertEqual(estimacion["ultima_entrega"], "22:51")
        self.assertEqual((estimacion["casos"], estimacion["confianza"]), (40, "alta"))
        self.assertNotIn("salir_antes", estimacion)

    def test_a_failing_model_never_breaks_the_plan(self):
        with (
            patch.object(self.est, "_modelo", return_value=self._modelo_falso(falla=True)),
            self.assertLogs(self.est.logger, level="ERROR"),
        ):
            self.assertIsNone(self.est.estimar(self._ruta(), "2026-09-26"))

    def test_the_band_always_contains_the_estimate(self):
        minutos, desde, hasta = self.est.banda_calibrada(30.0, 40.0, 25.0, 2.0)
        self.assertLessEqual(desde, minutos)
        self.assertLessEqual(minutos, hasta)
        self.assertEqual(self.est.banda_calibrada(1.0, 0.0, 2.0, 0.0)[0], self.est.DURACION_MINIMA)

    def test_the_health_check_says_whether_the_model_shipped(self):
        """Sin esto, un despliegue sin el paquete del modelo no lo señalaría nada."""
        self.assertEqual(backend.read_root()["estimacion_duracion"], self.est.disponible())
        with patch.object(self.est.importlib.util, "find_spec", return_value=None):
            self.assertFalse(self.est.disponible())

    def test_the_exported_model_loads_and_gives_plausible_minutes(self):
        """El modelo que va a producción, no uno falso."""
        paquete = self.est._modelo()
        if paquete is None:
            self.skipTest("No hay modelo exportado en api/modelo_duracion.")
        for clave in ("ensanche", "casos", "prueba", "entrenado_el"):
            self.assertIn(clave, paquete.META)
        estimacion = self.est.estimar(self._ruta(), "2026-09-26")
        self.assertLess(self.est.DURACION_MINIMA, estimacion["minutos"])
        self.assertLess(estimacion["minutos"], self.est.DURACION_MAXIMA)
        self.assertLessEqual(estimacion["desde"], estimacion["minutos"])
        self.assertLessEqual(estimacion["minutos"], estimacion["hasta"])


class _YaExiste(Exception):
    """Lo que en Postgres es el `PT409` de `si_ausente`."""


def _aplicar_como_postgres(fila, cambios):
    """Lo que hace `guardar_estado()` (008), para simular la base en las pruebas.

    La función de verdad se prueba contra Postgres con
    `scripts/probar_guardar_estado.py`; esto solo necesita comportarse igual.
    Un `null` de JSON cuenta como ausente, como allí.
    """
    estado = copy.deepcopy(fila)

    def leer(ruta):
        nodo = estado
        for tramo in ruta:
            if not isinstance(nodo, dict) or tramo not in nodo:
                return None
            nodo = nodo[tramo]
        return nodo

    for op in cambios.get("quitar", []):
        if "si_vale" in op and leer(op["ruta"]) != op["si_vale"]:
            continue
        padre = leer(op["ruta"][:-1]) if len(op["ruta"]) > 1 else estado
        if isinstance(padre, dict):
            padre.pop(op["ruta"][-1], None)
    for op in cambios.get("poner", []):
        if "si_existe" in op and not isinstance(leer(op["si_existe"]), dict):
            continue
        actual = leer(op["ruta"])
        if op.get("si_ausente") and actual is not None and actual != op["valor"]:
            raise _YaExiste(op["ruta"])
        if op.get("si_libre") and actual is not None and actual != op["valor"]:
            continue
        nodo = estado
        for tramo in op["ruta"][:-1]:
            nodo = nodo.setdefault(tramo, {})
        nodo[op["ruta"][-1]] = copy.deepcopy(op["valor"])
    for lista in cambios.get("listas", []):
        # Los elementos sin `id` de la base se conservan, como en la función.
        def id_de(e):
            return json.dumps(e.get("id")) if isinstance(e, dict) and e.get("id") is not None else None
        nuevos = {id_de(e): e for e in lista["poner"]}
        quitar = {json.dumps(i) for i in lista["quitar"]}
        actual = estado.get(lista["clave"]) or []
        vistos = {id_de(e) for e in actual} - {None}
        fusion = [nuevos.get(id_de(e), e) if id_de(e) else e for e in actual
                  if id_de(e) is None or id_de(e) not in quitar]
        fusion += [e for e in lista["poner"] if id_de(e) not in vistos]
        estado[lista["clave"]] = fusion
    return estado


class EscrituraPorDiferenciasTestCase(unittest.IsolatedAsyncioTestCase):
    """Guardar escribe lo que cambió, no la fila entera (ver `escritura_estado.py`).

    Antes cada guardado reescribía `app_state.usuarios` desde la copia en
    memoria de la instancia, y dos instancias se pisaban en silencio.
    """

    CUENTA = {"identifier": "ana@kapital.com", "email": "ana@kapital.com", "dni": "11111111",
              "password": "pbkdf2_sha256$1$sal$hash-de-ana", "unidad_id": "K-001",
              "nombre": "Ana", "rol": "Conductor", "estado": "Pendiente Revisión",
              "perfil_conductor": {"direccion": "Calle 1", "documentos": {"dni": "a.pdf"}}}

    def setUp(self):
        self._storage_config = backend.STORAGE_CONFIG
        self._globales = {nombre: copy.deepcopy(getattr(backend, nombre)) for nombre in (
            "usuarios_db", "conductores_db", "notifications_db", "actividad_db",
            "rutas_estado_actual", "routes_summary", "historial_rutas", "board_lock", "db_loaded",
            "AUTH_ENFORCED")}
        # Aquí se prueba la escritura; la sesión tiene sus propias pruebas.
        backend.AUTH_ENFORCED = False
        backend._reset_db_runtime_state()
        backend._activate_storage_config(backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-compat.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        }))
        self.fila = {
            "ana@kapital.com": copy.deepcopy(self.CUENTA),
            "beto@kapital.com": {"identifier": "beto@kapital.com", "email": "beto@kapital.com",
                                 "nombre": "Beto", "rol": "Conductor", "estado": "Activo"},
            "__flota__": {"K-001": {"capacidad": 4, "chofer": "Ana"},
                          "K-002": {"capacidad": 6, "chofer": "Beto"}},
            "__notifications__": [{"id": 1, "message": "uno"}, {"id": 2, "message": "dos"}],
            "__actividad__": [{"id": "act_1", "action_type": "Alta"}],
            "__login__": {"ana@kapital.com": "ana@kapital.com", "11111111": "ana@kapital.com",
                          "beto@kapital.com": "beto@kapital.com"},
            "__routes_summary__": [], "__historial_rutas__": [], "__lock__": {},
        }
        self.rutas = []
        self.escrituras = []
        # Para simular lo que otra instancia —u otra petición de esta— hace
        # justo antes o justo después de que la escritura llegue a la base.
        self.antes_de_escribir = None
        self.despues_de_escribir = None

    def tearDown(self):
        backend._reset_db_runtime_state()
        for nombre, valor in self._globales.items():
            setattr(backend, nombre, valor)
        backend._activate_storage_config(self._storage_config)

    async def _pedir(self, metodo, url, *, operation, headers, timeout,
                     json_payload=None, failure_detail=None):
        """PostgREST de mentira sobre `self.fila`, con `guardar_estado` como en Postgres."""
        if metodo == "GET":
            return httpx.Response(200, json=[{"usuarios": copy.deepcopy(self.fila),
                                              "rutas": copy.deepcopy(self.rutas)}])
        self.assertEqual(metodo, "POST")
        self.assertTrue(url.endswith("/rpc/guardar_estado"), url)
        self.escrituras.append(json_payload["p_cambios"])
        if self.antes_de_escribir:
            self.antes_de_escribir()
        try:
            self.fila = _aplicar_como_postgres(self.fila, json_payload["p_cambios"])
        except _YaExiste:
            return httpx.Response(409, json={"code": "PT409"})
        if "rutas" in json_payload["p_cambios"]:
            self.rutas = json_payload["p_cambios"]["rutas"]
        if self.despues_de_escribir:
            self.despues_de_escribir()
        return httpx.Response(200, json={"aplicados": 1, "omitidos": 0})

    async def _cargar(self):
        with patch.object(backend, "_db_http_request", new=self._pedir):
            await backend.reload_db(force=True)

    async def _guardar(self, persistir=None):
        with patch.object(backend, "_db_http_request", new=self._pedir):
            await (persistir or backend.persist_users_only)()

    async def test_two_instances_editing_different_accounts_keep_both_changes(self):
        """El caso que se perdía: dos guardados cercanos desde copias distintas."""
        await self._cargar()
        # Otra instancia aprueba a Beto después de que esta leyera.
        self.fila["beto@kapital.com"]["estado"] = "Rechazado"
        # Esta, con su copia de hace un rato, cambia a Ana.
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"
        await self._guardar()

        self.assertEqual(self.fila["ana@kapital.com"]["estado"], "Activo")
        self.assertEqual(self.fila["beto@kapital.com"]["estado"], "Rechazado",
                         "el cambio de la otra instancia no puede deshacerse")

    async def test_two_instances_editing_the_same_account_keep_both_fields(self):
        await self._cargar()
        self.fila["ana@kapital.com"]["perfil_conductor"]["documentos"]["licencia"] = "b.pdf"
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"
        await self._guardar()

        self.assertEqual(self.fila["ana@kapital.com"]["estado"], "Activo")
        self.assertEqual(self.fila["ana@kapital.com"]["perfil_conductor"]["documentos"],
                         {"dni": "a.pdf", "licencia": "b.pdf"})

    async def test_only_the_changed_field_travels(self):
        await self._cargar()
        backend.usuarios_db["ana@kapital.com"]["perfil_conductor"]["direccion"] = "Calle 2"
        await self._guardar()

        (cambios,) = self.escrituras
        self.assertEqual(cambios["poner"], [{
            "ruta": ["ana@kapital.com", "perfil_conductor", "direccion"],
            "valor": "Calle 2",
            "si_existe": ["ana@kapital.com", "perfil_conductor"],
        }] + [op for op in cambios["poner"] if op["ruta"][0] == "__login__"])
        self.assertNotIn("quitar", cambios)

    async def test_an_account_deleted_elsewhere_is_not_resurrected_by_a_stale_edit(self):
        await self._cargar()
        del self.fila["beto@kapital.com"]  # otra instancia la borró
        backend.usuarios_db["beto@kapital.com"]["estado"] = "Inactivo"
        await self._guardar()

        self.assertNotIn("beto@kapital.com", self.fila, "ni entera ni a medias")

    async def test_a_new_account_goes_whole_and_gets_its_login_aliases(self):
        await self._cargar()
        backend.usuarios_db["caro@kapital.com"] = {
            "identifier": "caro@kapital.com", "email": "caro@kapital.com", "dni": "22222222",
            "rol": "Cliente", "estado": "Activo"}
        await self._guardar()

        self.assertEqual(self.fila["caro@kapital.com"]["dni"], "22222222")
        self.assertEqual(self.fila["__login__"]["22222222"], "caro@kapital.com")
        self.assertEqual(self.fila["__login__"]["11111111"], "ana@kapital.com", "el resto intacto")

    async def test_an_alias_already_taken_is_not_stolen(self):
        await self._cargar()
        backend.usuarios_db["ana2@kapital.com"] = {
            "identifier": "ana2@kapital.com", "dni": "11111111", "rol": "Cliente"}
        await self._guardar()
        self.assertEqual(self.fila["__login__"]["11111111"], "ana@kapital.com")

    async def test_deleting_an_account_removes_it_and_only_its_aliases(self):
        await self._cargar()
        del backend.usuarios_db["ana@kapital.com"]
        await self._guardar()

        self.assertNotIn("ana@kapital.com", self.fila)
        self.assertNotIn("11111111", self.fila["__login__"])
        self.assertEqual(self.fila["__login__"]["beto@kapital.com"], "beto@kapital.com")

    async def test_a_changed_email_moves_its_alias(self):
        await self._cargar()
        backend.usuarios_db["ana@kapital.com"]["email"] = "ana.nueva@kapital.com"
        backend.usuarios_db["ana@kapital.com"]["identifier"] = "ana.nueva@kapital.com"
        await self._guardar()

        self.assertEqual(self.fila["__login__"]["ana.nueva@kapital.com"], "ana@kapital.com")
        # La clave de la cuenta sigue siendo un alias suyo, así que se queda.
        self.assertEqual(self.fila["__login__"]["ana@kapital.com"], "ana@kapital.com")

    async def test_fleet_is_written_unit_by_unit(self):
        await self._cargar()
        self.fila["__flota__"]["K-002"]["capacidad"] = 8  # otra instancia
        backend.conductores_db["K-001"]["capacidad"] = 5
        backend.conductores_db["K-003"] = {"capacidad": 2, "tipo": "Moto"}
        await self._guardar(backend.persist)

        self.assertEqual(self.fila["__flota__"]["K-001"]["capacidad"], 5)
        self.assertEqual(self.fila["__flota__"]["K-002"]["capacidad"], 8)
        self.assertEqual(self.fila["__flota__"]["K-003"]["tipo"], "Moto")

    async def test_notifications_added_on_two_instances_both_survive(self):
        await self._cargar()
        self.fila["__notifications__"].append({"id": 3, "message": "de la otra instancia"})
        backend.notifications_db.append({"id": 4, "message": "de esta"})
        backend.notifications_db[0]["leido"] = True
        await self._guardar()

        self.assertEqual([n["id"] for n in self.fila["__notifications__"]], [1, 2, 3, 4])
        self.assertTrue(self.fila["__notifications__"][0]["leido"])

    async def test_trimming_a_list_removes_only_what_this_instance_trimmed(self):
        await self._cargar()
        self.fila["__notifications__"].append({"id": 3, "message": "de la otra instancia"})
        backend.notifications_db.pop(0)
        await self._guardar()
        self.assertEqual([n["id"] for n in self.fila["__notifications__"]], [2, 3])

    async def test_activity_logged_without_reading_the_history_is_appended_not_replaced(self):
        """Registrar una acción sin haber cargado el historial no lo vacía."""
        with patch.object(backend, "_db_http_request", new=self._pedir):
            await backend._load_compat_users(force=True)
        backend.actividad_db = []  # esta instancia nunca leyó el historial
        backend.registrar_actividad("Usuario aprobado", actor_respaldo="prueba")
        await self._guardar()

        self.assertEqual(len(self.fila["__actividad__"]), 2)
        self.assertEqual(self.fila["__actividad__"][0]["id"], "act_1")

    async def test_reserved_keys_never_read_are_never_written(self):
        """Una instancia que solo cargó las cuentas no puede vaciar la flota."""
        with patch.object(backend, "_db_http_request", new=self._pedir):
            await backend._load_compat_users(force=True)
        backend.conductores_db = {}
        backend.notifications_db = []
        backend.routes_summary = []
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"
        await self._guardar(backend.persist)

        self.assertEqual(len(self.fila["__flota__"]), 2)
        self.assertEqual(len(self.fila["__notifications__"]), 2)
        (cambios,) = self.escrituras
        self.assertNotIn("rutas", cambios, "la columna de rutas no se leyó")

    async def test_a_partial_users_read_cannot_become_a_mass_deletion(self):
        """Si la memoria se queda con menos cuentas, la base se queda igual de corta."""
        await self._cargar()
        backend.usuarios_db = {"ana@kapital.com": backend.usuarios_db["ana@kapital.com"]}
        backend._recordar_base_de_cuentas(backend.usuarios_db)
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"
        await self._guardar()
        self.assertIn("beto@kapital.com", self.fila)

    async def test_an_implausible_mass_deletion_is_refused(self):
        await self._cargar()
        for n in range(backend.escritura_estado.MAX_BORRADOS + 5):
            backend._recordar_base({f"fantasma{n}@kapital.com": {"rol": "Conductor"}})
        with self.assertRaises(HTTPException) as caught:
            await self._guardar()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(self.escrituras, [], "nada llega a la base")

    async def test_nothing_changed_means_no_write(self):
        await self._cargar()
        await self._guardar()
        self.assertEqual(self.escrituras, [])

    async def test_a_second_save_does_not_resend_the_first(self):
        await self._cargar()
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"
        await self._guardar()
        # Otra instancia la vuelve a cambiar; esta guarda otra cosa.
        self.fila["ana@kapital.com"]["estado"] = "Inactivo"
        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()

        self.assertEqual(self.fila["ana@kapital.com"]["estado"], "Inactivo")
        self.assertEqual(self.fila["beto@kapital.com"]["nombre"], "Roberto")

    async def test_a_failed_write_is_a_503_and_is_retried_next_time(self):
        await self._cargar()
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"

        async def caida(*args, **kwargs):
            return httpx.Response(500, json={"message": "secreto del proveedor"})

        with patch.object(backend, "_db_http_request", new=caida):
            with self.assertRaises(HTTPException) as caught:
                await backend.persist_users_only()
        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_WRITE_UNAVAILABLE_DETAIL)

        await self._guardar()
        self.assertEqual(self.fila["ana@kapital.com"]["estado"], "Activo",
                         "lo que no se escribió sigue pendiente")

    async def test_routes_column_is_written_whole_only_after_reading_it(self):
        await self._cargar()
        backend.rutas_estado_actual = [{"conductor": "K-001", "agentes": []}]
        await self._guardar(backend.persist)
        self.assertEqual(self.rutas, [{"conductor": "K-001", "agentes": []}])

    # --- Hallazgos de la revisión --------------------------------------------------------

    async def test_reviewing_a_document_on_a_cold_instance_keeps_the_account(self):
        """En frío, el conductor no estaba en memoria y se guardaba una cuenta vacía encima."""
        self.fila["admin@kapital.com"] = {"identifier": "admin@kapital.com", "rol": "Administración",
                                          "nombre": "Admin", "estado": "Activo"}
        with patch.object(backend, "_db_http_request", new=self._pedir):
            await backend.review_driver_doc(backend.DriverDocReviewPayload(
                admin_email="admin@kapital.com", conductor_email="ana@kapital.com",
                campo="dniScaneado", estado="rechazado", nota="Borroso"))

        ana = self.fila["ana@kapital.com"]
        self.assertEqual(ana["password"], self.CUENTA["password"], "la contraseña sigue ahí")
        self.assertEqual(ana["dni"], "11111111")
        self.assertEqual(ana["perfil_conductor"]["documentos"], {"dni": "a.pdf"})
        self.assertEqual(ana["perfil_conductor"]["revision_docs"]["dniScaneado"]["estado"], "rechazado")
        self.assertEqual(ana["estado"], "Documentos Observados")

    async def test_reviewing_a_document_of_an_unknown_driver_is_a_404_not_a_new_account(self):
        self.fila["admin@kapital.com"] = {"identifier": "admin@kapital.com", "rol": "Administración"}
        with patch.object(backend, "_db_http_request", new=self._pedir):
            with self.assertRaises(HTTPException) as caught:
                await backend.review_driver_doc(backend.DriverDocReviewPayload(
                    admin_email="admin@kapital.com", conductor_email="nadie@kapital.com",
                    campo="dniScaneado", estado="aprobado"))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.escrituras, [])

    async def test_a_new_account_that_already_exists_is_refused_not_overwritten(self):
        await self._cargar()
        # Otra instancia la creó después de que esta leyera.
        self.fila["zeta@kapital.com"] = {"identifier": "zeta@kapital.com", "password": "real"}
        backend.usuarios_db["zeta@kapital.com"] = {"identifier": "zeta@kapital.com", "rol": "Cliente"}
        backend.notifications_db.append({"id": 99, "message": "de esta"})
        with self.assertRaises(HTTPException) as caught:
            await self._guardar()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.fila["zeta@kapital.com"]["password"], "real")
        self.assertEqual(len(self.fila["__notifications__"]), 2, "nada del guardado se aplicó")

    async def test_a_read_that_slips_in_before_the_write_does_not_revert_it_later(self):
        """Una lectura con datos de antes de la escritura no puede quedar como base «nueva»."""
        await self._cargar()
        backend.usuarios_db["ana@kapital.com"]["estado"] = "Activo"

        def lectura_colada():
            # Lo que haría una carga que empezó antes de la escritura.
            backend.usuarios_db = {k: copy.deepcopy(v) for k, v in self.fila.items()
                                   if not k.startswith("__")}
            backend._recordar_base_de_cuentas(backend.usuarios_db)

        self.antes_de_escribir = lectura_colada
        await self._guardar()
        self.antes_de_escribir = None
        self.assertEqual(self.fila["ana@kapital.com"]["estado"], "Activo")

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()
        self.assertEqual(self.fila["ana@kapital.com"]["estado"], "Activo", "no se deshizo")
        self.assertEqual(self.fila["beto@kapital.com"]["nombre"], "Roberto")

    async def test_the_aliases_of_an_account_deleted_elsewhere_do_not_come_back(self):
        await self._cargar()
        del self.fila["ana@kapital.com"]
        self.fila["__login__"] = {k: v for k, v in self.fila["__login__"].items() if v != "ana@kapital.com"}
        backend.usuarios_db["ana@kapital.com"]["email"] = "ana.nueva@kapital.com"
        await self._guardar()
        self.assertNotIn("ana@kapital.com", self.fila)
        self.assertNotIn("ana.nueva@kapital.com", self.fila["__login__"])
        self.assertNotIn("ana@kapital.com", self.fila["__login__"])

    async def test_a_concurrent_edit_to_another_field_of_the_unit_is_not_a_503(self):
        """Los campos se fusionan: que otro cambie el chofer no invalida mi capacidad."""
        def otra_instancia():
            self.fila["__flota__"]["K-001"]["chofer"] = "Cambiado por otra instancia"

        self.despues_de_escribir = otra_instancia
        with patch.object(backend, "_db_http_request", new=self._pedir):
            respuesta = await backend.update_flota("K-001", backend.FlotaUpdate(capacidad=6))
        self.assertEqual(respuesta["unidad"]["capacidad"], 6)
        self.assertEqual(self.fila["__flota__"]["K-001"],
                         {"capacidad": 6, "chofer": "Cambiado por otra instancia"})

        # Y el siguiente guardado no deshace nada.
        self.despues_de_escribir = None
        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()
        self.assertEqual(self.fila["__flota__"]["K-001"]["capacidad"], 6)

    async def test_replacing_the_board_writes_it_even_on_a_cold_instance(self):
        tablero = [{"conductor": "K-001", "micro_zona": "SURCO", "horario": "08:00", "agentes": []}]
        with patch.object(backend, "_db_http_request", new=self._pedir):
            await backend.update_routes(tablero)
        self.assertEqual(self.rutas, tablero)

    async def test_a_list_element_without_id_in_the_base_survives_a_merge(self):
        self.fila["__notifications__"].insert(0, {"message": "antiguo, sin id"})
        await self._cargar()
        backend.notifications_db.append({"id": 3, "message": "nuevo"})
        await self._guardar()
        self.assertEqual(self.fila["__notifications__"][0], {"message": "antiguo, sin id"})
        self.assertEqual(self.fila["__notifications__"][-1]["id"], 3)

    # --- Segunda ronda de la revisión ------------------------------------------------------

    def _nueva_cuenta(self):
        backend.usuarios_db["caro@kapital.com"] = {
            "identifier": "caro@kapital.com", "email": "caro@kapital.com", "rol": "Cliente"}

    async def test_an_unrelated_read_during_a_creation_does_not_make_it_new_again(self):
        """Una lectura de avisos que se cuela no puede hacer que la cuenta recién creada choque luego."""
        await self._cargar()
        self._nueva_cuenta()
        self.antes_de_escribir = lambda: backend._recordar_base(
            {"__notifications__": copy.deepcopy(self.fila["__notifications__"])})
        await self._guardar()
        self.antes_de_escribir = None
        # Otra instancia la completa; si esta la creyera nueva otra vez, la
        # reenviaría entera y chocaría con esa versión.
        self.fila["caro@kapital.com"]["nombre"] = "Carolina"

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()  # antes: 409
        self.assertEqual(self.fila["caro@kapital.com"]["nombre"], "Carolina")
        self.assertEqual(self.fila["beto@kapital.com"]["nombre"], "Roberto")

    async def test_a_full_read_during_a_creation_does_not_delete_it_later(self):
        await self._cargar()
        self._nueva_cuenta()

        def lectura_completa_colada():
            # Empezó antes de la escritura: la cuenta nueva no está en lo que leyó.
            backend._olvidar_base_entera()
            backend._recordar_base(copy.deepcopy(self.fila))
            backend.usuarios_db = {k: copy.deepcopy(v) for k, v in self.fila.items()
                                   if not k.startswith("__")}

        self.antes_de_escribir = lectura_completa_colada
        await self._guardar()
        self.antes_de_escribir = None
        self.assertIn("caro@kapital.com", self.fila)

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()
        self.assertIn("caro@kapital.com", self.fila, "ni se borra ni choca")

    async def test_a_409_does_not_stick_nor_leak_the_failed_request(self):
        await self._cargar()
        self.fila["zeta@kapital.com"] = {"identifier": "zeta@kapital.com", "password": "real"}
        backend.usuarios_db["zeta@kapital.com"] = {"identifier": "zeta@kapital.com", "rol": "Cliente"}
        backend.notifications_db.append({"id": 99, "message": "de la petición que falla"})
        with self.assertRaises(HTTPException) as caught:
            await self._guardar()
        self.assertEqual(caught.exception.status_code, 409)

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()  # antes: 409 otra vez, y otra…
        self.assertEqual(self.fila["beto@kapital.com"]["nombre"], "Roberto")
        self.assertEqual(self.fila["zeta@kapital.com"], {"identifier": "zeta@kapital.com", "password": "real"})
        self.assertNotIn(99, [n["id"] for n in self.fila["__notifications__"]],
                         "lo de la petición fallida no se cuela en el guardado siguiente")

    def test_repeating_a_creation_is_not_a_conflict(self):
        """El cliente reintenta si se pierde la respuesta: la misma alta dos veces no es un 409."""
        cambios = {"poner": [{"ruta": ["caro@kapital.com"], "valor": {"rol": "Cliente"}, "si_ausente": True}]}
        una_vez = _aplicar_como_postgres(self.fila, cambios)
        dos_veces = _aplicar_como_postgres(una_vez, cambios)
        self.assertEqual(una_vez, dos_veces)
        with self.assertRaises(_YaExiste):
            _aplicar_como_postgres(una_vez, {"poner": [
                {"ruta": ["caro@kapital.com"], "valor": {"rol": "Otra"}, "si_ausente": True}]})

    async def test_a_failed_reread_after_deleting_a_unit_does_not_bring_it_back(self):
        await self._cargar()
        with (
            patch.object(backend, "_db_http_request", new=self._pedir),
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "_load_compat_fleet",
                         new=AsyncMock(side_effect=HTTPException(status_code=503, detail="caída"))),
        ):
            with self.assertRaises(HTTPException) as caught:
                await backend.delete_flota("K-002")
        self.assertEqual(caught.exception.status_code, 503)
        self.assertNotIn("K-002", self.fila["__flota__"])
        self.assertNotIn("K-002", backend.conductores_db, "no se deshace lo que sí se escribió")

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar(backend.persist)
        self.assertNotIn("K-002", self.fila["__flota__"], "y el siguiente guardado no la resucita")

    # --- Tercera ronda de la revisión ------------------------------------------------------

    async def test_a_users_read_during_a_creation_does_not_delete_it_later(self):
        """Una lectura de las cuentas que empezó antes del alta no la conoce, y no puede borrarla."""
        await self._cargar()
        self._nueva_cuenta()

        def lectura_de_cuentas_colada():
            backend.usuarios_db = {k: copy.deepcopy(v) for k, v in self.fila.items()
                                   if not k.startswith("__")}
            backend._recordar_base_de_cuentas(backend.usuarios_db)

        self.antes_de_escribir = lectura_de_cuentas_colada
        await self._guardar()
        self.antes_de_escribir = None
        self.assertIn("caro@kapital.com", self.fila)

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar()
        self.assertIn("caro@kapital.com", self.fila, "el siguiente guardado no la borra")

    async def test_two_admins_creating_the_same_driver_do_not_delete_each_others_account(self):
        """El 409 del segundo no puede deshacer en memoria lo que creó el primero."""
        la_del_primero = {"identifier": "40000001", "dni": "40000001", "rol": "Conductor",
                          "nombre": "Del primero", "password": "hash-del-primero", "unidad_id": "K-900"}

        def el_primero_guarda_antes():
            self.fila["40000001"] = copy.deepcopy(la_del_primero)
            self.fila["__flota__"]["K-900"] = {"capacidad": 4, "chofer": "Del primero"}

        self.antes_de_escribir = el_primero_guarda_antes
        with patch.object(backend, "_db_http_request", new=self._pedir):
            with self.assertRaises(HTTPException) as caught:
                await backend.add_flota(backend.FlotaRegistro(
                    padron="K-900", dni="40000001", password="provisional", capacidad=4,
                    tipo="AUTO", chofer="Del segundo"))
        self.antes_de_escribir = None
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(backend.usuarios_db["40000001"]["nombre"], "Del primero",
                         "la memoria tiene la cuenta real, no la vuelta atrás")

        backend.usuarios_db["beto@kapital.com"]["nombre"] = "Roberto"
        await self._guardar(backend.persist)
        self.assertEqual(self.fila["40000001"], la_del_primero)
        self.assertIn("K-900", self.fila["__flota__"])

    def test_the_diff_is_pure_and_symmetric(self):
        """Sin cambios, sin nada que hacer; y lo que calcula es exactamente la diferencia."""
        base = {"a@k.com": backend.escritura_estado.huella({"x": 1, "y": {"z": 2}})}
        cambios, base_nueva, sin_leer = backend.escritura_estado.calcular(
            base, {"a@k.com": {"x": 1, "y": {"z": 3}}}, alias_de=lambda clave, cuenta: [])
        self.assertEqual(sin_leer, [])
        self.assertEqual(cambios, {"poner": [
            {"ruta": ["a@k.com", "y", "z"], "valor": 3, "si_existe": ["a@k.com", "y"]}]})
        self.assertEqual(base_nueva["a@k.com"], backend.escritura_estado.huella({"x": 1, "y": {"z": 3}}))

        cambios, _, _ = backend.escritura_estado.calcular(
            base, {"a@k.com": {"x": 1, "y": {"z": 2}}}, alias_de=lambda clave, cuenta: [])
        self.assertTrue(backend.escritura_estado.vacio(cambios))


class NormalizedStorageTestCase(unittest.IsolatedAsyncioTestCase):
    """Exercise the opt-in relational adapter without contacting Supabase."""

    def setUp(self):
        self._storage_config = backend.STORAGE_CONFIG
        self._almacen_sesiones = backend.almacen_sesiones
        backend.almacen_sesiones = backend.sesiones.SesionesEnMemoria()
        self._almacen_intentos = backend.almacen_intentos
        backend.almacen_intentos = backend.intentos_acceso.IntentosEnMemoria()
        backend.sesiones_en_cache.clear()
        self._db_loaded = backend.db_loaded
        self._state = {
            "usuarios_db": copy.deepcopy(backend.usuarios_db),
            "conductores_db": copy.deepcopy(backend.conductores_db),
            "notifications_db": copy.deepcopy(backend.notifications_db),
            "rutas_estado_actual": copy.deepcopy(backend.rutas_estado_actual),
            "routes_summary": copy.deepcopy(backend.routes_summary),
            "historial_rutas": copy.deepcopy(backend.historial_rutas),
            "board_lock": copy.deepcopy(backend.board_lock),
        }
        backend._reset_db_runtime_state()
        backend._activate_storage_config(backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2",
            "KAPITAL_V2_SUPABASE_URL": "https://v2.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "sb_secret_test_key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "false",
        }))
        backend.usuarios_db.clear()
        backend.conductores_db.clear()
        backend.notifications_db.clear()
        backend.rutas_estado_actual = []
        backend.routes_summary = []
        backend.historial_rutas = []
        backend.board_lock = {}

    def tearDown(self):
        backend._reset_db_runtime_state()
        backend.db_loaded = self._db_loaded
        backend.usuarios_db.clear()
        backend.usuarios_db.update(self._state["usuarios_db"])
        backend.conductores_db.clear()
        backend.conductores_db.update(self._state["conductores_db"])
        backend.notifications_db.clear()
        backend.notifications_db.extend(self._state["notifications_db"])
        backend.rutas_estado_actual = self._state["rutas_estado_actual"]
        backend.routes_summary = self._state["routes_summary"]
        backend.historial_rutas = self._state["historial_rutas"]
        backend.board_lock = self._state["board_lock"]
        backend.actividad_db = self._state.get("actividad_db", backend.actividad_db)
        backend._activate_storage_config(self._storage_config)
        backend.almacen_sesiones = self._almacen_sesiones
        backend.almacen_intentos = self._almacen_intentos
        backend.sesiones_en_cache.clear()

    def _row_response(self, rows):
        return httpx.Response(200, json=rows)

    async def test_normalized_fetch_rows_paginates_three_pages_without_duplicates(self):
        pages = [
            httpx.Response(
                206,
                json=[{"assignment_id": f"assignment-{index}"} for index in range(1000)],
                headers={"Content-Range": "0-999/2645"},
            ),
            httpx.Response(
                206,
                json=[{"assignment_id": f"assignment-{index}"} for index in range(1000, 2000)],
                headers={"Content-Range": "1000-1999/2645"},
            ),
            httpx.Response(
                206,
                json=[{"assignment_id": f"assignment-{index}"} for index in range(2000, 2645)],
                headers={"Content-Range": "2000-2644/2645"},
            ),
        ]

        with patch.object(
            backend,
            "_db_http_request",
            new=AsyncMock(side_effect=pages),
        ) as request:
            rows = await backend.STORAGE_ADAPTER.fetch_rows(
                "route_passengers",
                select="assignment_id",
                operation="test_paged_route_passengers",
            )

        self.assertEqual(len(rows), 2645)
        self.assertEqual(
            [row["assignment_id"] for row in rows],
            [f"assignment-{index}" for index in range(2645)],
        )
        self.assertEqual(request.await_count, 3)
        self.assertEqual(
            [call.kwargs["headers"]["Range"] for call in request.await_args_list],
            ["0-999", "1000-1999", "2000-2999"],
        )
        for call in request.await_args_list:
            self.assertEqual(call.kwargs["headers"].get("Range-Unit"), "items")
            self.assertEqual(call.kwargs["headers"].get("Prefer"), "count=exact")
            self.assertEqual(call.kwargs["headers"].get("Accept-Profile"), "app")
            self.assertNotIn("Authorization", call.kwargs["headers"])

    async def test_normalized_fetch_rows_stops_on_exact_multiple(self):
        pages = [
            httpx.Response(
                206,
                json=[{"id": f"route-{index}"} for index in range(1000)],
                headers={"Content-Range": "0-999/2000"},
            ),
            httpx.Response(
                206,
                json=[{"id": f"route-{index}"} for index in range(1000, 2000)],
                headers={"Content-Range": "1000-1999/2000"},
            ),
        ]

        with patch.object(
            backend,
            "_db_http_request",
            new=AsyncMock(side_effect=pages),
        ) as request:
            rows = await backend.STORAGE_ADAPTER.fetch_rows(
                "routes",
                select="id",
                operation="test_exact_multiple_routes",
            )

        self.assertEqual(len(rows), 2000)
        self.assertEqual(request.await_count, 2)

    async def test_normalized_fetch_rows_fails_on_intermediate_page_error(self):
        pages = [
            httpx.Response(
                206,
                json=[{"assignment_id": f"assignment-{index}"} for index in range(1000)],
                headers={"Content-Range": "0-999/2645"},
            ),
            httpx.Response(503, json={"message": "provider detail must not escape"}),
        ]

        with patch.object(
            backend,
            "_db_http_request",
            new=AsyncMock(side_effect=pages),
        ) as request:
            with self.assertRaises(HTTPException) as caught:
                await backend.STORAGE_ADAPTER.fetch_rows(
                    "route_passengers",
                    select="assignment_id",
                    operation="test_intermediate_page_error",
                )

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)
        self.assertEqual(request.await_count, 2)

    async def test_normalized_fetch_rows_enforces_collection_limit(self):
        pages = [
            httpx.Response(
                206,
                json=[{"id": f"route-{index}"} for index in range(1000)],
                headers={"Content-Range": "0-999/*"},
            ),
            httpx.Response(
                206,
                json=[{"id": f"route-{index}"} for index in range(1000, 2000)],
                headers={"Content-Range": "1000-1999/*"},
            ),
        ]

        with patch.object(backend, "NORMALIZED_MAX_ROWS", 1500):
            with patch.object(
                backend,
                "_db_http_request",
                new=AsyncMock(side_effect=pages),
            ) as request:
                with self.assertRaises(HTTPException) as caught:
                    await backend.STORAGE_ADAPTER.fetch_rows(
                        "routes",
                        select="id",
                        operation="test_collection_limit",
                    )

        self.assertEqual(caught.exception.status_code, 503)
        self.assertEqual(caught.exception.detail, backend.DATABASE_UNAVAILABLE_DETAIL)
        self.assertEqual(request.await_count, 2)

    async def test_routes_endpoint_rebuilds_all_paged_assignments(self):
        route_rows = [
            {
                "id": f"route-{index}",
                "unit_id": f"UNIT-{index:03d}",
                "zone": f"Zone {index}",
                "schedule": "08:00",
                "status_code": "active",
            }
            for index in range(193)
        ]
        assignment_rows = [
            {
                "assignment_id": f"assignment-{index}",
                "route_id": f"route-{index % 193}",
                "passenger_id": "passenger-1",
                "assignment_order": index,
                "status_code": "active",
            }
            for index in range(2645)
        ]
        base_rows = {
            "app_users": [],
            "auth_credentials": [],
            "auth_sessions": [],
            "driver_profiles": [],
            "fleet_units": [],
            "routes": route_rows,
            "passengers": [{
                "id": "passenger-1",
                "legacy_identifier": "PAX-1",
                "full_name": "Passenger",
                "status_code": "active",
            }],
            "notifications": [],
            "route_history": [],
            "board_locks": [],
        }
        requested_ranges = []

        async def request(method, url, **kwargs):
            resource = url.split("/rest/v1/", 1)[1].split("?", 1)[0]
            self.assertEqual(method, "GET")
            self.assertEqual(kwargs["headers"].get("Accept-Profile"), "app")
            self.assertNotIn("Authorization", kwargs["headers"])
            if resource != "route_passengers":
                return self._row_response(base_rows.get(resource, []))

            range_header = kwargs["headers"].get("Range")
            self.assertIsNotNone(range_header)
            start_text, end_text = range_header.split("-", 1)
            start, end = int(start_text), int(end_text)
            requested_ranges.append(range_header)
            page = assignment_rows[start:min(end + 1, len(assignment_rows))]
            last = start + len(page) - 1
            content_range = f"{start}-{last}/{len(assignment_rows)}"
            return httpx.Response(
                206,
                json=page,
                headers={"Content-Range": content_range},
            )

        # Lo que se prueba es el paginado; la sesión tiene sus propias pruebas.
        with (
            patch.object(backend, "_db_http_request", new=AsyncMock(side_effect=request)),
            patch.object(backend, "AUTH_ENFORCED", False),
        ):
            transport = httpx.ASGITransport(app=backend.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/api/routes")

        self.assertEqual(response.status_code, 200)
        routes = response.json()

        self.assertEqual(len(routes), 193)
        self.assertEqual(sum(len(route["agentes"]) for route in routes), 2645)
        self.assertEqual(requested_ranges, ["0-999", "1000-1999", "2000-2999"])
        self.assertTrue(all(route["agentes"] for route in routes))

    async def test_normalized_snapshot_rebuilds_legacy_contract_without_documents(self):
        password_hash = backend.hash_password("safe-password", salt=b"0123456789abcdef")
        rows = {
            "app_users": [{
                "id": "00000000-0000-0000-0000-000000000001",
                "login_identifier": "driver@example.com",
                "login_identifier_sha256": "0" * 64,
                "role_code": "Conductor",
                "status_code": "active",
                "unit_id": "K-001",
                "display_name": "Driver Baseline",
                "email": "driver@example.com",
                "government_id": "DNI-001",
                "needs_password_change": False,
            }],
            "auth_credentials": [{
                "user_id": "00000000-0000-0000-0000-000000000001",
                "password_hash": password_hash,
                "password_scheme": "pbkdf2_sha256",
                "needs_reset": False,
            }],
            "auth_sessions": [],
            "driver_profiles": [{
                "user_id": "00000000-0000-0000-0000-000000000001",
                "document_number": "DNI-001",
                "vehicle_plate": "PLATE-001",
                "change_requests": {},
            }],
            "fleet_units": [{
                "unit_id": "K-001",
                "vehicle_type": "Sprinter",
                "capacity": 15,
                "driver_name": "Driver Baseline",
            }],
            "routes": [{
                "id": "00000000-0000-0000-0000-000000000010",
                "unit_id": "K-001",
                "zone": "Surco Sur",
                "schedule": "08:00",
                "status_code": "active",
            }],
            "passengers": [{
                "id": "00000000-0000-0000-0000-000000000020",
                "legacy_identifier": "PAX-001",
                "full_name": "Passenger Baseline",
                "status_code": "active",
            }],
            "route_passengers": [{
                "assignment_id": "00000000-0000-0000-0000-000000000030",
                "route_id": "00000000-0000-0000-0000-000000000010",
                "passenger_id": "00000000-0000-0000-0000-000000000020",
                "assignment_order": 0,
            }],
            "notifications": [{
                "id": "00000000-0000-0000-0000-000000000040",
                "notification_type": "info",
                "message": "Baseline",
                "audience_code": "admin",
            }],
            "route_history": [{
                "id": "00000000-0000-0000-0000-000000000050",
                "operation_code": "snapshot",
                "route_count": 1,
            }],
            "board_locks": [{"board_name": "routes", "version": 1}],
        }
        requested_resources = []

        async def request(method, url, **kwargs):
            resource = url.split("/rest/v1/", 1)[1].split("?", 1)[0]
            requested_resources.append(resource)
            headers = kwargs["headers"]
            self.assertEqual(headers.get("Accept-Profile"), "app")
            self.assertNotIn("Authorization", headers)
            return self._row_response(rows.get(resource, []))

        with patch.object(backend, "_db_http_request", new=AsyncMock(side_effect=request)):
            await backend.reload_db(force=True)

        self.assertEqual(set(requested_resources), set(rows))
        self.assertNotIn("driver_documents", requested_resources)
        self.assertIn("driver@example.com", backend.usuarios_db)
        self.assertTrue(backend.verify_password("safe-password", backend.usuarios_db["driver@example.com"]["password"]))
        self.assertEqual(backend.usuarios_db["driver@example.com"]["estado"], "Activo")
        self.assertEqual(backend.conductores_db["K-001"]["capacidad"], 15)
        self.assertEqual(backend.rutas_estado_actual[0]["agentes"][0]["id"], "PAX-001")
        self.assertEqual(backend.notifications_db[0]["message"], "Baseline")
        self.assertEqual(backend.historial_rutas[0]["operation"], "snapshot")

    async def test_normalized_login_loads_only_auth_bundle(self):
        password_hash = backend.hash_password("safe-password", salt=b"0123456789abcdef")
        user_id = "00000000-0000-0000-0000-000000000001"
        rows = {
            "app_users": [{
                "id": user_id,
                "login_identifier": "driver@example.com",
                "login_identifier_sha256": hashlib.sha256(b"driver@example.com").hexdigest(),
                "role_code": "Conductor",
                "status_code": "active",
                "email": "driver@example.com",
                "display_name": "Driver Baseline",
            }],
            "auth_credentials": [{
                "user_id": user_id,
                "password_hash": password_hash,
                "password_scheme": "pbkdf2_sha256",
                "needs_reset": False,
            }],
            "driver_profiles": [{"user_id": user_id, "change_requests": {}}],
            "auth_sessions": [],
        }
        requested_resources = []

        async def request(method, url, **kwargs):
            resource = url.split("/rest/v1/", 1)[1].split("?", 1)[0]
            requested_resources.append(resource)
            self.assertEqual(method, "GET")
            self.assertEqual(kwargs["headers"].get("Accept-Profile"), "app")
            self.assertNotIn("Authorization", kwargs["headers"])
            return self._row_response(rows.get(resource, []))

        with patch.object(backend, "_db_http_request", new=AsyncMock(side_effect=request)):
            user = await backend._load_normalized_login_user("driver@example.com")

        self.assertIsNotNone(user)
        self.assertTrue(backend.verify_password("safe-password", user["password"]))
        self.assertEqual(
            requested_resources,
            ["app_users", "auth_credentials", "driver_profiles", "auth_sessions"],
        )
        self.assertNotIn("routes", requested_resources)
        self.assertNotIn("passengers", requested_resources)
        self.assertNotIn("driver_documents", requested_resources)

    async def test_normalized_upserts_use_profiles_and_hash_plaintext_before_writing(self):
        backend.usuarios_db["new@example.com"] = {
            "identifier": "new@example.com",
            "password": "plain-password",
            "nombre": "New User",
            "rol": "Conductor",
            "estado": "Activo",
        }
        client = AsyncMock()
        client.return_value = httpx.Response(204)

        with patch.object(backend, "_db_http_request", new=AsyncMock(return_value=httpx.Response(204))) as request:
            await backend._persist_normalized_state("test")

        resources = [call.args[1].split("/rest/v1/", 1)[1].split("?", 1)[0] for call in request.await_args_list]
        self.assertIn("app_users", resources)
        self.assertIn("auth_credentials", resources)
        for call in request.await_args_list:
            self.assertEqual(call.kwargs["headers"].get("Content-Profile"), "app")
            self.assertNotIn("Accept-Profile", call.kwargs["headers"])
            self.assertNotIn("Authorization", call.kwargs["headers"])
        credentials_call = next(
            call for call in request.await_args_list
            if "/auth_credentials?" in call.args[1]
        )
        credential = credentials_call.kwargs["json_payload"][0]
        self.assertTrue(credential["password_hash"].startswith("pbkdf2_sha256$"))
        self.assertEqual(credential["password_scheme"], "pbkdf2_sha256")

    async def test_normalized_user_persist_does_not_reupload_route_graph(self):
        backend.usuarios_db["new@example.com"] = {
            "identifier": "new@example.com",
            "password": "plain-password",
            "nombre": "New User",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.conductores_db["K-001"] = {"capacidad": 15}
        backend.rutas_estado_actual = [{
            "conductor": "K-001",
            "micro_zona": "Surco",
            "horario": "08:00",
            "agentes": [{"id": "PAX-001", "nombre": "Passenger"}],
        }]

        with patch.object(backend, "_db_http_request", new=AsyncMock(return_value=httpx.Response(204))) as request:
            await backend._persist_normalized_state("persist_users")

        resources = {
            call.args[1].split("/rest/v1/", 1)[1].split("?", 1)[0]
            for call in request.await_args_list
        }
        self.assertIn("app_users", resources)
        self.assertIn("auth_credentials", resources)
        self.assertNotIn("fleet_units", resources)
        self.assertNotIn("routes", resources)
        self.assertNotIn("passengers", resources)
        self.assertNotIn("route_passengers", resources)

    async def test_normalized_read_only_blocks_writes_before_http(self):
        read_only = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2",
            "KAPITAL_V2_SUPABASE_URL": "https://v2-read-only.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "sb_secret_test_key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "true",
        })
        backend._activate_storage_config(read_only)
        backend.usuarios_db["user@example.com"] = {
            "identifier": "user@example.com",
            "password": "safe-password",
            "nombre": "User",
            "rol": "Conductor",
            "estado": "Activo",
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(HTTPException) as caught:
                await backend._persist_normalized_state("read_only")

        self.assertEqual(caught.exception.status_code, 503)
        client.post.assert_not_awaited()

    async def test_normalized_partial_loaders_use_small_profiled_resources(self):
        backend._notifications_cache_loaded_at = 0.0
        backend._routes_summary_cache_loaded_at = 0.0

        async def request(method, url, **kwargs):
            resource = url.split("/rest/v1/", 1)[1].split("?", 1)[0]
            self.assertIn(resource, {"notifications", "route_summary"})
            self.assertEqual(kwargs["headers"].get("Accept-Profile"), "app")
            if resource == "notifications":
                return self._row_response([{"id": "n-1", "notification_type": "info", "message": "Hi", "audience_code": "admin"}])
            return self._row_response([{"unit_id": "K-001", "zone": "Surco", "schedule": "08:00", "passenger_count": 2}])

        with patch.object(backend, "_db_http_request", new=AsyncMock(side_effect=request)):
            await backend.reload_notifications()
            await backend.reload_routes_summary()

        self.assertEqual(backend.notifications_db[0]["message"], "Hi")
        self.assertEqual(backend.routes_summary, [{
            "conductor": "K-001",
            "micro_zona": "Surco",
            "horario": "08:00",
            "count": 2,
        }])

    async def test_normalized_notification_poll_resolves_only_recipient_users(self):
        backend._notifications_cache_loaded_at = 0.0
        requested_resources = []
        recipient_id = "00000000-0000-0000-0000-000000000001"

        async def request(method, url, **kwargs):
            resource = url.split("/rest/v1/", 1)[1].split("?", 1)[0]
            requested_resources.append(resource)
            self.assertEqual(method, "GET")
            self.assertEqual(kwargs["headers"].get("Accept-Profile"), "app")
            self.assertNotIn("Authorization", kwargs["headers"])
            if resource == "notifications":
                return self._row_response([{
                    "id": "00000000-0000-0000-0000-000000000010",
                    "recipient_user_id": recipient_id,
                    "notification_type": "info",
                    "message": "Private notice",
                }])
            if resource == "app_users":
                return self._row_response([{
                    "id": recipient_id,
                    "login_identifier": "driver@example.com",
                }])
            raise AssertionError(f"unexpected normalized resource: {resource}")

        with patch.object(backend, "_db_http_request", new=AsyncMock(side_effect=request)):
            await backend.reload_notifications()

        self.assertEqual(requested_resources, ["notifications", "app_users"])
        self.assertEqual(backend.notifications_db[0]["para"], "driver@example.com")
        self.assertNotIn("routes", requested_resources)
        self.assertNotIn("driver_documents", requested_resources)

    async def test_normalized_reconciliation_does_not_delete_without_complete_snapshot(self):
        backend._normalized_snapshot_ready = False
        backend._normalized_snapshot_ids = {"app_users": {"remote-user"}}
        with patch.object(backend, "_db_http_request", new=AsyncMock(return_value=httpx.Response(204))) as request:
            await backend._persist_normalized_state("no_delete")

        request.assert_not_awaited()


class StorageConfigurationTestCase(unittest.TestCase):
    def test_legacy_names_select_old_by_default(self):
        config = backend._build_storage_config({
            "SUPABASE_URL": "https://legacy.invalid/rest/v1",
            "SUPABASE_KEY": "legacy-key",
        })

        self.assertEqual(config.mode, backend.STORAGE_OLD)
        self.assertEqual(config.layout, backend.STORAGE_LAYOUT_LEGACY)
        self.assertEqual(config.url, "https://legacy.invalid/rest/v1")
        self.assertEqual(config.key, "legacy-key")
        self.assertTrue(config.configured)
        self.assertFalse(config.read_only)

    def test_dedicated_old_names_override_legacy_names(self):
        config = backend._build_storage_config({
            "SUPABASE_URL": "https://legacy.invalid/rest/v1",
            "SUPABASE_KEY": "legacy-key",
            "KAPITAL_OLD_SUPABASE_URL": "https://old.invalid/rest/v1",
            "KAPITAL_OLD_SUPABASE_KEY": "old-key",
        })

        self.assertEqual(config.url, "https://old.invalid/rest/v1")
        self.assertEqual(config.key, "old-key")
        self.assertEqual(config.source, "old-dedicated")

    def test_v2_requires_two_explicit_opt_ins_and_separate_credentials(self):
        config = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2",
            "SUPABASE_URL": "https://legacy.invalid/rest/v1",
            "SUPABASE_KEY": "legacy-key",
            "KAPITAL_V2_SUPABASE_URL": "https://v2.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "v2-key",
        })

        self.assertEqual(config.mode, backend.STORAGE_V2)
        self.assertEqual(config.layout, backend.STORAGE_LAYOUT_NORMALIZED)
        self.assertFalse(config.enabled)
        self.assertFalse(config.configured)
        self.assertEqual(config.url, "https://v2.invalid/rest/v1")
        self.assertNotEqual(config.url, "https://legacy.invalid/rest/v1")

    def test_v2_explicit_opt_in_selects_normalized_target(self):
        config = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2",
            "KAPITAL_V2_SUPABASE_URL": "https://v2.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "v2-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "true",
            "KAPITAL_V2_STATE_RESOURCE": "normalized_state",
        })

        self.assertTrue(config.enabled)
        self.assertTrue(config.configured)
        self.assertTrue(config.read_only)
        self.assertEqual(config.state_resource, "normalized_state")
        self.assertEqual(backend._storage_status(config), {
            "mode": "v2",
            "layout": "normalized",
            "enabled": True,
            "configured": True,
            "read_only": True,
            "source": "v2-dedicated",
        })
        self.assertNotIn("v2-key", str(backend._storage_status(config)))

    def test_v2_compat_explicit_opt_in_targets_public_app_state(self):
        config = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "v2-compat-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "true",
            # A normalized override must never redirect the phase-1 bridge.
            "KAPITAL_V2_STATE_RESOURCE": "app_state_v2",
        })

        self.assertEqual(config.mode, backend.STORAGE_V2_COMPAT)
        self.assertEqual(config.layout, backend.STORAGE_LAYOUT_COMPAT)
        self.assertTrue(config.enabled)
        self.assertTrue(config.configured)
        self.assertTrue(config.read_only)
        self.assertEqual(config.source, "v2-compat")
        self.assertEqual(config.state_resource, "app_state")
        self.assertFalse(backend.StorageAdapter(config).is_normalized)
        self.assertEqual(
            backend.StorageAdapter(config).state_url(select="usuarios->__notifications__"),
            "https://v2.invalid/rest/v1/app_state?id=eq.1&select=usuarios->__notifications__",
        )
        self.assertEqual(backend._storage_status(config), {
            "mode": "v2_compat",
            "layout": "compat_json",
            "enabled": True,
            "configured": True,
            "read_only": True,
            "source": "v2-compat",
        })
        self.assertNotIn("v2-compat-key", str(backend._storage_status(config)))

    def test_v2_compat_uses_v2_credentials_and_never_falls_back_to_old(self):
        config = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "v2-compat",
            "SUPABASE_URL": "https://old.invalid/rest/v1",
            "SUPABASE_KEY": "old-key",
            "KAPITAL_V2_SUPABASE_URL": "https://v2.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "v2-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
        })

        self.assertEqual(config.url, "https://v2.invalid/rest/v1")
        self.assertEqual(config.key, "v2-key")
        self.assertEqual(config.state_resource, "app_state")
        self.assertNotEqual(config.mode, backend.STORAGE_OLD)
        self.assertNotIn("old.invalid", backend.StorageAdapter(config).state_url())

    def test_v2_compat_read_only_blocks_legacy_contract_writes(self):
        config = backend._build_storage_config({
            "KAPITAL_STORAGE_BACKEND": "V2_COMPAT",
            "KAPITAL_V2_SUPABASE_URL": "https://v2.invalid/rest/v1",
            "KAPITAL_V2_SUPABASE_KEY": "v2-key",
            "KAPITAL_V2_ENABLED": "true",
            "KAPITAL_V2_REMOTE_ENABLED": "true",
            "KAPITAL_V2_READ_ONLY": "true",
        })
        adapter = backend.StorageAdapter(config)

        with self.assertRaises(RuntimeError):
            adapter.assert_ready(write=True)

    def test_modern_supabase_keys_use_apikey_without_bearer(self):
        for key in ("sb_secret_test_key", "sb_publishable_test_key"):
            headers = backend._build_supabase_headers(
                key,
                prefer="return=minimal",
            )

            self.assertEqual(headers["apikey"], key)
            self.assertNotIn("Authorization", headers)
            self.assertEqual(headers["Content-Type"], "application/json")
            self.assertEqual(headers["Prefer"], "return=minimal")

        storage_headers = backend._build_supabase_headers(
            "sb_secret_storage_key",
            content_type="image/jpeg",
        )
        self.assertNotIn("Authorization", storage_headers)
        self.assertEqual(storage_headers["apikey"], "sb_secret_storage_key")
        self.assertEqual(storage_headers["Content-Type"], "image/jpeg")

    def test_legacy_supabase_keys_keep_bearer_compatibility(self):
        key = "eyJlegacy-test-key"
        headers = backend._build_supabase_headers(key)

        self.assertEqual(headers["apikey"], key)
        self.assertEqual(headers["Authorization"], f"Bearer {key}")
        self.assertEqual(headers["Content-Type"], "application/json")

class DiasProgramablesTestCase(unittest.TestCase):
    """El eje de días del Programador, que no sale del histórico.

    Es la distinción que faltaba: un programador trabaja sobre mañana, y mañana
    no está en `servicios_historicos` por definición. Mientras la pantalla solo
    supo ofrecer días ejecutados, la programación existía en la base y no había
    forma de abrirla desde la aplicación.
    """

    def test_empieza_hoy_y_cubre_la_ventana_completa(self):
        dias = backend._dias_programables([])

        self.assertEqual(len(dias), backend.DIAS_PROGRAMABLES)
        self.assertEqual(dias[0], backend._hoy_en_lima().isoformat())
        self.assertEqual(dias, sorted(dias))

    def test_incluye_un_plan_anterior_a_la_ventana(self):
        # Un día que ya pasó pero tiene programación tiene que seguir
        # abriéndose: si no, el trabajo hecho queda inalcanzable en cuanto
        # cambia la fecha.
        dias = backend._dias_programables(["2020-01-01"])

        self.assertIn("2020-01-01", dias)
        self.assertEqual(dias[0], "2020-01-01")

    def test_no_repite_un_dia_que_ya_esta_en_la_ventana(self):
        hoy = backend._hoy_en_lima().isoformat()

        dias = backend._dias_programables([hoy])

        self.assertEqual(dias.count(hoy), 1)

    def test_aguanta_que_la_base_no_devuelva_lista(self):
        self.assertEqual(len(backend._dias_programables(None)),
                         backend.DIAS_PROGRAMABLES)

    def test_hoy_es_el_de_lima_y_no_el_del_servidor(self):
        # A las 02:00 UTC en Lima todavía es el día anterior. Dar por vencido
        # un día que aún se está trabajando desplazaría toda la programación,
        # y justo en las horas en que se programa.
        from datetime import datetime as _dt, timezone as _tz

        momento = _dt(2026, 9, 26, 2, 0, tzinfo=_tz.utc)
        with mock.patch.object(backend, "datetime") as reloj:
            reloj.now.side_effect = lambda zona=None: momento.astimezone(zona)
            self.assertEqual(backend._hoy_en_lima().isoformat(), "2026-09-25")


class ProgramadorHardeningTestCase(unittest.IsolatedAsyncioTestCase):
    """Contracts for the persisted-plan boundary; no Supabase calls are made."""

    def test_invalid_dates_are_rejected_instead_of_sent_to_postgres(self):
        for value in ("2026-9-25", "2026-02-30", "25/09/2026", 20260925):
            with self.subTest(value=value), self.assertRaises(HTTPException) as ctx:
                backend._dia_o_hoy(value)
            self.assertEqual(ctx.exception.status_code, 400)

    async def test_past_mutation_requires_an_existing_plan(self):
        with patch.object(
            backend, "_rpc_programador", new=AsyncMock(return_value={"existe": False}),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await backend._dia_mutable("2020-01-01")
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_existing_past_plan_remains_reachable_for_editing(self):
        with patch.object(
            backend, "_rpc_programador", new=AsyncMock(return_value={"existe": True}),
        ) as rpc:
            self.assertEqual(await backend._dia_mutable("2020-01-01"), "2020-01-01")
        rpc.assert_awaited_once_with("leer_programacion", {"dia": "2020-01-01"})

    def test_rpc_error_payload_becomes_a_http_error(self):
        with self.assertRaises(HTTPException) as ctx:
            backend._raise_programador_result_error(
                "editar_programacion", {"error": "sin_programacion"},
            )
        self.assertEqual(ctx.exception.status_code, 409)

    async def test_rpc_json_error_is_not_returned_as_success(self):
        class FakeResponse:
            status_code = 200

            def json(self):
                return {"error": "accion_desconocida"}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, *_args, **_kwargs):
                return FakeResponse()

        with (
            patch.object(backend, "_ensure_storage_ready"),
            patch.object(backend.httpx, "AsyncClient", return_value=FakeClient()),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await backend._rpc_programador("editar_programacion", {}, write=True)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_incremental_sql_keeps_privileges_and_cleans_pending_assignments(self):
        sql = Path(__file__).parents[2].joinpath(
            "supabase", "004_plan_programador_hardening.sql",
        ).read_text(encoding="utf-8")
        self.assertIn("delete from programacion_pendientes", sql.lower())
        self.assertIn("revoke all on function public.editar_programacion", sql.lower())
        self.assertIn("grant execute on function public.aplicar_novedades", sql.lower())
        self.assertIn("accion_desconocida", sql)

    def test_reponer_clears_pending_only_after_successful_restore(self):
        sql = Path(__file__).parents[2].joinpath(
            "supabase", "004_plan_programador_hardening.sql",
        ).read_text(encoding="utf-8").lower()
        start = sql.index("elsif accion = 'reponer' then")
        end = sql.index("elsif accion = 'mover' then", start)
        reponer = sql[start:end]
        delete = "delete from programacion_pendientes"

        self.assertIn("and p.estado = 'retirado';", reponer)
        self.assertIn(delete, reponer)
        self.assertIn("x.fecha = dia and x.dni = cambio ->> 'dni'", reponer)
        self.assertIn("aplicados := aplicados + tocadas", reponer)
        success_branch = reponer.index("if tocadas > 0 then")
        cleanup = reponer.index(delete)
        no_op_branch = reponer.index("else", cleanup)
        self.assertGreater(cleanup, success_branch)
        self.assertLess(cleanup, no_op_branch)


if __name__ == "__main__":
    unittest.main()
