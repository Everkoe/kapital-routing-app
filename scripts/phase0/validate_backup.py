"""Validate the structure and hashes of a Phase 0 Supabase backup."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate(backup: Path) -> None:
    backup = backup.resolve()
    manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
    files = manifest.get("files", {})
    if "app_state.json" not in files:
        raise ValueError("Manifest does not contain app_state.json")
    for relative_name, expected in files.items():
        target = (backup / relative_name).resolve()
        if backup not in target.parents:
            raise ValueError(f"Manifest path escapes backup: {relative_name}")
        if not target.is_file():
            raise FileNotFoundError(target)
        if target.stat().st_size != expected["bytes"]:
            raise ValueError(f"Size mismatch: {relative_name}")
        if _sha256(target) != expected["sha256"]:
            raise ValueError(f"SHA-256 mismatch: {relative_name}")
    state = json.loads((backup / "app_state.json").read_text(encoding="utf-8"))
    if len(state) != 1 or state[0].get("id") != 1:
        raise ValueError("Invalid app_state snapshot")
    if not isinstance(state[0].get("usuarios"), dict) or not isinstance(state[0].get("rutas"), list):
        raise ValueError("Unexpected app_state data types")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()
    validate(args.backup)
    print(f"Backup verified: {args.backup.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
