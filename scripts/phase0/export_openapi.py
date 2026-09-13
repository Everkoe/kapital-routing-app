"""Export the current FastAPI schema as a versioned API contract baseline."""

from __future__ import annotations

import json
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"
OUTPUT = REPO_ROOT / "docs" / "phase-0" / "openapi-baseline.json"
sys.path.insert(0, str(FRONTEND))

from api.index import app  # noqa: E402


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"OpenAPI baseline exported: {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
