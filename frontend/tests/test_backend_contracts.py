import copy
import io
import random
import unittest
from unittest.mock import AsyncMock, patch

import pandas as pd
from fastapi import HTTPException, Response, UploadFile

from api import index as backend


class BackendStateTestCase(unittest.IsolatedAsyncioTestCase):
    """Protect the observable MVP behavior without contacting Supabase."""

    def setUp(self):
        self._random_state = random.getstate()
        self._password_hash_write_enabled = backend.PASSWORD_HASH_WRITE_ENABLED
        self._auth_enforced = backend.AUTH_ENFORCED
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
        }
        backend.usuarios_db.clear()
        backend.conductores_db.clear()
        backend.notifications_db.clear()
        backend.rutas_estado_actual = []
        backend.routes_summary = []
        backend.historial_rutas = []
        backend.board_lock = {}

    def tearDown(self):
        random.setstate(self._random_state)
        backend.PASSWORD_HASH_WRITE_ENABLED = self._password_hash_write_enabled
        backend.AUTH_ENFORCED = self._auth_enforced
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
        self.assertNotIn(
            http_response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1],
            str(backend.usuarios_db["driver-001"]["_auth_sessions"]),
        )

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

        with (
            patch.object(backend, "persist_users_only", new=AsyncMock()),
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

    async def test_client_routes_only_include_matching_company_passengers(self):
        backend.rutas_estado_actual = [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "agentes": [
                {"id": "PAX-001", "empresa": "CLIENT A"},
                {"id": "PAX-002", "empresa": "CLIENT B"},
            ],
        }]

        with patch.object(backend, "reload_db", new=AsyncMock()):
            routes = await backend.get_rutas_cliente("client a")

        self.assertEqual(len(routes), 1)
        self.assertEqual([agent["id"] for agent in routes[0]["agentes"]], ["PAX-001"])

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

        with patch.object(backend, "reload_db", new=AsyncMock()):
            response = await backend.get_flota_status()

        vehicle = response["flota"][0]
        self.assertEqual(vehicle["unidad_id"], "K-001")
        self.assertEqual(vehicle["real_placa"], "NEW-001")
        self.assertEqual(vehicle["celular"], "911111111")

    async def test_driver_routes_are_filtered_by_assigned_unit(self):
        backend.rutas_estado_actual = [
            {"conductor": "K-001", "horario": "08:00", "agentes": []},
            {"conductor": "K-002", "horario": "08:00", "agentes": []},
        ]

        with patch.object(backend, "reload_db", new=AsyncMock()):
            routes = await backend.mis_rutas("K-001")

        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]["conductor"], "K-001")

    async def test_manager_summary_uses_compact_persisted_shape(self):
        backend.routes_summary = [{
            "conductor": "K-001",
            "micro_zona": "SURCO",
            "horario": "08:00",
            "count": 12,
        }]

        with patch.object(backend, "reload_db", new=AsyncMock()):
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

    def test_session_lookup_accepts_valid_token_and_rejects_unknown_token(self):
        user = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.usuarios_db["driver-001"] = user
        raw_token = backend.issue_session(user)

        self.assertIs(backend.get_user_by_session(raw_token), user)
        self.assertIsNone(backend.get_user_by_session("unknown-token"))

    async def test_current_user_dependency_accepts_session_cookie(self):
        user = {
            "identifier": "driver-001",
            "nombre": "Driver Baseline",
            "rol": "Conductor",
            "estado": "Activo",
        }
        backend.usuarios_db["driver-001"] = user
        raw_token = backend.issue_session(user)

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
        other_token = backend.issue_session(other)

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
        driver_token = backend.issue_session(driver)

        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.get_all_users("admin@example.com", driver_token)

        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
