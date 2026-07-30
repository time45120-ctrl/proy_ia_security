import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const candidates =
  process.platform === "win32"
    ? [
        "backend/.venv/Scripts/python.exe",
        "backend/venv/Scripts/python.exe",
        "python",
      ]
    : ["backend/.venv/bin/python", "backend/venv/bin/python", "python3"];

const python = candidates.find((candidate) =>
  candidate.includes("/") ? existsSync(candidate) : true,
);

const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "backend", "-p", "test*.py", "-v"],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`No se pudo ejecutar ${python}: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
