"""Build a private, idempotent import for the legacy ``app_state`` row.

The CSV input and generated SQL/manifest must live outside the repository.
The SQL is a single transaction that writes only ``public.app_state`` at
``id = 1``.  It refuses a known checksum mismatch, validates the JSON object
and array shapes, and verifies the persisted checksum, byte sizes, and counts
before committing.  No network connection or remote SQL execution occurs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple


csv.field_size_limit(sys.maxsize)

REPO_ROOT = Path(__file__).resolve().parents[2]
PRIVATE_ROOT = REPO_ROOT.parent / "private"
DEFAULT_INPUT = PRIVATE_ROOT / "app_state_old.csv"
DEFAULT_OUTPUT = PRIVATE_ROOT / "migration-v2"
REQUIRED_COLUMNS = ("id", "usuarios", "rutas")
MAX_SOURCE_BYTES = 64 * 1024 * 1024


class AppStateCompatError(ValueError):
    """Raised when the legacy snapshot is not a safe singleton import."""


def _reject_duplicate_keys(pairs: List[Tuple[str, Any]]) -> Dict[str, Any]:
    value: Dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON object key")
        value[key] = item
    return value


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON constant: {value}")


def _parse_json(value: Any, label: str) -> Any:
    if not isinstance(value, str) or not value.strip():
        raise AppStateCompatError(f"{label} JSON is missing")
    try:
        return json.loads(
            value,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_constant,
        )
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise AppStateCompatError(f"{label} JSON is invalid") from exc


def _json_text(value: Any, label: str) -> Tuple[str, int]:
    try:
        text = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise AppStateCompatError(f"{label} JSON cannot be serialized") from exc
    return text, len(text.encode("utf-8"))


def _sql_literal(value: str) -> str:
    if "\x00" in value:
        raise AppStateCompatError("JSON contains a NUL byte")
    return "'" + value.replace("'", "''") + "'"


def _outside_repo(path: Path, label: str) -> Path:
    resolved = path.resolve()
    if resolved == REPO_ROOT or REPO_ROOT in resolved.parents:
        raise AppStateCompatError(f"{label} must be outside the repository")
    return resolved


def _load_snapshot(input_path: Path) -> Dict[str, Any]:
    source = _outside_repo(input_path, "CSV input")
    if not source.is_file():
        raise AppStateCompatError("CSV input does not exist")
    try:
        raw = source.read_bytes()
    except OSError as exc:
        raise AppStateCompatError("CSV input cannot be read") from exc
    source_size = len(raw)
    if source_size <= 0 or source_size > MAX_SOURCE_BYTES:
        raise AppStateCompatError("CSV input size is outside the allowed range")
    source_sha256 = hashlib.sha256(raw).hexdigest()

    try:
        with source.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns = tuple(reader.fieldnames or ())
            if columns != REQUIRED_COLUMNS:
                raise AppStateCompatError("CSV columns do not match app_state contract")
            rows = list(reader)
    except AppStateCompatError:
        raise
    except (OSError, UnicodeError, csv.Error) as exc:
        raise AppStateCompatError("CSV input is not parseable") from exc
    if len(rows) != 1:
        raise AppStateCompatError("CSV must contain exactly one app_state row")
    row = rows[0]
    try:
        row_id = int(str(row.get("id", "")).strip())
    except ValueError as exc:
        raise AppStateCompatError("app_state id is not an integer") from exc
    if row_id != 1:
        raise AppStateCompatError("app_state import requires id=1")

    usuarios = _parse_json(row.get("usuarios"), "usuarios")
    rutas = _parse_json(row.get("rutas"), "rutas")
    if not isinstance(usuarios, dict):
        raise AppStateCompatError("usuarios must be a JSON object")
    if not isinstance(rutas, list):
        raise AppStateCompatError("rutas must be a JSON array")
    usuarios_json, usuarios_size = _json_text(usuarios, "usuarios")
    rutas_json, rutas_size = _json_text(rutas, "rutas")
    if not math.isfinite(float(source_size)):
        raise AppStateCompatError("source size is invalid")
    return {
        "source_name": source.name,
        "source_sha256": source_sha256,
        "source_size_bytes": source_size,
        "usuarios": usuarios,
        "rutas": rutas,
        "usuarios_json": usuarios_json,
        "rutas_json": rutas_json,
        "usuarios_size_bytes": usuarios_size,
        "rutas_size_bytes": rutas_size,
        "source_user_count": len(usuarios),
        "source_route_count": len(rutas),
    }


def _validate_expected(snapshot: Mapping[str, Any], expected: Mapping[str, Optional[Any]]) -> None:
    checks = {
        "checksum": ("source_sha256", expected.get("sha256")),
        "size": ("source_size_bytes", expected.get("size")),
        "usuarios": ("source_user_count", expected.get("usuarios")),
        "rutas": ("source_route_count", expected.get("rutas")),
    }
    for label, (field, wanted) in checks.items():
        if wanted not in (None, "") and str(snapshot[field]) != str(wanted):
            raise AppStateCompatError(f"source {label} does not match the expected value")


def _render_sql(snapshot: Mapping[str, Any]) -> str:
    source_sha256 = str(snapshot["source_sha256"])
    source_size = int(snapshot["source_size_bytes"])
    usuarios_size = int(snapshot["usuarios_size_bytes"])
    rutas_size = int(snapshot["rutas_size_bytes"])
    user_count = int(snapshot["source_user_count"])
    route_count = int(snapshot["source_route_count"])
    usuarios = _sql_literal(str(snapshot["usuarios_json"]))
    rutas = _sql_literal(str(snapshot["rutas_json"]))
    checksum = _sql_literal(source_sha256)
    return f"""-- Private legacy app_state compatibility import.
-- Source: app_state_old.csv; no source path or operator values are logged.
-- This transaction writes only public.app_state(id=1), never app/* tables.
begin;
set local search_path = pg_catalog, public, extensions, auth;
set local standard_conforming_strings = on;

do $$
declare
  expected_sha256 text := {checksum};
  existing_sha256 text;
begin
  select source_sha256 into existing_sha256
  from public.app_state
  where id = 1;
  if found and existing_sha256 is not null and existing_sha256 <> expected_sha256 then
    raise exception 'app_state source checksum mismatch';
  end if;
end;
$$;

insert into public.app_state (
  id,
  usuarios,
  rutas,
  source_sha256,
  source_size_bytes,
  usuarios_size_bytes,
  rutas_size_bytes,
  source_user_count,
  source_route_count,
  restored_at
)
values (
  1,
  {usuarios}::jsonb,
  {rutas}::jsonb,
  {checksum},
  {source_size},
  {usuarios_size},
  {rutas_size},
  {user_count},
  {route_count},
  now()
)
on conflict (id) do update
set usuarios = excluded.usuarios,
    rutas = excluded.rutas,
    source_sha256 = excluded.source_sha256,
    source_size_bytes = excluded.source_size_bytes,
    usuarios_size_bytes = excluded.usuarios_size_bytes,
    rutas_size_bytes = excluded.rutas_size_bytes,
    source_user_count = excluded.source_user_count,
    source_route_count = excluded.source_route_count,
    restored_at = excluded.restored_at
where public.app_state.source_sha256 is null
   or public.app_state.source_sha256 = excluded.source_sha256;

do $$
declare
  actual_sha256 text;
  actual_source_size bigint;
  actual_usuarios_size bigint;
  actual_rutas_size bigint;
  actual_user_count integer;
  actual_route_count integer;
begin
  select source_sha256, source_size_bytes, usuarios_size_bytes,
         rutas_size_bytes, source_user_count, source_route_count
    into actual_sha256, actual_source_size, actual_usuarios_size,
         actual_rutas_size, actual_user_count, actual_route_count
  from public.app_state
  where id = 1
    and jsonb_typeof(usuarios) = 'object'
    and jsonb_typeof(rutas) = 'array';
  if not found
     or actual_sha256 is distinct from {checksum}
     or actual_source_size is distinct from {source_size}
     or actual_usuarios_size is distinct from {usuarios_size}
     or actual_rutas_size is distinct from {rutas_size}
     or actual_user_count is distinct from {user_count}
     or actual_route_count is distinct from {route_count} then
    raise exception 'app_state compatibility import postcondition failed';
  end if;
end;
$$;

commit;
"""


def _output_dir(path: Path) -> Path:
    resolved = _outside_repo(path, "output directory")
    parts = tuple(part.lower() for part in resolved.parts)
    if len(parts) < 2 or parts[-2:] != ("private", "migration-v2"):
        raise AppStateCompatError("output directory must end in private/migration-v2")
    try:
        resolved.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise AppStateCompatError("output directory cannot be created") from exc
    return resolved


def _write_stable(path: Path, text: str) -> None:
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == text:
                return
        except (OSError, UnicodeError) as exc:
            raise AppStateCompatError("existing compatibility output cannot be read") from exc
        raise AppStateCompatError("compatibility output already exists with different content")
    try:
        path.write_text(text, encoding="utf-8", newline="\n")
    except OSError as exc:
        raise AppStateCompatError("compatibility output cannot be written") from exc


def build_app_state_compat_sql(
    input_path: Path,
    output_dir: Path,
    *,
    filename: str = "app_state_compat.sql",
    expected_sha256: Optional[str] = None,
    expected_size: Optional[int] = None,
    expected_usuarios: Optional[int] = None,
    expected_rutas: Optional[int] = None,
) -> Dict[str, Any]:
    if Path(filename).name != filename or not filename.lower().endswith(".sql"):
        raise AppStateCompatError("output filename must be a simple .sql filename")
    snapshot = _load_snapshot(input_path)
    _validate_expected(
        snapshot,
        {
            "sha256": expected_sha256,
            "size": expected_size,
            "usuarios": expected_usuarios,
            "rutas": expected_rutas,
        },
    )
    sql_text = _render_sql(snapshot)
    root = _output_dir(output_dir)
    _write_stable(root / filename, sql_text)
    manifest = {
        "format_version": 1,
        "mode": "private_app_state_compat",
        "source_name": snapshot["source_name"],
        "source_sha256": snapshot["source_sha256"],
        "source_size_bytes": snapshot["source_size_bytes"],
        "usuarios_size_bytes": snapshot["usuarios_size_bytes"],
        "rutas_size_bytes": snapshot["rutas_size_bytes"],
        "source_user_count": snapshot["source_user_count"],
        "source_route_count": snapshot["source_route_count"],
        "sql_sha256": hashlib.sha256(sql_text.encode("utf-8")).hexdigest(),
    }
    manifest_text = json.dumps(manifest, sort_keys=True, indent=2) + "\n"
    _write_stable(root / "app_state_compat.manifest.json", manifest_text)
    return {
        "status": "ok",
        "source_sha256": snapshot["source_sha256"],
        "source_size_bytes": snapshot["source_size_bytes"],
        "usuarios_size_bytes": snapshot["usuarios_size_bytes"],
        "rutas_size_bytes": snapshot["rutas_size_bytes"],
        "source_user_count": snapshot["source_user_count"],
        "source_route_count": snapshot["source_route_count"],
        "sql_bytes": len(sql_text.encode("utf-8")),
        "sql_sha256": manifest["sql_sha256"],
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--filename", default="app_state_compat.sql")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--expected-size", type=int)
    parser.add_argument("--expected-usuarios", type=int)
    parser.add_argument("--expected-rutas", type=int)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        report = build_app_state_compat_sql(
            args.input,
            args.output_dir,
            filename=args.filename,
            expected_sha256=args.expected_sha256,
            expected_size=args.expected_size,
            expected_usuarios=args.expected_usuarios,
            expected_rutas=args.expected_rutas,
        )
    except (OSError, AppStateCompatError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
