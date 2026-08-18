#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER="${BACKEND_APP_USER:-$(id -un)}"
APP_DIR="${BACKEND_APP_DIR:-/opt/casa-domotica-ia/backend}"
VENV_DIR="${BACKEND_VENV_DIR:-${APP_DIR}/.venv}"
SERVICE_NAME="${BACKEND_SERVICE_NAME:-afcr-backend.service}"
LOCAL_HEALTH_URL="${BACKEND_LOCAL_HEALTH_URL:-http://127.0.0.1:8000/ping}"

run_as_app_user() {
  if [[ "$(id -un)" == "${APP_USER}" ]]; then
    "$@"
  else
    sudo -u "${APP_USER}" -- "$@"
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

if [[ "${AFCR_CONFIGURE_API_DOMAIN:-false}" == "true" ]]; then
  AFCR_API_DOMAIN="${AFCR_API_DOMAIN:-api.afcrtecnologia.com}" \
  AFCR_API_EXPECTED_IPV4="${AFCR_API_EXPECTED_IPV4:-2.24.95.57}" \
    bash "${APP_DIR}/scripts/configure-api-domain.sh"
fi

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
