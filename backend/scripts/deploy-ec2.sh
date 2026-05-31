#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${BACKEND_APP_USER:-ubuntu}"
APP_DIR="${BACKEND_APP_DIR:-/home/ubuntu/proy_ia_backend}"
VENV_DIR="${BACKEND_VENV_DIR:-/home/ubuntu/proy_ia_backend/.venv}"
SERVICE_NAME="${BACKEND_SERVICE_NAME:-proy-ia-backend.service}"
LOCAL_HEALTH_URL="${BACKEND_LOCAL_HEALTH_URL:-http://127.0.0.1:8000/ping}"

run_as_app_user() {
  if [[ "$(id -un)" == "${APP_USER}" ]]; then
    "$@"
  else
    runuser -u "${APP_USER}" -- "$@"
  fi
}

ensure_pairing_token_minutes() {
  run_as_app_user python3 - <<'PY_ENV'
from pathlib import Path

path = Path('.env')
lines = path.read_text().splitlines()
updated = False
for index, line in enumerate(lines):
    if line.startswith('PAIRING_TOKEN_MINUTES='):
        lines[index] = 'PAIRING_TOKEN_MINUTES=60'
        updated = True
        break
if not updated:
    lines.append('PAIRING_TOKEN_MINUTES=60')
path.write_text('\n'.join(lines) + '\n')
PY_ENV
}

cd "${APP_DIR}"

test -f app_api.py
test -f requirements.txt
test -f .env

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  run_as_app_user python3 -m venv "${VENV_DIR}"
fi

ensure_pairing_token_minutes

run_as_app_user "${VENV_DIR}/bin/python" -m pip install --requirement requirements.txt
run_as_app_user "${VENV_DIR}/bin/python" -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
run_as_app_user "${VENV_DIR}/bin/python" -B -m unittest -v test_http_polling.py

if [[ "$(id -u)" -eq 0 ]]; then
  systemctl restart "${SERVICE_NAME}"
  systemctl is-active --quiet "${SERVICE_NAME}"
else
  sudo systemctl restart "${SERVICE_NAME}"
  sudo systemctl is-active --quiet "${SERVICE_NAME}"
fi

for attempt in {1..15}; do
  if curl --fail --silent --show-error "${LOCAL_HEALTH_URL}"; then
    printf '\n'
    exit 0
  fi
  sleep 2
done

printf 'Backend health check failed after restart: %s\n' "${LOCAL_HEALTH_URL}" >&2
exit 1
