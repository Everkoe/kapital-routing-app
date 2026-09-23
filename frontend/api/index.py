# api/index.py
import pandas as pd

# Lectura del reporte de la intranet. Vive aparte porque lo comparten este
# endpoint y el script de carga masiva, y porque este archivo ya pasa de las
# seis mil lineas.
try:
    from api import historico_intranet, novedades_intranet
except ImportError:  # ejecucion desde dentro de `api/`
    import historico_intranet
    import novedades_intranet
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Body, Response, Cookie, WebSocket, WebSocketDisconnect
from fastapi import Request
import math
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Annotated, Dict, Any, List, Optional, Mapping, Union

import asyncio
import httpx
import json
import random
import os
import io
import threading
import time
from copy import copy as _copy_style
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote
import base64
import re
import hashlib
import hmac
import secrets
import uuid
from dotenv import load_dotenv
from fastapi.responses import StreamingResponse
from openpyxl import load_workbook

load_dotenv()



STORAGE_OLD = "old"
STORAGE_V2 = "v2"
STORAGE_V2_COMPAT = "v2_compat"
STORAGE_LAYOUT_LEGACY = "legacy_json"
STORAGE_LAYOUT_NORMALIZED = "normalized"
STORAGE_LAYOUT_COMPAT = "compat_json"
V2_SCHEMA = "app"
V2_NAMESPACE = uuid.UUID("8fef7f1f-83df-4d7c-b8d4-6f0fd2e9c6e4")

# Keep this allow-list local to the adapter.  It prevents a request value from
# becoming an arbitrary PostgREST resource and makes it explicit that binary
# document payloads are not part of the normalized read path.
V2_RESOURCES = frozenset({
    "app_users",
    "auth_credentials",
    "auth_sessions",
    "driver_profiles",
    "fleet_units",
    "routes",
    "passengers",
    "route_passengers",
    "notifications",
    "route_history",
    "board_locks",
    "route_summary",
})

V2_SELECTS = {
    "app_users": (
        "id,auth_user_id,login_identifier,login_identifier_sha256,role_code,"
        "status_code,unit_id,company_id,display_name,email,government_id,phone,"
        "needs_password_change,last_login_at,created_at,updated_at"
    ),
    "auth_credentials": (
        "user_id,password_hash,password_scheme,needs_reset,last_changed_at,"
        "created_at,updated_at"
    ),
    "auth_sessions": "id,user_id,token_hash,issued_at,expires_at,revoked_at,created_at",
    "driver_profiles": (
        "user_id,address,document_number,birth_date,direct_phone,vehicle_plate,"
        "profile_status,change_requests,created_at,updated_at"
    ),
    "fleet_units": (
        "unit_id,plate,vehicle_type,capacity,driver_name,soat_value,"
        "inspection_value,atu_value,license_value,created_at,updated_at"
    ),
    "routes": "id,unit_id,zone,schedule,route_date,status_code,source_key_sha256,version,created_at,updated_at",
    "passengers": (
        "id,legacy_identifier,legacy_identifier_sha256,full_name,company_id,address,"
        "latitude,longitude,status_code,created_at,updated_at"
    ),
    "route_passengers": (
        "assignment_id,route_id,passenger_id,assignment_order,status_code,"
        "created_at,updated_at"
    ),
    "notifications": (
        "id,recipient_user_id,audience_code,notification_type,title,message,read_at,"
        "source_notification_id,created_at,updated_at"
    ),
    "route_history": (
        "id,route_id,operation_code,route_count,passenger_count,captured_at,"
        "source_batch_id,created_at"
    ),
    "board_locks": "board_name,owner_user_id,lease_until,version,updated_at",
    "route_summary": "unit_id,zone,schedule,passenger_count,route_count",
}


def _first_env(env: Mapping[str, str], *names: str, default: str = "") -> str:
    """Return the first non-empty environment value without logging it."""
    for name in names:
        value = env.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def _env_bool(env: Mapping[str, str], *names: str, default: bool = False) -> bool:
    value = _first_env(env, *names)
    if not value:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _parse_content_range(value: Optional[str]) -> Optional[tuple[Optional[int], Optional[int], Optional[int]]]:
    """Parse a PostgREST Content-Range without trusting provider metadata."""
    if not value:
        return None
    try:
        range_part, total_part = value.strip().split("/", 1)
        # Some HTTP implementations include the range unit (for example,
        # ``items 0-999``), while PostgREST commonly returns ``0-999``.
        range_part = range_part.rsplit(" ", 1)[-1]
        total = None if total_part.strip() == "*" else int(total_part.strip())
        if range_part == "*":
            return None, None, total
        start_text, end_text = range_part.split("-", 1)
        start = int(start_text)
        end = int(end_text)
        if start < 0 or end < start or (total is not None and total < 0):
            raise ValueError("invalid content range bounds")
        return start, end, total
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid content range") from exc


@dataclass(frozen=True)
class StorageConfig:
    """Selected storage target; credentials never appear in diagnostics."""

    mode: str
    layout: str
    url: str
    key: str
    enabled: bool
    read_only: bool
    source: str
    state_resource: str
    remote_enabled: bool = True

    @property
    def configured(self) -> bool:
        return bool(self.enabled and self.url and self.key)

    @property
    def writes_allowed(self) -> bool:
        return bool(self.configured and not self.read_only)


def _build_storage_config(env: Optional[Mapping[str, str]] = None) -> StorageConfig:
    """Build an explicit OLD/V2 target while preserving legacy env names.

    OLD is the compatibility default. ``V2_COMPAT`` is the phase-1 bridge:
    it uses the dedicated V2 credentials but keeps the legacy JSON contract
    in ``public.app_state``. The normalized relational layout remains an
    explicit phase-2 choice (``V2``/``NORMALIZED``); merely adding V2
    credentials never changes the selected target.
    """
    values = env if env is not None else os.environ
    requested_mode = _first_env(
        values,
        "KAPITAL_STORAGE_BACKEND",
        "KAPITAL_STORAGE_MODE",
        "STORAGE_BACKEND",
        default=STORAGE_OLD,
    ).lower()
    if requested_mode in {
        STORAGE_V2_COMPAT,
        "v2-compat",
        "compat",
        "compatibility",
    }:
        mode = STORAGE_V2_COMPAT
    elif requested_mode in {
        STORAGE_V2,
        "normalized",
        "v2_normalized",
        "v2-normalized",
        "new",
    }:
        mode = STORAGE_V2
    else:
        mode = STORAGE_OLD
    generic_read_only = _env_bool(values, "KAPITAL_STORAGE_READ_ONLY", default=False)

    if mode in {STORAGE_V2, STORAGE_V2_COMPAT}:
        url = _first_env(
            values,
            "KAPITAL_V2_SUPABASE_URL",
            "KAPITAL_STORAGE_V2_SUPABASE_URL",
            "KAPITAL_STORAGE_V2_URL",
            "KAPITAL_SUPABASE_V2_URL",
            "SUPABASE_V2_URL",
        )
        key = _first_env(
            values,
            "KAPITAL_V2_SUPABASE_KEY",
            "KAPITAL_STORAGE_V2_SUPABASE_KEY",
            "KAPITAL_STORAGE_V2_KEY",
            "KAPITAL_SUPABASE_V2_KEY",
            "SUPABASE_V2_KEY",
        )
        remote_enabled = _env_bool(
            values,
            "KAPITAL_V2_REMOTE_ENABLED",
            "KAPITAL_STORAGE_V2_REMOTE_ENABLED",
            default=False,
        )
        explicitly_enabled = _env_bool(
            values,
            "KAPITAL_V2_ENABLED",
            "KAPITAL_STORAGE_V2_ENABLED",
            default=False,
        )
        is_compat = mode == STORAGE_V2_COMPAT
        return StorageConfig(
            mode=mode,
            layout=STORAGE_LAYOUT_COMPAT if is_compat else STORAGE_LAYOUT_NORMALIZED,
            url=url.rstrip("/"),
            key=key,
            enabled=bool(explicitly_enabled and remote_enabled),
            read_only=_env_bool(
                values,
                "KAPITAL_V2_READ_ONLY",
                "KAPITAL_V2_STORAGE_READ_ONLY",
                "KAPITAL_STORAGE_V2_READ_ONLY",
                default=True,
            ) or generic_read_only,
            source="v2-compat" if is_compat else "v2-dedicated",
            # V2_COMPAT intentionally targets the existing public JSON row.
            # Do not inherit a normalized resource override in this mode.
            state_resource=(
                "app_state"
                if is_compat
                else _first_env(
                    values,
                    "KAPITAL_V2_STATE_RESOURCE",
                    "KAPITAL_STORAGE_V2_STATE_RESOURCE",
                    default="app_state_v2",
                )
            ),
            remote_enabled=remote_enabled,
        )

    # Explicit OLD names win; SUPABASE_URL/SUPABASE_KEY remain compatible
    # with the existing Vercel configuration and local .env files.
    old_url = _first_env(
        values,
        "KAPITAL_OLD_SUPABASE_URL",
        "KAPITAL_STORAGE_OLD_SUPABASE_URL",
        "KAPITAL_STORAGE_OLD_URL",
        "KAPITAL_SUPABASE_OLD_URL",
        "SUPABASE_OLD_URL",
        "SUPABASE_URL",
    )
    old_key = _first_env(
        values,
        "KAPITAL_OLD_SUPABASE_KEY",
        "KAPITAL_STORAGE_OLD_SUPABASE_KEY",
        "KAPITAL_STORAGE_OLD_KEY",
        "KAPITAL_SUPABASE_OLD_KEY",
        "SUPABASE_OLD_KEY",
        "SUPABASE_KEY",
    )
    dedicated_old = bool(
        _first_env(
            values,
            "KAPITAL_OLD_SUPABASE_URL",
            "KAPITAL_STORAGE_OLD_SUPABASE_URL",
            "KAPITAL_STORAGE_OLD_URL",
            "KAPITAL_SUPABASE_OLD_URL",
            "SUPABASE_OLD_URL",
        )
        or _first_env(
            values,
            "KAPITAL_OLD_SUPABASE_KEY",
            "KAPITAL_STORAGE_OLD_SUPABASE_KEY",
            "KAPITAL_STORAGE_OLD_KEY",
            "KAPITAL_SUPABASE_OLD_KEY",
            "SUPABASE_OLD_KEY",
        )
    )
    return StorageConfig(
        mode=STORAGE_OLD,
        layout=STORAGE_LAYOUT_LEGACY,
        url=old_url.rstrip("/"),
        key=old_key,
        enabled=True,
        read_only=_env_bool(
            values,
            "KAPITAL_OLD_READ_ONLY",
            "KAPITAL_OLD_STORAGE_READ_ONLY",
            "KAPITAL_STORAGE_OLD_READ_ONLY",
            default=False,
        ) or generic_read_only,
        source="old-dedicated" if dedicated_old else "legacy",
        state_resource="app_state",
        remote_enabled=True,
    )


class StorageAdapter:
    """Storage boundary for legacy JSON and the opt-in normalized schema.

    The normalized branch deliberately exposes only relational resources.  It
    reconstructs the legacy in-memory contract for the existing endpoints, so
    the OLD path remains unchanged and document binaries are never loaded as
    part of a dashboard/auth refresh.
    """

    def __init__(self, config: StorageConfig):
        self.config = config

    def assert_ready(self, *, write: bool = False) -> None:
        if self.config.mode in {STORAGE_V2, STORAGE_V2_COMPAT} and not self.config.remote_enabled:
            raise RuntimeError("V2 storage remote is disabled")
        if not self.config.enabled or not self.config.url or not self.config.key:
            raise RuntimeError("storage target is not configured")
        if write and self.config.read_only:
            raise RuntimeError("selected storage target is read-only")

    def state_url(self, select: Optional[str] = None) -> str:
        """Build only the controlled app-state URL; query values are encoded."""
        resource = self.config.state_resource
        url = f"{self.config.url}/{resource}?id=eq.1"
        if select:
            url += f"&select={quote(select, safe='->')}"
        return url

    @property
    def is_normalized(self) -> bool:
        return self.config.mode == STORAGE_V2 and self.config.layout == STORAGE_LAYOUT_NORMALIZED

    def resource_url(
        self,
        resource: str,
        *,
        select: Optional[str] = None,
        filters: Optional[Mapping[str, str]] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
        on_conflict: Optional[str] = None,
    ) -> str:
        """Build a controlled PostgREST URL for one normalized resource."""
        if resource not in V2_RESOURCES:
            raise ValueError("unsupported normalized resource")
        params: List[str] = []
        if select:
            params.append(f"select={quote(select, safe=',.*()')}")
        if filters:
            for key, value in filters.items():
                params.append(f"{quote(str(key), safe='')}={quote(str(value), safe='.,()')}")
        if order:
            params.append(f"order={quote(order, safe='.,')}")
        if limit is not None:
            params.append(f"limit={int(limit)}")
        if on_conflict:
            params.append(f"on_conflict={quote(on_conflict, safe=',')}")
        suffix = f"?{'&'.join(params)}" if params else ""
        return f"{self.config.url}/{resource}{suffix}"

    def normalized_headers(
        self,
        *,
        write: bool = False,
        content_type: str = "application/json",
        prefer: Optional[str] = None,
    ) -> Dict[str, str]:
        """Return profile-aware Data API headers without exposing credentials."""
        return _build_supabase_headers(
            self.config.key,
            content_type=content_type,
            prefer=prefer,
            content_profile=V2_SCHEMA if write else None,
            accept_profile=V2_SCHEMA if not write else None,
        )

    async def fetch_rows(
        self,
        resource: str,
        *,
        select: Optional[str] = None,
        filters: Optional[Mapping[str, str]] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
        operation: str,
    ) -> List[Dict[str, Any]]:
        """Read rows from a normalized resource through PostgREST.

        A request with an explicit ``limit`` at or below the page size keeps
        the existing single-read behavior (used by login and targeted
        lookups).  Full collection reads use bounded ``Range`` requests and
        the provider's ``Content-Range`` metadata until the complete
        collection has been assembled.  Offsets are checked on every page so
        an ignored or repeated range cannot silently duplicate rows.
        """
        if limit is not None:
            try:
                requested_limit = int(limit)
            except (TypeError, ValueError) as exc:
                _raise_database_unavailable(operation, error=exc)
            if requested_limit < 0:
                _raise_database_unavailable(
                    operation,
                    error=ValueError("invalid normalized limit"),
                )
        else:
            requested_limit = None

        paginate = requested_limit is None or requested_limit > NORMALIZED_PAGE_SIZE
        if not paginate:
            response = await _db_http_request(
                "GET",
                self.resource_url(
                    resource,
                    select=select or V2_SELECTS.get(resource),
                    filters=filters,
                    order=order,
                    limit=requested_limit,
                ),
                operation=operation,
                headers=self.normalized_headers(),
                timeout=30.0,
            )
            if response.status_code not in {200, 206}:
                _raise_database_unavailable(operation, status_code=response.status_code)
            try:
                rows = response.json()
            except (TypeError, ValueError) as exc:
                _raise_database_unavailable(operation, error=exc)
            if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                _raise_database_unavailable(operation, error=ValueError("invalid normalized rows"))
            return rows

        if requested_limit is not None and requested_limit > NORMALIZED_MAX_ROWS:
            _raise_database_unavailable(
                operation,
                error=ValueError("normalized pagination limit exceeded"),
            )

        page_size = NORMALIZED_PAGE_SIZE
        offset = 0
        page_count = 0
        collected: List[Dict[str, Any]] = []
        expected_total: Optional[int] = None
        seen_page_signatures: set[str] = set()

        while True:
            if page_count >= NORMALIZED_MAX_PAGES or offset >= NORMALIZED_MAX_ROWS:
                _raise_database_unavailable(
                    operation,
                    error=ValueError("normalized pagination limit exceeded"),
                )

            if requested_limit is not None:
                remaining = requested_limit - offset
                if remaining <= 0:
                    break
                request_size = min(page_size, remaining)
            else:
                request_size = page_size

            page_headers = self.normalized_headers(prefer="count=exact")
            page_headers["Range-Unit"] = "items"
            page_headers["Range"] = f"{offset}-{offset + request_size - 1}"
            response = await _db_http_request(
                "GET",
                self.resource_url(
                    resource,
                    select=select or V2_SELECTS.get(resource),
                    filters=filters,
                    order=order,
                    # The Range header is the page boundary.  Supplying a
                    # query-string limit as well makes PostgREST apply the
                    # limit before the offset and returns HTTP 416 for page
                    # two (for example, Range 1000-1999 with limit=1000).
                    limit=None,
                ),
                operation=operation,
                headers=page_headers,
                timeout=30.0,
            )
            if response.status_code not in {200, 206}:
                _raise_database_unavailable(operation, status_code=response.status_code)
            try:
                page_rows = response.json()
            except (TypeError, ValueError) as exc:
                _raise_database_unavailable(operation, error=exc)
            if not isinstance(page_rows, list) or not all(isinstance(row, dict) for row in page_rows):
                _raise_database_unavailable(operation, error=ValueError("invalid normalized rows"))
            if len(page_rows) > request_size:
                _raise_database_unavailable(
                    operation,
                    error=ValueError("normalized page exceeds requested range"),
                )

            content_range_value = response.headers.get("content-range")
            try:
                content_range = _parse_content_range(content_range_value)
            except ValueError as exc:
                _raise_database_unavailable(operation, error=exc)

            if content_range is not None:
                range_start, range_end, range_total = content_range
                if range_total is not None:
                    if expected_total is None:
                        expected_total = range_total
                    elif expected_total != range_total:
                        _raise_database_unavailable(
                            operation,
                            error=ValueError("inconsistent normalized total"),
                        )
                    if expected_total > NORMALIZED_MAX_ROWS:
                        _raise_database_unavailable(
                            operation,
                            error=ValueError("normalized pagination limit exceeded"),
                        )
                if range_start is None or range_end is None:
                    if page_rows or (range_total not in {None, 0}):
                        _raise_database_unavailable(
                            operation,
                            error=ValueError("invalid normalized empty range"),
                        )
                else:
                    if range_start != offset or range_end - range_start + 1 != len(page_rows):
                        _raise_database_unavailable(
                            operation,
                            error=ValueError("normalized range does not match rows"),
                        )
                    if expected_total is not None and range_end >= expected_total:
                        if range_end + 1 != expected_total:
                            _raise_database_unavailable(
                                operation,
                                error=ValueError("normalized range exceeds total"),
                            )

            # A provider that ignores Range can otherwise return the same
            # full page forever.  Keep the check only for repeated pages; a
            # legitimate duplicate row inside different pages is preserved.
            if page_rows and len(page_rows) == request_size:
                page_signature = json.dumps(
                    page_rows,
                    sort_keys=True,
                    separators=(",", ":"),
                    default=str,
                )
                if page_signature in seen_page_signatures:
                    _raise_database_unavailable(
                        operation,
                        error=ValueError("normalized pagination repeated a page"),
                    )
                seen_page_signatures.add(page_signature)

            collected.extend(page_rows)
            page_count += 1
            offset += len(page_rows)
            if offset > NORMALIZED_MAX_ROWS:
                _raise_database_unavailable(
                    operation,
                    error=ValueError("normalized pagination limit exceeded"),
                )

            if requested_limit is not None and offset >= requested_limit:
                break
            if expected_total is not None:
                if offset == expected_total:
                    break
                if offset > expected_total or not page_rows:
                    _raise_database_unavailable(
                        operation,
                        error=ValueError("normalized pagination ended early"),
                    )
            elif not page_rows or len(page_rows) < request_size:
                break

        return collected[:requested_limit] if requested_limit is not None else collected

    async def upsert_rows(
        self,
        resource: str,
        rows: List[Dict[str, Any]],
        *,
        conflict_key: str,
        operation: str,
    ) -> None:
        """Upsert a bounded set of normalized rows without returning bodies."""
        if not rows:
            return
        response = await _db_http_request(
            "POST",
            self.resource_url(resource, on_conflict=conflict_key),
            operation=operation,
            headers=self.normalized_headers(
                write=True,
                prefer="resolution=merge-duplicates,return=minimal",
            ),
            timeout=30.0,
            json_payload=rows,
        )
        if response.status_code not in {200, 201, 204}:
            _raise_database_unavailable(
                operation,
                status_code=response.status_code,
                detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
            )

    async def delete_ids(
        self,
        resource: str,
        ids: List[str],
        *,
        id_column: str,
        operation: str,
    ) -> None:
        """Delete only IDs observed in a prior complete normalized snapshot."""
        if resource not in V2_RESOURCES or not ids:
            return
        for row_id in ids:
            response = await _db_http_request(
                "DELETE",
                self.resource_url(
                    resource,
                    filters={id_column: f"eq.{row_id}"},
                ),
                operation=operation,
                headers=self.normalized_headers(
                    write=True,
                    prefer="return=minimal",
                ),
                timeout=30.0,
            )
            if response.status_code not in {200, 204}:
                _raise_database_unavailable(
                    operation,
                    status_code=response.status_code,
                    detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
                )


def _storage_status(config: Optional[StorageConfig] = None) -> Dict[str, Any]:
    """Return safe configuration metadata without URL or credential values."""
    selected = config or STORAGE_CONFIG
    return {
        "mode": selected.mode,
        "layout": selected.layout,
        "enabled": selected.enabled,
        "configured": selected.configured,
        "read_only": selected.read_only,
        "source": selected.source,
    }


def _is_modern_supabase_key(key: str) -> bool:
    """New opaque Supabase keys are API keys, not JWT bearer tokens."""
    return isinstance(key, str) and key.startswith(("sb_secret_", "sb_publishable_"))


def _build_supabase_headers(
    key: str,
    *,
    content_type: str = "application/json",
    prefer: Optional[str] = None,
    accept_profile: Optional[str] = None,
    content_profile: Optional[str] = None,
) -> Dict[str, str]:
    """Build safe Data API/Storage headers for modern and legacy keys."""
    headers = {
        "apikey": key,
        "Content-Type": content_type,
    }
    if not _is_modern_supabase_key(key):
        headers["Authorization"] = f"Bearer {key}"
    if prefer:
        headers["Prefer"] = prefer
    if accept_profile:
        headers["Accept-Profile"] = accept_profile
    if content_profile:
        headers["Content-Profile"] = content_profile
    return headers


def _activate_storage_config(config: StorageConfig) -> None:
    """Apply a config atomically to the legacy globals used by this module."""
    global STORAGE_CONFIG, STORAGE_ADAPTER, STORAGE_BACKEND
    global SUPABASE_URL, SUPABASE_KEY, HEADERS
    STORAGE_CONFIG = config
    STORAGE_ADAPTER = StorageAdapter(config)
    STORAGE_BACKEND = config.mode
    SUPABASE_URL = config.url
    SUPABASE_KEY = config.key
    HEADERS = _build_supabase_headers(config.key)


def _is_normalized_storage() -> bool:
    """Return whether the selected target is the opt-in normalized V2 path."""
    return STORAGE_CONFIG.mode == STORAGE_V2 and STORAGE_CONFIG.layout == STORAGE_LAYOUT_NORMALIZED


def _is_compat_storage() -> bool:
    """Return whether the phase-1 V2 bridge uses the legacy JSON contract."""
    return STORAGE_CONFIG.mode == STORAGE_V2_COMPAT and STORAGE_CONFIG.layout == STORAGE_LAYOUT_COMPAT


STORAGE_CONFIG = _build_storage_config()
STORAGE_ADAPTER = StorageAdapter(STORAGE_CONFIG)
STORAGE_BACKEND = STORAGE_CONFIG.mode
_activate_storage_config(STORAGE_CONFIG)



# Configuración de Gemini AI Copilot (Usando REST puro para ahorrar espacio en Vercel)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Eres 'Kapital Copilot', el asistente virtual experto en logística de la aplicación B2B 'Kapital Routing'.
Tu objetivo es ayudar al usuario (el Programador de rutas o despachador logístico) a utilizar la plataforma
Reglas del negocio que debes conocer:
- Las unidades (Vans o Sprinters) tienen una capacidad MÁXIMA de 15 pasajeros.
- Los usuarios pueden subir un Excel con la base de datos de los pasajeros a enrutar (ID, Nombres, Turno, Dirección, Zona).
- La app tiene una función de "Arrastrar y Soltar" (Drag and Drop) para reasignar pasajeros entre unidades.
- La app muestra gráficos de "Carga por Unidad" y "Eficiencia Global".
Responde siempre de manera concisa, profesional, y directa (sin introducciones robóticas). Usa viñetas si es necesario."""

PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 310_000
# Cifrar al escribir viene activado.
#
# Nació apagado a propósito: hasta que la lectura compatible —la que entiende
# tanto un hash como el texto plano de antes— no estuviera desplegada, cifrar
# habría dejado fuera a todo el mundo en un rollback. Esa lectura lleva
# desplegada desde el PR #3, así que la precondición ya no existe y mantenerlo
# apagado solo significaba guardar contraseñas en claro.
#
# La variable sigue mandando: `KAPITAL_PASSWORD_HASH_WRITE=false` lo apaga.
PASSWORD_HASH_WRITE_ENABLED = os.environ.get(
    "KAPITAL_PASSWORD_HASH_WRITE",
    "true",
).strip().lower() in {"1", "true", "yes", "on"}
SESSION_COOKIE_NAME = "kapital_session"
SESSION_TTL_HOURS = int(os.environ.get("KAPITAL_SESSION_TTL_HOURS", "12"))
AUTH_ENFORCED = os.environ.get(
    "KAPITAL_AUTH_ENFORCED",
    "true",
).strip().lower() in {"1", "true", "yes", "on"}
SessionCookie = Annotated[Optional[str], Cookie(alias=SESSION_COOKIE_NAME)]


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """Return a salted PBKDF2 hash suitable for storage in the legacy user JSON."""
    if not isinstance(password, str) or not password:
        raise ValueError("Password cannot be empty")
    password_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        password_salt,
        PASSWORD_ITERATIONS,
    )
    return "$".join((
        PASSWORD_SCHEME,
        str(PASSWORD_ITERATIONS),
        base64.urlsafe_b64encode(password_salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    ))


def verify_password(password: str, stored_password: str | None) -> bool:
    """Verify both modern hashes and legacy plaintext during migration."""
    if not isinstance(password, str) or not isinstance(stored_password, str):
        return False
    if not stored_password.startswith(f"{PASSWORD_SCHEME}$"):
        return hmac.compare_digest(password, stored_password)
    try:
        scheme, iterations_text, salt_text, digest_text = stored_password.split("$", 3)
        if scheme != PASSWORD_SCHEME:
            return False
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            iterations,
        )
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def password_needs_upgrade(stored_password: str | None) -> bool:
    if not isinstance(stored_password, str) or not stored_password.startswith(f"{PASSWORD_SCHEME}$"):
        return True
    try:
        return int(stored_password.split("$", 2)[1]) < PASSWORD_ITERATIONS
    except (TypeError, ValueError, IndexError):
        return True


# Alfabeto sin caracteres que se confunden al dictar por teléfono: fuera la O
# y el cero, fuera la l, la I y el uno. Quien reinicia una contraseña se la
# canta al conductor por WhatsApp, y un carácter ambiguo es una llamada más.
_ALFABETO_PROVISIONAL = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LARGO_CONTRASENA_PROVISIONAL = 10


def contrasena_provisional() -> str:
    """Una contraseña de un solo uso, para dictar y cambiar al entrar."""
    return "".join(secrets.choice(_ALFABETO_PROVISIONAL)
                   for _ in range(LARGO_CONTRASENA_PROVISIONAL))


def revocar_sesiones_de(user: Dict[str, Any]) -> int:
    """Cierra todas las sesiones abiertas de una cuenta.

    Reiniciar una contraseña sin esto no echaría a nadie: quien tuviera la
    sesión abierta seguiría dentro doce horas más, que es justo lo que no se
    quiere cuando se reinicia porque una cuenta pudo quedar comprometida.
    """
    ahora = int(datetime.now(timezone.utc).timestamp())
    cerradas = 0
    for sesion in user.get("_auth_sessions") or []:
        if isinstance(sesion, dict) and not sesion.get("revoked_at"):
            sesion["revoked_at"] = ahora
            revoke_session_in_index(str(sesion.get("token_hash") or ""), ahora)
            cerradas += 1
    return cerradas


def password_for_storage(password: str) -> str:
    """Keep rollback-safe plaintext until hash writing is explicitly enabled."""
    return hash_password(password) if PASSWORD_HASH_WRITE_ENABLED else password


_SESSION_SNAPSHOT_FIELDS = (
    "rol", "estado", "email", "unidad_id", "empresa_id", "dni", "login_identifier",
)


def _session_auth_snapshot(user: Dict[str, Any]) -> Dict[str, Any]:
    """Campos que la autorización necesita, sin datos sensibles ni credenciales."""
    return {field: user.get(field) for field in _SESSION_SNAPSHOT_FIELDS}


def _prune_session_index(now: int) -> None:
    for token_hash in [
        key for key, entry in session_index.items()
        if not isinstance(entry, dict) or int(entry.get("expires_at", 0)) <= now
    ]:
        session_index.pop(token_hash, None)


def refresh_session_index_for(user: Dict[str, Any]) -> None:
    """Re-sincroniza la instantánea tras cambiar rol o estado de un usuario.

    Sin esto, desactivar una cuenta no surtiría efecto en los endpoints que
    autorizan solo con el índice hasta que caduque la sesión.
    """
    identifier = user.get("identifier")
    if not identifier:
        return
    snapshot = _session_auth_snapshot(user)
    for entry in session_index.values():
        if isinstance(entry, dict) and entry.get("identifier") == identifier:
            entry.update(snapshot)


def revoke_session_in_index(token_hash: str, now: int) -> None:
    entry = session_index.get(token_hash)
    if isinstance(entry, dict):
        entry["revoked_at"] = now


def session_actor_from_index(raw_token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Actor de autorización resuelto solo con el índice.

    Devuelve el usuario real si ya está cargado; si no, la instantánea, que
    basta para comprobar estado, rol y propiedad del recurso.
    """
    if not raw_token:
        return None
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    entry = session_index.get(token_hash)
    if not isinstance(entry, dict) or entry.get("revoked_at"):
        return None
    if int(entry.get("expires_at", 0)) <= int(datetime.now(timezone.utc).timestamp()):
        return None
    identifier = entry.get("identifier")
    if not identifier:
        return None
    loaded = usuarios_db.get(identifier)
    if isinstance(loaded, dict):
        return loaded
    return {"identifier": identifier, **{f: entry.get(f) for f in _SESSION_SNAPSHOT_FIELDS}}


def issue_session(user: Dict[str, Any]) -> str:
    """Create an opaque session while storing only its SHA-256 digest."""
    now = int(datetime.now(timezone.utc).timestamp())
    expires_at = now + (SESSION_TTL_HOURS * 60 * 60)
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    current_sessions = user.get("_auth_sessions", [])
    valid_sessions = [
        session for session in current_sessions
        if isinstance(session, dict) and int(session.get("expires_at", 0)) > now
    ]
    valid_sessions = valid_sessions[-4:]
    valid_sessions.append({
        "token_hash": token_hash,
        "created_at": now,
        "expires_at": expires_at,
    })
    user["_auth_sessions"] = valid_sessions
    # Escritura doble: `_auth_sessions` se conserva para que un rollback a una
    # versión anterior siga reconociendo la sesión.
    _prune_session_index(now)
    session_index[token_hash] = {
        "identifier": user.get("identifier"),
        "created_at": now,
        "expires_at": expires_at,
        **_session_auth_snapshot(user),
    }
    return raw_token


def get_user_by_session(raw_token: str | None) -> Optional[Dict[str, Any]]:
    """Resolve a valid opaque session without exposing tokens in app_state."""
    if not raw_token:
        return None
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now = int(datetime.now(timezone.utc).timestamp())
    entry = session_index.get(token_hash)
    if (
        isinstance(entry, dict)
        and not entry.get("revoked_at")
        and int(entry.get("expires_at", 0)) > now
    ):
        indexed = usuarios_db.get(entry.get("identifier"))
        if isinstance(indexed, dict):
            return indexed
    # Respaldo legado: sesiones emitidas antes de que existiera el índice.
    for user in usuarios_db.values():
        if not isinstance(user, dict):
            continue
        for session in user.get("_auth_sessions", []):
            if (
                not isinstance(session, dict)
                or int(session.get("expires_at", 0)) <= now
                or session.get("revoked_at")
            ):
                continue
            if hmac.compare_digest(session.get("token_hash", ""), token_hash):
                return user
    return None


# El campo ``estado`` almacena dos ejes distintos. Solo estos valores describen
# una cuenta deshabilitada; el resto describe el avance documental del conductor
# ("Pendiente Revisión", "Documentos Observados"), que debe poder entrar a su
# portal precisamente para subir o resubir documentos.
_ACCOUNT_BLOCKED_STATES = {
    "Pendiente": "Tu cuenta está pendiente de aprobación por Administración.",
    "Rechazado": "Tu cuenta fue rechazada por Administración.",
    "Inactivo": "Tu cuenta está desactivada. Contacta con Administración.",
}


def account_block_reason(user: Optional[Dict[str, Any]]) -> Optional[str]:
    """Return why the account cannot authenticate or operate, or None."""
    if not isinstance(user, dict):
        return None
    estado = str(user.get("estado", "Activo") or "Activo").strip()
    return _ACCOUNT_BLOCKED_STATES.get(estado)


def _public_user_payload(
    user: Dict[str, Any], fallback_identifier: Optional[str] = None
) -> Dict[str, Any]:
    """Shape returned by login and /api/auth/me. Never includes credentials."""
    return {
        "identifier": user.get("identifier", fallback_identifier),
        "email": user.get("email"),
        "dni": user.get("dni"),
        "nombre": user.get("nombre", "Usuario"),
        "rol": user.get("rol", "Usuario"),
        "unidad_id": user.get("unidad_id"),
        "empresa_id": user.get("empresa_id"),
        "avatar": user.get("avatar"),
        "estado": user.get("estado", "Activo"),
        "needs_password_change": user.get("needs_password_change", False),
        "profileComplete": "perfil_conductor" in user,
    }


async def get_current_user(session_token: SessionCookie = None) -> Dict[str, Any]:
    """FastAPI dependency prepared for the authorization rollout."""
    await reload_db()
    user = get_user_by_session(session_token)
    if not user:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada.")
    blocked = account_block_reason(user)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)
    return user


def require_request_actor(
    session_token: str | None,
    *,
    expected_user: Optional[Dict[str, Any]] = None,
    allowed_roles: Optional[List[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Validate the session when Phase 1 enforcement is enabled.

    With enforcement disabled this is intentionally a no-op, allowing the
    compatibility release to be deployed before existing sessions are renewed.
    """
    if not AUTH_ENFORCED:
        return None
    actor = get_user_by_session(session_token)
    if not actor:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada.")
    blocked = account_block_reason(actor)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)
    if expected_user is not None and actor is not expected_user:
        raise HTTPException(status_code=403, detail="No puedes operar sobre otro usuario.")
    if allowed_roles is not None and actor.get("rol") not in allowed_roles:
        raise HTTPException(status_code=403, detail="El rol actual no tiene permiso para esta acción.")
    return actor

# --- Estado Global en Memoria ---
rutas_estado_actual: List[Dict[str, Any]] = []
usuarios_db: Dict[str, Dict[str, Any]] = {}
conductores_db: Dict[str, Dict[str, Any]] = {}
historial_rutas: List[Dict[str, Any]] = []
board_lock: Dict[str, Any] = {}
routes_summary: List[Dict[str, Any]] = []  # Compact summary for GerentePortal
notifications_db: List[Dict[str, Any]] = [] # Real-time events
# Historial de acciones administrativas. Vive como pseudo-clave
# `usuarios.__actividad__`, igual que `__notifications__`: el proyecto guarda
# todo el estado en una sola fila y no hay acceso para crear tablas nuevas.
# Se recorta a los últimos `MAX_ACTIVIDAD` para que la fila no vuelva a crecer
# sin control, que es lo que ya tumbó una vez el envío de perfiles.
actividad_db: List[Dict[str, Any]] = []
# Índice de sesiones: sha256(token) -> instantánea de autorización. Vive como
# pseudo-clave `usuarios.__sessions__`, igual que `__flota__`. Existe para que
# validar una sesión no cueste los ~3,42 MB del objeto usuarios completo.
session_index: Dict[str, Dict[str, Any]] = {}

# --- WebSocket Manager ---
class WebSocketManager:
    """Gestiona conexiones WebSocket activas por user_id (identifier del usuario)."""
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.active[user_id] = ws
        print(f"[WS] Conectado: {user_id} (total: {len(self.active)})")

    def disconnect(self, user_id: str):
        self.active.pop(user_id, None)
        print(f"[WS] Desconectado: {user_id} (total: {len(self.active)})")

    async def send(self, user_id: str, data: dict):
        """Envía un mensaje JSON al usuario si está conectado."""
        ws = self.active.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
                return True
            except Exception as e:
                print(f"[WS] Error enviando a {user_id}: {e}")
                self.disconnect(user_id)
        return False

    async def broadcast_to_role(self, role: str, data: dict):
        """Envía un mensaje a todos los usuarios con cierto rol conectados."""
        for uid, ws in list(self.active.items()):
            user = usuarios_db.get(uid)
            if user and user.get("rol") == role:
                try:
                    await ws.send_json(data)
                except:
                    self.disconnect(uid)

ws_manager = WebSocketManager()

db_loaded = False

DATABASE_UNAVAILABLE_DETAIL = "La base de datos no está disponible temporalmente. Intenta nuevamente."
DATABASE_WRITE_UNAVAILABLE_DETAIL = "No se pudo guardar la información. Intenta nuevamente."


def _bounded_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    """Read a numeric tuning value without allowing unsafe extremes."""
    try:
        value = float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        value = default
    return min(max(value, minimum), maximum)


# A warm Vercel instance can serve repeated dashboard polls from memory. The
# cache is deliberately short and is invalidated after every successful write
# so local mutations are never hidden behind the TTL.
DB_CACHE_TTL_SECONDS = _bounded_float_env(
    "KAPITAL_DB_CACHE_TTL_SECONDS",
    45.0,
    30.0,
    60.0,
)
DB_RETRY_MAX_ATTEMPTS = 2
DB_RETRY_BASE_SECONDS = _bounded_float_env(
    "KAPITAL_DB_RETRY_BASE_SECONDS",
    0.15,
    0.05,
    1.0,
)
DB_CIRCUIT_FAILURE_THRESHOLD = 3
DB_CIRCUIT_COOLDOWN_SECONDS = _bounded_float_env(
    "KAPITAL_DB_CIRCUIT_COOLDOWN_SECONDS",
    15.0,
    5.0,
    60.0,
)

# PostgREST applies a provider-side row cap to collection reads.  Keep each
# request below that cap and bound the total work so a malformed/misconfigured
# endpoint cannot make a warm function loop forever or accumulate unbounded
# state in memory.  The limits are deliberately module constants so tests can
# exercise the failure boundary without changing deployment configuration.
NORMALIZED_PAGE_SIZE = 1000
NORMALIZED_MAX_PAGES = 100
NORMALIZED_MAX_ROWS = NORMALIZED_PAGE_SIZE * NORMALIZED_MAX_PAGES

_db_cache_loaded_at = 0.0
_notifications_cache_loaded_at = 0.0
_routes_summary_cache_loaded_at = 0.0
# Compatibility-mode projections are kept separate from the full snapshot
# cache.  A route-only read must not make a later user/admin read believe that
# the complete legacy state is resident in memory.
_routes_projection_loaded_at = 0.0
_users_projection_loaded_at = 0.0
_fleet_projection_loaded_at = 0.0
_db_io_lock: Optional[asyncio.Lock] = None
_db_io_lock_loop = None
_db_circuit_failures = 0
_db_circuit_open_until = 0.0
_db_circuit_state_lock = threading.Lock()
_normalized_snapshot_ids: Dict[str, set[str]] = {}
_normalized_snapshot_ready = False


def _cache_is_fresh(loaded_at: float) -> bool:
    return bool(loaded_at and (time.monotonic() - loaded_at) < DB_CACHE_TTL_SECONDS)


def _full_cache_is_fresh() -> bool:
    return db_loaded and _cache_is_fresh(_db_cache_loaded_at)


def _routes_projection_is_fresh() -> bool:
    return _cache_is_fresh(_routes_projection_loaded_at)


def _users_projection_is_fresh() -> bool:
    return _cache_is_fresh(_users_projection_loaded_at)


def _fleet_projection_is_fresh() -> bool:
    return _cache_is_fresh(_fleet_projection_loaded_at)


def _invalidate_db_cache() -> None:
    """Invalidate all in-process projections without erasing known state."""
    global db_loaded, _db_cache_loaded_at, _notifications_cache_loaded_at, _routes_summary_cache_loaded_at
    global _routes_projection_loaded_at, _users_projection_loaded_at, _fleet_projection_loaded_at
    global _normalized_snapshot_ready
    db_loaded = False
    _db_cache_loaded_at = 0.0
    _notifications_cache_loaded_at = 0.0
    _routes_summary_cache_loaded_at = 0.0
    _routes_projection_loaded_at = 0.0
    _users_projection_loaded_at = 0.0
    _fleet_projection_loaded_at = 0.0
    # A destructive reconciliation is only safe against a complete snapshot;
    # writes invalidate that evidence until the next normalized reload.
    _normalized_snapshot_ready = False


def _reset_db_runtime_state() -> None:
    """Reset cache/circuit state for tests and controlled local diagnostics."""
    global _db_io_lock, _db_io_lock_loop, _db_circuit_failures, _db_circuit_open_until
    global _normalized_snapshot_ids, _normalized_snapshot_ready, login_index
    global _login_index_loaded_at
    _invalidate_db_cache()
    # El índice de acceso vive en memoria entre peticiones de una misma
    # instancia: sin limpiarlo, una prueba arrastraría el de la anterior.
    login_index = {}
    _login_index_loaded_at = None
    _db_io_lock = None
    _db_io_lock_loop = None
    with _db_circuit_state_lock:
        _db_circuit_failures = 0
        _db_circuit_open_until = 0.0
    _normalized_snapshot_ids = {}
    _normalized_snapshot_ready = False


def _get_db_io_lock() -> asyncio.Lock:
    """Return one lock per running event loop for single-flight database I/O."""
    global _db_io_lock, _db_io_lock_loop
    loop = asyncio.get_running_loop()
    if _db_io_lock is None or _db_io_lock_loop is not loop:
        _db_io_lock = asyncio.Lock()
        _db_io_lock_loop = loop
    return _db_io_lock


def _circuit_is_open() -> bool:
    global _db_circuit_failures, _db_circuit_open_until
    now = time.monotonic()
    with _db_circuit_state_lock:
        if _db_circuit_open_until > now:
            return True
        if _db_circuit_open_until:
            _db_circuit_failures = 0
            _db_circuit_open_until = 0.0
    return False


def _record_db_failure() -> None:
    global _db_circuit_failures, _db_circuit_open_until
    now = time.monotonic()
    with _db_circuit_state_lock:
        _db_circuit_failures += 1
        if _db_circuit_failures >= DB_CIRCUIT_FAILURE_THRESHOLD:
            _db_circuit_open_until = now + DB_CIRCUIT_COOLDOWN_SECONDS


def _record_db_success() -> None:
    global _db_circuit_failures, _db_circuit_open_until
    with _db_circuit_state_lock:
        _db_circuit_failures = 0
        _db_circuit_open_until = 0.0


def _response_size_bytes(response) -> Optional[int]:
    """Return a response size without logging or parsing response contents."""
    try:
        header_value = response.headers.get("content-length")
        if header_value is not None:
            return int(header_value)
    except (AttributeError, TypeError, ValueError):
        pass
    try:
        content = response.content
        if isinstance(content, (bytes, bytearray)):
            return len(content)
    except Exception:
        pass
    return None


def _log_db_metric(operation: str, status: Optional[int], started_at: float, response=None) -> None:
    """Emit a sanitized database metric; never include URLs, bodies, or PII."""
    payload = {
        "component": "database",
        "operation": operation,
        "status": status,
        "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
        "response_bytes": _response_size_bytes(response) if response is not None else None,
    }
    print("[KapitalMetrics] " + json.dumps(payload, separators=(",", ":")))


async def _db_http_request(
    method: str,
    url: str,
    *,
    operation: str,
    headers: Dict[str, str],
    timeout: float,
    json_payload: Optional[Dict[str, Any]] = None,
    failure_detail: str = DATABASE_UNAVAILABLE_DETAIL,
) -> Any:
    """Run a bounded provider request with retry/backoff and circuit breaking."""
    method_name = method.lower()
    write_request = method_name in {"post", "patch", "put", "delete"}
    _ensure_storage_ready(operation, write=write_request, detail=failure_detail)
    if _circuit_is_open():
        _raise_database_unavailable(
            operation,
            error=RuntimeError("database circuit open"),
            detail=failure_detail,
        )

    for attempt in range(DB_RETRY_MAX_ATTEMPTS):
        started_at = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                request_kwargs = {"headers": headers}
                if json_payload is not None:
                    request_kwargs["json"] = json_payload
                request_method = getattr(client, method_name)
                response = await request_method(url, **request_kwargs)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            _log_db_metric(operation, None, started_at)
            if attempt + 1 < DB_RETRY_MAX_ATTEMPTS:
                await asyncio.sleep(DB_RETRY_BASE_SECONDS * (2 ** attempt))
                continue
            _record_db_failure()
            _raise_database_unavailable(operation, error=exc, detail=failure_detail)
        except Exception as exc:
            _log_db_metric(operation, None, started_at)
            _record_db_failure()
            _raise_database_unavailable(operation, error=exc, detail=failure_detail)

        status = getattr(response, "status_code", None)
        _log_db_metric(operation, status, started_at, response)
        if isinstance(status, int) and 200 <= status < 300:
            _record_db_success()
            return response

        # A quota response (402) is not useful to retry. Temporary provider
        # failures and rate limits get one short exponential retry.
        retryable_status = status in {429, 503, 504}
        if retryable_status and attempt + 1 < DB_RETRY_MAX_ATTEMPTS:
            await asyncio.sleep(DB_RETRY_BASE_SECONDS * (2 ** attempt))
            continue

        if status in {402, 429, 503, 504}:
            _record_db_failure()
        return response


def _app_state_url(select: Optional[str] = None) -> str:
    return STORAGE_ADAPTER.state_url(select=select)


def _raise_database_unavailable(
    operation: str,
    *,
    status_code: Optional[int] = None,
    error: Optional[BaseException] = None,
    detail: str = DATABASE_UNAVAILABLE_DETAIL,
):
    """Raise a sanitized 503 without echoing Supabase response bodies."""
    _invalidate_db_cache()
    context = f"[Supabase] {operation} failed"
    if status_code is not None:
        context += f" status={status_code}"
    if error is not None:
        context += f" error={type(error).__name__}"
    print(context)
    raise HTTPException(status_code=503, detail=detail)


def _ensure_storage_ready(
    operation: str,
    *,
    write: bool = False,
    detail: str = DATABASE_UNAVAILABLE_DETAIL,
) -> None:
    """Fail closed before any request when the selected target is unsafe."""
    try:
        STORAGE_ADAPTER.assert_ready(write=write)
    except Exception as exc:
        _raise_database_unavailable(operation, error=exc, detail=detail)


def _state_row_or_raise(response, operation: str = "load") -> Dict[str, Any]:
    """Validate a successful singleton response without exposing its body."""
    if response.status_code != 200:
        _raise_database_unavailable(operation, status_code=response.status_code)
    try:
        rows = response.json()
    except (TypeError, ValueError) as exc:
        _raise_database_unavailable(operation, error=exc)
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        _raise_database_unavailable(operation, error=ValueError("invalid app_state shape"))
    data = rows[0]
    if (
        not isinstance(data.get("usuarios"), dict)
        or ("rutas" in data and not isinstance(data.get("rutas"), list))
    ):
        _raise_database_unavailable(operation, error=ValueError("invalid app_state data"))
    reserved_shapes = {
        "__routes_summary__": list,
        "__historial_rutas__": list,
        "__lock__": dict,
        "__flota__": dict,
        "__notifications__": list,
        "__actividad__": list,
        "__login__": dict,
    }
    for key, expected_type in reserved_shapes.items():
        if key in data["usuarios"] and not isinstance(data["usuarios"][key], expected_type):
            _raise_database_unavailable(operation, error=ValueError(f"invalid {key} type"))
    legacy_shapes = {
        "routes_summary": list,
        "historial": list,
        "lock": dict,
        "flota": dict,
        "notifications": list,
    }
    for key, expected_type in legacy_shapes.items():
        if key in data and not isinstance(data[key], expected_type):
            _raise_database_unavailable(operation, error=ValueError(f"invalid legacy {key} type"))
    return data


def _v2_epoch(value: Any) -> int:
    """Convert a Postgres timestamp into the legacy session epoch shape."""
    if isinstance(value, (int, float)):
        return int(value)
    if not value:
        return 0
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp())
    except (TypeError, ValueError, OverflowError):
        return 0


def _v2_timestamp(value: Any) -> Optional[str]:
    """Return a Postgres-compatible timestamp or None for malformed input."""
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).isoformat()
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _v2_date(value: Any) -> Optional[str]:
    """Normalize common legacy date strings before writing Postgres dates."""
    if value in (None, ""):
        return None
    text = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], pattern).date().isoformat()
        except (TypeError, ValueError):
            continue
    return None


def _v2_integer(value: Any, *, minimum: Optional[int] = None) -> Optional[int]:
    """Coerce legacy numeric fields without sending invalid values to Postgres."""
    if value in (None, ""):
        return None
    try:
        number = int(float(str(value).strip()))
    except (TypeError, ValueError, OverflowError):
        return None
    if minimum is not None and number < minimum:
        return None
    return number


def _v2_coordinate(value: Any, *, minimum: float, maximum: float) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(number) or number < minimum or number > maximum:
        return None
    return number


def _v2_legacy_status(value: Any) -> str:
    text = str(value or "Activo").strip()
    return {"active": "Activo", "inactive": "Inactivo", "pending": "Pendiente"}.get(
        text.lower(),
    ) or text


def _v2_decode_users(
    user_rows: List[Dict[str, Any]],
    credential_rows: List[Dict[str, Any]],
    profile_rows: List[Dict[str, Any]],
    session_rows: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    credentials = {str(row.get("user_id")): row for row in credential_rows if row.get("user_id")}
    profiles = {str(row.get("user_id")): row for row in profile_rows if row.get("user_id")}
    sessions_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for row in session_rows:
        user_id = str(row.get("user_id")) if row.get("user_id") else ""
        if not user_id:
            continue
        sessions_by_user.setdefault(user_id, []).append({
            "token_hash": row.get("token_hash"),
            "created_at": _v2_epoch(row.get("issued_at") or row.get("created_at")),
            "expires_at": _v2_epoch(row.get("expires_at")),
            "revoked_at": row.get("revoked_at"),
            "_normalized_id": str(row.get("id")) if row.get("id") else None,
        })

    result: Dict[str, Dict[str, Any]] = {}
    for row in user_rows:
        user_id = str(row.get("id")) if row.get("id") else ""
        identifier = str(
            row.get("login_identifier")
            or row.get("email")
            or row.get("government_id")
            or user_id
        ).strip()
        if not user_id or not identifier:
            continue
        credential = credentials.get(user_id, {})
        user: Dict[str, Any] = {
            "identifier": identifier,
            "email": row.get("email"),
            "dni": row.get("government_id"),
            "password": credential.get("password_hash"),
            "nombre": row.get("display_name") or identifier,
            "rol": row.get("role_code") or "Usuario",
            "unidad_id": row.get("unit_id"),
            "empresa_id": row.get("company_id"),
            "estado": _v2_legacy_status(row.get("status_code")),
            "needs_password_change": bool(
                row.get("needs_password_change") or credential.get("needs_reset")
            ),
            "last_login": row.get("last_login_at"),
            "_normalized_id": user_id,
            "_auth_sessions": sessions_by_user.get(user_id, []),
        }
        profile = profiles.get(user_id)
        if profile is not None:
            changes = profile.get("change_requests")
            user["perfil_conductor"] = {
                "direccion": profile.get("address"),
                "numDoc": profile.get("document_number"),
                "fechaNacimiento": profile.get("birth_date"),
                "telefonoDirecto": profile.get("direct_phone"),
                "placa": profile.get("vehicle_plate"),
                "estado": profile.get("profile_status"),
                "solicitudes_cambio": changes if isinstance(changes, dict) else {},
            }
        result[identifier] = user
    return result


def _v2_decode_fleet(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        unit_id = str(row.get("unit_id") or "").strip()
        if not unit_id:
            continue
        result[unit_id] = {
            "placa": row.get("plate"),
            "capacidad": row.get("capacity"),
            "tipo": row.get("vehicle_type"),
            "chofer": row.get("driver_name"),
            "soat": row.get("soat_value"),
            "revision": row.get("inspection_value"),
            "atu": row.get("atu_value"),
            "licencia": row.get("license_value"),
            "_normalized_id": unit_id,
        }
    return result


def _v2_decode_notifications(
    rows: List[Dict[str, Any]],
    users: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    identifier_by_id = {
        str(user.get("_normalized_id")): user.get("identifier")
        for user in users.values()
        if user.get("_normalized_id")
    }
    result: List[Dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        source_id = row.get("source_notification_id")
        try:
            legacy_id: Any = int(source_id) if source_id not in (None, "") else index
        except (TypeError, ValueError):
            legacy_id = index
        recipient = identifier_by_id.get(str(row.get("recipient_user_id")))
        result.append({
            "id": legacy_id,
            "title": row.get("title"),
            "message": row.get("message"),
            "type": row.get("notification_type") or "info",
            "timestamp": row.get("created_at") or row.get("updated_at"),
            "para": recipient or row.get("audience_code"),
            "leido": row.get("read_at") is not None,
            "_normalized_id": str(row.get("id")) if row.get("id") else None,
        })
    return result


def _v2_decode_routes(
    route_rows: List[Dict[str, Any]],
    passenger_rows: List[Dict[str, Any]],
    assignment_rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    passengers = {str(row.get("id")): row for row in passenger_rows if row.get("id")}
    assignments: Dict[str, List[Dict[str, Any]]] = {}
    for row in assignment_rows:
        route_id = str(row.get("route_id")) if row.get("route_id") else ""
        if route_id:
            assignments.setdefault(route_id, []).append(row)
    routes: List[Dict[str, Any]] = []
    for row in route_rows:
        route_id = str(row.get("id")) if row.get("id") else ""
        if not route_id:
            continue
        agents: List[Dict[str, Any]] = []
        sorted_assignments = sorted(
            assignments.get(route_id, []),
            key=lambda item: item.get("assignment_order")
            if item.get("assignment_order") is not None
            else 0,
        )
        for assignment in sorted_assignments:
            passenger = passengers.get(str(assignment.get("passenger_id")), {})
            legacy_id = passenger.get("legacy_identifier") or passenger.get("id")
            if legacy_id is None:
                continue
            agents.append({
                "id": legacy_id,
                "nombre": passenger.get("full_name"),
                "empresa": passenger.get("company_id"),
                "direccion": passenger.get("address"),
                "lat": passenger.get("latitude"),
                "lng": passenger.get("longitude"),
                "estado": assignment.get("status_code") or passenger.get("status_code"),
                "_normalized_id": str(passenger.get("id")) if passenger.get("id") else None,
            })
        routes.append({
            "conductor": row.get("unit_id") or "SIN ASIGNAR",
            "micro_zona": row.get("zone") or "unknown",
            "horario": row.get("schedule") or "unknown",
            "fecha": row.get("route_date"),
            "estado": row.get("status_code"),
            "agentes": agents,
            "_normalized_id": route_id,
        })
    return routes


def _v2_decode_snapshot(rows_by_resource: Mapping[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    users = _v2_decode_users(
        rows_by_resource.get("app_users", []),
        rows_by_resource.get("auth_credentials", []),
        rows_by_resource.get("driver_profiles", []),
        rows_by_resource.get("auth_sessions", []),
    )
    routes = _v2_decode_routes(
        rows_by_resource.get("routes", []),
        rows_by_resource.get("passengers", []),
        rows_by_resource.get("route_passengers", []),
    )
    summary = _build_routes_summary(routes)
    return {
        "usuarios": users,
        "rutas": routes,
        "routes_summary": summary,
        "historial_rutas": [
            {
                "id": row.get("id"),
                "operation": row.get("operation_code"),
                "route_count": row.get("route_count"),
                "passenger_count": row.get("passenger_count"),
                "captured_at": row.get("captured_at"),
            }
            for row in rows_by_resource.get("route_history", [])
        ],
        "board_lock": {
            str(row.get("board_name")): {
                "owner_user_id": row.get("owner_user_id"),
                "lease_until": row.get("lease_until"),
                "version": row.get("version"),
                "updated_at": row.get("updated_at"),
            }
            for row in rows_by_resource.get("board_locks", [])
            if row.get("board_name")
        },
        "notifications": _v2_decode_notifications(
            rows_by_resource.get("notifications", []),
            users,
        ),
        "flota": _v2_decode_fleet(rows_by_resource.get("fleet_units", [])),
    }


async def _load_normalized_login_user(identifier: str) -> Optional[Dict[str, Any]]:
    """Load only the user/auth rows needed for a V2 login.

    Login must not download fleet, route, passenger, notification, history, or
    document data.  The full normalized snapshot remains available for legacy
    endpoints, but the auth path can resolve a single user and its credential,
    profile, and session rows first.
    """
    cleaned = str(identifier or "").strip()
    if not cleaned:
        return None
    lookup_candidates = (
        (
            "login_identifier_sha256",
            hashlib.sha256(cleaned.lower().encode("utf-8")).hexdigest(),
        ),
        ("login_identifier", cleaned),
        ("email", cleaned),
        ("government_id", cleaned),
    )
    user_rows: List[Dict[str, Any]] = []
    for column, value in lookup_candidates:
        user_rows = await STORAGE_ADAPTER.fetch_rows(
            "app_users",
            filters={column: f"eq.{value}"},
            limit=1,
            operation="load_login_user",
        )
        if user_rows:
            break
    if not user_rows:
        return None
    user_id = str(user_rows[0].get("id") or "")
    if not user_id:
        return None
    credential_rows = await STORAGE_ADAPTER.fetch_rows(
        "auth_credentials",
        filters={"user_id": f"eq.{user_id}"},
        limit=1,
        operation="load_login_credentials",
    )
    profile_rows = await STORAGE_ADAPTER.fetch_rows(
        "driver_profiles",
        filters={"user_id": f"eq.{user_id}"},
        limit=1,
        operation="load_login_profile",
    )
    session_rows = await STORAGE_ADAPTER.fetch_rows(
        "auth_sessions",
        filters={"user_id": f"eq.{user_id}"},
        order="expires_at.desc",
        limit=5,
        operation="load_login_sessions",
    )
    decoded = _v2_decode_users(user_rows, credential_rows, profile_rows, session_rows)
    user = next(iter(decoded.values()), None)
    if user is not None:
        usuarios_db[user["identifier"]] = user
    return user


async def _fetch_normalized_snapshot() -> Dict[str, List[Dict[str, Any]]]:
    """Load normalized relational data without fetching document binaries."""
    resources = (
        "app_users",
        "auth_credentials",
        "auth_sessions",
        "driver_profiles",
        "fleet_units",
        "routes",
        "passengers",
        "route_passengers",
        "notifications",
        "route_history",
        "board_locks",
    )
    result: Dict[str, List[Dict[str, Any]]] = {}
    for resource in resources:
        result[resource] = await STORAGE_ADAPTER.fetch_rows(
            resource,
            operation=f"load_{resource}",
        )
    return result


def _normalized_snapshot_keys(rows_by_resource: Mapping[str, List[Dict[str, Any]]]) -> Dict[str, set[str]]:
    key_by_resource = {
        "app_users": "id",
        "auth_credentials": "user_id",
        "auth_sessions": "id",
        "driver_profiles": "user_id",
        "fleet_units": "unit_id",
        "routes": "id",
        "passengers": "id",
        "route_passengers": "assignment_id",
        "notifications": "id",
        "route_history": "id",
        "board_locks": "board_name",
    }
    return {
        resource: {
            str(row[key])
            for row in rows_by_resource.get(resource, [])
            if row.get(key) not in (None, "")
        }
        for resource, key in key_by_resource.items()
    }


async def _load_normalized_state_locked() -> None:
    """Load V2 resources once and atomically rebuild the legacy globals."""
    global db_loaded, rutas_estado_actual, usuarios_db, conductores_db
    global historial_rutas, board_lock, routes_summary, notifications_db, actividad_db, login_index
    global session_index
    global _normalized_snapshot_ids, _normalized_snapshot_ready
    rows_by_resource = await _fetch_normalized_snapshot()
    decoded = _v2_decode_snapshot(rows_by_resource)
    usuarios_db = decoded["usuarios"]
    rutas_estado_actual = decoded["rutas"]
    routes_summary = decoded["routes_summary"]
    historial_rutas = decoded["historial_rutas"]
    board_lock = decoded["board_lock"]
    notifications_db = decoded["notifications"]
    actividad_db = decoded.get("actividad", [])
    session_index = decoded.get("sessions") if isinstance(decoded.get("sessions"), dict) else {}
    login_index = decoded.get("login_index") if isinstance(decoded.get("login_index"), dict) else {}
    conductores_db = decoded["flota"]
    _normalized_snapshot_ids = _normalized_snapshot_keys(rows_by_resource)
    _normalized_snapshot_ready = True
    db_loaded = True
    loaded_at = time.monotonic()
    global _db_cache_loaded_at, _notifications_cache_loaded_at, _routes_summary_cache_loaded_at
    global _routes_projection_loaded_at, _users_projection_loaded_at, _fleet_projection_loaded_at
    _db_cache_loaded_at = loaded_at
    _notifications_cache_loaded_at = loaded_at
    _routes_summary_cache_loaded_at = loaded_at
    _routes_projection_loaded_at = loaded_at
    _users_projection_loaded_at = loaded_at
    _fleet_projection_loaded_at = loaded_at


async def _persist_app_state(payload: Dict[str, Any], operation: str) -> None:
    """Persist state and fail closed without echoing Supabase response bodies."""
    if _is_normalized_storage():
        await _persist_normalized_state(operation)
        return
    headers = _build_supabase_headers(
        STORAGE_CONFIG.key,
        prefer="return=minimal",
    )
    async with _get_db_io_lock():
        response = await _db_http_request(
            "PATCH",
            _app_state_url(),
            operation=operation,
            headers=headers,
            timeout=30.0,
            json_payload=payload,
            failure_detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
        )
    if response.status_code not in (200, 204):
        _raise_database_unavailable(
            operation,
            status_code=response.status_code,
            detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
        )
    # Force the next read to confirm the remote snapshot. This is important
    # when another warm Vercel instance may have written between requests.
    _invalidate_db_cache()


def _v2_hash_is_supported(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(
        ("pbkdf2_sha256$", "bcrypt$", "$2a$", "$2b$", "$2y$", "$argon2")
    )


def _v2_password_scheme(value: Any) -> str:
    if isinstance(value, str) and value.startswith("pbkdf2_sha256$"):
        return "pbkdf2_sha256"
    if isinstance(value, str) and value.startswith(("bcrypt$", "$2a$", "$2b$", "$2y$")):
        return "bcrypt"
    if isinstance(value, str) and value.startswith("$argon2"):
        return "argon2"
    return "unknown"


def _v2_user_payloads() -> Dict[str, List[Dict[str, Any]]]:
    users: List[Dict[str, Any]] = []
    profiles: List[Dict[str, Any]] = []
    credentials: List[Dict[str, Any]] = []
    sessions: List[Dict[str, Any]] = []
    for key, user in usuarios_db.items():
        if not isinstance(user, dict) or str(key).startswith("__"):
            continue
        identifier = str(user.get("identifier") or key).strip()
        if not identifier:
            continue
        user_id = str(user.get("_normalized_id") or uuid.uuid4())
        user["_normalized_id"] = user_id
        password_value = user.get("password")
        password_hash = password_value if _v2_hash_is_supported(password_value) else None
        if password_value not in (None, "") and password_hash is None:
            # V2 never writes plaintext. OLD retains its compatibility setting.
            password_hash = hash_password(str(password_value))
            user["password"] = password_hash
        last_login_at = _v2_timestamp(user.get("last_login"))
        unit_id = user.get("unidad_id")
        if unit_id in (None, ""):
            unit_id = None
        elif str(unit_id) not in conductores_db:
            unit_id = None
        users.append({
            "id": user_id,
            "login_identifier": identifier,
            "login_identifier_sha256": hashlib.sha256(identifier.lower().encode("utf-8")).hexdigest(),
            "role_code": str(user.get("rol") or "Usuario"),
            "status_code": str(user.get("estado") or "Activo"),
            "unit_id": unit_id,
            "company_id": user.get("empresa_id"),
            "display_name": user.get("nombre") or identifier,
            "email": user.get("email"),
            "government_id": user.get("dni"),
            "phone": user.get("telefono") or user.get("celular"),
            "needs_password_change": bool(user.get("needs_password_change", False)),
            **({"last_login_at": last_login_at} if last_login_at else {}),
        })
        credentials.append({
            "user_id": user_id,
            "password_hash": password_hash,
            "password_scheme": _v2_password_scheme(password_hash),
            # The current backend verifies PBKDF2 and legacy plaintext only;
            # leave other accepted database schemes marked for reset.
            "needs_reset": bool(
                user.get("needs_password_change", False)
                or not password_hash
                or not (isinstance(password_hash, str) and password_hash.startswith("pbkdf2_sha256$"))
            ),
        })
        profile = user.get("perfil_conductor")
        if isinstance(profile, dict):
            profiles.append({
                "user_id": user_id,
                "address": profile.get("direccion"),
                "document_number": profile.get("numDoc"),
                "birth_date": _v2_date(profile.get("fechaNacimiento")),
                "direct_phone": profile.get("telefonoDirecto") or profile.get("telefono"),
                "vehicle_plate": profile.get("placa") or profile.get("vehiculoPlaca"),
                "profile_status": profile.get("estado"),
                "change_requests": profile.get("solicitudes_cambio") or {},
            })
        for session in user.get("_auth_sessions", []):
            if not isinstance(session, dict):
                continue
            token_hash = session.get("token_hash")
            issued_at = _v2_timestamp(session.get("issued_at") or session.get("created_at"))
            expires_at = _v2_timestamp(session.get("expires_at"))
            if not token_hash or not issued_at or not expires_at:
                continue
            sessions.append({
                "id": str(session.get("_normalized_id") or uuid.uuid4()),
                "user_id": user_id,
                "token_hash": token_hash,
                "issued_at": issued_at,
                "expires_at": expires_at,
                **({
                    "revoked_at": revoked_at,
                } if (revoked_at := _v2_timestamp(session.get("revoked_at"))) else {}),
            })
    return {
        "app_users": users,
        "driver_profiles": profiles,
        "auth_credentials": credentials,
        "auth_sessions": sessions,
    }


def _v2_route_payloads() -> Dict[str, List[Dict[str, Any]]]:
    routes: List[Dict[str, Any]] = []
    passengers: Dict[str, Dict[str, Any]] = {}
    assignments: List[Dict[str, Any]] = []
    for route_index, route in enumerate(rutas_estado_actual, start=1):
        if not isinstance(route, dict):
            continue
        conductor = str(route.get("conductor") or "SIN ASIGNAR")
        zone = str(route.get("micro_zona") or "unknown")
        schedule = str(route.get("horario") or "unknown")
        route_key = f"{route_index}|{conductor}|{zone}|{schedule}"
        route_id = str(route.get("_normalized_id") or uuid.uuid5(V2_NAMESPACE, f"route:{route_key}"))
        routes.append({
            "id": route_id,
            "unit_id": conductor if conductor in conductores_db else None,
            "zone": zone,
            "schedule": schedule,
            "status_code": route.get("estado") or "active",
            "source_key_sha256": hashlib.sha256(route_key.encode("utf-8")).hexdigest(),
            **({"route_date": _v2_date(route.get("fecha"))} if _v2_date(route.get("fecha")) else {}),
        })
        for assignment_index, agent in enumerate(route.get("agentes", [])):
            if not isinstance(agent, dict):
                continue
            legacy_id = str(agent.get("id") or f"missing:{route_index}:{assignment_index}")
            passenger_id = str(
                agent.get("_normalized_id")
                or uuid.uuid5(V2_NAMESPACE, f"passenger:{legacy_id}")
            )
            passengers.setdefault(passenger_id, {
                "id": passenger_id,
                "legacy_identifier": legacy_id,
                "legacy_identifier_sha256": hashlib.sha256(legacy_id.encode("utf-8")).hexdigest(),
                "full_name": agent.get("nombre"),
                "company_id": agent.get("empresa"),
                "address": agent.get("direccion"),
                "latitude": _v2_coordinate(agent.get("lat"), minimum=-90, maximum=90),
                "longitude": _v2_coordinate(agent.get("lng"), minimum=-180, maximum=180),
                "status_code": agent.get("estado"),
            })
            assignments.append({
                "assignment_id": str(
                    agent.get("_assignment_id")
                    or uuid.uuid5(V2_NAMESPACE, f"assignment:{route_id}:{assignment_index}")
                ),
                "route_id": route_id,
                "passenger_id": passenger_id,
                "assignment_order": _v2_integer(assignment_index, minimum=0),
                "status_code": agent.get("estado"),
            })
    return {"routes": routes, "passengers": list(passengers.values()), "route_passengers": assignments}


def _v2_notification_payloads() -> List[Dict[str, Any]]:
    user_ids = {
        str(user.get("identifier")): str(user.get("_normalized_id"))
        for user in usuarios_db.values()
        if isinstance(user, dict) and user.get("_normalized_id")
    }
    rows: List[Dict[str, Any]] = []
    for index, notification in enumerate(notifications_db, start=1):
        if not isinstance(notification, dict):
            continue
        recipient_raw = notification.get("para") or notification.get("recipient")
        recipient_id = user_ids.get(str(recipient_raw)) if recipient_raw else None
        audience = notification.get("audience_code") or (str(recipient_raw) if not recipient_id else None) or "admin"
        row: Dict[str, Any] = {
            "id": str(notification.get("_normalized_id") or uuid.uuid5(V2_NAMESPACE, f"notification:{notification.get('id', index)}")),
            "recipient_user_id": recipient_id,
            "audience_code": audience if not recipient_id else None,
            "notification_type": notification.get("type") or notification.get("tipo") or "info",
            "title": notification.get("title"),
            "message": notification.get("message"),
            "source_notification_id": str(notification.get("id")) if notification.get("id") is not None else None,
        }
        timestamp = _v2_timestamp(notification.get("timestamp") or notification.get("created_at"))
        if timestamp:
            row["created_at"] = timestamp
            if notification.get("leido"):
                row["read_at"] = timestamp
        rows.append(row)
    return rows


def _v2_history_payloads() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for index, item in enumerate(historial_rutas, start=1):
        if not isinstance(item, dict):
            continue
        captured_at = _v2_timestamp(item.get("captured_at"))
        rows.append({
            "id": str(item.get("_normalized_id") or uuid.uuid5(V2_NAMESPACE, f"history:{index}:{item.get('id', '')}")),
            "operation_code": str(item.get("operation") or item.get("operacion") or "snapshot"),
            "route_count": _v2_integer(item.get("route_count"), minimum=0),
            "passenger_count": _v2_integer(item.get("passenger_count"), minimum=0),
            **({"captured_at": captured_at} if captured_at else {}),
        })
    return rows


def _v2_lock_payloads() -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    user_ids = {
        str(user.get("identifier")): str(user.get("_normalized_id"))
        for user in usuarios_db.values()
        if isinstance(user, dict) and user.get("_normalized_id")
    }
    for board_name, value in board_lock.items():
        if board_name == "routes_summary":
            continue
        payload = value if isinstance(value, dict) else {}
        if not str(board_name).strip():
            continue
        owner = payload.get("owner_user_id")
        owner_user_id = None
        if owner:
            owner_user_id = user_ids.get(str(owner))
            # A decoded normalized snapshot already stores the UUID.  Keep it
            # stable across a read-modify-write cycle instead of dropping the
            # ownership foreign key when no legacy identifier is available.
            if owner_user_id is None:
                owner_text = str(owner)
                if any(owner_text == normalized_id for normalized_id in user_ids.values()):
                    owner_user_id = owner_text
        rows.append({
            "board_name": str(board_name),
            "owner_user_id": owner_user_id,
            "lease_until": _v2_timestamp(payload.get("lease_until")),
            "version": _v2_integer(payload.get("version") or 1, minimum=1) or 1,
        })
    return rows


async def _persist_normalized_state(operation: str) -> None:
    """Persist normalized tables in bounded, non-document batches."""
    payloads: Dict[str, List[Dict[str, Any]]] = {}
    payloads.update(_v2_user_payloads())
    payloads.update(_v2_route_payloads())
    payloads["fleet_units"] = [
        {
            "unit_id": str(unit_id),
            "plate": data.get("placa"),
            "vehicle_type": data.get("tipo"),
            "capacity": _v2_integer(data.get("capacidad"), minimum=0),
            "driver_name": data.get("chofer"),
            "soat_value": data.get("soat"),
            "inspection_value": data.get("revision"),
            "atu_value": data.get("atu"),
            "license_value": data.get("licencia"),
        }
        for unit_id, data in conductores_db.items()
        if isinstance(data, dict) and str(unit_id).strip()
    ]
    payloads["notifications"] = _v2_notification_payloads()
    payloads["route_history"] = _v2_history_payloads()
    payloads["board_locks"] = _v2_lock_payloads()

    upsert_plan = (
        ("fleet_units", "unit_id"),
        ("app_users", "id"),
        ("driver_profiles", "user_id"),
        ("auth_credentials", "user_id"),
        ("auth_sessions", "id"),
        ("passengers", "id"),
        ("routes", "id"),
        ("route_passengers", "assignment_id"),
        ("notifications", "id"),
        ("route_history", "id"),
        ("board_locks", "board_name"),
    )
    # Keep user/auth mutations small.  The legacy persist_users_only() path
    # intentionally carries notifications and locks because those values were
    # co-located in app_state; it must not re-upload routes/passengers/fleet on
    # every login or profile change.  Full route operations still reconcile the
    # complete normalized graph.
    if operation.startswith("persist_users"):
        resources_to_write = {
            "app_users",
            "driver_profiles",
            "auth_credentials",
            "auth_sessions",
            "notifications",
            "board_locks",
        }
    elif operation.startswith("persist_fleet"):
        resources_to_write = {"fleet_units"}
    else:
        resources_to_write = {resource for resource, _ in upsert_plan}
    for resource, conflict_key in upsert_plan:
        if resource not in resources_to_write:
            continue
        await STORAGE_ADAPTER.upsert_rows(
            resource,
            payloads.get(resource, []),
            conflict_key=conflict_key,
            operation=f"{operation}:{resource}",
        )

    # Deletes are only reconciled after a complete snapshot was loaded. This
    # prevents an empty/partial cache from becoming a destructive remote write.
    if _normalized_snapshot_ready:
        delete_plan = (
            ("auth_sessions", "id"),
            ("auth_credentials", "user_id"),
            ("driver_profiles", "user_id"),
            ("notifications", "id"),
            ("route_passengers", "assignment_id"),
            ("routes", "id"),
            ("passengers", "id"),
            ("route_history", "id"),
            ("board_locks", "board_name"),
            ("fleet_units", "unit_id"),
            ("app_users", "id"),
        )
        current_keys = _normalized_snapshot_keys(payloads)
        for resource, id_column in delete_plan:
            if resource not in resources_to_write:
                continue
            removed = sorted(_normalized_snapshot_ids.get(resource, set()) - current_keys.get(resource, set()))
            if not removed:
                continue
            if len(removed) > 500:
                _raise_database_unavailable(
                    f"{operation}:{resource}",
                    error=ValueError("normalized delete set is unexpectedly large"),
                    detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
                )
            await STORAGE_ADAPTER.delete_ids(
                resource,
                removed,
                id_column=id_column,
                operation=f"{operation}:{resource}_delete",
            )
    _invalidate_db_cache()


def _build_routes_summary(routes: list) -> list:
    """Build a compact route summary (no agent details) for GerentePortal."""
    return [
        {
            "conductor": r.get("conductor", "SIN ASIGNAR"),
            "micro_zona": r.get("micro_zona", ""),
            "horario": r.get("horario", ""),
            "count": len(r.get("agentes", [])),
        }
        for r in routes
    ]

_MISSING = object()


def _default_fleet() -> Dict[str, Dict[str, Any]]:
    """Return the compatibility fleet used only by an empty legacy snapshot."""
    return {
        "KAP-001": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Juan Pérez", "soat": "2027-01-15", "revision": "2027-02-10", "atu": "2027-03-20", "licencia": "2028-05-10"},
        "KAP-002": {"capacidad": 15, "tipo": "Sprinter", "chofer": "Carlos Gómez", "soat": "2026-08-05", "revision": "2026-11-20", "atu": "2026-12-01", "licencia": "2027-04-15"},
        "KAP-003": {"capacidad": 10, "tipo": "Van", "chofer": "Luis Ramírez", "soat": "2027-05-10", "revision": "2026-09-15", "atu": "2026-10-30", "licencia": "2029-01-20"},
        "KAP-004": {"capacidad": 12, "tipo": "Sprinter", "chofer": "Miguel Torres", "soat": "2026-10-01", "revision": "2027-01-05", "atu": "2026-06-15", "licencia": "2028-11-10"},
    }


def _decode_full_state(data: Dict[str, Any], *, include_defaults: bool) -> Dict[str, Any]:
    """Decode a validated app_state row without mutating the HTTP response."""
    raw_users = data.get("usuarios", {})
    usuarios = dict(raw_users)
    has_canonical_flota = "__flota__" in usuarios
    has_legacy_flota = "flota" in data
    decoded = {
        "usuarios": usuarios,
        "rutas": list(data.get("rutas", [])),
        "routes_summary": usuarios.pop("__routes_summary__", data.get("routes_summary", [])),
        "historial_rutas": usuarios.pop("__historial_rutas__", data.get("historial", [])),
        "board_lock": usuarios.pop("__lock__", data.get("lock", {})),
        "notifications": usuarios.pop("__notifications__", data.get("notifications", [])),
        "actividad": usuarios.pop("__actividad__", []),
        "flota": usuarios.pop("__flota__", data.get("flota", _MISSING)),
        "sessions": usuarios.pop("__sessions__", {}) or {},
        "login_index": usuarios.pop("__login__", {}) or {},
        "has_canonical_flota": has_canonical_flota,
        "has_legacy_flota": has_legacy_flota,
    }
    if include_defaults and not has_canonical_flota and not has_legacy_flota:
        if decoded["flota"] is _MISSING or not decoded["flota"]:
            decoded["flota"] = _default_fleet()
    # Aquí se sembraba una cuenta «TELEPERFORMANCE» con la contraseña «1234»
    # escrita en el código, en cada lectura del estado y en los dos decodificadores.
    # Era una credencial conocida sobre una cuenta real y en uso, y como se
    # reinyectaba siempre, borrarla no servía de nada: volvía sola.
    #
    # La cuenta existe en la fila con su propio historial, así que quitar la
    # siembra no se la lleva por delante; solo impide que resucite. Una cuenta
    # nueva se da de alta como cualquier otra, no apareciendo de la nada.
    return decoded


async def _load_full_state_locked(*, include_defaults: bool) -> None:
    """Load and atomically apply the full state; caller owns the I/O lock."""
    if _is_normalized_storage():
        await _load_normalized_state_locked()
        return
    global db_loaded, rutas_estado_actual, usuarios_db, conductores_db
    global historial_rutas, board_lock, routes_summary, notifications_db, actividad_db, login_index
    global session_index
    response = await _db_http_request(
        "GET",
        _app_state_url(),
        operation="load",
        headers=HEADERS,
        timeout=30.0,
    )
    data = _state_row_or_raise(response)
    decoded = _decode_full_state(data, include_defaults=include_defaults)
    # Apply the snapshot only after every shape has been validated. A failed
    # provider response therefore leaves the last known in-memory state intact.
    usuarios_db = decoded["usuarios"]
    rutas_estado_actual = decoded["rutas"]
    routes_summary = decoded["routes_summary"]
    historial_rutas = decoded["historial_rutas"]
    board_lock = decoded["board_lock"]
    notifications_db = decoded["notifications"]
    actividad_db = decoded.get("actividad", [])
    session_index = decoded.get("sessions") if isinstance(decoded.get("sessions"), dict) else {}
    login_index = decoded.get("login_index") if isinstance(decoded.get("login_index"), dict) else {}
    if decoded["flota"] is not _MISSING:
        conductores_db = decoded["flota"]
    db_loaded = True
    loaded_at = time.monotonic()
    global _db_cache_loaded_at, _notifications_cache_loaded_at, _routes_summary_cache_loaded_at
    global _routes_projection_loaded_at, _users_projection_loaded_at, _fleet_projection_loaded_at
    _db_cache_loaded_at = loaded_at
    _notifications_cache_loaded_at = loaded_at
    _routes_summary_cache_loaded_at = loaded_at
    _routes_projection_loaded_at = loaded_at
    _users_projection_loaded_at = loaded_at
    _fleet_projection_loaded_at = loaded_at


async def _load_full_state(*, include_defaults: bool, force: bool = False) -> None:
    if not force and _full_cache_is_fresh():
        return
    try:
        async with _get_db_io_lock():
            # A concurrent request may have filled the cache while this one
            # waited. Re-check even for force loads to retain single-flight.
            if not force and _full_cache_is_fresh():
                return
            await _load_full_state_locked(include_defaults=include_defaults)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load", error=exc)


async def ensure_db_loaded():
    """Load the canonical state once, retaining legacy fleet compatibility."""
    await _load_full_state(include_defaults=True)


async def reload_db(force: bool = False):
    """Refresh the full snapshot with a bounded TTL and single-flight lock."""
    await _load_full_state(include_defaults=False, force=force)


def _projection_rows_or_raise(response, operation: str) -> List[Dict[str, Any]]:
    if response.status_code != 200:
        _raise_database_unavailable(operation, status_code=response.status_code)
    try:
        rows = response.json()
    except (TypeError, ValueError) as exc:
        _raise_database_unavailable(operation, error=exc)
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        _raise_database_unavailable(operation, error=ValueError("invalid app_state projection shape"))
    return rows


def _projection_value(row: Dict[str, Any], key: str):
    """Accept PostgREST JSON-path and compatibility response shapes."""
    candidates = (
        f"usuarios->{key}",
        f"usuarios->>{key}",
        f"usuarios__{key}",
        key,
    )
    for candidate in candidates:
        if candidate in row:
            return row[candidate]
    raw_users = row.get("usuarios", _MISSING)
    if isinstance(raw_users, dict):
        if key in raw_users:
            return raw_users[key]
        if f"__{key.strip('_')}__" in raw_users:
            return raw_users[f"__{key.strip('_')}__"]
    elif raw_users is not _MISSING:
        # A JSON-path projection may return the selected value under the
        # usuarios alias rather than preserving the original object.
        return raw_users
    if len(row) == 1:
        only_value = next(iter(row.values()))
        if isinstance(only_value, dict):
            if key in only_value:
                return only_value[key]
            if f"__{key.strip('_')}__" in only_value:
                return only_value[f"__{key.strip('_')}__"]
    return _MISSING


async def _fetch_projection_value(key: str, operation: str):
    """Fetch a reserved JSON value, falling back to the users object."""
    response = await _db_http_request(
        "GET",
        _app_state_url(select=f"usuarios->{key}"),
        operation=operation,
        headers=HEADERS,
        timeout=10.0,
    )
    # Older PostgREST versions may reject a JSON-path select. In that case,
    # retry with the compatible users-object projection before using the full
    # snapshot fallback. Other provider errors retain the normal 503 path.
    if response.status_code in {400, 406}:
        value = _MISSING
    else:
        value = _projection_value(_projection_rows_or_raise(response, operation)[0], key)
    if value is not _MISSING:
        return value
    response = await _db_http_request(
        "GET",
        _app_state_url(select="usuarios"),
        operation=operation,
        headers=HEADERS,
        timeout=10.0,
    )
    return _projection_value(_projection_rows_or_raise(response, operation)[0], key)


async def _fetch_top_level_projection_value(key: str, operation: str):
    """Fetch one top-level legacy column without downloading app_state.

    The compatibility row keeps routes in a separate JSONB column.  PostgREST
    can return that column alone (``select=rutas``), which is materially
    smaller than the full ``usuarios+rutas`` snapshot.  A projection rejected
    by an older Data API is returned as ``_MISSING`` so callers can fall back
    to the validated full-state loader instead of silently serving partial
    data.
    """
    response = await _db_http_request(
        "GET",
        _app_state_url(select=key),
        operation=operation,
        headers=HEADERS,
        timeout=10.0,
    )
    if response.status_code in {400, 406}:
        return _MISSING
    return _projection_value(_projection_rows_or_raise(response, operation)[0], key)


def _compat_users_from_projection(value: Any, operation: str) -> Dict[str, Dict[str, Any]]:
    """Decode only the user object from a legacy compatibility projection."""
    if not isinstance(value, dict):
        _raise_database_unavailable(operation, error=ValueError("invalid usuarios projection"))
    # A normal ``select=usuarios`` response is a mapping keyed by login
    # identifier.  Accept a single user object too: this keeps the decoder
    # compatible with older PostgREST JSON-path responses and fixtures.
    if any(field in value for field in ("identifier", "email", "dni", "password")):
        identifier = str(value.get("identifier") or value.get("email") or value.get("dni") or "").strip()
        users = {identifier: value} if identifier else {}
    else:
        users = {
            str(identifier): user
            for identifier, user in value.items()
            if not str(identifier).startswith("__") and isinstance(user, dict)
        }
    # Aquí se sembraba una cuenta «TELEPERFORMANCE» con la contraseña «1234»
    # escrita en el código, en cada lectura del estado y en los dos decodificadores.
    # Era una credencial conocida sobre una cuenta real y en uso, y como se
    # reinyectaba siempre, borrarla no servía de nada: volvía sola.
    #
    # La cuenta existe en la fila con su propio historial, así que quitar la
    # siembra no se la lleva por delante; solo impide que resucite. Una cuenta
    # nueva se da de alta como cualquier otra, no apareciendo de la nada.
    return users


def _compat_find_user(users: Mapping[str, Dict[str, Any]], identifier: str) -> Optional[Dict[str, Any]]:
    """Resolve an identifier from a partial users projection."""
    cleaned = str(identifier or "").strip()
    if not cleaned:
        return None
    user = users.get(cleaned)
    if isinstance(user, dict):
        return user
    cleaned_lower = cleaned.lower()
    for key, candidate in users.items():
        if not isinstance(candidate, dict):
            continue
        if str(key).strip().lower() == cleaned_lower:
            return candidate
        for alias in (
            candidate.get("identifier"),
            candidate.get("email"),
            candidate.get("dni"),
            candidate.get("login_identifier"),
        ):
            if alias and str(alias).strip().lower() == cleaned_lower:
                return candidate
        profile = candidate.get("perfil_conductor", {})
        if isinstance(profile, dict) and str(profile.get("numDoc") or "") == cleaned:
            return candidate
    return None


async def _fetch_compat_users_object(operation: str):
    """Fetch the users JSONB column only, with no route payload."""
    response = await _db_http_request(
        "GET",
        _app_state_url(select="usuarios"),
        operation=operation,
        headers=HEADERS,
        timeout=10.0,
    )
    if response.status_code in {400, 406}:
        return _MISSING
    rows = _projection_rows_or_raise(response, operation)
    value = rows[0].get("usuarios", _MISSING)
    return value if isinstance(value, dict) else _MISSING


async def _load_compat_users_locked() -> None:
    """Load users without routes/fleet when V2_COMPAT serves a read endpoint."""
    global usuarios_db, _users_projection_loaded_at
    value = await _fetch_compat_users_object("load_users_projection")
    if value is _MISSING:
        # A provider that cannot expose JSONB projections is still safe: use
        # the existing shape-validated full loader as a compatibility fallback.
        await _load_full_state_locked(include_defaults=False)
        return
    usuarios_db = _compat_users_from_projection(value, "load_users_projection")
    # A single-user compatibility fixture/JSON-path response is useful for a
    # targeted lookup but must not be treated as a complete users cache.
    complete_projection = not any(
        field in value for field in ("identifier", "email", "dni", "password")
    )
    _users_projection_loaded_at = time.monotonic() if complete_projection else 0.0


async def _load_compat_users(*, force: bool = False) -> None:
    if not _is_compat_storage():
        await reload_db(force=force)
        return
    if not force and (_full_cache_is_fresh() or _users_projection_is_fresh()):
        return
    try:
        async with _get_db_io_lock():
            if not force and (_full_cache_is_fresh() or _users_projection_is_fresh()):
                return
            await _load_compat_users_locked()
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load_users_projection", error=exc)


# --- Índice de acceso ---------------------------------------------------------

# Un login descargaba el bloque entero de usuarios —678 KB— para comprobar una
# contraseña. PostgREST sí sabe devolver un solo usuario (`usuarios->"clave"`,
# con comillas dobles: sin ellas rechaza los correos y trata los DNI como
# índices de array), pero la clave del diccionario no siempre es lo que la
# persona teclea: los 108 conductores importados tienen por clave un correo
# inventado y entran con su DNI o con su correo real.
#
# Este índice resuelve eso: identificador -> clave de la cuenta. No guarda
# contraseñas, ni roles, ni estados. Solo dónde mirar. La credencial se lee
# siempre del usuario real y recién traído, así que un índice desactualizado no
# puede dejar entrar a nadie de más: en el peor caso no encuentra la clave y se
# cae a la lectura completa de siempre.
login_index: Dict[str, str] = {}

# El índice vive en memoria entre peticiones de una misma instancia, así que
# caduca como el resto de cachés: si otra instancia da de alta un conductor,
# esta lo ve en cuanto expire en vez de mandarlo a la lectura completa siempre.
_login_index_loaded_at: Optional[float] = None


def _alias_de_login(clave: str, usuario: Dict[str, Any]) -> List[str]:
    """Todo lo que alguien podría teclear para entrar como este usuario."""
    perfil = usuario.get("perfil_conductor")
    valores = [
        clave,
        usuario.get("identifier"),
        usuario.get("email"),
        usuario.get("dni"),
        usuario.get("login_identifier"),
        perfil.get("numDoc") if isinstance(perfil, dict) else None,
    ]
    vistos = []
    for valor in valores:
        texto = str(valor).strip().lower() if valor is not None else ""
        if texto and texto not in vistos:
            vistos.append(texto)
    return vistos


def construir_indice_login() -> Dict[str, str]:
    """Reconstruye el índice desde los usuarios en memoria.

    Se rehace entero en cada escritura en vez de mantenerse a mano: así no hay
    forma de que se desvíe por olvidar actualizarlo en una ruta nueva.
    """
    indice: Dict[str, str] = {}
    for clave, usuario in usuarios_db.items():
        if not isinstance(usuario, dict) or clave.startswith("__"):
            continue
        for alias in _alias_de_login(clave, usuario):
            # El primero gana: si dos cuentas comparten un alias, la lectura
            # completa desempata como lo hace hoy `get_user_by_identifier`.
            indice.setdefault(alias, clave)
    return indice


async def _fetch_proyeccion_sin_respaldo(clave: str, operation: str) -> Any:
    """Una clave reservada del bloque, o `_MISSING` si no se puede."""
    respuesta = await _db_http_request(
        "GET",
        _app_state_url(select=f'usuarios->"{clave}"'),
        operation=operation,
        headers=HEADERS,
        timeout=10.0,
    )
    if respuesta.status_code != 200:
        return _MISSING
    filas = respuesta.json()
    if not isinstance(filas, list) or not filas:
        return _MISSING
    return _projection_value(filas[0], clave)


async def _fetch_usuario_por_clave(clave: str) -> Any:
    """Trae un solo usuario del bloque, sin descargar el resto.

    Las comillas dobles son imprescindibles: sin ellas PostgREST rechaza las
    claves con punto o arroba y trata un DNI como índice de un array.
    """
    valor = await _fetch_proyeccion_sin_respaldo(clave.replace('"', ''), "load_login_user")
    return valor if isinstance(valor, dict) else _MISSING


async def _usuario_por_indice(identificador: str) -> Optional[Dict[str, Any]]:
    """Resuelve un login en dos saltos pequeños, o `None` si no puede.

    `None` no significa «no existe»: significa «no lo he resuelto por el atajo».
    Quien llama debe caer entonces a la lectura completa.
    """
    global login_index, _login_index_loaded_at
    buscado = str(identificador or "").strip().lower()
    if not buscado:
        return None
    try:
        if not login_index or not _cache_is_fresh(_login_index_loaded_at):
            # Proyección directa, sin el respaldo de `_fetch_projection_value`:
            # ese respaldo descarga el bloque entero, y entonces el atajo
            # costaría más que el camino que intenta evitar. Si el índice no
            # está —la primera vez, antes de la primera escritura— se abandona
            # tras una petición de diecinueve bytes.
            valor = await _fetch_proyeccion_sin_respaldo("__login__", "load_login_index")
            login_index = valor if isinstance(valor, dict) else {}
            _login_index_loaded_at = time.monotonic()
        clave = login_index.get(buscado)
        if not clave:
            return None
        usuario = await _fetch_usuario_por_clave(clave)
        if usuario is _MISSING:
            return None
        # El usuario entra en memoria bajo su clave real para que el resto del
        # endpoint —sesión, último acceso, persistencia— funcione igual.
        usuarios_db[clave] = usuario
        return usuario
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 - el atajo nunca debe impedir entrar
        return None


async def _load_compat_user(identifier: str) -> Optional[Dict[str, Any]]:
    """Load a user from the users-only compatibility projection.

    PostgREST JSON-path projections are not reliable for legacy object keys
    such as email addresses (the parser can reject ``@``, dots, or other
    identifier characters).  Requesting the users JSONB column is still
    smaller than the complete app_state row and gives one canonical lookup
    shape for login and profile reads.
    """
    if not _is_compat_storage():
        await reload_db()
        return get_user_by_identifier(identifier)
    if _full_cache_is_fresh() or _users_projection_is_fresh():
        return get_user_by_identifier(identifier)

    # Atajo: índice de acceso más el usuario suelto, ~10 KB en vez de 678.
    # Si no resuelve, sigue el camino de siempre.
    por_indice = await _usuario_por_indice(identifier)
    if por_indice is not None:
        return por_indice

    try:
        await _load_compat_users()
        return get_user_by_identifier(identifier)
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load_user_projection", error=exc)


_sessions_projection_loaded_at: Optional[float] = None


def _sessions_projection_is_fresh() -> bool:
    return _cache_is_fresh(_sessions_projection_loaded_at)


async def _load_compat_sessions() -> None:
    """Carga solo `usuarios.__sessions__`: decenas de KB en vez de ~3,42 MB."""
    global session_index, _sessions_projection_loaded_at
    if _full_cache_is_fresh() or _users_projection_is_fresh() or _sessions_projection_is_fresh():
        return
    async with _get_db_io_lock():
        if _full_cache_is_fresh() or _users_projection_is_fresh() or _sessions_projection_is_fresh():
            return
        value = await _fetch_projection_value("__sessions__", "load_sessions_projection")
        # Un índice ausente no justifica descargar el estado completo: significa
        # que aún no hay sesiones indexadas, y la ruta cara lo resolverá.
        session_index = value if isinstance(value, dict) else {}
        _sessions_projection_loaded_at = time.monotonic()


async def require_any_session(session_token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Exige una sesión válida sin descargar el objeto de usuarios completo.

    Devuelve ``None`` cuando la exigencia está desactivada, igual que
    ``require_request_actor``, para conservar el rollback de la fase 1.
    """
    if not AUTH_ENFORCED:
        return None
    if not session_token:
        # Sin cookie no hay nada que resolver: se rechaza sin tocar la base.
        # Así una sonda anónima no cuesta ni una lectura.
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada.")
    # 1. Índice ya en memoria: una instancia caliente no hace ninguna lectura.
    actor = session_actor_from_index(session_token)
    if actor is None and _is_compat_storage():
        # 2. Traer solo el índice (decenas de KB).
        await _load_compat_sessions()
        actor = session_actor_from_index(session_token)
    if actor is None:
        # 3. Sesión anterior al índice: se paga la vía cara una vez; el próximo
        #    login la indexa.
        await _load_compat_users()
        actor = get_user_by_session(session_token)
    if actor is None:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada.")
    blocked = account_block_reason(actor)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)
    return actor


async def require_admin_session(session_token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Exige sesión con un rol administrativo, por la vía barata."""
    actor = await require_any_session(session_token)
    if actor is not None and actor.get("rol") not in _ADMIN_ROLES:
        raise HTTPException(
            status_code=403, detail="El rol actual no tiene permiso para esta acción."
        )
    return actor


async def require_administration_session(session_token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Exige un rol de Administración, más estrecho que `_ADMIN_ROLES`."""
    actor = await require_any_session(session_token)
    if actor is not None and actor.get("rol") not in _ADMINISTRATION_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Solo Administración puede realizar esta acción.",
        )
    return actor


async def require_session_owner(
    session_token: Optional[str],
    *,
    actor_fields: tuple,
    requested: Any,
    resource: str,
) -> Optional[Dict[str, Any]]:
    """Autoriza al dueño del recurso o a un administrador, por la vía barata.

    Con la exigencia desactivada no hace ninguna lectura, para no alterar el
    coste de egress caracterizado en las pruebas de la fase 0.
    """
    actor = await require_any_session(session_token)
    if actor is None:
        return None
    if actor.get("rol") in _ADMIN_ROLES:
        return actor
    if _owner_matches(actor, actor_fields, requested):
        return actor
    # Nunca denegar con información incompleta. Si el actor salió de una
    # instantánea del índice, puede ser anterior a que esta llevara todos los
    # alias de identidad, así que se contrasta una vez contra el usuario real
    # antes de rechazar. Con el usuario ya cargado no hay nada que reconsultar,
    # de modo que una denegación legítima no cuesta ninguna lectura extra.
    if usuarios_db.get(actor.get("identifier")) is not actor:
        await _load_compat_users()
        full_actor = get_user_by_session(session_token)
        if full_actor is not None and _owner_matches(full_actor, actor_fields, requested):
            return full_actor
    raise HTTPException(status_code=403, detail=f"No tienes acceso a {resource}.")


async def _load_compat_routes_locked() -> None:
    """Load only ``rutas`` for route/listing endpoints."""
    global rutas_estado_actual, _routes_projection_loaded_at
    value = await _fetch_top_level_projection_value("rutas", "load_routes_projection")
    if value is _MISSING:
        await _load_full_state_locked(include_defaults=False)
        return
    if not isinstance(value, list):
        await _load_full_state_locked(include_defaults=False)
        return
    rutas_estado_actual = value
    _routes_projection_loaded_at = time.monotonic()


async def _load_compat_routes(*, force: bool = False) -> None:
    if not _is_compat_storage():
        await reload_db(force=force)
        return
    if not force and (_full_cache_is_fresh() or _routes_projection_is_fresh()):
        return
    try:
        async with _get_db_io_lock():
            if not force and (_full_cache_is_fresh() or _routes_projection_is_fresh()):
                return
            await _load_compat_routes_locked()
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load_routes_projection", error=exc)


async def _load_compat_fleet_locked() -> None:
    """Load only the reserved fleet object for the fleet dashboard."""
    global conductores_db, _fleet_projection_loaded_at
    value = await _fetch_projection_value("__flota__", "load_fleet_projection")
    if value is _MISSING:
        await _load_full_state_locked(include_defaults=False)
        return
    if not isinstance(value, dict):
        await _load_full_state_locked(include_defaults=False)
        return
    conductores_db = value
    _fleet_projection_loaded_at = time.monotonic()


async def _load_compat_fleet(*, force: bool = False) -> None:
    if not _is_compat_storage():
        await reload_db(force=force)
        return
    if not force and (_full_cache_is_fresh() or _fleet_projection_is_fresh()):
        return
    try:
        async with _get_db_io_lock():
            if not force and (_full_cache_is_fresh() or _fleet_projection_is_fresh()):
                return
            await _load_compat_fleet_locked()
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load_fleet_projection", error=exc)


async def reload_notifications():
    """Refresh only notifications, using a JSON projection when available."""
    global notifications_db, _notifications_cache_loaded_at
    if _full_cache_is_fresh() or _cache_is_fresh(_notifications_cache_loaded_at):
        return
    try:
        async with _get_db_io_lock():
            if _full_cache_is_fresh() or _cache_is_fresh(_notifications_cache_loaded_at):
                return
            if _is_normalized_storage():
                rows = await STORAGE_ADAPTER.fetch_rows(
                    "notifications",
                    operation="load_notifications",
                )
                # A notifications-only poll can happen before the full
                # snapshot (and therefore before usuarios_db) is loaded.  Resolve
                # only the referenced user IDs so the legacy `para` contract
                # still returns an email/identifier without loading the users,
                # routes, fleet, or document tables wholesale.
                recipient_ids = sorted({
                    str(row.get("recipient_user_id"))
                    for row in rows
                    if row.get("recipient_user_id")
                })
                notification_users = usuarios_db
                known_recipient_ids = {
                    str(user.get("_normalized_id"))
                    for user in usuarios_db.values()
                    if isinstance(user, dict) and user.get("_normalized_id")
                }
                missing_recipient_ids = [
                    value for value in recipient_ids if value not in known_recipient_ids
                ]
                if missing_recipient_ids:
                    user_rows = await STORAGE_ADAPTER.fetch_rows(
                        "app_users",
                        select="id,login_identifier,email,government_id",
                        filters={"id": f"in.({','.join(missing_recipient_ids)})"},
                        operation="load_notification_recipients",
                    )
                    notification_users = {
                        **usuarios_db,
                        **_v2_decode_users(user_rows, [], [], []),
                    }
                notifications_db = _v2_decode_notifications(rows, notification_users)
                _notifications_cache_loaded_at = time.monotonic()
                return
            value = await _fetch_projection_value("__notifications__", "load_notifications")
            if value is _MISSING:
                await _load_full_state_locked(include_defaults=False)
                value = notifications_db
            if not isinstance(value, list):
                _raise_database_unavailable("load_notifications", error=ValueError("invalid notifications shape"))
            notifications_db = value
            _notifications_cache_loaded_at = time.monotonic()
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load_notifications", error=exc)


async def reload_routes_summary():
    """Refresh only the compact routes summary without passenger payloads."""
    global routes_summary, _routes_summary_cache_loaded_at
    if _full_cache_is_fresh() or _cache_is_fresh(_routes_summary_cache_loaded_at):
        return
    try:
        async with _get_db_io_lock():
            if _full_cache_is_fresh() or _cache_is_fresh(_routes_summary_cache_loaded_at):
                return
            if _is_normalized_storage():
                rows = await STORAGE_ADAPTER.fetch_rows(
                    "route_summary",
                    operation="load_routes_summary",
                )
                routes_summary = [
                    {
                        "conductor": row.get("unit_id") or "SIN ASIGNAR",
                        "micro_zona": row.get("zone") or "",
                        "horario": row.get("schedule") or "",
                        "count": int(row.get("passenger_count") or 0),
                    }
                    for row in rows
                ]
                _routes_summary_cache_loaded_at = time.monotonic()
                return
            value = await _fetch_projection_value("__routes_summary__", "load_routes_summary")
            if value is _MISSING:
                await _load_full_state_locked(include_defaults=False)
                value = routes_summary
            if not isinstance(value, list):
                _raise_database_unavailable("load_routes_summary", error=ValueError("invalid routes summary shape"))
            routes_summary = value
            _routes_summary_cache_loaded_at = time.monotonic()
    except HTTPException:
        raise
    except Exception as exc:
        _raise_database_unavailable("load_routes_summary", error=exc)

async def upload_evidence_to_supabase(base64_str: str, filename: str) -> str:
    """Sube una imagen Base64 al bucket 'evidencias' de Supabase Storage."""
    _ensure_storage_ready(
        "storage_upload",
        write=True,
        detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
    )
    try:
        if "," in base64_str:
            _, base64_str = base64_str.split(",", 1)
        file_data = base64.b64decode(base64_str)
        
        # SUPABASE_URL es "https://[...].supabase.co/rest/v1"
        storage_url = SUPABASE_URL.replace("/rest/v1", "") + f"/storage/v1/object/evidencias/{filename}"
        
        hdrs = _build_supabase_headers(
            STORAGE_CONFIG.key,
            content_type="image/jpeg",
        )
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(storage_url, headers=hdrs, content=file_data)
            if res.status_code in [200, 201]:
                public_url = SUPABASE_URL.replace("/rest/v1", "") + f"/storage/v1/object/public/evidencias/{filename}"
                return public_url
            else:
                print(f"[Supabase] storage upload failed status={res.status_code}")
                return None
    except Exception as e:
        print(f"[Supabase] storage upload failed error={type(e).__name__}")
        return ""

# --- Documentos del conductor en Supabase Storage -------------------------
#
# Guardarlos como base64 dentro de `app_state` hacía que cada envío de perfil
# reescribiera la fila entera: 9,8 MB que tardaban 18,7 s en subir, por encima
# del límite de 10 s de una función serverless. El envío fallaba sin decir por
# qué. Con los archivos fuera, el perfil guarda rutas de unos pocos bytes.
#
# El bucket es **privado**: son DNI, licencias y antecedentes. El acceso se da
# con URLs firmadas de vida corta, emitidas solo a quien ya tiene sesión.

DOCUMENTS_BUCKET = "documentos"
DOCUMENT_URL_TTL_SECONDS = 300

_documents_bucket_ready = False


def _storage_base_url() -> str:
    return SUPABASE_URL.replace("/rest/v1", "") + "/storage/v1"


async def ensure_documents_bucket() -> None:
    """Crea el bucket privado la primera vez. Idempotente."""
    global _documents_bucket_ready
    if _documents_bucket_ready:
        return
    hdrs = _build_supabase_headers(STORAGE_CONFIG.key)
    async with httpx.AsyncClient(timeout=20.0) as client:
        existe = await client.get(f"{_storage_base_url()}/bucket/{DOCUMENTS_BUCKET}", headers=hdrs)
        if existe.status_code == 200:
            _documents_bucket_ready = True
            return
        creado = await client.post(
            f"{_storage_base_url()}/bucket",
            headers=hdrs,
            json={"name": DOCUMENTS_BUCKET, "id": DOCUMENTS_BUCKET, "public": False},
        )
        # 409 significa que ya existía: otra instancia se adelantó.
        if creado.status_code in (200, 201, 409):
            _documents_bucket_ready = True
            return
        _raise_database_unavailable(
            "storage_bucket", detail=DATABASE_WRITE_UNAVAILABLE_DETAIL
        )


async def upload_document_to_storage(base64_str: str, path: str, content_type: str) -> str:
    """Sube un documento y devuelve su ruta dentro del bucket."""
    _ensure_storage_ready("document_upload", write=True, detail=DATABASE_WRITE_UNAVAILABLE_DETAIL)
    await ensure_documents_bucket()

    if "," in base64_str:
        _, base64_str = base64_str.split(",", 1)
    contenido = base64.b64decode(base64_str)

    hdrs = _build_supabase_headers(STORAGE_CONFIG.key, content_type=content_type or "application/octet-stream")
    # `upsert` permite reemplazar un documento sin tener que borrarlo antes.
    hdrs["x-upsert"] = "true"

    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            f"{_storage_base_url()}/object/{DOCUMENTS_BUCKET}/{path}", headers=hdrs, content=contenido
        )
    if res.status_code not in (200, 201):
        print(f"[Supabase] document upload failed status={res.status_code}")
        _raise_database_unavailable("document_upload", detail=DATABASE_WRITE_UNAVAILABLE_DETAIL)
    return path


async def signed_document_url(path: str, ttl: int = DOCUMENT_URL_TTL_SECONDS) -> Optional[str]:
    """URL temporal para ver un documento. `None` si la ruta ya no existe."""
    _ensure_storage_ready("document_sign", write=False)
    hdrs = _build_supabase_headers(STORAGE_CONFIG.key)
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            f"{_storage_base_url()}/object/sign/{DOCUMENTS_BUCKET}/{path}",
            headers=hdrs,
            json={"expiresIn": ttl},
        )
    if res.status_code != 200:
        return None
    firmada = res.json().get("signedURL") or res.json().get("signedUrl")
    return f"{_storage_base_url()}{firmada}".replace("/storage/v1/storage/v1", "/storage/v1") if firmada else None


async def persist():
    payload = {
        "id": 1,
        "usuarios": {
            **usuarios_db,
            "__routes_summary__": routes_summary,
            "__historial_rutas__": historial_rutas,
            "__lock__": board_lock,
            "__flota__": conductores_db,
            "__notifications__": notifications_db,
            "__actividad__": actividad_db,
            "__sessions__": session_index,
            "__login__": _refrescar_indice_login(),
        },
        "rutas": rutas_estado_actual,
    }
    await _persist_app_state(payload, "persist")


def _refrescar_indice_login() -> Dict[str, str]:
    """Índice recién hecho, y de paso al día en esta instancia.

    Se recalcula entero en cada escritura en vez de mantenerse a mano: así no
    hay forma de que se desvíe por olvidar actualizarlo en una ruta nueva.
    """
    global login_index, _login_index_loaded_at
    login_index = construir_indice_login()
    _login_index_loaded_at = time.monotonic()
    return login_index


async def _ensure_compat_users_for_write() -> None:
    """Merge a single-user projection into a complete users snapshot.

    Login/profile reads may intentionally load only the users JSONB column.
    Before a legacy ``usuarios`` PATCH, hydrate the complete app_state row so
    a partial read can never overwrite the route board or reserved metadata
    (``__flota__``, ``__notifications__``, locks, history, and summaries).
    """
    if not _is_compat_storage() or _full_cache_is_fresh():
        return
    pending_users = {
        key: value
        for key, value in usuarios_db.items()
        if not str(key).startswith("__") and isinstance(value, dict)
    }
    # This is deliberately a full, shape-validated read.  The write payload
    # carries the reserved compatibility keys, so a users-only projection
    # would otherwise replace them with empty in-memory defaults.
    await _load_full_state(include_defaults=False, force=True)
    for key, value in pending_users.items():
        existing = usuarios_db.get(key)
        if isinstance(existing, dict):
            existing.update(value)
        else:
            usuarios_db[key] = value


async def persist_users_only():
    """Lightweight persist — only saves the usuarios dict. Use for user management actions."""
    await _ensure_compat_users_for_write()
    payload = {
        "id": 1,
        "usuarios": {
            **usuarios_db,
            "__routes_summary__": routes_summary,
            "__historial_rutas__": historial_rutas,
            "__lock__": board_lock,
            "__flota__": conductores_db,
            "__notifications__": notifications_db,
            "__actividad__": actividad_db,
            "__sessions__": session_index,
            "__login__": _refrescar_indice_login(),
        },
    }
    await _persist_app_state(payload, "persist_users")

async def persist_routes_summary(summary: list):
    """Persist ONLY the compact routes summary inside the lock column.
    Very small payload (~30KB) — always succeeds even with 2000+ agents."""
    global board_lock, routes_summary
    next_lock = {**board_lock, "routes_summary": summary}
    payload = {
        "id": 1,
        "usuarios": {
            **usuarios_db,
            "__routes_summary__": summary,
            "__historial_rutas__": historial_rutas,
            "__lock__": next_lock,
            "__flota__": conductores_db,
            "__notifications__": notifications_db,
            "__actividad__": actividad_db,
            "__sessions__": session_index,
            "__login__": _refrescar_indice_login(),
        },
    }
    if _is_normalized_storage():
        previous_summary, previous_lock = routes_summary, board_lock
        routes_summary, board_lock = summary, next_lock
        try:
            await _persist_app_state(payload, "persist_routes_summary")
        except Exception:
            routes_summary, board_lock = previous_summary, previous_lock
            raise
    else:
        await _persist_app_state(payload, "persist_routes_summary")
    routes_summary = summary
    board_lock = next_lock
    print(f"Routes summary saved: {len(summary)} routes")

# --- Metadata y Configuración de la App ---
description = "Backend para Kapital Routing, con autenticación y lógica de negocio avanzada."
app = FastAPI(title="Kapital Routing Backend (JSON DB + Polling)", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _metric_endpoint(request: Request) -> str:
    """Return a route template or coarse path without user-controlled IDs."""
    route = request.scope.get("route")
    route_path = getattr(route, "path", None)
    if isinstance(route_path, str) and route_path:
        return route_path[:100]
    path = request.url.path
    parts = [part for part in path.split("/") if part]
    if parts and parts[0] == "api":
        # The router is not always attached when middleware handles an error;
        # retain only a stable prefix and discard possible identifiers.
        return "/" + "/".join(parts[:2])
    return "/<unmatched>"


@app.middleware("http")
async def request_metrics_middleware(request: Request, call_next):
    """Emit local request metrics without query strings, bodies, or PII."""
    started_at = time.perf_counter()
    response = None
    status = 500
    try:
        response = await call_next(request)
        status = getattr(response, "status_code", 500)
        return response
    finally:
        payload = {
            "component": "http",
            "method": request.method,
            "endpoint": _metric_endpoint(request),
            "status": status,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 2),
            "response_bytes": _response_size_bytes(response) if response is not None else None,
        }
        print("[KapitalMetrics] " + json.dumps(payload, separators=(",", ":")))

# --- Ruta de Prueba ---
@app.get("/api")
def read_root():
    return {"status": "Kapital Routing API is running!"}

# --- WebSocket Endpoint ---
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """Punto de conexión WebSocket. El user_id es el identifier del usuario."""
    await ws_manager.connect(user_id, websocket)
    try:
        while True:
            # Mantenemos la conexión viva esperando mensajes del cliente (ping/pong)
            data = await websocket.receive_text()
            # Si el cliente manda un ping, responde con pong
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(user_id)

# --- Modelos de Datos Pydantic ---
class UsuarioRegistro(BaseModel):
    identifier: str
    password: str
    nombre: Optional[str] = None
    rol: str
    telefono: Optional[str] = None
    unidad_id: Optional[str] = None
    empresa_id: Optional[str] = None
    avatar: Optional[str] = None

class UsuarioLogin(BaseModel):
    identifier: str
    password: str



class EmergencyRequest(BaseModel):
    conductor_id: str
    tipo_emergencia: str
    horario: str

class FlotaRegistro(BaseModel):
    # `padron` es el identificador interno con el que Kapital nombra la unidad
    # (K-027) y `placa` la matrícula del vehículo (BUR-628). El formulario los
    # mandaba en el mismo campo, así que las unidades creadas a mano se
    # quedaban sin matrícula y su padrón viajaba en el campo equivocado.
    # `padron` es opcional para que un cliente viejo, que solo manda `placa`,
    # siga registrando unidades como hasta ahora.
    padron: Optional[str] = None
    placa: str = ""
    # Cuenta del conductor que maneja la unidad. Opcionales para no romper a un
    # cliente viejo, pero el formulario las pide: sin ellas la unidad queda sin
    # nadie que pueda entrar a subir su documentación.
    dni: Optional[str] = None
    password: Optional[str] = None
    capacidad: int
    tipo: str
    chofer: str
    soat: Optional[str] = None
    revision: Optional[str] = None
    atu: Optional[str] = None
    licencia: Optional[str] = None
    telefono: Optional[str] = None
    soat_doc: Optional[str] = None
    revision_doc: Optional[str] = None
    atu_doc: Optional[str] = None
    licencia_doc: Optional[str] = None


class FlotaUpdate(BaseModel):
    """Structured fields editable from the fleet pencil modal.

    Document blobs/URLs are intentionally not part of this contract. Pydantic
    ignores old clients' extra ``*_doc`` fields, while the merge performed by
    the endpoint preserves the values already stored for the driver dossier.
    """
    placa: Optional[str] = None
    capacidad: Optional[int] = None
    tipo: Optional[str] = None
    chofer: Optional[str] = None
    telefono: Optional[str] = None
    soat: Optional[str] = None
    revision: Optional[str] = None
    atu: Optional[str] = None
    licencia: Optional[str] = None

class ChatMessagePayload(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessagePayload] = []

class UsuarioUpdate(BaseModel):
    identifier: str
    nombre: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None
    # Una foto llega como `{name, size, type, path}` desde que vive en Storage.
    # Se sigue admitiendo la cadena base64 de antes para no romper una pestaña
    # que lleve abierta desde el despliegue anterior.
    avatar: Optional[Union[str, Dict[str, Any]]] = None
    fotoVehiculo: Optional[Union[str, Dict[str, Any]]] = None
    unidad_id: Optional[str] = None
    rol: Optional[str] = None

def _foto_guardable(foto: Any) -> Any:
    """Lo que de una foto se puede guardar en la fila.

    De un objeto se conserva la referencia al archivo y se descartan los bytes:
    `base64` volvería a engordar la fila —que es justo lo que se arregló al
    llevarlas al bucket— y `url` es una vista previa local que solo existe en la
    pestaña que la creó, así que guardarla dejaría un enlace muerto.

    Una cadena se deja pasar tal cual. Es el formato viejo, y rechazarlo
    rompería a quien todavía tenga cargada la versión anterior de la página.
    """
    if not isinstance(foto, dict):
        return foto
    return {k: v for k, v in foto.items() if k not in ("base64", "url")}


class ChangePasswordRequest(BaseModel):
    identifier: str
    old_password: str
    new_password: str

class DriverProfilePayload(BaseModel):
    email: str
    perfilData: dict

def _capacidad_declarada(valor: Any) -> Optional[int]:
    """Capacidad como entero, o `None` si el conductor no declaró una usable."""
    try:
        capacidad = int(float(str(valor).strip()))
    except (TypeError, ValueError):
        return None
    return capacidad if capacidad > 0 else None


def _sembrar_unidad(unidad_id: str, usuario: Dict[str, Any]) -> None:
    """Crea o completa la unidad de flota con lo que el conductor ya declaró.

    Antes esta siembra escribía una forma distinta de la que lee la flota
    —`nombre` en vez de `chofer`— y rellenaba el resto con constantes: 15
    plazas, tipo «Sprinter» y cuatro vencimientos en 2027. El resultado era una
    unidad sin nombre de chofer, con una capacidad que nadie había declarado y
    con documentos marcados como vigentes sin que nadie los hubiera revisado.

    Ahora se toma del perfil lo que el conductor sí rellenó y se deja fuera lo
    que nadie preguntó: el tipo de unidad y los vencimientos no están en el
    alta, así que quedan vacíos y la flota los muestra como pendientes, que es
    lo que son. Los campos que ya tengan valor no se tocan: la unidad puede
    existir porque Administración la creó antes a mano.
    """
    if not unidad_id:
        return

    perfil = usuario.get("perfil_conductor")
    perfil = perfil if isinstance(perfil, dict) else {}

    declarado: Dict[str, Any] = {}
    nombre = str(perfil.get("nombres") or usuario.get("nombre") or "").strip()
    if nombre:
        declarado["chofer"] = nombre
    telefono = str(perfil.get("telefonoDirecto") or usuario.get("telefono") or "").strip()
    if telefono:
        declarado["telefono"] = telefono
    capacidad = _capacidad_declarada(perfil.get("vehiculoCapacidad"))
    if capacidad is not None:
        declarado["capacidad"] = capacidad

    unidad = conductores_db.setdefault(unidad_id, {})
    for campo, valor in declarado.items():
        if not str(unidad.get(campo) or "").strip():
            unidad[campo] = valor


class BulkActionPayload(BaseModel):
    admin_email: str
    target_emails: List[str]
    action: str # "approve", "reject", "delete", "deactivate"

class ReinicioDeContrasena(BaseModel):
    admin_email: str
    target: str

class DriverDocReviewPayload(BaseModel):
    admin_email: str
    conductor_email: str
    campo: str          # e.g. "dniScaneado", "licenciaConducir"
    estado: str         # "aprobado" | "rechazado"
    nota: Optional[str] = None

class DriverNotifyPayload(BaseModel):
    admin_email: str
    conductor_email: str
    mensaje: str

# --- Endpoints de Autenticación y Verificación ---

@app.get("/api/notifications")
async def get_notifications(last_id: int = 0):
    await reload_notifications()  # Lightweight: only loads notifications from Supabase
    def safe_id(n):
        try:
            return int(float(str(n.get("id", 0))))
        except:
            return 0
    all_admin_notifs = [n for n in notifications_db if 
        "type" in n or 
        n.get("para") == "admin" or
        n.get("tipo") in ["resubmision", "solicitud_vehiculo2", "notificacion_admin", "sos"]
    ]
    new_notifs = [n for n in all_admin_notifs if safe_id(n) > last_id]
    return new_notifs

@app.post("/api/notifications")
async def add_notification(notif: dict, session_token: SessionCookie = None):
    await reload_db()
    # Lo usa el SOS del conductor, así que basta con una sesión válida: sin esto
    # cualquiera podía inyectar entradas en el panel de Administración.
    require_request_actor(session_token)
    new_id = _next_notification_id()
    new_notif = {
        "id": new_id,
        "title": notif.get("title", "Notificación"),
        "message": notif.get("message", ""),
        "type": notif.get("type", "info"),
        "timestamp": datetime.now().isoformat()
    }
    notifications_db.append(new_notif)
    
    # Keep only the last 50 notifications
    if len(notifications_db) > 50:
        notifications_db.pop(0)
        
    await persist_users_only()
    return new_notif



@app.post("/api/auth/register")
async def register_user(usuario: UsuarioRegistro):
    await reload_db()

    # Validaciones básicas para evitar 500
    if not usuario.identifier or not usuario.identifier.strip():
        raise HTTPException(status_code=400, detail="El identificador (DNI o Correo) no puede estar vacío.")
    if usuario.rol != "Conductor" and (not usuario.nombre or not usuario.nombre.strip()):
        raise HTTPException(status_code=400, detail="El nombre no puede estar vacío para este rol.")
    if not usuario.password or len(usuario.password) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")

    identifier_clean = usuario.identifier.strip().lower()
    if identifier_clean in [k.lower() for k in usuarios_db.keys()]:
        raise HTTPException(status_code=400, detail="El usuario ya está registrado.")
    
    ROLES_VALIDOS = ["Programador de rutas", "Administración", "Conductor", "Gerente de Operaciones", "Cliente"]
    rol_solicitado = usuario.rol if usuario.rol in ROLES_VALIDOS else "Programador de rutas"
    
    # Si es el primer usuario, se aprueba automáticamente como Admin
    estado = "Activo" if len(usuarios_db) == 0 else "Pendiente"
    
    nuevo_usuario = {
        "identifier": identifier_clean,
        "email": identifier_clean if usuario.rol != 'Conductor' else None,
        "dni": identifier_clean if usuario.rol == 'Conductor' else None,
        "password": password_for_storage(usuario.password),
        "nombre": usuario.nombre.strip() if usuario.nombre else ("Conductor Pendiente" if rol_solicitado == "Conductor" else "Usuario"),
        "rol": "Administración" if len(usuarios_db) == 0 else rol_solicitado,
        "telefono": usuario.telefono,
        "unidad_id": usuario.unidad_id.strip() if usuario.unidad_id else None,
        "empresa_id": usuario.empresa_id,
        "avatar": usuario.avatar,
        "estado": estado
    }
    usuarios_db[identifier_clean] = nuevo_usuario
    
    if rol_solicitado == "Conductor" and usuario.unidad_id:
        _sembrar_unidad(usuario.unidad_id.strip(), nuevo_usuario)
            
    # Add notification for new registration
    if rol_solicitado == "Conductor":
        notifications_db.append({
            "id": _next_notification_id(),
            "title": "Nuevo Conductor",
            "message": f"{usuario.nombre} se ha registrado y está en lista de espera.",
            "type": "success",
            "timestamp": datetime.now().isoformat()
        })
            
    await persist_users_only()
    return {"message": "Usuario registrado exitosamente.", "estado": estado}



def get_user_by_identifier(identifier: str):
    if not identifier: return None
    identifier_clean = identifier.strip()
    user = usuarios_db.get(identifier_clean)
    if user: return user
    for k, v in usuarios_db.items():
        if k.lower() == identifier_clean.lower():
            return v
        for alias in (
            v.get("identifier"),
            v.get("email"),
            v.get("dni"),
            v.get("login_identifier"),
        ):
            if alias and str(alias).strip().lower() == identifier_clean.lower():
                return v
        perfil = v.get("perfil_conductor", {})
        if perfil and perfil.get("numDoc") == identifier_clean:
            return v
    return None

# Un correo se guarda como dato de contacto, no como clave de la cuenta: los 108
# conductores importados del Excel tienen por clave un correo inventado
# (`apellido@kapital.com`) y `identifier` a nulo. Renombrar esa clave sería
# migrar la cuenta entera; guardar el correo real al lado no rompe nada y
# `get_user_by_identifier` lo reconoce igual para iniciar sesión.
_FORMATO_CORREO = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def correo_normalizado(correo: Any) -> str:
    """Correo en minúsculas y sin espacios, o cadena vacía si no lo parece."""
    limpio = str(correo or "").strip().lower()
    return limpio if _FORMATO_CORREO.match(limpio) else ""


def _cuenta_con_correo(correo: str, excepto: Dict[str, Any]) -> Optional[str]:
    """Clave de otra cuenta que ya responde a ese correo, si la hay."""
    buscado = correo.strip().lower()
    for clave, otro in usuarios_db.items():
        if not isinstance(otro, dict) or otro is excepto:
            continue
        candidatos = [clave, otro.get("identifier"), otro.get("email"), otro.get("login_identifier")]
        if any(str(valor or "").strip().lower() == buscado for valor in candidatos):
            return clave
    return None


def asignar_correo(user: Dict[str, Any], correo: Any) -> bool:
    """Guarda el correo real del usuario. Devuelve si cambió algo.

    El correo entra también en la instantánea de sesión, así que hay que
    refrescar el índice o la autorización seguiría viendo el anterior.
    """
    limpio = correo_normalizado(correo)
    if not limpio:
        raise HTTPException(status_code=400, detail="El correo no tiene un formato válido.")

    ocupado = _cuenta_con_correo(limpio, excepto=user)
    if ocupado:
        raise HTTPException(status_code=409, detail="Ese correo ya pertenece a otra cuenta.")

    perfil = user.get("perfil_conductor")
    cambio = str(user.get("email") or "").strip().lower() != limpio
    user["email"] = limpio
    if isinstance(perfil, dict):
        cambio = cambio or str(perfil.get("correo") or "").strip().lower() != limpio
        perfil["correo"] = limpio
    refresh_session_index_for(user)
    return cambio


class CorreoConductorPayload(BaseModel):
    identificador: str
    correo: str


@app.put("/api/conductor/correo")
async def actualizar_correo_conductor(payload: CorreoConductorPayload, session_token: SessionCookie = None):
    """Corrige el correo de un conductor.

    Lo puede hacer Administración —los correos del Excel eran inventados y hay
    que sustituirlos por los reales— y el propio conductor sobre el suyo.
    """
    await _load_compat_users()
    user = get_user_by_identifier(payload.identificador)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    actor = await require_any_session(session_token)
    if actor is not None and actor.get("rol") not in _ADMIN_ROLES:
        if not _owner_matches(actor, _IDENTITY_FIELDS, payload.identificador):
            raise HTTPException(status_code=403, detail="No puedes cambiar el correo de otra cuenta.")

    asignar_correo(user, payload.correo)
    await persist_users_only()
    return {"email": user.get("email")}


@app.post("/api/auth/login")
async def login_user(usuario: UsuarioLogin, response: Response):
    if _is_normalized_storage() and not _full_cache_is_fresh():
        user_in_db = await _load_normalized_login_user(usuario.identifier)
    elif _is_compat_storage() and not _full_cache_is_fresh():
        # A login needs one user plus its password/session fields, not routes,
        # fleet, notifications, or the complete app_state JSONB row.
        user_in_db = await _load_compat_user(usuario.identifier)
    else:
        await reload_db()
        user_in_db = get_user_by_identifier(usuario.identifier)
                
    stored_password = user_in_db.get("password") if user_in_db else None
    if not user_in_db or not verify_password(usuario.password, stored_password):
        raise HTTPException(status_code=401, detail="Credenciales inválidas.")

    # Transparent migration: a successful login upgrades legacy plaintext (or
    # an older PBKDF2 cost) without forcing a password reset or changing UX.
    if PASSWORD_HASH_WRITE_ENABLED and password_needs_upgrade(stored_password):
        user_in_db["password"] = hash_password(usuario.password)
    
    # Un estado de ciclo de vida bloqueado impide autenticarse. Los estados
    # documentales del conductor no bloquean: su portal es donde resuelve los
    # documentos observados.
    blocked = account_block_reason(user_in_db)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)

    # Registrar última conexión
    user_in_db["last_login"] = datetime.now().isoformat()
    session_token = issue_session(user_in_db)
    registrar_actividad(
        "Usuario inició sesión",
        actor=user_in_db,
        entity_type="sesion",
        description=f"Acceso al sistema como {user_in_db.get('rol') or 'Usuario'}.",
    )
    await persist_users_only()

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        max_age=SESSION_TTL_HOURS * 60 * 60,
        httponly=True,
        secure=bool(os.environ.get("VERCEL")),
        samesite="lax",
        path="/",
    )

    
    return _public_user_payload(user_in_db, usuario.identifier)

@app.get("/api/auth/me")
async def get_authenticated_user(session_token: SessionCookie = None):
    """Identidad resuelta en servidor. El frontend debe preferirla a su propio estado."""
    await reload_db()
    user = get_user_by_session(session_token)
    if not user:
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada.")
    blocked = account_block_reason(user)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)
    return _public_user_payload(user)


@app.post("/api/auth/logout")
async def logout_user(response: Response, session_token: SessionCookie = None):
    """Revoca la sesión en servidor y limpia la cookie.

    Idempotente a propósito: cerrar sesión con una cookie ya caducada debe
    funcionar igual, o el usuario queda atrapado en una sesión que no puede soltar.
    """
    revoked = False
    if session_token:
        await reload_db()
        user = get_user_by_session(session_token)
        if user:
            token_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
            now = int(datetime.now(timezone.utc).timestamp())
            for session in user.get("_auth_sessions", []):
                if not isinstance(session, dict):
                    continue
                if hmac.compare_digest(session.get("token_hash", ""), token_hash):
                    session["revoked_at"] = now
                    revoked = True
            if revoked:
                revoke_session_in_index(token_hash, now)
            if revoked:
                # Solo se persiste si de verdad hubo algo que revocar.
                await persist_users_only()
    # Se sobreescribe con los mismos atributos del login para que el navegador
    # reemplace exactamente esa cookie.
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value="",
        max_age=0,
        httponly=True,
        secure=bool(os.environ.get("VERCEL")),
        samesite="lax",
        path="/",
    )
    return {"message": "Sesión cerrada.", "revoked": revoked}


@app.post("/api/auth/change-password")
async def change_password(req: ChangePasswordRequest):
    await reload_db()
    user_in_db = get_user_by_identifier(req.identifier)
                
    if not user_in_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        
    if not verify_password(req.old_password, user_in_db.get("password")):
        raise HTTPException(status_code=401, detail="La contraseña actual es incorrecta.")
        
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 4 caracteres.")
        
    user_in_db["password"] = password_for_storage(req.new_password)
    user_in_db["needs_password_change"] = False
    
    await persist_users_only()
    return {"message": "Contraseña actualizada exitosamente."}

@app.get("/api/user/profile")
async def get_profile(email: str, session_token: SessionCookie = None):
    if _is_compat_storage() and not _full_cache_is_fresh():
        user = await _load_compat_user(email)
    else:
        await reload_db()
        user = get_user_by_identifier(email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    require_request_actor(session_token, expected_user=user)
    return {
        "email": user["email"],
        "nombre": user["nombre"],
        "rol": user["rol"],
        "identifier": user.get("identifier"),
        "unidad_id": user.get("unidad_id"),
        "empresa_id": user.get("empresa_id"),
        "avatar": user.get("avatar"),
        "estado": user.get("estado", "Activo"),
        "profileComplete": "perfil_conductor" in user,
        "perfil_conductor": user.get("perfil_conductor", {})
    }

@app.put("/api/user/profile")
async def update_profile(update_data: UsuarioUpdate, session_token: SessionCookie = None):
    await reload_db()
    user = get_user_by_identifier(update_data.identifier)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    require_request_actor(session_token, expected_user=user)

    # Roles are managed only through administrative workflows. Keeping the
    # field in the request model gives old clients an explicit error instead of
    # silently accepting a privilege escalation attempt.
    if update_data.rol is not None:
        raise HTTPException(status_code=400, detail="El rol no puede modificarse desde el perfil.")
    
    # Validar password actual si se intenta cambiar la password
    if update_data.new_password:
        if len(update_data.new_password) < 4:
            raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 4 caracteres.")
        if not verify_password(update_data.current_password or "", user.get("password")):
            raise HTTPException(status_code=401, detail="Contraseña actual incorrecta.")
        user["password"] = password_for_storage(update_data.new_password)

    if update_data.nombre: user["nombre"] = update_data.nombre
    if update_data.avatar: user["avatar"] = _foto_guardable(update_data.avatar)
    if update_data.fotoVehiculo:
        if "perfil_conductor" not in user:
            user["perfil_conductor"] = {}
        user["perfil_conductor"]["fotoVehiculo"] = _foto_guardable(update_data.fotoVehiculo)
    if update_data.unidad_id: user["unidad_id"] = update_data.unidad_id

    await persist_users_only()
    return {
        "identifier": user.get("identifier", update_data.identifier),
        "email": user.get("email"),
        "dni": user.get("dni"),
        "perfil_conductor": user.get("perfil_conductor", {}),
        "nombre": user.get("nombre", "Usuario"),
        "rol": user.get("rol", "Usuario"),
        "unidad_id": user.get("unidad_id"),
        "empresa_id": user.get("empresa_id"),
        "avatar": user.get("avatar"),
        "estado": user.get("estado", "Activo"),
        "profileComplete": "perfil_conductor" in user
    }

# --- Historial de actividad ---------------------------------------------------

# Tope de eventos guardados. El estado entero vive en una sola fila, así que un
# historial sin límite la haría crecer hasta repetir el fallo que tuvo el envío
# de perfiles: una escritura que no cabía en el tiempo de la función.
MAX_ACTIVIDAD = 500

# Nombres de los campos de flota tal como se leen en pantalla: en la
# comparación de un evento no sirve enseñar la clave interna.
_ETIQUETA_FLOTA = {
    "chofer": "Nombre del chofer",
    "telefono": "Teléfono",
    "tipo": "Tipo de vehículo",
    "placa": "Placa del vehículo",
    "capacidad": "Capacidad",
    "soat": "Vencimiento SOAT",
    "revision": "Vencimiento revisión técnica",
    "licencia": "Vencimiento licencia MTC",
}

_actividad_cache_loaded_at: Optional[float] = None


def _actor_visible(actor: Optional[Dict[str, Any]], respaldo: str = "") -> Dict[str, str]:
    """Quién hizo la acción, con lo que se puede enseñar sin exponer de más."""
    if not isinstance(actor, dict):
        return {"actor_id": respaldo, "actor_name": respaldo or "Sistema", "actor_email": respaldo}
    identificador = str(
        actor.get("identifier") or actor.get("email") or actor.get("dni") or respaldo or ""
    )
    return {
        "actor_id": identificador,
        "actor_name": str(actor.get("nombre") or identificador or "Sistema"),
        "actor_email": str(actor.get("email") or ""),
    }


def registrar_actividad(
    action_type: str,
    *,
    actor: Optional[Dict[str, Any]] = None,
    actor_respaldo: str = "",
    entity_type: str = "",
    entity_id: str = "",
    entity_label: str = "",
    description: str = "",
    status: str = "info",
    changes: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Anota una acción administrativa en el historial.

    No persiste por su cuenta: se apoya en el guardado que el propio endpoint ya
    hace, así que auditar no añade ni un viaje más contra Supabase.

    Nunca lanza. Un fallo apuntando lo que pasó no puede impedir que pase: si
    algo va mal aquí, la acción del usuario debe seguir su curso.
    """
    global actividad_db
    try:
        evento = {
            "id": f"act_{int(datetime.now(timezone.utc).timestamp() * 1000)}_{secrets.token_hex(3)}",
            "action_type": action_type,
            **_actor_visible(actor, actor_respaldo),
            "entity_type": entity_type,
            "entity_id": str(entity_id or ""),
            "entity_label": str(entity_label or ""),
            "description": description,
            "status": status,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if changes:
            evento["changes"] = changes
        actividad_db.append(evento)
        if len(actividad_db) > MAX_ACTIVIDAD:
            del actividad_db[: len(actividad_db) - MAX_ACTIVIDAD]
    except Exception as exc:  # noqa: BLE001 - auditar no puede romper la acción
        print(f"[Actividad] no se pudo registrar {action_type}: {type(exc).__name__}")


def cambio(campo: str, antes: Any, despues: Any) -> Optional[Dict[str, Any]]:
    """Una fila de la comparación «antes / después», o `None` si no cambió."""
    anterior, nuevo = ("" if antes is None else str(antes)), ("" if despues is None else str(despues))
    if anterior == nuevo:
        return None
    return {"campo": campo, "anterior": anterior, "nuevo": nuevo}


async def reload_actividad() -> None:
    """Carga solo el historial: unas decenas de KB en vez del estado entero."""
    global actividad_db, _actividad_cache_loaded_at
    if _full_cache_is_fresh() or _cache_is_fresh(_actividad_cache_loaded_at):
        return
    if not _is_compat_storage():
        await reload_db()
        return
    try:
        async with _get_db_io_lock():
            if _full_cache_is_fresh() or _cache_is_fresh(_actividad_cache_loaded_at):
                return
            value = await _fetch_projection_value("__actividad__", "load_actividad")
            actividad_db = value if isinstance(value, list) else []
            _actividad_cache_loaded_at = time.monotonic()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        _raise_database_unavailable("load_actividad", error=exc)


def _coincide_texto(evento: Dict[str, Any], buscado: str) -> bool:
    campos = ("action_type", "actor_name", "actor_email", "actor_id",
              "entity_label", "entity_id", "entity_type", "description")
    return any(buscado in str(evento.get(campo) or "").lower() for campo in campos)


def _dentro_del_rango(evento: Dict[str, Any], desde: str, hasta: str) -> bool:
    fecha = str(evento.get("created_at") or "")[:10]
    if desde and fecha < desde:
        return False
    # `hasta` es inclusivo: quien filtra «hasta el 17» espera ver el día 17.
    if hasta and fecha > hasta:
        return False
    return True


@app.get("/api/actividad")
async def listar_actividad(
    session_token: SessionCookie = None,
    pagina: int = 1,
    limite: int = 10,
    q: str = "",
    tipo: str = "",
    actor: str = "",
    desde: str = "",
    hasta: str = "",
):
    """Historial de acciones administrativas, filtrado y paginado.

    Es de solo lectura: no hay forma de editar ni borrar un evento desde la
    aplicación, que es lo que hace que un registro de auditoría sirva de algo.
    """
    await require_admin_session(session_token)
    await reload_actividad()

    eventos = [e for e in actividad_db if isinstance(e, dict)]
    buscado = q.strip().lower()
    if buscado:
        eventos = [e for e in eventos if _coincide_texto(e, buscado)]
    if tipo:
        eventos = [e for e in eventos if e.get("action_type") == tipo]
    if actor:
        eventos = [e for e in eventos if (e.get("actor_id") or e.get("actor_email")) == actor]
    if desde or hasta:
        eventos = [e for e in eventos if _dentro_del_rango(e, desde.strip(), hasta.strip())]

    # Más reciente primero: es el orden en el que se audita.
    eventos.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)

    hoy = datetime.now(timezone.utc).date().isoformat()
    resumen = {
        "total": len(eventos),
        "hoy": sum(1 for e in eventos if str(e.get("created_at") or "").startswith(hoy)),
        "responsables": len({e.get("actor_id") or e.get("actor_email") or "" for e in eventos} - {""}),
    }

    limite = max(1, min(int(limite or 10), 100))
    paginas = max(1, (len(eventos) + limite - 1) // limite)
    pagina = max(1, min(int(pagina or 1), paginas))
    inicio = (pagina - 1) * limite

    # Los tipos y responsables que ofrecen los desplegables salen de lo que hay
    # de verdad en el historial, no de una lista escrita a mano que se desviaría.
    todos = [e for e in actividad_db if isinstance(e, dict)]
    return {
        "eventos": eventos[inicio:inicio + limite],
        "pagina": pagina,
        "paginas": paginas,
        "limite": limite,
        "resumen": resumen,
        "tipos": sorted({e.get("action_type") for e in todos if e.get("action_type")}),
        "responsables": sorted(
            {(e.get("actor_id") or e.get("actor_email") or "") for e in todos} - {""}
        ),
    }


# --- Endpoints de Administración (Aprobación de Usuarios) ---
@app.get("/api/admin/users")
async def get_all_users(email: str, session_token: SessionCookie = None):
    if _is_compat_storage() and not _full_cache_is_fresh():
        # The admin table needs all users, but not the route/passenger board.
        await _load_compat_users()
    else:
        await reload_db()
    req_user = get_user_by_identifier(email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Administrador", "Gerente de Operaciones", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado. Se requiere rol de Administración.")
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)
    
    # Devolver lista de usuarios sin contraseñas
    lista_usuarios = []
    for k, v in usuarios_db.items():
        lista_usuarios.append({
            "email": v.get("identifier", k),
            "nombre": v.get("nombre", "Usuario"),
            "rol": v.get("rol", "Usuario"),
            "estado": v.get("estado", "Activo"),
            "perfil_conductor": v.get("perfil_conductor", None),
            "last_login": v.get("last_login", None),
            "avatar": v.get("avatar", None)
        })
    return {"usuarios": lista_usuarios}

@app.post("/api/admin/users/bulk")
async def bulk_users_action(payload: BulkActionPayload, session_token: SessionCookie = None):
    await reload_db()
    req_user = usuarios_db.get(payload.admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Administrador", "Gerente de Operaciones", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)
    
    for target in payload.target_emails:
        if target in usuarios_db:
            if payload.action == "approve":
                usuarios_db[target]["estado"] = "Activo"
                refresh_session_index_for(usuarios_db[target])
                _sembrar_unidad(str(usuarios_db[target].get("unidad_id") or "").strip(), usuarios_db[target])
            elif payload.action in ["reject", "deactivate"]:
                usuarios_db[target]["estado"] = "Rechazado"
                refresh_session_index_for(usuarios_db[target])
            elif payload.action == "delete":
                del usuarios_db[target]
                
    await persist_users_only()
    return {"message": f"Acción '{payload.action}' aplicada a {len(payload.target_emails)} usuarios."}

# Quién puede reiniciar la contraseña de quién.
#
# Cualquiera de administración puede reiniciar la de un conductor o un cliente,
# que es el caso real y cotidiano. Pero reiniciar la de otra cuenta de
# administración es tomarla: se te da una contraseña que conoces sobre una
# cuenta con más permisos que la tuya. Eso queda reservado a la administración
# principal, y nadie puede reiniciar la suya propia por esta vía —para eso
# está cambiarla sabiendo la actual—.
_ROLES_QUE_REINICIAN_A_UN_ADMIN = ["Admin", "Administración", "Administrador"]


@app.post("/api/admin/users/reset-password")
async def reset_user_password(payload: ReinicioDeContrasena, session_token: SessionCookie = None):
    """Devuelve una contraseña provisional para una cuenta, una sola vez.

    Hace falta porque las contraseñas se guardan cifradas: ya no se puede leer
    la de nadie, así que un olvido no tenía salida dentro de la aplicación.

    La provisional se devuelve aquí y no se guarda en ningún otro sitio —ni en
    el historial de actividad—: quien la reinicia se la dicta a su dueño y
    después no vuelve a existir. Al entrar, el sistema le obliga a poner la
    suya, que es lo que ya hace `needs_password_change`.
    """
    await reload_db()
    actor = usuarios_db.get(payload.admin_email)
    if not actor or actor.get("rol") not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    require_request_actor(session_token, expected_user=actor, allowed_roles=_ADMIN_ROLES)

    destino = usuarios_db.get(payload.target)
    if not isinstance(destino, dict):
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    if destino.get("identifier") == actor.get("identifier"):
        raise HTTPException(
            status_code=400,
            detail="Para cambiar la tuya usa «Cambiar contraseña», que pide la actual.",
        )
    if destino.get("rol") in _ADMIN_ROLES and actor.get("rol") not in _ROLES_QUE_REINICIAN_A_UN_ADMIN:
        raise HTTPException(
            status_code=403,
            detail="Solo la administración principal puede reiniciar la contraseña de otra cuenta de administración.",
        )

    provisional = contrasena_provisional()
    destino["password"] = password_for_storage(provisional)
    destino["needs_password_change"] = True
    # Si no se cierran, quien ya estuviera dentro seguiría doce horas más.
    cerradas = revocar_sesiones_de(destino)

    registrar_actividad(
        "Contraseña reiniciada",
        actor=actor,
        entity_type="usuario",
        entity_id=str(destino.get("identifier") or payload.target),
        entity_label=str(destino.get("nombre") or payload.target),
        description=(
            "Se entregó una contraseña provisional; deberá cambiarla al entrar."
            + (f" Se cerraron {cerradas} sesiones abiertas." if cerradas else "")
        ),
        status="warning",
    )
    await persist_users_only()

    # La provisional viaja solo en esta respuesta.
    return {
        "password": provisional,
        "nombre": destino.get("nombre"),
        "sesiones_cerradas": cerradas,
    }


@app.put("/api/admin/users/approve/{target_email}")
async def approve_user(
    target_email: str,
    admin_email: str,
    unidad_id: Optional[str] = None,
    session_token: SessionCookie = None,
):
    await reload_db()
    req_user = usuarios_db.get(admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Administrador", "Gerente de Operaciones", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)
    
    if target_email not in usuarios_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
        
    usuarios_db[target_email]["estado"] = "Activo"
    refresh_session_index_for(usuarios_db[target_email])

    # Si es conductor y el admin proporcionó un Padrón (unidad_id)
    if usuarios_db[target_email].get("rol") == "Conductor" and unidad_id:
        usuarios_db[target_email]["unidad_id"] = unidad_id.strip()
        _sembrar_unidad(unidad_id.strip(), usuarios_db[target_email])

    registrar_actividad(
        "Acceso aprobado",
        actor=req_user,
        actor_respaldo=admin_email,
        entity_type="usuario",
        entity_id=target_email,
        entity_label=usuarios_db[target_email].get("nombre") or target_email,
        description=f"Alta autorizada{f' con padrón {unidad_id.strip()}' if unidad_id else ''}.",
        status="success",
    )
    await persist_users_only()
    return {"message": f"Usuario {target_email} aprobado exitosamente."}

_ADMIN_ROLES = ["Admin", "Administración", "Administrador", "Gerente de Operaciones", "Programador de rutas"]

# Renombrar un padrón migra la clave con la que se identifican unidad, usuario y
# sesión. No es una edición más, así que se reserva a Administración: el Gerente
# y el Programador entran en `_ADMIN_ROLES` y no deben poder hacerlo.
_ADMINISTRATION_ROLES = ("Admin", "Administración", "Administrador")


def _owner_key(value: Any) -> str:
    """Normaliza identificadores de propiedad (padrón, empresa, correo)."""
    return str(value).strip().upper() if value is not None else ""


# El login acepta correo o DNI, y `get_user_by_identifier` resuelve además
# `login_identifier` y `perfil_conductor.numDoc`. La comprobación de propiedad
# tiene que aceptar el mismo conjunto, o un conductor que entra con su DNI
# recibe 403 sobre sus propios datos.
_IDENTITY_FIELDS = ("identifier", "email", "dni", "login_identifier")


def _owner_matches(actor: Dict[str, Any], fields: tuple, requested: Any) -> bool:
    wanted = _owner_key(requested)
    if not wanted:
        return False
    values = [actor.get(field) for field in fields]
    if "dni" in fields:
        perfil = actor.get("perfil_conductor")
        if isinstance(perfil, dict):
            values.append(perfil.get("numDoc"))
    return any(_owner_key(value) == wanted for value in values)


def _next_notification_id() -> int:
    """Id monotónico.

    ``_next_notification_id()`` se repetía indefinidamente: la lista se recorta
    a 50, así que a partir de ahí toda notificación nueva recibía el id 51.
    """
    highest = 0
    for notification in notifications_db:
        if not isinstance(notification, dict):
            continue
        try:
            highest = max(highest, int(float(str(notification.get("id", 0)))))
        except (TypeError, ValueError):
            continue
    return highest + 1


def _require_admin(admin_email: str) -> Dict[str, Any]:
    """Valida que admin_email exista y tenga rol administrativo. Retorna el user."""
    req_user = usuarios_db.get(admin_email)
    if not req_user or req_user.get("rol") not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Acceso denegado.")
    return req_user


@app.delete("/api/admin/users/reject/{target_email}")
async def reject_user(target_email: str, admin_email: str, session_token: SessionCookie = None):
    """Deniega una solicitud PENDIENTE de acceso. Borra la cuenta por completo
    (la cuenta aún no fue aprobada, no hay historial que preservar)."""
    await reload_db()
    req_user = _require_admin(admin_email)
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)

    if target_email not in usuarios_db:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    del usuarios_db[target_email]
    await persist_users_only()
    return {"message": f"Usuario {target_email} rechazado y eliminado."}


@app.patch("/api/admin/users/deactivate/{target_email}")
async def deactivate_user(target_email: str, admin_email: str, session_token: SessionCookie = None):
    """Da de baja a un usuario activo sin borrar sus datos. Mantiene la entrada
    en usuarios_db (incluida perfil_conductor) y la vinculación con
    conductores_db, marcando estado='Inactivo'. El usuario aparecerá en la
    pestaña Inactivos y puede ser reactivado o eliminado permanentemente."""
    await reload_db()
    req_user = _require_admin(admin_email)
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)

    user = usuarios_db.get(target_email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if target_email == admin_email:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta.")

    user["estado"] = "Inactivo"
    # Sin esto, la instantánea del índice seguiría diciendo "Activo" hasta que
    # la sesión caducara: una desactivación que no desactiva.
    refresh_session_index_for(user)
    registrar_actividad(
        "Usuario desactivado",
        actor=req_user,
        actor_respaldo=admin_email,
        entity_type="usuario",
        entity_id=target_email,
        entity_label=user.get("nombre") or target_email,
        description="La cuenta deja de tener acceso al sistema.",
        status="error",
    )
    await persist_users_only()
    return {"message": f"Usuario {target_email} desactivado.", "estado": "Inactivo"}


@app.patch("/api/admin/users/reactivate/{target_email}")
async def reactivate_user(target_email: str, admin_email: str, session_token: SessionCookie = None):
    """Reactiva a un usuario previamente desactivado (Inactivo o Rechazado con
    datos preservados). Restaura estado='Activo'."""
    await reload_db()
    req_user = _require_admin(admin_email)
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)

    user = usuarios_db.get(target_email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    registrar_actividad(
        "Usuario reactivado",
        actor=req_user,
        actor_respaldo=admin_email,
        entity_type="usuario",
        entity_id=target_email,
        entity_label=user.get("nombre") or target_email,
        description="La cuenta vuelve a tener acceso al sistema.",
        status="success",
    )
    user["estado"] = "Activo"
    refresh_session_index_for(user)
    await persist_users_only()
    return {"message": f"Usuario {target_email} reactivado.", "estado": "Activo"}


@app.delete("/api/admin/users/permanent/{target_email}")
async def permanent_delete_user(target_email: str, admin_email: str, session_token: SessionCookie = None):
    """Elimina definitivamente al usuario y todos sus datos. Además libera la
    unidad asociada en conductores_db (si es Conductor). Solo debe usarse desde
    la pestaña Inactivos como acción irreversible de seguridad."""
    await reload_db()
    req_user = _require_admin(admin_email)
    require_request_actor(session_token, expected_user=req_user, allowed_roles=_ADMIN_ROLES)

    user = usuarios_db.get(target_email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if target_email == admin_email:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta.")

    unidad = user.get("unidad_id")
    del usuarios_db[target_email]
    if unidad and unidad in conductores_db:
        del conductores_db[unidad]

    await persist()
    return {"message": f"Usuario {target_email} eliminado permanentemente."}

@app.post("/api/admin/driver/review")
async def review_driver_doc(payload: DriverDocReviewPayload, session_token: SessionCookie = None):
    """Admin marca un documento individual del conductor como aprobado o rechazado."""
    await require_admin_session(session_token)

    req_user = usuarios_db.get(payload.admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Administrador", "Gerente de Operaciones", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")

    conductor = get_user_by_identifier(payload.conductor_email)
    if not conductor:
        conductor = {
            "identifier": payload.conductor_email,
            "email": payload.conductor_email,
            "rol": "Conductor",
            "estado": "Pendiente Revisión",
            "perfil_conductor": {}
        }
        usuarios_db[payload.conductor_email] = conductor

    if "perfil_conductor" not in conductor:
        conductor["perfil_conductor"] = {}

    if "revision_docs" not in conductor["perfil_conductor"]:
        conductor["perfil_conductor"]["revision_docs"] = {}

    conductor["perfil_conductor"]["revision_docs"][payload.campo] = {
        "estado": payload.estado,
        "nota": payload.nota or "",
        "revisado_por": req_user.get("nombre", payload.admin_email),
        "fecha": __import__('datetime').datetime.now().isoformat()
    }

    # Save the notification to notifications_db so it persists
    conductor_key = conductor.get("identifier") or payload.conductor_email
    notif_id = int(__import__('time').time() * 1000)
    notifications_db.append({
        "id": notif_id,
        "tipo": "documento_revisado",
        "campo": payload.campo,
        "estado": payload.estado,
        "nota": payload.nota or "",
        "titulo": f"📋 Documento {payload.campo} {'✅ aprobado' if payload.estado == 'aprobado' else '❌ rechazado'}",
        "mensaje": payload.nota or f"Tu documento '{payload.campo}' fue marcado como {payload.estado}.",
        "para": conductor_key,
        "de": req_user.get("nombre", payload.admin_email),
        "fecha": __import__('datetime').datetime.now().isoformat(),
        "leido": False
    })
    
    # Push WebSocket notification to the conductor immediately
    await ws_manager.send(conductor_key, {
        "tipo": "documento_revisado",
        "campo": payload.campo,
        "estado": payload.estado,
        "nota": payload.nota or "",
        "titulo": f"📋 Documento {payload.campo} {'✅ aprobado' if payload.estado == 'aprobado' else '❌ rechazado'}",
        "mensaje": payload.nota or f"Tu documento '{payload.campo}' fue marcado como {payload.estado}.",
        "fecha": __import__('datetime').datetime.now().isoformat()
    })

    # Update global driver state based on all doc reviews
    revisiones = conductor["perfil_conductor"]["revision_docs"]
    if any(v["estado"] == "rechazado" for v in revisiones.values()):
        conductor["estado"] = "Documentos Observados"
    elif len(revisiones) > 0 and all(v["estado"] == "aprobado" for v in revisiones.values()):
        conductor["estado"] = "Activo"
        refresh_session_index_for(conductor)
        # Aprobar el último documento es lo que da de alta al conductor, así
        # que es aquí donde su unidad tiene que recoger lo que él declaró. Sin
        # esto quedaba en la flota sin nombre de chofer ni capacidad.
        _sembrar_unidad(str(conductor.get("unidad_id") or "").strip(), conductor)

    registrar_actividad(
        "Documento aprobado" if payload.estado == "aprobado" else "Documento rechazado",
        actor=req_user,
        actor_respaldo=payload.admin_email,
        entity_type="documento",
        entity_id=payload.campo,
        entity_label=f"{payload.campo} · {conductor.get('unidad_id') or conductor_key}",
        description=payload.nota or f"Documento marcado como {payload.estado}.",
        status="success" if payload.estado == "aprobado" else "error",
    )
    await persist_users_only()
    return {
        "message": f"Documento '{payload.campo}' marcado como {payload.estado}.",
        "estado_conductor": conductor["estado"],
        "revision_docs": conductor["perfil_conductor"]["revision_docs"]
    }

@app.post("/api/admin/driver/notify")
async def notify_driver(payload: DriverNotifyPayload, session_token: SessionCookie = None):
    """Admin envía un aviso interno al conductor."""
    await require_admin_session(session_token)
    await reload_db()
    req_user = usuarios_db.get(payload.admin_email)
    if not req_user or req_user.get("rol") not in ["Admin", "Administración", "Administrador", "Gerente de Operaciones", "Programador de rutas"]:
        raise HTTPException(status_code=403, detail="Acceso denegado.")

    conductor = get_user_by_identifier(payload.conductor_email)
    if not conductor:
        conductor = {
            "identifier": payload.conductor_email,
            "email": payload.conductor_email,
            "rol": "Conductor",
            "estado": "Pendiente Revisión",
            "perfil_conductor": {}
        }
        usuarios_db[payload.conductor_email] = conductor

    notif_id = int(__import__('time').time() * 1000)
    notifications_db.append({
        "id": notif_id,
        "tipo": "aviso_admin",
        "titulo": "⚠️ Revisión de documentos",
        "mensaje": payload.mensaje,
        "para": payload.conductor_email,
        "de": req_user.get("nombre", payload.admin_email),
        "fecha": __import__('datetime').datetime.now().isoformat(),
        "leido": False
    })
    await persist_users_only()

    # Push WebSocket notification to conductor immediately
    conductor_key = conductor.get("identifier") if conductor else payload.conductor_email
    await ws_manager.send(conductor_key, {
        "tipo": "notificacion",
        "id": notif_id,
        "titulo": "⚠️ Revisión de documentos",
        "mensaje": payload.mensaje,
        "de": req_user.get("nombre", payload.admin_email),
        "fecha": __import__('datetime').datetime.now().isoformat(),
        "leido": False
    })

    return {"message": "Aviso enviado al conductor exitosamente.", "notif_id": notif_id}

class DocumentoSubida(BaseModel):
    unidad_id: str
    campo: str
    nombre: str
    tipo: str
    base64: str
    # Una foto de perfil no es un documento: no se sube en nombre de nadie y no
    # se guarda en la carpeta de una unidad. Ver `CARPETA_AVATARES`.
    foto_de_perfil: bool = False


def _ruta_de_documento(unidad_id: str, campo: str, nombre: str) -> str:
    """Ruta dentro del bucket, agrupada por carpeta del propietario.

    El nombre original se descarta salvo su extensión: viene del dispositivo
    del usuario y puede traer acentos, espacios o rutas. El campo ya identifica
    de qué documento se trata.
    """
    carpeta = re.sub(r"[^A-Za-z0-9_-]", "", unidad_id or "") or "sin-unidad"
    campo_limpio = re.sub(r"[^A-Za-z0-9_-]", "", campo or "documento") or "documento"
    extension = ""
    if "." in (nombre or ""):
        cruda = nombre.rsplit(".", 1)[-1].lower()
        if 1 <= len(cruda) <= 5 and cruda.isalnum():
            extension = f".{cruda}"
    return f"{carpeta}/{campo_limpio}{extension}"


# Las fotos de perfil viven aparte de los documentos.
#
# Un documento es de una unidad y solo lo ve quien tiene que revisarlo. Una foto
# de perfil la ve cualquiera que ya pueda ver ese perfil —el cliente ve la del
# conductor de su ruta, y así era cuando iba incrustada en la fila—, así que
# heredar el gateo por unidad la habría roto justo para quien más la mira.
#
# Sigue dentro del bucket privado y sigue necesitando sesión y URL firmada: lo
# que se abre es a quién, no a todo el mundo.
CARPETA_AVATARES = "avatares"


def _carpeta_personal(identidad: Any) -> str:
    """Carpeta propia de quien todavía no tiene unidad.

    Se deriva de un hash y no del DNI en claro: la ruta viaja al navegador y
    aparece en los registros, así que no debe llevar el documento de nadie.
    """
    digest = hashlib.sha256(_owner_key(identidad).encode("utf-8")).hexdigest()
    return f"usuario-{digest[:16]}"


def _carpetas_del_actor(actor: Dict[str, Any]) -> List[str]:
    """Todas las carpetas que pertenecen a este usuario, de la preferida abajo.

    Son varias porque un conductor sube sus documentos antes de tener unidad y
    la recibe después: si solo se aceptara la carpeta actual, al asignarle la
    unidad dejaría de ver lo que él mismo subió.
    """
    carpetas = []
    unidad = re.sub(r"[^A-Za-z0-9_-]", "", str(actor.get("unidad_id") or ""))
    if unidad:
        carpetas.append(unidad)
    valores = [actor.get(campo) for campo in _IDENTITY_FIELDS]
    perfil = actor.get("perfil_conductor")
    if isinstance(perfil, dict):
        valores.append(perfil.get("numDoc"))
    for valor in valores:
        if _owner_key(valor):
            personal = _carpeta_personal(valor)
            if personal not in carpetas:
                carpetas.append(personal)
    return carpetas


def _carpeta_destino(actor: Optional[Dict[str, Any]], unidad_id: str) -> str:
    """Carpeta en la que se guarda lo que sube este usuario.

    Administración escribe en la unidad que indique —sube documentos en nombre
    del conductor—, pero el resto no elige: el destino sale de su sesión. Un
    conductor sin unidad mandaba `unidad_id` vacío, que caía en la carpeta
    compartida `sin-unidad`, de modo que el DNI del siguiente conductor
    sobrescribía el del anterior y ninguno de los dos podía volver a verlo.
    """
    if actor is None:  # exigencia desactivada: se conserva el rollback de fase 1
        return unidad_id or "sin-unidad"
    if actor.get("rol") in _ADMIN_ROLES:
        if not (unidad_id or "").strip():
            raise HTTPException(status_code=400, detail="Falta la unidad de destino.")
        return unidad_id
    carpetas = _carpetas_del_actor(actor)
    if not carpetas:
        raise HTTPException(status_code=403, detail="Tu cuenta no tiene una unidad asociada.")
    return carpetas[0]


def _ruta_de_avatar(actor: Optional[Dict[str, Any]], nombre: str) -> str:
    """Sitio de la foto de perfil de quien la sube.

    Siempre la suya: a diferencia de un documento, administración no sube la
    foto de otro. Por eso el destino no admite `unidad_id` y sale solo de la
    sesión, y por eso un administrador —que no tiene unidad— también tiene
    dónde ponerla.
    """
    identidad = _carpeta_personal(actor.get("email") or actor.get("identifier")) if actor else "anonimo"
    return _ruta_de_documento(CARPETA_AVATARES, identidad, nombre)


def _puede_ver_unidad(actor: Optional[Dict[str, Any]], unidad_id: str) -> bool:
    """Administración ve cualquier carpeta; un conductor, solo las suyas."""
    if actor is None:  # exigencia desactivada: se conserva el rollback de fase 1
        return True
    if actor.get("rol") in _ADMIN_ROLES:
        return True
    if (unidad_id or "") == CARPETA_AVATARES:
        return True  # ya hay sesión: ver una foto de perfil no pide más
    pedida = _owner_key(unidad_id)
    return any(_owner_key(propia) == pedida for propia in _carpetas_del_actor(actor))


@app.post("/api/documentos/subir")
async def subir_documento(datos: DocumentoSubida, session_token: SessionCookie = None):
    """Guarda un documento en Storage y devuelve su ruta.

    El perfil pasa a almacenar esa ruta en vez del base64 completo, que es lo
    que hacía que cada envío reescribiera una fila de casi diez megas.
    """
    actor = await require_any_session(session_token)
    if datos.foto_de_perfil:
        ruta = _ruta_de_avatar(actor, datos.nombre)
    else:
        ruta = _ruta_de_documento(_carpeta_destino(actor, datos.unidad_id), datos.campo, datos.nombre)
    await upload_document_to_storage(datos.base64, ruta, datos.tipo)
    # Se anota el hecho y su destino, nunca el archivo: el historial no es sitio
    # para el contenido de un DNI.
    registrar_actividad(
        "Documento cargado",
        actor=actor,
        entity_type="documento",
        entity_id=datos.campo,
        entity_label=f"{datos.campo} · {datos.unidad_id or 'sin unidad'}",
        description=f"Archivo {datos.nombre} subido al almacenamiento.",
    )
    return {"path": ruta, "name": datos.nombre, "type": datos.tipo}


@app.get("/api/documentos/url")
async def url_de_documento(path: str, session_token: SessionCookie = None):
    """URL temporal para ver un documento guardado en Storage.

    Se emite solo a quien tiene sesión y sobre la unidad que le corresponde:
    sin esto, conocer o adivinar una ruta bastaría para ver el DNI de otro.
    """
    actor = await require_any_session(session_token)
    unidad = (path or "").split("/", 1)[0]
    if not _puede_ver_unidad(actor, unidad):
        raise HTTPException(status_code=403, detail="No puedes ver documentos de otra unidad.")

    url = await signed_document_url(path)
    if not url:
        raise HTTPException(status_code=404, detail="El documento ya no está disponible.")
    return {"url": url}


def _tiene_contenido(valor: Any) -> bool:
    """Si este valor apunta a un archivo de verdad."""
    if isinstance(valor, str):
        return valor.startswith("data:") or valor.startswith("http")
    if isinstance(valor, dict):
        return bool(valor.get("path") or valor.get("base64") or valor.get("url"))
    return False


def _es_cascara(valor: Any) -> bool:
    """Ficha de un archivo que ya no dice dónde está.

    El formulario del conductor reconstruía cada documento guardado a partir de
    `name`, `size` y `type`, y en el camino perdía `path`. Al reenviar el
    perfil, esa ficha vacía sustituía al documento bueno y el archivo quedaba
    huérfano en el bucket: la pantalla decía «Documento no disponible» aunque el
    fichero siguiera allí.
    """
    return isinstance(valor, dict) and not _tiene_contenido(valor) and bool(valor.get("name"))


def conservar_documentos(anterior: Any, nuevo: Dict[str, Any]) -> Dict[str, Any]:
    """Perfil nuevo, pero sin perder documentos por el camino.

    Un envío solo puede sustituir un documento por otro con contenido, o
    retirarlo explícitamente (`null`). Lo que no puede es pisarlo con una ficha
    que ya no apunta a ningún sitio.
    """
    if not isinstance(anterior, dict):
        return nuevo
    resultado = dict(nuevo)
    for campo, valor in nuevo.items():
        if _es_cascara(valor) and _tiene_contenido(anterior.get(campo)):
            resultado[campo] = anterior[campo]
    return resultado


@app.post("/api/driver/onboarding")
async def driver_onboarding(payload: DriverProfilePayload):
    # Cargar solo los usuarios, no el estado completo: el envío del perfil no
    # necesita rutas ni pasajeros, y descargarlos añadía un viaje entero contra
    # Supabase a una operación que ya rozaba el límite de tiempo de la función.
    user = await _load_compat_user(payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    if user.get("rol") != "Conductor":
        raise HTTPException(status_code=403, detail="El usuario no es un conductor.")
        
    user["perfil_conductor"] = conservar_documentos(user.get("perfil_conductor"), payload.perfilData)
    user["estado"] = "Pendiente Revisión"
    
    if payload.perfilData.get("nombres"):
        user["nombre"] = payload.perfilData.get("nombres")

    # El conductor ya puede escribir su correo en el alta. Se guarda también
    # como correo de la cuenta para que Administración vea el real y no el
    # `apellido@kapital.com` que traía la importación del Excel.
    if str(payload.perfilData.get("correo") or "").strip():
        asignar_correo(user, payload.perfilData["correo"])
    
    await persist_users_only()
    return {"message": "Perfil enviado para revisión exitosamente", "estado": "Pendiente Revisión"}

class MarkReadPayload(BaseModel):
    notif_id: int

@app.get("/api/conductor/notifications")
async def get_conductor_notifications(email: str, session_token: SessionCookie = None):
    await require_session_owner(
        session_token, actor_fields=_IDENTITY_FIELDS, requested=email,
        resource="esas notificaciones",
    )
    await reload_notifications()  # Lightweight: only loads notifications from Supabase
    user_notifs = [n for n in notifications_db if n.get("para") == email]
    user_notifs.sort(key=lambda x: x.get("fecha", ""), reverse=True)
    return user_notifs

@app.post("/api/conductor/notifications/mark-read")
async def mark_notification_read(payload: MarkReadPayload):
    await reload_db()
    for n in notifications_db:
        if n.get("id") == payload.notif_id:
            n["leido"] = True
            await persist_users_only()
            return {"message": "Marcado como leído."}
    raise HTTPException(status_code=404, detail="Notificación no encontrada.")

class ResubmitDocsPayload(BaseModel):
    email: str
    docs: Dict[str, Any]
    uploaded_by: str = "conductor"

class UpdateDataRequestPayload(BaseModel):
    email: str
    field: str
    new_value: str

class ResolveDataRequestPayload(BaseModel):
    admin_email: str
    conductor_email: str
    field: str
    action: str

@app.post("/api/conductor/resubmit-docs")
async def resubmit_driver_docs(payload: ResubmitDocsPayload):
    user = get_user_by_identifier(payload.email)
    if not user:
        raise HTTPException(status_code=404, detail="Conductor no encontrado.")
    
    perfil = user.get("perfil_conductor")
    if not perfil:
        raise HTTPException(status_code=400, detail="El conductor no tiene perfil configurado.")
        
    revision_docs = perfil.get("revision_docs", {})
    
    # Update only the provided documents
    for k, v in payload.docs.items():
        perfil[k] = v
        # Reset the status of this specific document back to pending
        if k in revision_docs:
            revision_docs[k]["estado"] = "pendiente"
            
    # Check if there are any remaining rejected documents
    has_rejected = any(rev.get("estado", "").lower() == "rechazado" for rev in revision_docs.values())
    
    if not has_rejected:
        user["estado"] = "Pendiente Revisión"
    
    await persist_users_only()

    # Notify admins only if the driver uploaded the documents
    if getattr(payload, 'uploaded_by', 'conductor') != 'admin':
        conductor_nombre = user.get("nombre", payload.email)
        notif_obj = {
            "id": _next_notification_id(),
            "tipo": "docs_resubmitted",
            "type": "info", # To be picked up by App.jsx polling
            "title": "📥 Documentos resubidos",
            "message": f"{conductor_nombre} ha subido nuevamente sus documentos para revisión.",
            "conductor_id": payload.email,
            "conductor_nombre": conductor_nombre,
            "para": "admin",
            "timestamp": __import__('datetime').datetime.now().isoformat()
        }
        notifications_db.append(notif_obj)

        # Broadcast to all connected admins
        for role in ["Administración", "Administrador", "Gerente de Operaciones"]:
            await ws_manager.broadcast_to_role(role, notif_obj)

    return {"message": "Documentos actualizados exitosamente", "estado": user["estado"], "user": user}

@app.post("/api/conductor/request-update")
async def request_data_update(payload: UpdateDataRequestPayload):
    user = get_user_by_identifier(payload.email)
    if not user or user.get("rol") != "Conductor":
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
    
    if "perfil_conductor" not in user:
        user["perfil_conductor"] = {}
    
    if "solicitudes_cambio" not in user["perfil_conductor"]:
        user["perfil_conductor"]["solicitudes_cambio"] = {}
        
    user["perfil_conductor"]["solicitudes_cambio"][payload.field] = {
        "new_value": payload.new_value,
        "status": "pendiente",
        "timestamp": __import__('datetime').datetime.now().isoformat()
    }
    
    # Notify admins
    notif_id = f"notif_{int(__import__('datetime').datetime.now().timestamp())}_{__import__('random').randint(1000,9999)}"
    conductor_nombre = user.get("nombre", payload.email)
    notif_obj = {
        "id": notif_id,
        "type": "data_update_request",
        "title": "📝 Solicitud de Cambio de Datos",
        "message": f"{conductor_nombre} ha solicitado actualizar su {payload.field}.",
        "conductor_id": payload.email,
        "conductor_nombre": conductor_nombre,
        "para": "admin",
        "timestamp": __import__('datetime').datetime.now().isoformat()
    }
    notifications_db.append(notif_obj)
    
    for role in ["Administración", "Administrador", "Gerente de Operaciones"]:
        await ws_manager.broadcast_to_role(role, notif_obj)
    
    await persist_users_only()
    return {"status": "ok", "message": "Solicitud enviada"}

@app.post("/api/admin/resolve-update")
async def resolve_data_update(payload: ResolveDataRequestPayload, session_token: SessionCookie = None):
    await require_admin_session(session_token)
    admin = usuarios_db.get(payload.admin_email)
    if not admin or admin.get("rol") not in ["Administración", "Administrador", "Gerente de Operaciones"]:
        raise HTTPException(status_code=403, detail="No autorizado")
        
    conductor = get_user_by_identifier(payload.conductor_email)
    if not conductor or "perfil_conductor" not in conductor:
        raise HTTPException(status_code=404, detail="Conductor no encontrado")
        
    solicitudes = conductor["perfil_conductor"].get("solicitudes_cambio", {})
    if payload.field not in solicitudes or solicitudes[payload.field]["status"] != "pendiente":
        raise HTTPException(status_code=400, detail="Solicitud no encontrada o ya resuelta")
        
    new_value = solicitudes[payload.field]["new_value"]
    
    if payload.action == "approve":
        conductor["perfil_conductor"][payload.field] = new_value
        solicitudes[payload.field]["status"] = "aprobado"
        msg = f"Tu solicitud para actualizar '{payload.field}' ha sido aprobada."
    else:
        solicitudes[payload.field]["status"] = "rechazado"
        msg = f"Tu solicitud para actualizar '{payload.field}' ha sido rechazada."
        
    # Notify conductor
    notif_id = f"notif_{int(__import__('datetime').datetime.now().timestamp())}_{__import__('random').randint(1000,9999)}"
    notif_obj = {
        "id": notif_id,
        "type": "data_update_resolved",
        "title": "📝 Respuesta a Solicitud de Cambio",
        "message": msg,
        "para": "conductor",
        "timestamp": __import__('datetime').datetime.now().isoformat(),
        "leido": False
    }
    
    if "notificaciones" not in conductor:
        conductor["notificaciones"] = []
    conductor["notificaciones"].insert(0, notif_obj)
    
    await ws_manager.send(payload.conductor_email, {"type": "NEW_NOTIFICATION", "notification": notif_obj})
    await persist_users_only()
    
    return {"status": "ok", "action": payload.action, "conductor": conductor}

# --- Lógica de Negocio y Endpoints de Rutas ---


@app.get("/api/flota")
async def get_flota_status(session_token: SessionCookie = None):
    # La respuesta enriquece cada unidad con datos personales del conductor
    # —DNI, dirección, fecha de nacimiento, celular— para la exportación al
    # formato oficial. Servía todo eso sin pedir sesión: bastaba conocer la URL.
    await require_any_session(session_token)
    if _is_compat_storage() and not _full_cache_is_fresh():
        # Fleet is already materialized under the reserved compatibility key;
        # avoid downloading the users and routes JSONB columns just to render
        # the fleet list.  Profile enrichment is retained when a full users
        # cache is already warm (for example after opening Administración).
        await _load_compat_fleet()
    else:
        await reload_db()
    # Índice inverso: unidad_id (padrón K-027) -> usuario con perfil_conductor.
    # Permite enriquecer cada unidad con datos personales (direccion, DNI, fecha
    # de nacimiento, celular) necesarios para la exportación al formato oficial
    # BASE MASIVO / BASE REMISSE.
    perfil_por_unidad: Dict[str, Dict[str, Any]] = {}
    for _email, u in usuarios_db.items():
        if not isinstance(u, dict):
            continue
        uid = u.get("unidad_id")
        if uid and isinstance(u.get("perfil_conductor"), dict):
            perfil_por_unidad[uid] = u

    flota_list = []
    for unidad_id, data in conductores_db.items():
        has_pending_requests = False
        real_placa = data.get("placa")

        user = perfil_por_unidad.get(unidad_id)
        perfil = user.get("perfil_conductor", {}) if user else {}

        if perfil:
            if perfil.get("placa"):
                real_placa = perfil.get("placa")
            solicitudes = perfil.get("solicitudes_cambio", {}) or {}
            for _k, v in solicitudes.items():
                if isinstance(v, dict) and v.get("status") == "pendiente":
                    has_pending_requests = True
                    break

        direccion = perfil.get("direccion", "") or ""
        dni = perfil.get("numDoc", "") or ""
        fecha_nacimiento = perfil.get("fechaNacimiento", "") or ""
        celular = (
            perfil.get("telefonoDirecto")
            or (user.get("celular") if user else None)
            or data.get("telefono", "")
            or ""
        )

        flota_list.append({
            **data,
            # The app_state object key is the immutable fleet identity (padrón)
            # used by PUT/DELETE routes. Never let a stored physical plate
            # overwrite it in the serialized response.
            "placa": unidad_id,
            "unidad_id": unidad_id,
            "real_placa": real_placa or unidad_id,
            "has_pending_requests": has_pending_requests,
            "direccion": direccion,
            "dni": dni,
            "fecha_nacimiento": fecha_nacimiento,
            "celular": celular,
        })
    return {"flota": flota_list}


# --- Exportación oficial de flota (usa plantillas xlsx originales para
# preservar cabecera, colores por GRUPO, ancho de columna y estilos) ---

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
_TEMPLATE_FILES = {
    "MASIVO": "base_masivo.xlsx",
    "REMISSE": "base_remisse.xlsx",
}
_grupo_por_padron_cache: Optional[Dict[str, str]] = None


def _leer_grupo_por_padron() -> Dict[str, str]:
    """Extrae el mapa padrón -> GRUPO desde AMBAS plantillas (source of truth)."""
    result: Dict[str, str] = {}
    for fname in _TEMPLATE_FILES.values():
        path = os.path.join(TEMPLATES_DIR, fname)
        if not os.path.exists(path):
            continue
        wb = load_workbook(path, data_only=True)
        ws = wb.active
        for r in range(2, ws.max_row + 1):
            padron = ws.cell(r, 7).value
            grupo = ws.cell(r, 15).value
            if padron:
                result[str(padron).strip()] = (str(grupo).strip() if grupo else "")
    return result


def _get_grupo_por_padron() -> Dict[str, str]:
    global _grupo_por_padron_cache
    if _grupo_por_padron_cache is None:
        _grupo_por_padron_cache = _leer_grupo_por_padron()
    return _grupo_por_padron_cache


@app.get("/api/flota/export")
async def export_flota(base: str = "MASIVO"):
    """Genera un .xlsx idéntico al template BASE MASIVO 2026 / BASE REMISSE 2026,
    rellenando cada fila con los datos actuales de Supabase. Preserva encabezados,
    colores del GRUPO (TP/KONECTA/TP-KONECTA/REMISSE) y anchos de columna.

    base = MASIVO | REMISSE | TODAS
    """
    base_key = (base or "MASIVO").upper().strip()
    if base_key not in ("MASIVO", "REMISSE", "TODAS"):
        raise HTTPException(status_code=400, detail="base debe ser MASIVO, REMISSE o TODAS")

    await reload_db()

    # Índice usuario por unidad (mismo criterio que /api/flota)
    perfil_por_unidad: Dict[str, Dict[str, Any]] = {}
    for _email, u in usuarios_db.items():
        if isinstance(u, dict) and u.get("unidad_id") and isinstance(u.get("perfil_conductor"), dict):
            perfil_por_unidad[u["unidad_id"]] = u

    def _incluye(unidad_base: str) -> bool:
        b = (unidad_base or "").upper()
        if base_key == "TODAS":
            return True
        return base_key in b

    unidades = sorted(
        [(uid, d) for uid, d in conductores_db.items() if _incluye(d.get("base", ""))],
        key=lambda x: x[0],
    )

    template_file = _TEMPLATE_FILES["REMISSE"] if base_key == "REMISSE" else _TEMPLATE_FILES["MASIVO"]
    template_path = os.path.join(TEMPLATES_DIR, template_file)
    if not os.path.exists(template_path):
        raise HTTPException(status_code=500, detail=f"Template no encontrado: {template_file}")

    wb = load_workbook(template_path)
    ws = wb.active

    # Captura estilos de la fila 2 (para nuevas unidades) y estilo por valor de GRUPO
    base_row_styles = {c: _copy_style(ws.cell(2, c)._style) for c in range(1, 16)}
    grupo_style_by_value: Dict[str, Any] = {}
    for r in range(2, ws.max_row + 1):
        g = ws.cell(r, 15).value
        if g:
            key = str(g).strip()
            if key not in grupo_style_by_value:
                grupo_style_by_value[key] = _copy_style(ws.cell(r, 15)._style)

    # Limpia todas las filas de datos, conserva header
    if ws.max_row >= 2:
        ws.delete_rows(2, ws.max_row - 1)

    grupo_map = _get_grupo_por_padron()

    for i, (uid, data) in enumerate(unidades, start=2):
        user = perfil_por_unidad.get(uid)
        perfil = user.get("perfil_conductor", {}) if user else {}

        base_val = (data.get("base") or "").upper()
        celular = (
            perfil.get("telefonoDirecto")
            or (user.get("celular") if user else None)
            or data.get("telefono")
            or ""
        )
        grupo = grupo_map.get(uid, "")

        values = [
            base_val,
            data.get("chofer") or "",
            perfil.get("direccion") or "",
            perfil.get("numDoc") or "",
            perfil.get("fechaNacimiento") or "",
            celular,
            uid,
            data.get("placa") or "",
            (data.get("tipo") or "").upper(),
            data.get("capacidad") or "",
            (data.get("marca") or "").upper(),
            (data.get("modelo") or "").upper(),
            data.get("ano") or "",
            (data.get("color") or "").upper(),
            grupo,
        ]

        for c, val in enumerate(values, start=1):
            cell = ws.cell(i, c, value=val)
            cell._style = _copy_style(base_row_styles[c])
            if c == 15 and grupo and grupo in grupo_style_by_value:
                cell._style = _copy_style(grupo_style_by_value[grupo])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename_map = {
        "MASIVO": "BASE MASIVO 2026.xlsx",
        "REMISSE": "BASE REMISSE 2026.xlsx",
        "TODAS": "BASE FLOTA 2026.xlsx",
    }
    filename = filename_map[base_key]
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
    }
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )

# Ubicación de respaldo cuando una fila no trae coordenada legible. No es un
# dato del pasajero: todo agente que la reciba va marcado `ubicacion_estimada`.
COORD_RESPALDO_LAT = -12.046374
COORD_RESPALDO_LNG = -77.042793


def get_micro_zona(direccion: str) -> str:
    direccion = direccion.lower()
    if "comas" in direccion: return "Comas 1" if "universitaria" in direccion else "Comas 2"
    if "callao" in direccion: return "Callao 1"
    if "surco" in direccion: return "Surco Sur"
    if "san miguel" in direccion: return "San Miguel Centro"
    return "Zona General"

def get_coordenadas_simuladas(zona: str):
    base_lat = -12.0464
    base_lng = -77.0428
    if "Comas" in zona:
        base_lat, base_lng = -11.9300, -77.0460
    elif "Callao" in zona:
        base_lat, base_lng = -12.0500, -77.1200
    elif "Surco" in zona:
        base_lat, base_lng = -12.1300, -76.9900
    elif "San Miguel" in zona:
        base_lat, base_lng = -12.0800, -77.0800
        
    # Reducimos el offset de 0.02 a 0.005 para evitar que caigan al mar (San Miguel/Callao)
    return base_lat + random.uniform(-0.005, 0.005), base_lng + random.uniform(-0.005, 0.005)


# K-Means nativo y ligero para evitar que Vercel explote por límite de tamaño (250MB)
def native_kmeans(points, k, max_iters=10):
    if len(points) <= k:
        return list(range(len(points)))
        
    import random
    # Inicializar centroides al azar
    centroids = random.sample(points, k)
    labels = []
    
    for _ in range(max_iters):
        labels = []
        clusters = [[] for _ in range(k)]
        
        # Asignar cada punto al centroide más cercano
        for pt in points:
            dists = [math.hypot(pt[0] - c[0], pt[1] - c[1]) for c in centroids]
            best_k = dists.index(min(dists))
            labels.append(best_k)
            clusters[best_k].append(pt)
            
        # Recalcular centroides
        new_centroids = []
        for i in range(k):
            if not clusters[i]:
                new_centroids.append(centroids[i])
            else:
                avg_lat = sum(p[0] for p in clusters[i]) / len(clusters[i])
                avg_lng = sum(p[1] for p in clusters[i]) / len(clusters[i])
                new_centroids.append((avg_lat, avg_lng))
                
        if new_centroids == centroids:
            break
        centroids = new_centroids
        
    return labels



# --- Histórico de la intranet ------------------------------------------------

# Filas por petición a PostgREST. Un mes son 21.271, que caben en 43 viajes;
# mandarlas de una sola vez agota el tiempo de la función serverless.
LOTE_HISTORICO = 500


def _tabla_url(nombre: str) -> str:
    return f"{str(STORAGE_CONFIG.url).rstrip('/')}/{nombre}"


async def _upsert_tabla(cliente: httpx.AsyncClient, tabla: str,
                        filas: List[Dict[str, Any]], conflicto: str) -> int:
    """Escribe en lotes resolviendo duplicados sobre la clave natural.

    `merge-duplicates` es lo que hace repetible la carga: volver a subir el
    mismo día no duplica nada, y subir uno nuevo solo añade. El Programador
    sube el reporte a diario y a veces repite el de ayer.
    """
    cabeceras = {
        **HEADERS,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    escritas = 0
    for inicio in range(0, len(filas), LOTE_HISTORICO):
        trozo = filas[inicio:inicio + LOTE_HISTORICO]
        respuesta = await cliente.post(
            _tabla_url(tabla), params={"on_conflict": conflicto},
            headers=cabeceras, json=trozo,
        )
        if respuesta.status_code not in (200, 201, 204):
            print(f"[Kapital] {tabla} rechazó el lote: {respuesta.status_code}")
            _raise_database_unavailable(f"upsert_{tabla}",
                                        detail=DATABASE_WRITE_UNAVAILABLE_DETAIL)
        escritas += len(trozo)
    return escritas


@app.post("/api/programador/historico")
async def cargar_historico_intranet(
    file: UploadFile = File(...),
    session_token: SessionCookie = None,
):
    """Recibe el reporte diario de la intranet y lo incorpora al histórico.

    Es la puerta por la que entra lo que realmente ocurrió. De aquí salen las
    tres cosas que el Programador necesita y que hasta ahora no existían: dónde
    vive cada pasajero, cuánto tarda de verdad cada ruta, y qué direcciones no
    se pueden situar y necesitan una persona.

    No calcula ni propone rutas. Solo registra.
    """
    actor = await require_admin_session(session_token)

    contenido = await file.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo llegó vacío.")

    try:
        datos = historico_intranet.leer_reporte(io.BytesIO(contenido))
        declarados, deducidos = historico_intranet.construir_padron(datos)
        servicios = historico_intranet.construir_historico(datos)
        duraciones = historico_intranet.construir_duraciones(datos)
    except historico_intranet.ReporteInvalido as exc:
        # El motivo se devuelve tal cual: quien sube el archivo equivocado
        # necesita saber cuál era el correcto, no un fallo genérico.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        print(f"[Kapital] reporte ilegible: {type(exc).__name__}")
        raise HTTPException(
            status_code=400,
            detail="No se pudo leer el archivo. ¿Es el reporte «Detalle» de la intranet?",
        ) from exc

    if not servicios:
        raise HTTPException(
            status_code=400,
            detail="El reporte no trae ningún servicio con fecha y turno legibles.",
        )

    async with httpx.AsyncClient(timeout=90.0) as cliente:
        # Los dos grupos van por separado a propósito. Quien no declara
        # coordenada se escribe sin las columnas de ubicación, de modo que lo
        # que ya se sabía de él sobreviva: un reporte de un día no tiene puntos
        # suficientes y sobrescribirlo degradaba domicilios resueltos con meses
        # de historia.
        if declarados:
            await _upsert_tabla(cliente, "pasajeros", declarados, "dni")
        if deducidos:
            await _upsert_tabla(cliente, "pasajeros", deducidos, "dni")
        await _upsert_tabla(cliente, "servicios_historicos", servicios,
                            "fecha_ejecutada,codigo_vehiculo,turno,dni,modalidad")
        if duraciones:
            await _upsert_tabla(cliente, "duraciones_base", duraciones,
                                "cobertura,modalidad,turno")

        # El domicilio se deduce del histórico acumulado y dentro de la base:
        # mover veinte mil filas para sacar una mediana sería pagar egress por
        # algo que Postgres resuelve donde están los datos. Cada carga solo
        # puede mejorarlo, porque añade puntos.
        ubicaciones = {}
        recalculo = await cliente.post(
            f"{str(STORAGE_CONFIG.url).rstrip('/')}/rpc/recalcular_ubicaciones",
            headers={**HEADERS, "Content-Type": "application/json"}, json={},
        )
        if recalculo.status_code == 200:
            filas = recalculo.json()
            if isinstance(filas, list) and filas:
                ubicaciones = filas[0]
        else:
            # No se aborta: los servicios ya están guardados y son lo valioso.
            # El recálculo se repite en la siguiente carga.
            print(f"[Kapital] recalcular_ubicaciones devolvió {recalculo.status_code}")

    resumen = historico_intranet.resumen(
        len(declarados) + len(deducidos), servicios, duraciones, ubicaciones)
    registrar_actividad(
        "Histórico cargado",
        actor=actor,
        entity_type="historico",
        entity_id=resumen.get("hasta") or "",
        entity_label=f"{resumen['servicios']} servicios",
        description=(
            f"Reporte de la intranet del {resumen['desde']} al {resumen['hasta']}: "
            f"{resumen['pasajeros']} pasajeros, {resumen['ubicacion_pendiente']} sin ubicar."
        ),
    )
    await persist_users_only()
    return resumen


@app.get("/api/programador/estado-historico")
async def estado_historico(session_token: SessionCookie = None):
    """Qué hay cargado hoy: sirve para saber si falta subir el reporte."""
    await require_admin_session(session_token)
    cabeceras = {**HEADERS, "Prefer": "count=exact", "Range": "0-0"}
    async with httpx.AsyncClient(timeout=30.0) as cliente:
        async def cuenta(tabla, params=None):
            r = await cliente.get(_tabla_url(tabla), headers=cabeceras,
                                  params={"select": "*", **(params or {})})
            rango = r.headers.get("content-range", "*/0")
            return int(rango.split("/")[-1]) if rango.split("/")[-1].isdigit() else 0

        ultimo = await cliente.get(
            _tabla_url("servicios_historicos"), headers=HEADERS,
            params={"select": "fecha_ejecutada", "order": "fecha_ejecutada.desc", "limit": 1},
        )
        filas = ultimo.json() if ultimo.status_code == 200 else []
        return {
            "servicios": await cuenta("servicios_historicos"),
            "pasajeros": await cuenta("pasajeros"),
            "sin_ubicar": await cuenta("pasajeros",
                                       {"estado_ubicacion": "eq.no_resuelta"}),
            "duraciones": await cuenta("duraciones_base"),
            "ultimo_dia": filas[0]["fecha_ejecutada"] if filas else None,
        }


# Documentos por consulta al cruzar las novedades contra el historico. No es
# por egress —son columnas cortas— sino por el largo de la URL: PostgREST
# recibe los documentos en `in.(...)` y una lista sin trocear la desborda.
LOTE_CONSULTA_DNI = 40

# PostgREST no devuelve mas de mil filas por peticion, pida uno lo que pida.
# Hay que recorrerlas con `offset` y parar en la tanda corta; dar por
# terminada la lectura en la primera respuesta deja fuera lo que no cupo, y
# un historial recortado convierte un cambio real en «sin novedad».
PAGINA_POSTGREST = 1000


def _clave_de_vehiculo(codigo: Any) -> str:
    """El código de una unidad, comparable entre las dos fuentes.

    La flota de `app_state` guarda «K-027» y la intranet registra «K027». Sin
    normalizar no cruzaba ni una sola de las 110 unidades.
    """
    return re.sub(r"[^A-Z0-9]", "", str(codigo or "").upper())


async def _filas_por_dni(cliente: httpx.AsyncClient, tabla: str, columnas: str,
                         documentos: List[str]) -> List[Dict[str, Any]]:
    """Las filas de esa tabla para esos documentos, en tandas y paginadas."""
    encontradas: List[Dict[str, Any]] = []
    for inicio in range(0, len(documentos), LOTE_CONSULTA_DNI):
        trozo = documentos[inicio:inicio + LOTE_CONSULTA_DNI]
        leidas = 0
        while True:
            respuesta = await cliente.get(
                _tabla_url(tabla), headers=HEADERS,
                params={"select": columnas, "dni": "in.(%s)" % ",".join(trozo),
                        "order": "dni", "limit": PAGINA_POSTGREST, "offset": leidas},
            )
            if respuesta.status_code != 200:
                print(f"[Kapital] {tabla} no respondió al cruce: {respuesta.status_code}")
                _raise_database_unavailable(f"consulta_{tabla}")
            pagina = respuesta.json()
            encontradas.extend(pagina)
            leidas += len(pagina)
            if len(pagina) < PAGINA_POSTGREST:
                break
    return encontradas


@app.get("/api/programador/programacion")
async def programacion_del_dia(fecha: Optional[str] = None,
                               session_token: SessionCookie = None):
    """La programación de un día, tal como se ejecutó.

    Sustituye a `/api/routes` como fuente de la mesa del Programador. Ese
    endpoint devuelve `[]` desde que la programación dejó de escribirse en
    `app_state`, así que el tablero estaba vacío y no había forma de llenarlo:
    lo que el Programador carga entra en las tablas del histórico.

    No propone rutas ni asigna nada —para eso hace falta un motor que no
    existe—, sino que enseña lo que de verdad ocurrió, que es el punto de
    partida del trabajo: seguir el orden anterior y aplicar las novedades.

    Sin `fecha` devuelve el último día cargado.
    """
    await require_admin_session(session_token)
    async with httpx.AsyncClient(timeout=60.0) as cliente:
        respuesta = await cliente.post(
            f"{str(STORAGE_CONFIG.url).rstrip('/')}/rpc/programacion_del_dia",
            headers={**HEADERS, "Content-Type": "application/json"},
            json={"dia": fecha} if fecha else {},
        )
    if respuesta.status_code != 200:
        print(f"[Kapital] programacion_del_dia devolvió {respuesta.status_code}")
        _raise_database_unavailable("programacion_del_dia")
    return respuesta.json()


@app.get("/api/programador/vehiculos")
async def ocupacion_de_vehiculos(session_token: SessionCookie = None):
    """Cuánto llevó de verdad cada vehículo, según el histórico.

    La pantalla de Flota enseñaba la carga derivada de `/api/routes`, que está
    vacío: cuatro columnas a cero para las 110 unidades. Esto la sustituye por
    lo medido.

    La clave es el código normalizado sin guiones ni espacios: la flota guarda
    «K-027» y la intranet registra «K027», y sin normalizar no cruzaba ninguna.
    """
    await require_admin_session(session_token)
    async with httpx.AsyncClient(timeout=60.0) as cliente:
        respuesta = await cliente.post(
            f"{str(STORAGE_CONFIG.url).rstrip('/')}/rpc/resumen_vehiculos",
            headers={**HEADERS, "Content-Type": "application/json"}, json={},
        )
    if respuesta.status_code != 200:
        print(f"[Kapital] resumen_vehiculos devolvió {respuesta.status_code}")
        _raise_database_unavailable("resumen_vehiculos")
    medidos = respuesta.json() or {}
    return {_clave_de_vehiculo(codigo): datos for codigo, datos in medidos.items()}


@app.get("/api/programador/analisis")
async def analisis_del_historico(session_token: SessionCookie = None):
    """Lo que dice el histórico cargado, resumido.

    El cálculo vive en la función `resumen_analisis()` de Postgres, no aquí:
    son 21.789 filas y subirlas para contarlas costaría medio mega de egress
    cada vez que alguien abre la pestaña. Lo que viaja son ~4 KB.

    Sustituye al análisis anterior, que derivaba del tablero de `/api/routes`.
    Ese endpoint devuelve una lista vacía desde que la programación no se
    escribe en `app_state`, así que la pantalla no podía enseñar nada.
    """
    await require_admin_session(session_token)
    async with httpx.AsyncClient(timeout=60.0) as cliente:
        respuesta = await cliente.post(
            f"{str(STORAGE_CONFIG.url).rstrip('/')}/rpc/resumen_analisis",
            headers={**HEADERS, "Content-Type": "application/json"}, json={},
        )
    if respuesta.status_code != 200:
        print(f"[Kapital] resumen_analisis devolvió {respuesta.status_code}")
        _raise_database_unavailable("resumen_analisis")
    return respuesta.json()


@app.post("/api/programador/novedades")
async def analizar_novedades(
    file: UploadFile = File(...),
    session_token: SessionCookie = None,
):
    """Lee las novedades del cliente y dice qué cambia de verdad.

    No se fía de la columna «NOVEDAD» —está medido que se equivoca— sino que
    contrasta cada fila con lo que esa persona venía haciendo según el
    histórico. De la etiqueta solo toma si viaja o no, que es el único dato
    que no está en ninguna otra parte.

    No escribe nada: devuelve el resultado para que una persona lo mire. Las
    altas y bajas de verdad las confirma el histórico del día siguiente.
    """
    await require_admin_session(session_token)

    contenido = await file.read()
    if not contenido:
        raise HTTPException(status_code=400, detail="El archivo llegó vacío.")

    try:
        marco = novedades_intranet.leer_novedades(contenido)
    except novedades_intranet.ReporteInvalido as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        print(f"[Kapital] novedades ilegibles: {type(exc).__name__}")
        raise HTTPException(
            status_code=400,
            detail="No se pudo leer el archivo. ¿Es el Excel de Novedades del cliente?",
        ) from exc

    documentos = sorted({d for d in marco["dni"] if d})
    if not documentos:
        raise HTTPException(status_code=400,
                            detail="El archivo no trae ningún documento legible.")

    async with httpx.AsyncClient(timeout=60.0) as cliente:
        servicios = await _filas_por_dni(
            cliente, "servicios_historicos",
            "dni,cobertura,turno,modalidad,fecha_ejecutada", documentos)
        padron = await _filas_por_dni(
            cliente, "pasajeros", "dni,nombre,direccion,distrito,estado_ubicacion",
            documentos)

    return novedades_intranet.analizar(marco, servicios, padron)


@app.get("/api/routes")
async def get_routes():
    if _is_compat_storage() and not _full_cache_is_fresh():
        await _load_compat_routes()
    else:
        await reload_db()
    return rutas_estado_actual

@app.get("/api/routes/summary")
async def get_routes_summary():
    """Returns compact route summary for GerentePortal (no agent details, just counts)."""
    await reload_routes_summary()
    if routes_summary:
        return routes_summary
    # A valid projection can be empty while the previous in-memory full
    # snapshot still contains routes. Do not expose that stale board as a
    # summary; only a full snapshot may use the route-derived fallback.
    if not _full_cache_is_fresh() and _cache_is_fresh(_routes_summary_cache_loaded_at):
        return []
    # Fallback: build summary from full routes if available
    if rutas_estado_actual:
        return _build_routes_summary(rutas_estado_actual)
    return []

@app.post("/api/routes/publish")
async def publish_routes_summary(rutas: list = Body(...), session_token: SessionCookie = None):
    await require_admin_session(session_token)
    await ensure_db_loaded()
    summary = _build_routes_summary(rutas)
    
    global usuarios_db, routes_summary, board_lock
    next_lock = {**(board_lock or {}), "routes_summary": summary}
    payload = {
        "id": 1,
        "usuarios": {
            **usuarios_db,
            "__routes_summary__": summary,
            "__historial_rutas__": historial_rutas,
            "__lock__": next_lock,
            "__flota__": conductores_db,
            "__notifications__": notifications_db,
            "__actividad__": actividad_db,
            "__sessions__": session_index,
            "__login__": _refrescar_indice_login(),
        },
    }
    if _is_normalized_storage():
        previous_summary, previous_lock = routes_summary, board_lock
        routes_summary, board_lock = summary, next_lock
        try:
            await _persist_app_state(payload, "publish_routes_summary")
        except Exception:
            routes_summary, board_lock = previous_summary, previous_lock
            raise
    else:
        await _persist_app_state(payload, "publish_routes_summary")
    routes_summary = summary
    board_lock = next_lock

    return {"message": f"Publicado: {len(summary)} rutas al panel del Gerente.", "total_routes": len(summary)}


@app.post("/api/routes")
async def update_routes(rutas: list = Body(...), session_token: SessionCookie = None):
    await require_admin_session(session_token)
    global rutas_estado_actual
    rutas_estado_actual = rutas
    await persist()
    return {"message": "Rutas actualizadas sincronizadas", "rutas": rutas_estado_actual}

@app.post("/api/assign-routes/")
async def assign_routes_from_excel(
    file: UploadFile = File(...),
    fecha: str = Form(""),
    hora: str = Form(""),
    sentido: str = Form(""),
    sede: str = Form(""),
    session_token: SessionCookie = None,
):
    await require_admin_session(session_token)
    global rutas_estado_actual
    await reload_db()

    try:
        disponibilidad_conductores = {conductor_id: [] for conductor_id in conductores_db.keys()}
        # Leer todo como texto para evitar que Pandas convierta fechas a '2026-08-03' en lugar de '3/08/2026'
        df = pd.read_excel(file.file, dtype=str)
        
        # Limpiar nombres de columnas
        df.columns = df.columns.str.strip()
        
        # Filtrar el DataFrame según los parámetros
        # En el excel las columnas suelen tener un punto al final "FECHA.", "HORA.", "SENTIDO.", "SEDE."
        # Nos aseguramos de manejar si tienen el punto o no.
        def col_name(name):
            return name + "." if name + "." in df.columns else name
            
        c_fecha = col_name("FECHA")
        c_hora = col_name("HORA")
        c_sentido = col_name("SENTIDO")
        c_sede = col_name("SEDE")
        
        # Filtrar (convertimos a str para asegurar la comparacion correcta, quitando .0 de horas como 00:00:00)
        df[c_fecha] = df[c_fecha].astype(str).str.strip()
        df[c_hora] = df[c_hora].astype(str).str.strip()
        df[c_sentido] = df[c_sentido].astype(str).str.strip()
        df[c_sede] = df[c_sede].astype(str).str.strip()
        
        # Hacemos match parcial o exacto
        df_filtered = df[
            (df[c_fecha].str.contains(fecha, na=False, case=False)) &
            (df[c_hora].str.contains(hora, na=False, case=False)) &
            (df[c_sentido].str.contains(sentido, na=False, case=False)) &
            (df[c_sede].str.contains(sede, na=False, case=False))
        ].copy()
        
        if df_filtered.empty:
            fechas_demo = df[c_fecha].dropna().unique()[:3].tolist() if c_fecha in df.columns else []
            horas_demo = df[c_hora].dropna().unique()[:3].tolist() if c_hora in df.columns else []
            sentidos_demo = df[c_sentido].dropna().unique()[:3].tolist() if c_sentido in df.columns else []
            sedes_demo = df[c_sede].dropna().unique()[:3].tolist() if c_sede in df.columns else []
            
            debug_info = f"Columnas: {list(df.columns)}. Fechas detectadas: {fechas_demo}. Horas detectadas: {horas_demo}. Sentidos detectadas: {sentidos_demo}. Sedes detectadas: {sedes_demo}."
            raise HTTPException(status_code=400, detail=f"No se encontraron pasajeros para estos filtros. INFO DEL EXCEL: {debug_info}")
            
        # Parsear coordenadas de forma segura.
        #
        # El respaldo al centro de Lima se conserva para que una celda sucia no
        # tumbe la generación entera, pero deja de ser silencioso: antes un
        # `except: pass` se tragaba el motivo y el resultado era que el 70 % del
        # padrón acababa en un mismo punto sin que nadie se enterara. Una
        # ubicación inventada que no se anuncia invalida cualquier ruteo
        # posterior y nadie puede corregir lo que no ve.
        c_coord = col_name("COORDENADAS")

        def parse_coord(val):
            """Devuelve (lat, lng, estimada). `estimada` marca el respaldo."""
            try:
                parts = str(val).split(',')
                if len(parts) >= 2:
                    return float(parts[0].strip()), float(parts[1].strip()), False
            except (ValueError, TypeError, AttributeError):
                pass
            return COORD_RESPALDO_LAT, COORD_RESPALDO_LNG, True

        parsed = df_filtered[c_coord].apply(parse_coord) if c_coord in df_filtered.columns else None
        if parsed is None:
            # Sin columna de coordenadas no hay nada que parsear: todo el lote
            # queda estimado, y se dice.
            df_filtered['lat'] = COORD_RESPALDO_LAT
            df_filtered['lng'] = COORD_RESPALDO_LNG
            df_filtered['ubicacion_estimada'] = True
        else:
            df_filtered['lat'] = [p[0] for p in parsed]
            df_filtered['lng'] = [p[1] for p in parsed]
            df_filtered['ubicacion_estimada'] = [p[2] for p in parsed]

        estimadas = int(df_filtered['ubicacion_estimada'].sum())
        if estimadas:
            print(
                f"[Kapital] {estimadas} de {len(df_filtered)} pasajeros sin coordenada legible: "
                f"se les asignó la ubicación de respaldo y quedan marcados como estimados."
            )
        
        # Contexto del turno que se adjunta a cada ruta generada. Se omiten los
        # campos vacíos para no escribir claves sin valor en el snapshot.
        _contexto_turno = {
            clave: valor.strip()
            for clave, valor in (("fecha", fecha), ("sentido", sentido), ("sede", sede))
            if valor and valor.strip()
        }

        rutas_generadas = []
        c_distrito = col_name("DISTRITO")
        c_dni = col_name("DNI")
        c_nombres = col_name("NOMBRES")
        c_dir = col_name("DIRECCION")
        c_emp = col_name("PROVEEDOR")
        
        # Agrupar por distrito para aplicar KMeans
        for distrito, grupo in df_filtered.groupby(c_distrito):
            n_pasajeros = len(grupo)
            k_clusters = math.ceil(n_pasajeros / 15.0)
            
            # KMeans nativo
            coords = list(zip(grupo['lat'], grupo['lng']))
            if k_clusters > 1 and len(coords) >= k_clusters:
                labels = native_kmeans(coords, k_clusters)
                grupo['cluster'] = labels
            else:
                grupo['cluster'] = 0
                
            # Por cada cluster dentro del distrito, intentamos buscar un vehiculo
            for cluster_id, subgrupo in grupo.groupby('cluster'):
                agentes_grupo = subgrupo.to_dict('records')
                
                while agentes_grupo:
                    conductor_encontrado = False
                    
                    # Intentar buscar un conductor disponible
                    for conductor_id, horarios_ocupados in disponibilidad_conductores.items():
                        capacidad_actual = sum(len(r['agentes']) for r in rutas_generadas if r['conductor'] == conductor_id)
                        
                        if hora not in horarios_ocupados and capacidad_actual < conductores_db[conductor_id]["capacidad"]:
                            espacio_disponible = conductores_db[conductor_id]["capacidad"] - capacidad_actual
                            agentes_a_asignar = agentes_grupo[:espacio_disponible]
                            
                            agentes_format = []
                            for ag in agentes_a_asignar:

                                agentes_format.append({
                                    "id": str(ag[c_dni]), 
                                    "nombre": str(ag.get(c_nombres, "Desconocido")),
                                    "direccion": str(ag.get(c_dir, "")),
                                    "lat": float(ag['lat']),
                                    "lng": float(ag['lng']),
                                    "ubicacion_estimada": bool(ag.get('ubicacion_estimada', False)),
                                    "empresa": str(ag.get(c_emp, "KAPITAL"))
                                })

                            ruta_existente = next((r for r in rutas_generadas if r["conductor"] == conductor_id and r["micro_zona"] == distrito and r["horario"] == hora), None)
                            if ruta_existente:
                                ruta_existente["agentes"].extend(agentes_format)
                            else:
                                rutas_generadas.append({
                                    "conductor": conductor_id,
                                    "micro_zona": distrito,
                                    "horario": hora,
                                    # La ruta conserva el turno que la originó.
                                    # Antes `fecha`, `sentido` y `sede` solo
                                    # servían para filtrar el Excel y se
                                    # tiraban, así que un tablero no sabía de
                                    # qué día ni de qué sentido era, y dos
                                    # generaciones distintas se volvían
                                    # indistinguibles al acumularse.
                                    **_contexto_turno,
                                    "agentes": agentes_format,
                                })
                                
                            disponibilidad_conductores[conductor_id].append(hora)
                            agentes_grupo = agentes_grupo[len(agentes_a_asignar):]
                            conductor_encontrado = True
                            break
                            
                    # Si no hay vehiculos, ponerlos en reten
                    if not conductor_encontrado:
                        agentes_format = []
                        for ag in agentes_grupo:
                            agentes_format.append({
                                "id": str(ag[c_dni]), 
                                "nombre": str(ag.get(c_nombres, "Desconocido")),
                                "direccion": str(ag.get(c_dir, "")),
                                "lat": float(ag['lat']),
                                "lng": float(ag['lng']),
                                "ubicacion_estimada": bool(ag.get('ubicacion_estimada', False)),
                                "empresa": str(ag.get(c_emp, "KAPITAL"))
                            })
                        rutas_generadas.append({
                            "conductor": "SIN ASIGNAR",
                            "micro_zona": distrito,
                            "horario": hora,
                            **_contexto_turno,
                            "agentes": agentes_format,
                        })
                        break
                        
        rutas_estado_actual = rutas_generadas
        
        # Guardar automáticamente el resumen para que el Gerente vea la nueva data al instante
        # sin importar si persist() completo falla por tamaño.
        summary = _build_routes_summary(rutas_estado_actual)
        await persist_routes_summary(summary)
        
        await persist()
        return rutas_estado_actual
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error en el procesamiento AI del backend: {str(e)}")

@app.post("/api/emergency-reassign/")
async def emergency_reassign(request: EmergencyRequest, session_token: SessionCookie = None):
    await require_admin_session(session_token)
    await reload_db()
    global rutas_estado_actual
    if request.horario == "Todos los turnos" or request.tipo_emergencia == "Baja Total (Siniestro)":
        rutas_afectadas = [r for r in rutas_estado_actual if r["conductor"] == request.conductor_id]
        if not rutas_afectadas: raise HTTPException(status_code=404, detail=f"Conductor '{request.conductor_id}' no encontrado.")
        rescatista_id = None
        for ruta in rutas_afectadas:
            rescatista = next((r for r in rutas_estado_actual if r["micro_zona"] == ruta["micro_zona"] and r["horario"] == ruta["horario"] and r["conductor"] != request.conductor_id), None)
            if rescatista:
                rescatista["agentes"].extend(ruta["agentes"])
                rescatista_id = rescatista["conductor"]
        rutas_estado_actual = [r for r in rutas_estado_actual if r["conductor"] != request.conductor_id]
        await persist()
        return {"message": f"Baja Total procesada. Todas las rutas de {request.conductor_id} han sido reasignadas.", "rutas_actualizadas": rutas_estado_actual, "rescatista_id": rescatista_id or "N/A"}
    else:
        ruta_afectada_idx, ruta_afectada = next(((i, r) for i, r in enumerate(rutas_estado_actual) if r["conductor"] == request.conductor_id and r["horario"] == request.horario), (None, None))
        if ruta_afectada is None: raise HTTPException(status_code=404, detail=f"No se encontró la ruta para '{request.conductor_id}' a las {request.horario}.")
        rescatista = next((r for r in rutas_estado_actual if r["micro_zona"] == ruta_afectada["micro_zona"] and r["horario"] == ruta_afectada["horario"] and r["conductor"] != request.conductor_id), None)
        if rescatista is None: raise HTTPException(status_code=400, detail=f"No se encontró un rescatista en la zona '{ruta_afectada['micro_zona']}' para el horario de las {request.horario}.")
        rescatista["agentes"].extend(ruta_afectada["agentes"])
        del rutas_estado_actual[ruta_afectada_idx]
        await persist()
        return {"message": f"Falla Temporal procesada. La ruta de las {request.horario} de {request.conductor_id} ha sido reasignada a {rescatista['conductor']}.", "rutas_actualizadas": rutas_estado_actual, "rescatista_id": rescatista["conductor"]}

class EstadoPasajeroUpdate(BaseModel):
    conductor_id: str
    horario: str
    agente_id: str
    estado: str # "Recogido" u otro
    evidencia_foto: Optional[str] = None

@app.get("/api/mis-rutas/{conductor_id}")
async def mis_rutas(conductor_id: str, session_token: SessionCookie = None):
    await require_session_owner(
        session_token, actor_fields=("unidad_id",), requested=conductor_id,
        resource="las rutas de esa unidad",
    )
    if _is_compat_storage() and not _full_cache_is_fresh():
        await _load_compat_routes()
    else:
        await reload_db()
    mis_rutas_asignadas = [r for r in rutas_estado_actual if r["conductor"] == conductor_id]
    return mis_rutas_asignadas

@app.post("/api/actualizar-pasajero")
async def actualizar_pasajero(data: EstadoPasajeroUpdate):
    await reload_db()
    ruta = next((r for r in rutas_estado_actual if r["conductor"] == data.conductor_id and r["horario"] == data.horario), None)
    if ruta:
        agente = next((a for a in ruta["agentes"] if a["id"] == data.agente_id), None)
        if agente:
            agente["estado"] = data.estado
            
            # Guardar evidencia en Supabase Storage si existe
            if data.evidencia_foto:
                try:
                    filename = f"evidencia_{data.agente_id}_{int(datetime.now().timestamp())}.jpg"
                    public_url = await upload_evidence_to_supabase(data.evidencia_foto, filename)
                    if public_url:
                        agente["evidencia_foto_url"] = public_url
                except Exception as e:
                    print(f"Error guardando evidencia: {e}")
            
            await persist()
            return {"message": "Estado del pasajero actualizado exitosamente."}
    raise HTTPException(status_code=404, detail="Ruta o agente no encontrado")

@app.get("/api/cliente/rutas/{empresa_id}")
async def get_rutas_cliente(empresa_id: str, session_token: SessionCookie = None):
    await require_session_owner(
        session_token, actor_fields=("empresa_id",), requested=empresa_id,
        resource="las rutas de esa empresa",
    )
    if _is_compat_storage() and not _full_cache_is_fresh():
        await _load_compat_routes()
    else:
        await reload_db()
    global rutas_estado_actual
    try:
        rutas_filtradas = []
        for ruta in rutas_estado_actual:
            agentes_empresa = [ag for ag in ruta.get("agentes", []) if ag.get("empresa") == empresa_id.upper()]
            if agentes_empresa:
                ruta_copy = ruta.copy()
                ruta_copy["agentes"] = agentes_empresa
                rutas_filtradas.append(ruta_copy)
        return rutas_filtradas
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al obtener rutas del cliente: {str(e)}")

@app.get("/api/conductor/info/{unidad_id}")
async def get_conductor_info(unidad_id: str):
    await reload_db()
    
    conductor_user = None
    for k, v in usuarios_db.items():
        if v.get("unidad_id") == unidad_id and v.get("rol") == "Conductor":
            conductor_user = v
            break
            
    flota_info = conductores_db.get(unidad_id, {})
    
    if not conductor_user and not flota_info:
        raise HTTPException(status_code=404, detail="Conductor/Unidad no encontrada")
        
    return {
        "unidad_id": unidad_id,
        "usuario": {
            "nombre": conductor_user.get("nombre") if conductor_user else flota_info.get("chofer", "Desconocido"),
            "email": conductor_user.get("email") if conductor_user else "",
            "identifier": conductor_user.get("identifier") if conductor_user else "",
            "avatar": conductor_user.get("avatar") if conductor_user else None,
            "perfil_conductor": conductor_user.get("perfil_conductor") if conductor_user else None
        },
        "flota": flota_info
    }


# El T.U.C. (ATU) se retira del seguimiento: la operación dejó de usarlo. Los
# valores ya guardados siguen en la fila pero no se leen ni se muestran.
_FLEET_EXPIRY_FIELDS = ("soat", "revision", "licencia")
_FLEET_EDITABLE_FIELDS = (
    "capacidad", "tipo", "chofer", "telefono", "placa", *_FLEET_EXPIRY_FIELDS,
)


def _model_changes(model: BaseModel) -> Dict[str, Any]:
    """Return explicitly supplied fields on Pydantic 1 and 2."""
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=True)
    return model.dict(exclude_unset=True)


def _normalize_fleet_expiries(values: Dict[str, Any]) -> Dict[str, Any]:
    """Validate canonical optional ISO dates; status labels are never stored."""
    normalized = dict(values)
    for field in _FLEET_EXPIRY_FIELDS:
        if field not in normalized:
            continue
        value = normalized[field]
        if value is None or (isinstance(value, str) and not value.strip()):
            normalized[field] = ""
            continue
        if not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f"{field} debe usar formato AAAA-MM-DD.")
        candidate = value.strip()
        try:
            parsed = datetime.strptime(candidate, "%Y-%m-%d")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"{field} debe usar formato AAAA-MM-DD.") from exc
        # strptime accepts some non-zero-padded variants; require a canonical
        # round-trip so every consumer derives status from one stable shape.
        if parsed.strftime("%Y-%m-%d") != candidate:
            raise HTTPException(status_code=400, detail=f"{field} debe usar formato AAAA-MM-DD.")
        normalized[field] = candidate
    return normalized


async def _persist_and_verify_fleet(
    unit_id: str, expected: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Persist the fleet source of truth and confirm it with a fresh read.

    ``expected=None`` verifies a removal: the unit must be gone after the
    re-read, so a silently rejected delete cannot report success.
    """
    await _persist_app_state({
        "id": 1,
        "usuarios": {
            **usuarios_db,
            "__routes_summary__": routes_summary,
            "__historial_rutas__": historial_rutas,
            "__lock__": board_lock,
            "__flota__": conductores_db,
            "__notifications__": notifications_db,
            "__actividad__": actividad_db,
            "__sessions__": session_index,
            "__login__": _refrescar_indice_login(),
        },
    }, "persist_fleet")
    await _load_compat_fleet(force=True)
    stored = conductores_db.get(unit_id)
    if expected is None:
        verified = stored is None
    else:
        verified = isinstance(stored, dict) and all(
            stored.get(key) == value for key, value in expected.items()
        )
    if not verified:
        _raise_database_unavailable(
            "verify_fleet_write",
            error=ValueError("fleet write could not be verified"),
            detail=DATABASE_WRITE_UNAVAILABLE_DETAIL,
        )
    return stored


@app.post("/api/flota")
async def add_flota(flota: FlotaRegistro, session_token: SessionCookie = None):
    # Autorizar ANTES de leer. `reload_db(force=True)` salta el caché y
    # descarga el estado completo (~3,95 MB): hacerlo primero significaba que
    # una petición sin sesión válida pagaba esa lectura entera para acabar
    # rechazada con 401. El orden inverso existía porque validar una sesión
    # exigía el blob de usuarios; el índice de sesiones del lote anterior
    # eliminó esa dependencia, así que `require_admin_session` resuelve sin
    # cookie en cero lecturas y con cookie contra el índice.
    actor_admin = await require_admin_session(session_token)
    await reload_db(force=True)
    global conductores_db
    # Sin `padron` se usa `placa`, que es lo que mandaba el formulario antiguo.
    unit_id = (flota.padron or flota.placa or "").strip().upper()
    if not unit_id:
        raise HTTPException(status_code=400, detail="El padrón de la unidad no puede estar vacío.")
    if unit_id in conductores_db:
        raise HTTPException(status_code=409, detail=f"Ya existe una unidad con el padrón {unit_id}.")

    matricula = (flota.placa or "").strip().upper() if flota.padron else ""
    if matricula:
        duplicada = next(
            (uid for uid, u in conductores_db.items()
             if isinstance(u, dict) and str(u.get("placa") or "").strip().upper() == matricula),
            None,
        )
        if duplicada:
            raise HTTPException(status_code=409, detail=f"La placa {matricula} ya está en la unidad {duplicada}.")

    values = _normalize_fleet_expiries({
        key: getattr(flota, key) for key in _FLEET_EDITABLE_FIELDS
    })
    if matricula:
        values["placa"] = matricula

    # La cuenta del conductor se crea con la unidad, no después: dar de alta una
    # unidad cuyo conductor no puede entrar deja su documentación en el aire.
    dni = (flota.dni or "").strip()
    conductor_nuevo = None
    if dni or flota.password:
        if not dni:
            raise HTTPException(status_code=400, detail="Falta el DNI del conductor.")
        if not flota.password or len(flota.password) < 4:
            raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 4 caracteres.")
        if get_user_by_identifier(dni):
            raise HTTPException(status_code=409, detail=f"Ya existe una cuenta con el documento {dni}.")
        conductor_nuevo = {
            "identifier": dni,
            "email": None,
            "dni": dni,
            "password": password_for_storage(flota.password),
            "nombre": (flota.chofer or "").strip() or "Conductor",
            "rol": "Conductor",
            "telefono": (flota.telefono or "").strip(),
            "unidad_id": unit_id,
            "empresa_id": None,
            "avatar": None,
            "estado": "Activo",
            # La contraseña la pone Administración, así que es provisional: el
            # conductor tiene que cambiarla la primera vez que entre para que
            # nadie más la conozca.
            "needs_password_change": True,
        }
        usuarios_db[dni] = conductor_nuevo
    # Uploads remain accepted for the independent new-unit flow. They are not
    # part of FlotaUpdate and therefore cannot be changed from the pencil modal.
    for field in ("soat_doc", "revision_doc", "licencia_doc"):
        value = getattr(flota, field)
        if value is not None:
            values[field] = value
    conductores_db[unit_id] = values
    if conductor_nuevo:
        registrar_actividad(
            "Unidad creada",
            actor=actor_admin,
            entity_type="unidad",
            entity_id=unit_id,
            entity_label=unit_id,
            description=f"Alta de la unidad con la cuenta del conductor {dni}.",
            status="success",
        )
    try:
        stored = await _persist_and_verify_fleet(unit_id, values)
    except Exception:
        conductores_db.pop(unit_id, None)
        if conductor_nuevo:
            usuarios_db.pop(dni, None)
        raise
    return {"message": "Unidad agregada exitosamente", "unidad": {"unidad_id": unit_id, **stored}, "flota": conductores_db}


@app.put("/api/flota/{placa}")
async def update_flota(placa: str, flota: FlotaUpdate, session_token: SessionCookie = None):
    # Autorizar antes de leer, por el motivo explicado en `add_flota`.
    actor_admin = await require_admin_session(session_token)
    # A fresh provider read prevents a warm Vercel instance from overwriting a
    # newer fleet snapshot written by another instance.
    await reload_db(force=True)
    global conductores_db
    if placa not in conductores_db:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    previous = dict(conductores_db[placa])
    changes = _normalize_fleet_expiries({
        key: value for key, value in _model_changes(flota).items()
        if key in _FLEET_EDITABLE_FIELDS
    })
    updated = {**previous, **changes}
    # Preserve base/make/model/year/color, document URLs and any future
    # metadata by merging only the explicit structured allow-list above.
    if updated == previous:
        return {"message": "Sin cambios", "unchanged": True, "unidad": {"unidad_id": placa, **previous}, "flota": conductores_db}
    conductores_db[placa] = updated
    # Se anota antes de persistir para que el guardado lo lleve consigo, y se
    # deshace junto al resto si la escritura falla.
    actividad_previa = list(actividad_db)
    registrar_actividad(
        "Unidad actualizada",
        actor=actor_admin,
        entity_type="unidad",
        entity_id=placa,
        entity_label=placa,
        description=f"Unidad {placa} modificada desde la ficha del conductor.",
        status="success",
        changes=[c for c in (
            cambio(_ETIQUETA_FLOTA.get(campo, campo), previous.get(campo), valor)
            for campo, valor in changes.items()
        ) if c],
    )
    try:
        stored = await _persist_and_verify_fleet(placa, updated)
    except Exception:
        conductores_db[placa] = previous
        actividad_db[:] = actividad_previa
        raise
    return {"message": "Unidad actualizada", "unchanged": False, "unidad": {"unidad_id": placa, **stored}, "flota": conductores_db}

class FlotaRenombrar(BaseModel):
    nuevo_id: str


@app.post("/api/flota/{placa}/renombrar")
async def rename_flota(placa: str, datos: FlotaRenombrar, session_token: SessionCookie = None):
    """Cambia el padrón de una unidad migrando todo lo que lo referencia.

    El padrón no es un campo más: es la clave con la que se relacionan la
    unidad, el usuario conductor y su sesión. Cambiarlo solo en la flota
    dejaría al conductor apuntando a una unidad inexistente, y su sesión
    conservaría el padrón viejo — perdería el acceso a sus propias rutas sin
    que nada lo explicara.

    Por eso la operación migra las tres referencias a la vez y refresca el
    índice de sesiones, que es obligatorio al mutar datos de autorización.
    """
    # Autorizar antes de leer, por el mismo motivo que el resto de escrituras
    # de flota: `reload_db(force=True)` descarga el estado completo.
    await require_administration_session(session_token)
    await reload_db(force=True)

    global conductores_db, rutas_estado_actual

    origen = placa.strip()
    destino = (datos.nuevo_id or "").strip()

    if not destino:
        raise HTTPException(status_code=400, detail="El nuevo padrón no puede estar vacío.")
    if origen not in conductores_db:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    if destino == origen:
        return {"message": "Sin cambios", "unchanged": True, "unidad_id": origen}
    # Aceptar un destino existente fusionaría dos unidades y perdería una.
    if destino in conductores_db:
        raise HTTPException(status_code=409, detail=f"Ya existe una unidad con el padrón {destino}.")

    previo_flota = dict(conductores_db)
    previo_rutas = [dict(r) for r in rutas_estado_actual]
    usuarios_migrados = []

    conductores_db[destino] = conductores_db.pop(origen)

    for user in usuarios_db.values():
        if isinstance(user, dict) and user.get("unidad_id") == origen:
            user["unidad_id"] = destino
            usuarios_migrados.append(user)
            # Sin esto la sesión abierta del conductor mantiene el padrón viejo
            # y deja de autorizarle sobre su propia unidad.
            refresh_session_index_for(user)

    rutas_estado_actual = [
        {**ruta, "conductor": destino} if ruta.get("conductor") == origen else ruta
        for ruta in rutas_estado_actual
    ]

    try:
        await _persist_and_verify_fleet(destino, conductores_db[destino])
    except Exception:
        conductores_db = previo_flota
        rutas_estado_actual = previo_rutas
        for user in usuarios_migrados:
            user["unidad_id"] = origen
            refresh_session_index_for(user)
        raise

    return {
        "message": "Padrón actualizado",
        "unchanged": False,
        "anterior": origen,
        "unidad_id": destino,
        "usuarios_actualizados": len(usuarios_migrados),
        "flota": conductores_db,
    }


@app.delete("/api/flota/{placa}")
async def delete_flota(placa: str, session_token: SessionCookie = None):
    # Autorizar antes de leer, por el motivo explicado en `add_flota`.
    await require_admin_session(session_token)
    # Removing a unit is irreversible, so it reloads before writing: a warm
    # instance must not delete from a stale snapshot, nor drop a unit another
    # instance just created.
    await reload_db(force=True)
    global conductores_db
    if placa not in conductores_db:
        raise HTTPException(status_code=404, detail="Unidad no encontrada")
    previous = dict(conductores_db[placa])
    del conductores_db[placa]
    try:
        await _persist_and_verify_fleet(placa, None)
    except Exception:
        conductores_db[placa] = previous
        raise
    return {"message": "Unidad eliminada", "unidad_id": placa, "flota": conductores_db}

import asyncio

JSON_PE_TOKEN = os.environ.get("JSON_PE_TOKEN", "0cea1f04743e822b1605856b5ca5e1c3912f5bcb228e661aa8878bc8da36")

@app.get("/api/verify/soat/{placa}")
async def verify_soat(placa: str, session_token: SessionCookie = None):
    """Verifica el SOAT de un vehículo. Implementa caché en memoria para evitar consumir
    créditos de json.pe en consultas repetidas."""
    await require_any_session(session_token)
    await reload_db()
    placa_limpia = placa.replace("-", "").strip()

    # --- CORTAFUEGOS: Buscar caché en usuarios_db ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        # Normalizar placa al comparar
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            cached = perfil.get("validacion_soat")
            if cached and cached.get("valido") is not None:
                # ¡Caché HIT! Retornar sin gastar créditos.
                return {**cached, "fuente": "cache"}
            break  # Conductor encontrado pero sin caché, salir del loop.

    # --- CACHÉ MISS: Llamar a json.pe ---
    result = None
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.json.pe/api/soat",
                headers={"Authorization": f"Bearer {JSON_PE_TOKEN}", "Content-Type": "application/json"},
                json={"placa": placa_limpia},
                timeout=10.0
            )
            if res.status_code == 200:
                data = res.json()
                if data.get("success"):
                    info = data.get("data", {})
                    fecha_fin_str = info.get("fecha_fin")
                    valido = True
                    mensaje = f"SOAT VIGENTE ({info.get('nombre_compania')})"
                    if fecha_fin_str:
                        try:
                            vencimiento = datetime.strptime(fecha_fin_str, "%d/%m/%Y")
                            if vencimiento < datetime.now():
                                valido = False
                                mensaje = "SOAT VENCIDO"
                        except:
                            pass
                    result = {
                        "valido": valido,
                        "mensaje": mensaje,
                        "compania": info.get("nombre_compania", "Desconocida"),
                        "fechaVencimiento": fecha_fin_str,
                        "fuente": "api"
                    }
    except Exception as e:
        print("JSON.PE SOAT Error:", e)

    # --- FALLBACK: Si la API falló o no retornó datos útiles ---
    if result is None:
        await asyncio.sleep(0.5)
        if "XXX" in placa.upper():
            result = {"valido": False, "mensaje": "SOAT vencido (Simulación/Fallback)", "fechaVencimiento": None, "fuente": "fallback"}
        else:
            result = {"valido": True, "mensaje": "SOAT VIGENTE (Fallback)", "compania": "La Positiva", "fechaVencimiento": "2027-12-31", "fuente": "fallback"}

    # --- GUARDAR en caché (memoria + Supabase) ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            user["perfil_conductor"]["validacion_soat"] = result
            await persist()  # persist() completo para sobrevivir reinicio de Vercel
            break

    return result


@app.get("/api/verify/citv/{placa}")
async def verify_citv(placa: str, session_token: SessionCookie = None):
    """Verifica la Revisión Técnica (CITV) con caché en memoria."""
    await require_any_session(session_token)
    await reload_db()
    placa_limpia = placa.replace("-", "").strip()

    # --- CORTAFUEGOS: Buscar caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            cached = perfil.get("validacion_citv")
            if cached and cached.get("valido") is not None:
                return {**cached, "fuente": "cache"}
            break

    # --- CITV: json.pe no provee este dato, usamos simulación inteligente ---
    await asyncio.sleep(0.5)
    if "XXX" in placa.upper():
        result = {"valido": False, "mensaje": "Revisión Técnica vencida (Simulación)", "fechaVencimiento": None, "fuente": "simulacion"}
    else:
        result = {
            "valido": True,
            "mensaje": "CITV VIGENTE (Simulación activa)",
            "centro": "Farenet",
            "fechaVencimiento": "2027-10-15",
            "fuente": "simulacion"
        }

    # --- GUARDAR en caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        placa_perfil = (perfil.get("vehiculoPlaca") or "").replace("-", "").strip()
        if placa_perfil == placa_limpia:
            user["perfil_conductor"]["validacion_citv"] = result
            await persist()
            break

    return result


@app.get("/api/verify/licencia/{doc}")
async def verify_licencia(doc: str, session_token: SessionCookie = None):
    """Verifica la licencia de un conductor con caché en memoria."""
    await require_any_session(session_token)
    await reload_db()
    doc_limpio = doc.strip()

    # --- CORTAFUEGOS: Buscar caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        doc_perfil = (perfil.get("numDoc") or "").strip()
        if doc_perfil == doc_limpio:
            cached = perfil.get("validacion_licencia")
            if cached and cached.get("valido") is not None:
                return {**cached, "fuente": "cache"}
            break

    # --- CACHÉ MISS: Llamar a json.pe ---
    result = None
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://api.json.pe/api/licencia",
                headers={"Authorization": f"Bearer {JSON_PE_TOKEN}", "Content-Type": "application/json"},
                json={"dni": doc_limpio},
                timeout=10.0
            )
            if res.status_code == 200:
                data = res.json()
                if data.get("success"):
                    info = data.get("data", {})
                    lic_info = info.get("licencia", {})
                    estado = lic_info.get("estado", "")
                    valido = estado.upper() == "VIGENTE"
                    result = {
                        "valido": valido,
                        "mensaje": f"LICENCIA {estado} ({lic_info.get('restricciones', '')})",
                        "claseCategoria": lic_info.get("categoria", ""),
                        "fechaVencimiento": lic_info.get("fecha_vencimiento", ""),
                        "fechaEmision": lic_info.get("fecha_emision", ""),
                        "restricciones": lic_info.get("restricciones", ""),
                        "fuente": "api"
                    }
    except Exception as e:
        print("JSON.PE Licencia Error:", e)

    # --- FALLBACK ---
    if result is None:
        await asyncio.sleep(0.5)
        if doc_limpio.startswith("000"):
            result = {"valido": False, "mensaje": "Licencia Retenida (Simulación/Fallback)", "claseCategoria": None, "fuente": "fallback"}
        else:
            result = {
                "valido": True,
                "mensaje": "LICENCIA VIGENTE (Fallback)",
                "claseCategoria": "A-IIb",
                "fechaVencimiento": "2028-05-20",
                "fuente": "fallback"
            }

    # --- GUARDAR en caché ---
    for email, user in usuarios_db.items():
        perfil = user.get("perfil_conductor", {})
        if not perfil:
            continue
        doc_perfil = (perfil.get("numDoc") or "").strip()
        if doc_perfil == doc_limpio:
            user["perfil_conductor"]["validacion_licencia"] = result
            await persist()
            break

    return result

@app.post("/api/clear-routes")
async def clear_routes(session_token: SessionCookie = None):
    await require_admin_session(session_token)
    await reload_db()
    global rutas_estado_actual, historial_rutas
    from datetime import datetime
    if rutas_estado_actual:
        fecha_hoy = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        registro_historial = {
            "fecha": fecha_hoy,
            "rutas": rutas_estado_actual
        }
        historial_rutas.append(registro_historial)
    rutas_estado_actual = []
    await persist()
    return {"message": "Rutas archivadas y tablero limpiado"}

@app.post("/api/save-history")
async def save_history(session_token: SessionCookie = None):
    await require_admin_session(session_token)
    await reload_db()
    global rutas_estado_actual, historial_rutas
    from datetime import datetime
    if rutas_estado_actual:
        fecha_hoy = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        registro_historial = {
            "fecha": fecha_hoy,
            "rutas": rutas_estado_actual
        }
        historial_rutas.append(registro_historial)
        await persist()
        return {"message": "Rutas guardadas en el historial"}
    return {"message": "No hay rutas para guardar"}


@app.get("/api/reportes")
async def get_reportes():
    await reload_db()
    global historial_rutas
    return {"historial": historial_rutas}

# --- AI Copilot Chat Route (REST API) ---
@app.post("/api/chat")
async def chat_with_copilot(req: ChatRequest, session_token: SessionCookie = None):
    await require_any_session(session_token)
    await reload_db()
    try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={GEMINI_API_KEY}"
        
        contents = []
        for msg in req.history:
            role = 'model' if msg.role == 'assistant' else 'user'
            contents.append({
                "role": role,
                "parts": [{"text": msg.text}]
            })
            
        # Add current user message with system prompt if no history
        user_text = req.message
        if not req.history:
            user_text = f"Instrucciones internas: {SYSTEM_PROMPT}\n\nPregunta del usuario: {req.message}"
            
        contents.append({
            "role": "user",
            "parts": [{"text": user_text}]
        })
        
        payload = {
            "contents": contents
        }
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, timeout=30.0)
            
        if resp.status_code == 200:
            data = resp.json()
            reply = data["candidates"][0]["content"]["parts"][0]["text"]
            return {"response": reply}
        else:
            return {"error": True, "detail": f"Status {resp.status_code} - API msg: {resp.text}"}
            
    except Exception as e:
        return {"error": True, "detail": f"Python Exception: {str(e)}"}
