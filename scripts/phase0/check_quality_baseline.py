"""Prevent Phase 0 quality debt from increasing while legacy debt is reduced."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend"
BASELINE_PATH = Path(__file__).with_name("quality-baseline.json")
HEX_PATTERN = re.compile(r"#[0-9a-fA-F]{3,8}\b")
NAMED_COLOR_PATTERN = re.compile(r"(?<![\w-])(?:white|black)(?![\w-])", re.IGNORECASE)
EMOJI_PATTERN = re.compile("[\U0001F300-\U0001FAFF]")


def source_metrics() -> dict[str, int]:
    jsx_files = sorted((FRONTEND / "src").rglob("*.jsx"))
    texts = [path.read_text(encoding="utf-8") for path in jsx_files]
    return {
        "hardcoded_hex_in_jsx": sum(len(HEX_PATTERN.findall(text)) for text in texts),
        "named_white_black_in_jsx": sum(len(NAMED_COLOR_PATTERN.findall(text)) for text in texts),
        "emoji_codepoints_in_jsx": sum(len(EMOJI_PATTERN.findall(text)) for text in texts),
    }


def eslint_metrics() -> dict[str, int]:
    executable = "npx.cmd" if os.name == "nt" else "npx"
    result = subprocess.run(
        [executable, "eslint", "src", "--format", "json"],
        cwd=FRONTEND,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        print(result.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"Could not parse ESLint JSON output: {exc}") from exc
    return {
        "eslint_errors": sum(item["errorCount"] for item in report),
        "eslint_warnings": sum(item["warningCount"] for item in report),
    }


def main() -> int:
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    current = {**eslint_metrics(), **source_metrics()}
    failures = []
    for metric, maximum in baseline.items():
        actual = current[metric]
        status = "OK" if actual <= maximum else "REGRESSION"
        print(f"{status:10} {metric}: {actual} (baseline maximum: {maximum})")
        if actual > maximum:
            failures.append(metric)
    if failures:
        print("Quality baseline exceeded: " + ", ".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
