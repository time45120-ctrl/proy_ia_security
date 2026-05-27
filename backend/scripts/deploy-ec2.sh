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

cd "${APP_DIR}"

test -f app_api.py
test -f requirements.txt
test -f .env

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  run_as_app_user python3 -m venv "${VENV_DIR}"
fi

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
curl --fail --silent --show-error --retry 5 --retry-delay 2 "${LOCAL_HEALTH_URL}"
