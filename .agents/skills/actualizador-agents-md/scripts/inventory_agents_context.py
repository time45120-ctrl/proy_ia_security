#!/usr/bin/env python3
"""Inventario no destructivo para actualizar los AGENTS.md del monorepo."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
AGENTS = [ROOT / "AGENTS.md", BACKEND / "AGENTS.md", FRONTEND / "AGENTS.md"]


def run(command: list[str], cwd: Path = ROOT) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
    except FileNotFoundError as exc:
        return f"ERROR: {exc}"
    return result.stdout.strip()


def grep(pattern: str, path: Path) -> list[str]:
    if not path.exists():
        return []
    rx = re.compile(pattern)
    return [
        line.strip()
        for line in path.read_text(errors="replace").splitlines()
        if rx.search(line)
    ]


def section(title: str) -> None:
    print(f"\n## {title}")


def main() -> None:
    section("Rutas AGENTS")
    for path in AGENTS:
        print(f"- {path}: {'OK' if path.exists() else 'MISSING'}")

    section("Git monorepo")
    print(run(["git", "status", "-sb"], ROOT))
    print("last:", run(["git", "log", "-1", "--oneline"], ROOT))
    remote = run(["git", "remote", "-v"], ROOT).splitlines()
    print("remote:", remote[0] if remote else "no remote")
    for label, path in [("root", ROOT), ("backend", BACKEND), ("frontend", FRONTEND)]:
        print(f"{label} toplevel:", run(["git", "rev-parse", "--show-toplevel"], path))

    section("Frontend build marker")
    marker = FRONTEND / "scripts" / "print-deploy-info.js"
    for line in grep(r"AFCR_FRONTEND_", marker):
        print(line)

    section("Backend voz/OpenAI")
    app_api = BACKEND / "app_api.py"
    for line in grep(
        r"VOICE_AUDIO_MIN_BYTES|OPENAI_TRANSCRIBE_MODEL|OPENAI_TRANSCRIBE_FALLBACK_MODEL|VOICE_PLAN_TTL_SECONDS|DEVICE_COMMAND_TTL_SECONDS",
        app_api,
    ):
        print(line)

    section("Frontend audio diagnostics")
    dashboard = FRONTEND / "components" / "voice-dashboard.tsx"
    for line in grep(
        r"SILENT_AUDIO_MIN_BYTES|SILENT_AUDIO_PEAK_THRESHOLD|Logs de prueba|peak_level|average_level",
        dashboard,
    ):
        print(line)

    section("LED sin ambiente")
    for path in [app_api, BACKEND / "test_http_polling.py"]:
        print(f"\n[{path.relative_to(ROOT)}]")
        for line in grep(
            r"prende el led|find_latest_http_esp32|assigned_space|control_luces",
            path,
        ):
            print(line)

    section("Endpoints principales")
    for line in grep(
        r'@app\.(get|post)\("/(ping|voice-intent|devices|device/commands)',
        app_api,
    ):
        print(line)


if __name__ == "__main__":
    main()
