import copy
import asyncio
import hashlib
import io
import random
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import pandas as pd
from fastapi import HTTPException, Response, UploadFile

from api import index as backend


class BackendStateTestCase(unittest.IsolatedAsyncioTestCase):
    """Protect the observable MVP behavior without contacting Supabase."""

    def setUp(self):
        self._random_state = random.getstate()
        self._password_hash_write_enabled = backend.PASSWORD_HASH_WRITE_ENABLED
        self._auth_enforced = backend.AUTH_ENFORCED
        self._db_loaded = backend.db_loaded
        self._storage_config = backend.STORAGE_CONFIG
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
        backend._activate_storage_config(self._storage_config)

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
        self.assertEqual(vehicle["placa"], "K-001")
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
            self.assertEqual(await backend.mis_rutas("K-001"), routes)
            filtered = await backend.get_rutas_cliente("client a")

        self.assertEqual(filtered, routes)
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

    async def test_compat_cold_login_hydrates_full_state_before_users_persist(self):
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
        # The first read is users-only.  The second read is mandatory before
        # the PATCH because it hydrates every reserved compatibility key.
        client.get.side_effect = [
            httpx.Response(200, json=[{"usuarios": {"admin@example.com": user}}]),
            httpx.Response(200, json=[canonical_state]),
        ]
        client.patch.return_value = httpx.Response(204)

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            response = await backend.login_user(
                backend.UsuarioLogin(identifier="admin@example.com", password="safe-password"),
                Response(),
            )

        self.assertEqual(response["identifier"], "admin@example.com")
        self.assertEqual(client.get.await_count, 2)
        patch_payload = client.patch.call_args.kwargs["json"]["usuarios"]
        for reserved_key in (
            "__routes_summary__",
            "__historial_rutas__",
            "__lock__",
            "__flota__",
            "__notifications__",
        ):
            self.assertEqual(patch_payload[reserved_key], canonical_state["usuarios"][reserved_key])
        self.assertIn("admin@example.com", patch_payload)

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
        self.assertEqual(len(listing["usuarios"]), 3)  # includes legacy client sentinel
        self.assertEqual(client.get.await_count, 1)
        self.assertIn("select=usuarios", client.get.call_args_list[0].args[0])

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
            ))

        reload_db.assert_awaited_once_with(force=True)
        persist_state.assert_awaited_once()
        payload = persist_state.await_args.args[0]
        stored = payload["usuarios"]["__flota__"]["K-027"]
        self.assertEqual(stored["soat"], "2027-05-20")
        self.assertEqual(stored["revision"], "2026-09-30")
        self.assertEqual(stored["atu"], "2028-01-01")
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
        token = backend.issue_session(driver)
        with patch.object(backend, "reload_db", new=AsyncMock()):
            with self.assertRaises(HTTPException) as caught:
                await backend.update_flota(
                    "K-001", backend.FlotaUpdate(soat="2027-05-20"), token
                )
        self.assertEqual(caught.exception.status_code, 403)

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
        self.assertEqual(response["unidad"]["atu"], "")


class NormalizedStorageTestCase(unittest.IsolatedAsyncioTestCase):
    """Exercise the opt-in relational adapter without contacting Supabase."""

    def setUp(self):
        self._storage_config = backend.STORAGE_CONFIG
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
        backend._activate_storage_config(self._storage_config)

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

        with patch.object(backend, "_db_http_request", new=AsyncMock(side_effect=request)):
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


if __name__ == "__main__":
    unittest.main()
