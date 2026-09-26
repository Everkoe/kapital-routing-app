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
        backend.session_index.clear()

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
        # Primero se tantea el índice de acceso, que en una fila sin él
        # devuelve nulo y se abandona en diecinueve bytes. Después la lectura
        # de usuarios, y la del estado completo que hidrata las claves
        # reservadas antes del PATCH.
        client.get.side_effect = [
            httpx.Response(200, json=[{"usuarios": None}]),
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
        self.assertEqual(client.get.await_count, 3)  # índice + usuarios + estado completo
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

    async def test_a_login_through_the_index_never_drops_the_other_users(self):
        """El atajo trae un solo usuario; la escritura debe seguir llevándolos todos.

        Es el riesgo real de resolver un login sin leer el bloque entero: si la
        persistencia usara lo que hay en memoria —una única cuenta—, un acceso
        cualquiera borraría a los ciento y pico restantes. Lo que lo impide es
        que `_ensure_compat_users_for_write` hidrata el estado completo antes
        del PATCH, y esto lo deja clavado.
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
        # Índice, el usuario suelto, y el estado completo que exige la escritura.
        # PostgREST nombra la columna con el ultimo tramo del camino, asi que
        # una proyeccion vuelve como {"__login__": ...}, no anidada bajo
        # "usuarios". Comprobado contra la base real.
        client.get.side_effect = [
            httpx.Response(200, json=[{"__login__": {"09704190": "chofer@kapital.com"}}]),
            httpx.Response(200, json=[{"chofer@kapital.com": dict(entrando)}]),
            httpx.Response(200, json=[estado_completo]),
        ]
        client.patch.return_value = httpx.Response(204)

        with patch.object(backend.httpx, "AsyncClient", return_value=client):
            respuesta = await backend.login_user(
                backend.UsuarioLogin(identifier="09704190", password="su-clave"),
                Response(),
            )

        self.assertEqual(respuesta["identifier"], "09704190")
        escrito = client.patch.call_args.kwargs["json"]["usuarios"]
        cuentas = [k for k in escrito if not str(k).startswith("__")]
        # Ninguno de los que no participan en este login puede desaparecer.
        for clave in otros:
            self.assertIn(clave, escrito, f"{clave} se perdio al escribir")
        self.assertIn("chofer@kapital.com", escrito)
        self.assertGreaterEqual(len(cuentas), 41, "los 40 de la fila mas quien entra")
        # Y las claves reservadas tampoco: son el tablero, la flota y el resto.
        self.assertEqual(escrito["__flota__"], estado_completo["usuarios"]["__flota__"])

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
        token = backend.issue_session(driver)
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
        token = backend.issue_session(admin)
        with patch.object(backend, "_load_compat_users", new=AsyncMock()) as heavy:
            self.assertIs(await backend.require_admin_session(token), admin)
        heavy.assert_not_awaited()

    # --- Índice de sesiones ---

    async def test_issue_session_indexes_an_authorization_snapshot(self):
        user = {
            "identifier": "drv-1", "rol": "Conductor", "estado": "Activo",
            "unidad_id": "K-001", "empresa_id": None, "email": "d@e.com",
            "password": "secret",
        }
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
        entry = backend.session_index[
            hashlib.sha256(token.encode("utf-8")).hexdigest()
        ]
        self.assertEqual(entry["identifier"], "drv-1")
        self.assertEqual(entry["unidad_id"], "K-001")
        self.assertNotIn("password", entry)
        self.assertNotIn("_auth_sessions", entry)

    async def test_session_resolves_without_loading_the_users_blob(self):
        """El objetivo del índice: autorizar sin los ~3,42 MB de usuarios."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo", "unidad_id": "K-001"}
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
        backend.usuarios_db.clear()  # simula una instancia sin usuarios cargados

        actor = backend.session_actor_from_index(token)
        self.assertEqual(actor["identifier"], "drv-1")
        self.assertEqual(actor["unidad_id"], "K-001")
        self.assertEqual(actor["estado"], "Activo")

    async def test_legacy_sessions_still_resolve_without_an_index(self):
        """Rollback: una sesión emitida antes del índice sigue siendo válida."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
        backend.session_index.clear()  # como si el índice no existiera
        self.assertIs(backend.get_user_by_session(token), user)

    async def test_deactivation_updates_the_indexed_snapshot(self):
        """Una desactivación debe surtir efecto en el índice, no solo en el usuario."""
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
        user["estado"] = "Inactivo"
        backend.refresh_session_index_for(user)
        backend.usuarios_db.clear()

        actor = backend.session_actor_from_index(token)
        self.assertEqual(actor["estado"], "Inactivo")
        self.assertIsNotNone(backend.account_block_reason(actor))

    async def test_logout_revokes_the_indexed_entry_too(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            await backend.logout_user(Response(), token)
        self.assertIsNone(backend.session_actor_from_index(token))
        self.assertIsNone(backend.get_user_by_session(token))

    async def test_expired_entries_are_pruned_and_never_authorize(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        backend.session_index[digest]["expires_at"] = 1
        self.assertIsNone(backend.session_actor_from_index(token))

        other = {"identifier": "drv-2", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-2"] = other
        backend.issue_session(other)  # poda al emitir
        self.assertNotIn(digest, backend.session_index)

    async def test_index_travels_inside_the_users_payload(self):
        user = {"identifier": "drv-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["drv-1"] = user
        backend.issue_session(user)
        with patch.object(backend, "_persist_app_state", new=AsyncMock()) as persisted:
            await backend.persist_users_only()
        payload = persisted.await_args.args[0]
        self.assertIn("__sessions__", payload["usuarios"])

    async def test_decoding_state_restores_the_index_as_a_reserved_key(self):
        decoded = backend._decode_full_state(
            {"usuarios": {"drv-1": {"identifier": "drv-1"}, "__sessions__": {"abc": {"identifier": "drv-1"}}}},
            include_defaults=False,
        )
        self.assertEqual(decoded["sessions"], {"abc": {"identifier": "drv-1"}})
        self.assertNotIn("__sessions__", decoded["usuarios"])

    # --- Lote 3: acceso cruzado ---

    def _session_for(self, identifier, **extra):
        user = {"identifier": identifier, "rol": "Conductor", "estado": "Activo", **extra}
        backend.usuarios_db[identifier] = user
        return user, backend.issue_session(user)

    async def test_driver_cannot_read_another_units_routes(self):
        backend.AUTH_ENFORCED = True
        self._session_for("drv-1", unidad_id="K-001")
        _, token = self._session_for("drv-1", unidad_id="K-001")
        backend.rutas_estado_actual = [{"conductor": "K-002", "agentes": []}]
        with self.assertRaises(HTTPException) as caught:
            await backend.mis_rutas("K-002", token)
        self.assertEqual(caught.exception.status_code, 403)

    async def test_driver_reads_their_own_unit_routes(self):
        backend.AUTH_ENFORCED = True
        _, token = self._session_for("drv-1", unidad_id="K-001")
        backend.rutas_estado_actual = [
            {"conductor": "K-001", "agentes": []}, {"conductor": "K-002", "agentes": []},
        ]
        with patch.object(backend, "reload_db", new=AsyncMock()):
            routes = await backend.mis_rutas("K-001", token)
        self.assertEqual([r["conductor"] for r in routes], ["K-001"])

    async def test_admin_may_read_any_units_routes(self):
        backend.AUTH_ENFORCED = True
        _, token = self._session_for("adm", rol="Administrador")
        backend.rutas_estado_actual = [{"conductor": "K-002", "agentes": []}]
        with patch.object(backend, "reload_db", new=AsyncMock()):
            self.assertEqual(len(await backend.mis_rutas("K-002", token)), 1)

    async def test_client_cannot_read_another_companys_routes(self):
        backend.AUTH_ENFORCED = True
        _, token = self._session_for("cli", rol="Cliente", empresa_id="GLOBO_AZUL")
        with self.assertRaises(HTTPException) as caught:
            await backend.get_rutas_cliente("OTRA_EMPRESA", token)
        self.assertEqual(caught.exception.status_code, 403)

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
        token = backend.issue_session(user)
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
        token = backend.issue_session(user)
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        backend.session_index[digest].pop("dni")  # instantánea antigua, sin dni
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()),
            patch.object(backend, "reload_notifications", new=AsyncMock()),
        ):
            await backend.get_conductor_notifications("74538840", token)

    async def test_driver_cannot_read_another_drivers_notifications(self):
        backend.AUTH_ENFORCED = True
        _, token = self._session_for("drv-1", email="uno@e.com")
        backend.notifications_db.append({"id": 1, "para": "otro@e.com", "fecha": "2026-01-01"})
        with self.assertRaises(HTTPException) as caught:
            await backend.get_conductor_notifications("otro@e.com", token)
        self.assertEqual(caught.exception.status_code, 403)

    async def test_anonymous_cannot_read_protected_resources(self):
        backend.AUTH_ENFORCED = True
        with patch.object(backend, "_load_compat_users", new=AsyncMock()):
            for coro in (
                backend.mis_rutas("K-001", None),
                backend.get_rutas_cliente("GLOBO_AZUL", None),
                backend.get_conductor_notifications("a@e.com", None),
            ):
                with self.assertRaises(HTTPException) as caught:
                    await coro
                self.assertEqual(caught.exception.status_code, 401)

    async def test_gating_does_not_load_the_users_blob(self):
        """El objetivo del lote: gatear sin volver a los ~3,42 MB de usuarios."""
        backend.AUTH_ENFORCED = True
        _, token = self._session_for("drv-1", unidad_id="K-001")
        backend.rutas_estado_actual = []
        with (
            patch.object(backend, "_load_compat_users", new=AsyncMock()) as heavy,
            patch.object(backend, "reload_db", new=AsyncMock()),
        ):
            await backend.mis_rutas("K-001", token)
        heavy.assert_not_awaited()

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
        token_admin = backend.issue_session(admin)
        token_chofer = backend.issue_session(chofer)
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
        self.assertIsNone(backend.session_actor_from_index(token_chofer))

        # Y la provisional no se queda escrita en el historial.
        for evento in backend.actividad_db:
            self.assertNotIn(provisional, json.dumps(evento, ensure_ascii=False))

    async def test_a_reset_never_becomes_a_way_to_take_over_an_admin(self):
        """Reiniciar la contraseña de quien tiene más permisos es tomar su cuenta."""
        admin, gerente, chofer = self._escenario_de_reinicio()
        token_gerente = backend.issue_session(gerente)

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
        token_chofer = backend.issue_session(chofer)

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
                token = backend.issue_session(user)
                self.assertIs(backend.require_request_actor(token, expected_user=user), user)

    async def test_account_lifecycle_states_block_operations(self):
        backend.AUTH_ENFORCED = True
        for estado in ("Pendiente", "Rechazado", "Inactivo"):
            with self.subTest(estado=estado):
                user = {"identifier": "u", "rol": "Conductor", "estado": estado}
                backend.usuarios_db["u"] = user
                token = backend.issue_session(user)
                with self.assertRaises(HTTPException) as caught:
                    backend.require_request_actor(token, expected_user=user)
                self.assertEqual(caught.exception.status_code, 403)

    async def test_auth_me_returns_server_side_identity(self):
        user = {
            "identifier": "drv-1", "nombre": "Driver", "rol": "Conductor",
            "estado": "Pendiente Revisión", "password": "secret",
            "perfil_conductor": {},
        }
        backend.usuarios_db["drv-1"] = user
        token = backend.issue_session(user)
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
        token = backend.issue_session(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()) as persist_users,
        ):
            result = await backend.logout_user(Response(), token)
        persist_users.assert_awaited_once()
        self.assertTrue(result["revoked"])
        # La sesión revocada ya no resuelve, aunque el token siga sin caducar.
        self.assertIsNone(backend.get_user_by_session(token))

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
        phone = backend.issue_session(user)
        laptop = backend.issue_session(user)
        with (
            patch.object(backend, "reload_db", new=AsyncMock()),
            patch.object(backend, "persist_users_only", new=AsyncMock()),
        ):
            await backend.logout_user(Response(), phone)
        self.assertIsNone(backend.get_user_by_session(phone))
        self.assertIs(backend.get_user_by_session(laptop), user)

    async def test_fleet_delete_requires_admin_session_when_enforced(self):
        backend.AUTH_ENFORCED = True
        unit = {"capacidad": 15, "tipo": "Van", "chofer": "Driver"}
        backend.conductores_db["K-001"] = copy.deepcopy(unit)
        driver = {"identifier": "driver-1", "rol": "Conductor", "estado": "Activo"}
        backend.usuarios_db["driver-1"] = driver
        token = backend.issue_session(driver)
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
        token = backend.issue_session(admin)
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
        return admin, conductor, backend.issue_session(admin), backend.issue_session(conductor)

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
        entrada = backend.session_index[token_hash]
        self.assertEqual(entrada.get("unidad_id"), "K-999",
                         "sin refrescar el índice, el conductor pierde su unidad en frío")

        # Y con los usuarios descargados, la autorización sigue resolviendo bien.
        backend.usuarios_db.clear()
        actor = backend.session_actor_from_index(driver_token)
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
                token = backend.issue_session(otro)

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
        with mock.patch.dict(backend.usuarios_db, usuarios, clear=True),                 mock.patch.object(backend, "refresh_session_index_for") as refresco:
            cambio = backend.asignar_correo(conductor, "  Richard.DeLosSantos@Gmail.com ")
            claves = list(backend.usuarios_db)

        self.assertTrue(cambio)
        self.assertEqual(conductor["email"], "richard.delossantos@gmail.com")
        self.assertEqual(conductor["perfil_conductor"]["correo"], "richard.delossantos@gmail.com")
        # La instantánea de autorización guarda el correo: sin refrescarla, la
        # sesión abierta seguiría respondiendo por el correo anterior.
        refresco.assert_called_once_with(conductor)
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
            "perfil_conductor": {"nombres": "ANYELO BILL", "vehiculoCapacidad": 12},
        }
        existente = {"KAP-009": {"chofer": "NOMBRE CORREGIDO A MANO", "capacidad": 20, "tipo": "Sprinter"}}
        with mock.patch.dict(backend.conductores_db, existente, clear=True):
            backend._sembrar_unidad("KAP-009", conductor)
            unidad = backend.conductores_db["KAP-009"]

        self.assertEqual(unidad["chofer"], "NOMBRE CORREGIDO A MANO")
        self.assertEqual(unidad["capacidad"], 20)
        self.assertEqual(unidad["tipo"], "Sprinter")

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
