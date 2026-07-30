#!/usr/bin/env bash
set -Eeuo pipefail

MONOREPO_REPOSITORY_URL="${MONOREPO_REPOSITORY_URL:-https://github.com/abraham-development/casa-domotica-ia.git}"
MONOREPO_TARGET_SHA="${MONOREPO_TARGET_SHA:-}"
MONOREPO_DIR="${MONOREPO_DIR:-/home/ubuntu/casa-domotica-ia}"
APP_USER="${BACKEND_APP_USER:-ubuntu}"
APP_GROUP="$(id -gn "${APP_USER}")"
APP_DIR="${BACKEND_APP_DIR:-${MONOREPO_DIR}/backend}"
VENV_DIR="${BACKEND_VENV_DIR:-${APP_DIR}/.venv}"
LEGACY_APP_DIR="${LEGACY_BACKEND_APP_DIR:-/home/ubuntu/proy_ia_backend}"
SERVICE_NAME="${BACKEND_SERVICE_NAME:-proy-ia-backend.service}"
LOCAL_HEALTH_URL="${BACKEND_LOCAL_HEALTH_URL:-http://127.0.0.1:8000/ping}"
DROP_IN_DIR="/etc/systemd/system/${SERVICE_NAME}.d"
DROP_IN_FILE="${DROP_IN_DIR}/20-monorepo.conf"
BACKUP_ROOT="/var/backups/casa-domotica-ia"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
DROP_IN_BACKUP="${BACKUP_ROOT}/${SERVICE_NAME}.20-monorepo.${RUN_ID}.conf"
FAILED_DROP_IN="${BACKUP_ROOT}/${SERVICE_NAME}.20-monorepo.${RUN_ID}.failed"
DROP_IN_EXISTED=false
ROLLBACK_ARMED=false

run_as_app_user() {
  if [[ "$(id -un)" == "${APP_USER}" ]]; then
    "$@"
  else
    runuser -u "${APP_USER}" -- "$@"
  fi
}

rollback_service() {
  local exit_code=$?
  if [[ "${ROLLBACK_ARMED}" != "true" ]]; then
    exit "${exit_code}"
  fi

  set +e
  printf 'Bootstrap failed; restoring the previous systemd configuration.\n' >&2
  if [[ -f "${DROP_IN_FILE}" ]]; then
    mv "${DROP_IN_FILE}" "${FAILED_DROP_IN}"
  fi
  if [[ "${DROP_IN_EXISTED}" == "true" && -f "${DROP_IN_BACKUP}" ]]; then
    cp "${DROP_IN_BACKUP}" "${DROP_IN_FILE}"
  fi
  systemctl daemon-reload
  systemctl restart "${SERVICE_NAME}"
  systemctl is-active --quiet "${SERVICE_NAME}"
  curl --fail --silent --show-error "${LOCAL_HEALTH_URL}"
  printf '\nPrevious backend service restored. Failed drop-in: %s\n' "${FAILED_DROP_IN}" >&2
  exit "${exit_code}"
}

trap rollback_service ERR

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'Run this bootstrap as root (SSM runs it as root).\n' >&2
  exit 1
fi

test -d "${LEGACY_APP_DIR}/.git"
test -f "${LEGACY_APP_DIR}/.env"
test -n "${MONOREPO_REPOSITORY_URL}"

test -d "$(dirname "${MONOREPO_DIR}")"

if [[ -d "${MONOREPO_DIR}/.git" ]]; then
  CURRENT_ORIGIN="$(run_as_app_user git -C "${MONOREPO_DIR}" remote get-url origin)"
  if [[ "${CURRENT_ORIGIN}" != "${MONOREPO_REPOSITORY_URL}" ]]; then
    printf 'Unexpected monorepo origin: %s\n' "${CURRENT_ORIGIN}" >&2
    exit 1
  fi
else
  if [[ -e "${MONOREPO_DIR}" ]]; then
    test -d "${MONOREPO_DIR}"
    test -z "$(find "${MONOREPO_DIR}" -mindepth 1 -maxdepth 1 -print -quit)"
    chown "${APP_USER}:${APP_GROUP}" "${MONOREPO_DIR}"
  else
    install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${MONOREPO_DIR}"
  fi
  run_as_app_user git clone --branch main --single-branch "${MONOREPO_REPOSITORY_URL}" "${MONOREPO_DIR}"
fi

run_as_app_user git -C "${MONOREPO_DIR}" fetch origin main
run_as_app_user git -C "${MONOREPO_DIR}" checkout main
run_as_app_user git -C "${MONOREPO_DIR}" merge --ff-only origin/main

if [[ -n "${MONOREPO_TARGET_SHA}" ]]; then
  run_as_app_user git -C "${MONOREPO_DIR}" cat-file -e "${MONOREPO_TARGET_SHA}^{commit}"
  run_as_app_user git -C "${MONOREPO_DIR}" merge-base --is-ancestor "${MONOREPO_TARGET_SHA}" HEAD
fi

test -f "${APP_DIR}/app_api.py"
test -f "${APP_DIR}/requirements.txt"
test -f "${APP_DIR}/scripts/deploy-ec2.sh"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  install -m 0600 -o "${APP_USER}" -g "${APP_GROUP}" "${LEGACY_APP_DIR}/.env" "${APP_DIR}/.env"
else
  chown "${APP_USER}:${APP_GROUP}" "${APP_DIR}/.env"
  chmod 0600 "${APP_DIR}/.env"
fi

install -d -m 0755 "${BACKUP_ROOT}"
install -d -m 0755 "${DROP_IN_DIR}"
if [[ -f "${DROP_IN_FILE}" ]]; then
  cp "${DROP_IN_FILE}" "${DROP_IN_BACKUP}"
  DROP_IN_EXISTED=true
fi

DROP_IN_TMP="$(mktemp /tmp/afcr-systemd-drop-in.XXXXXX)"
{
  printf '[Service]\n'
  printf 'WorkingDirectory=%s\n' "${APP_DIR}"
  printf 'EnvironmentFile=\n'
  printf 'EnvironmentFile=-%s/.env\n' "${APP_DIR}"
  printf 'ExecStart=\n'
  printf 'ExecStart=%s/bin/uvicorn app_api:app --host 127.0.0.1 --port 8000\n' "${VENV_DIR}"
} > "${DROP_IN_TMP}"
install -m 0644 "${DROP_IN_TMP}" "${DROP_IN_FILE}"
mv "${DROP_IN_TMP}" "${BACKUP_ROOT}/systemd-drop-in.${RUN_ID}.installed"

ROLLBACK_ARMED=true
systemctl daemon-reload

BACKEND_APP_USER="${APP_USER}" \
BACKEND_APP_DIR="${APP_DIR}" \
BACKEND_VENV_DIR="${VENV_DIR}" \
BACKEND_SERVICE_NAME="${SERVICE_NAME}" \
BACKEND_LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL}" \
AFCR_CONFIGURE_API_DOMAIN="${AFCR_CONFIGURE_API_DOMAIN:-false}" \
AFCR_API_DOMAIN="${AFCR_API_DOMAIN:-api.afcrtecnologia.com}" \
AFCR_API_EXPECTED_IPV4="${AFCR_API_EXPECTED_IPV4:-3.132.192.3}" \
AFCR_LEGACY_ORIGINS_ENABLED="${AFCR_LEGACY_ORIGINS_ENABLED:-false}" \
AFCR_INSPECT_LEGACY_API_DOMAIN="${AFCR_INSPECT_LEGACY_API_DOMAIN:-false}" \
AFCR_RETIRE_LEGACY_API_DOMAIN="${AFCR_RETIRE_LEGACY_API_DOMAIN:-false}" \
  bash "${APP_DIR}/scripts/deploy-ec2.sh"

systemctl is-active --quiet "${SERVICE_NAME}"
curl --fail --silent --show-error "${LOCAL_HEALTH_URL}"
printf '\nMonorepo backend is active from %s.\n' "${APP_DIR}"
ROLLBACK_ARMED=false
trap - ERR
