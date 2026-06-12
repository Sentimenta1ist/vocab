#!/bin/sh
set -e

# Write runtime config injected from env var API_URL.
# Coolify sets API_URL=https://vocab-api.qear.net/api for the frontend service.
# Falls back to /api for local single-container mode.
printf 'window.__API_URL__ = "%s";\n' "${API_URL:-/api}" \
  > /usr/share/nginx/html/config.js

exec nginx -g 'daemon off;'
