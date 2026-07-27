#!/usr/bin/env bash
set -Eeuo pipefail

LEGACY_DOMAIN="${AFCR_LEGACY_API_DOMAIN:-api.afcrseguridad.com}"

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'This inspection must run as root.\n' >&2
  exit 1
fi

printf 'AFCR_LEGACY_API_DOMAIN=%s\n' "${LEGACY_DOMAIN}"
printf 'AFCR_LEGACY_NGINX_FILES_BEGIN\n'
grep -RIl --include='*.conf' -- "${LEGACY_DOMAIN}" \
  /etc/nginx/conf.d /etc/nginx/sites-available /etc/nginx/sites-enabled \
  2>/dev/null | sort -u || true
printf 'AFCR_LEGACY_NGINX_FILES_END\n'

printf 'AFCR_LEGACY_CERTIFICATE_BEGIN\n'
certbot certificates 2>/dev/null | grep -A 6 -B 1 -- "${LEGACY_DOMAIN}" || true
printf 'AFCR_LEGACY_CERTIFICATE_END\n'

nginx -t
