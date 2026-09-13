"""Create a verified, git-ignored snapshot of Kapital's Supabase state.

The script is read-only with respect to Supabase. It stores the app_state row,
optionally downloads every object from configured Storage buckets, and writes a
SHA-256 manifest that can later be checked with validate_backup.py.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
from urllib.parse import quote

import httpx
from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"


def _configuration() -> tuple[str, str]:
    load_dotenv(FRONTEND / ".env")
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        sys.path.insert(0, str(FRONTEND))
        from api.index import SUPABASE_KEY, SUPABASE_URL

        url = url or SUPABASE_URL.rstrip("/")
        key = key or SUPABASE_KEY
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_KEY are required")
    rest_url = url if url.endswith("/rest/v1") else f"{url}/rest/v1"
    return rest_url, key


def _headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_relative_object_path(object_name: str) -> Path:
    candidate = PurePosixPath(object_name)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError(f"Unsafe Storage object path: {object_name!r}")
    return Path(*candidate.parts)


def _list_storage_objects(
    client: httpx.Client,
    storage_url: str,
    headers: dict[str, str],
    bucket: str,
    prefix: str = "",
) -> list[str]:
    found: list[str] = []
    offset = 0
    limit = 1000
    while True:
        response = client.post(
            f"{storage_url}/object/list/{quote(bucket, safe='')}",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "prefix": prefix,
                "limit": limit,
                "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            },
        )
        response.raise_for_status()
        items = response.json()
        for item in items:
            name = item.get("name", "")
            full_name = f"{prefix}/{name}" if prefix else name
            if item.get("id") is None and item.get("metadata") is None:
                found.extend(_list_storage_objects(client, storage_url, headers, bucket, full_name))
            elif full_name:
                found.append(full_name)
        if len(items) < limit:
            break
        offset += limit
    return found


def create_backup(output_root: Path, buckets: list[str]) -> Path:
    rest_url, key = _configuration()
    project_url = rest_url.removesuffix("/rest/v1")
    headers = _headers(key)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = output_root.resolve() / stamp
    destination.mkdir(parents=True, exist_ok=False)
    manifest: dict[str, object] = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "source_project": project_url,
        "files": {},
        "storage": {},
    }

    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        state_response = client.get(
            f"{rest_url}/app_state?id=eq.1&select=*",
            headers=headers,
        )
        state_response.raise_for_status()
        state = state_response.json()
        if len(state) != 1 or state[0].get("id") != 1:
            raise RuntimeError("Expected exactly one app_state row with id=1")
        state_path = destination / "app_state.json"
        state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        manifest["files"]["app_state.json"] = {
            "bytes": state_path.stat().st_size,
            "sha256": _sha256(state_path),
        }

        storage_url = f"{project_url}/storage/v1"
        for bucket in buckets:
            object_names = _list_storage_objects(client, storage_url, headers, bucket)
            bucket_bytes = 0
            for object_name in object_names:
                relative = Path("storage") / bucket / _safe_relative_object_path(object_name)
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                response = client.get(
                    f"{storage_url}/object/{quote(bucket, safe='')}/{quote(object_name, safe='/')}",
                    headers=headers,
                )
                response.raise_for_status()
                target.write_bytes(response.content)
                size = target.stat().st_size
                bucket_bytes += size
                manifest["files"][relative.as_posix()] = {
                    "bytes": size,
                    "sha256": _sha256(target),
                }
            manifest["storage"][bucket] = {
                "objects": len(object_names),
                "bytes": bucket_bytes,
            }

    manifest_path = destination / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPO_ROOT / "backups" / "supabase",
        help="Parent directory for timestamped backups (default: backups/supabase)",
    )
    parser.add_argument(
        "--bucket",
        action="append",
        default=[],
        help="Storage bucket to download; repeat for multiple buckets",
    )
    args = parser.parse_args()
    destination = create_backup(args.output_root, args.bucket)
    print(f"Backup created: {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
