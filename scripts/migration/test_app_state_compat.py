from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_app_state_compat_sql import AppStateCompatError, build_app_state_compat_sql  # noqa: E402


class AppStateCompatTests(unittest.TestCase):
    def _write_source(self, root: Path, *, usuarios: object | None = None, rutas: object | None = None) -> Path:
        path = root / "app_state_old.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        if usuarios is None:
            usuarios = {"fixture-user": {"rol": "Conductor"}, "__flota__": {}}
        if rutas is None:
            rutas = [{"fixture": True}]
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=("id", "usuarios", "rutas"))
            writer.writeheader()
            writer.writerow(
                {
                    "id": "1",
                    "usuarios": json.dumps(usuarios, separators=(",", ":")),
                    "rutas": json.dumps(rutas, separators=(",", ":")),
                }
            )
        return path

    def test_build_is_private_transactional_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self._write_source(root)
            output = root / "private" / "migration-v2"
            first = build_app_state_compat_sql(source, output, expected_usuarios=2, expected_rutas=1)
            sql = (output / "app_state_compat.sql").read_text(encoding="utf-8")
            second = build_app_state_compat_sql(source, output, expected_usuarios=2, expected_rutas=1)

            self.assertEqual(first, second)
            self.assertIn("begin;", sql.lower())
            self.assertIn("commit;", sql.lower())
            self.assertIn("public.app_state", sql)
            self.assertIn("on conflict (id) do update", sql.lower())
            self.assertNotIn("app.app_users", sql)
            self.assertNotIn("delete from", sql.lower())
            self.assertTrue((output / "app_state_compat.manifest.json").is_file())

    def test_expected_checksum_and_shape_are_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self._write_source(root)
            with self.assertRaisesRegex(AppStateCompatError, "checksum"):
                build_app_state_compat_sql(source, root / "private" / "migration-v2", expected_sha256="0" * 64)

            invalid = self._write_source(root / "invalid", usuarios=[], rutas=[])
            with self.assertRaisesRegex(AppStateCompatError, "usuarios"):
                build_app_state_compat_sql(invalid, root / "invalid" / "private" / "migration-v2")

    def test_duplicate_json_keys_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "app_state_old.csv"
            with source.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=("id", "usuarios", "rutas"))
                writer.writeheader()
                writer.writerow({"id": "1", "usuarios": '{"x":1,"x":2}', "rutas": "[]"})
            with self.assertRaisesRegex(AppStateCompatError, "invalid"):
                build_app_state_compat_sql(source, root / "private" / "migration-v2")


if __name__ == "__main__":
    unittest.main()
