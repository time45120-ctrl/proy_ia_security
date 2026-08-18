#!/usr/bin/env bash
set -Eeuo pipefail

API_DOMAIN="${AFCR_API_DOMAIN:-api.afcrtecnologia.com}"
EXPECTED_IPV4="${AFCR_API_EXPECTED_IPV4:-2.24.95.57}"
UPSTREAM="${AFCR_API_UPSTREAM:-http://127.0.0.1:8000}"
BACKUP_ROOT="${AFCR_DOMAIN_BACKUP_ROOT:-/var/backups/afcr-domain-migration}"
MARKER="# Managed by AFCR domain migration"

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'configure-api-domain.sh must run as root\n' >&2
  exit 1
fi

for command in getent nginx certbot tar systemctl; do
  command -v "${command}" >/dev/null 2>&1 || {
    printf 'Required command not found: %s\n' "${command}" >&2
    exit 1
  }
done

resolved_ipv4="$({ getent ahostsv4 "${API_DOMAIN}" || true; } | awk '{print $1}' | sort -u)"
if ! grep -qx "${EXPECTED_IPV4}" <<<"${resolved_ipv4}"; then
  printf 'DNS is not ready: %s must resolve to %s (resolved: %s)\n' \
    "${API_DOMAIN}" "${EXPECTED_IPV4}" "${resolved_ipv4:-none}" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT}/${timestamp}"
install -d -m 0700 "${backup_dir}"
tar -C / -czf "${backup_dir}/nginx-and-letsencrypt.tgz" etc/nginx etc/letsencrypt
chmod 0600 "${backup_dir}/nginx-and-letsencrypt.tgz"

if grep -Eq '^[[:space:]]*include[[:space:]]+/etc/nginx/conf\.d/\*\.conf;' /etc/nginx/nginx.conf; then
  nginx_config="/etc/nginx/conf.d/${API_DOMAIN}.conf"
else
  install -d -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled
  nginx_config="/etc/nginx/sites-available/${API_DOMAIN}.conf"
fi

if [[ -f "${nginx_config}" ]] && ! grep -Fqx "${MARKER}" "${nginx_config}"; then
  printf 'Refusing to overwrite unmanaged Nginx config: %s\n' "${nginx_config}" >&2
  exit 1
fi

cat >"${nginx_config}" <<NGINX
${MARKER}
server {
    listen 80;
    listen [::]:80;
    server_name ${API_DOMAIN};

    location / {
        proxy_pass ${UPSTREAM};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        client_max_body_size 25m;
    }
}
NGINX

if [[ "${nginx_config}" == /etc/nginx/sites-available/* ]]; then
  ln -sfn "${nginx_config}" "/etc/nginx/sites-enabled/${API_DOMAIN}.conf"
fi

nginx -t
systemctl reload nginx

certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --cert-name "${API_DOMAIN}" \
  -d "${API_DOMAIN}"

nginx -t
systemctl reload nginx
if systemctl list-unit-files certbot.timer >/dev/null 2>&1; then
  systemctl enable --now certbot.timer
fi

printf 'AFCR_API_DOMAIN_READY=%s\n' "${API_DOMAIN}"
printf 'AFCR_API_DOMAIN_BACKUP=%s\n' "${backup_dir}"
