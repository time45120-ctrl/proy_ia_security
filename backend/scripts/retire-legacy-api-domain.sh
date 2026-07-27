#!/usr/bin/env bash
set -Eeuo pipefail

LEGACY_DOMAIN="${AFCR_LEGACY_API_DOMAIN:-api.afcrseguridad.com}"
AVAILABLE_PATH="/etc/nginx/sites-available/${LEGACY_DOMAIN}"
ENABLED_PATH="/etc/nginx/sites-enabled/${LEGACY_DOMAIN}"
RENEWAL_PATH="/etc/letsencrypt/renewal/${LEGACY_DOMAIN}.conf"
BACKUP_ROOT="/var/backups/afcr-domain-migration/legacy-retired-$(date -u +%Y%m%dT%H%M%SZ)"

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'Legacy API retirement must run as root.\n' >&2
  exit 1
fi

test -f "${AVAILABLE_PATH}"
grep -Fq -- "${LEGACY_DOMAIN}" "${AVAILABLE_PATH}"

mkdir -p "${BACKUP_ROOT}/originals/sites-available" \
  "${BACKUP_ROOT}/originals/sites-enabled" \
  "${BACKUP_ROOT}/originals/renewal" \
  "${BACKUP_ROOT}/retired"
chmod 700 "${BACKUP_ROOT}"
cp -a "${AVAILABLE_PATH}" "${BACKUP_ROOT}/originals/sites-available/"
if [[ -e "${ENABLED_PATH}" || -L "${ENABLED_PATH}" ]]; then
  cp -a "${ENABLED_PATH}" "${BACKUP_ROOT}/originals/sites-enabled/"
fi
if [[ -f "${RENEWAL_PATH}" ]]; then
  cp -a "${RENEWAL_PATH}" "${BACKUP_ROOT}/originals/renewal/"
fi

restore_legacy_config() {
  cp -a "${BACKUP_ROOT}/originals/sites-available/${LEGACY_DOMAIN}" \
    "${AVAILABLE_PATH}"
  if [[ -e "${BACKUP_ROOT}/originals/sites-enabled/${LEGACY_DOMAIN}" || \
        -L "${BACKUP_ROOT}/originals/sites-enabled/${LEGACY_DOMAIN}" ]]; then
    cp -a "${BACKUP_ROOT}/originals/sites-enabled/${LEGACY_DOMAIN}" \
      "${ENABLED_PATH}"
  fi
  if [[ -f "${BACKUP_ROOT}/originals/renewal/${LEGACY_DOMAIN}.conf" ]]; then
    cp -a "${BACKUP_ROOT}/originals/renewal/${LEGACY_DOMAIN}.conf" \
      "${RENEWAL_PATH}"
  fi
  nginx -t && systemctl reload nginx
}

if [[ -L "${ENABLED_PATH}" ]]; then
  unlink "${ENABLED_PATH}"
elif [[ -f "${ENABLED_PATH}" ]]; then
  mv "${ENABLED_PATH}" "${BACKUP_ROOT}/retired/sites-enabled-${LEGACY_DOMAIN}"
fi
mv "${AVAILABLE_PATH}" "${BACKUP_ROOT}/retired/sites-available-${LEGACY_DOMAIN}"
if [[ -f "${RENEWAL_PATH}" ]]; then
  mv "${RENEWAL_PATH}" "${BACKUP_ROOT}/retired/renewal-${LEGACY_DOMAIN}.conf"
fi

if ! nginx -t; then
  printf 'Nginx validation failed; restoring legacy configuration.\n' >&2
  restore_legacy_config
  exit 1
fi

if ! systemctl reload nginx; then
  printf 'Nginx reload failed; restoring legacy configuration.\n' >&2
  restore_legacy_config
  exit 1
fi

printf 'AFCR_LEGACY_API_RETIRED=%s\n' "${LEGACY_DOMAIN}"
printf 'AFCR_LEGACY_API_BACKUP=%s\n' "${BACKUP_ROOT}"
