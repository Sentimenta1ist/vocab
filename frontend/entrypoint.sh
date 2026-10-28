#!/bin/sh
set -e
printf 'window.__API_URL__ = "%s";\nwindow.__ALLOW_REGISTRATION__ = %s;\n' \
  "${API_URL:-/api}" "${ALLOW_REGISTRATION:-false}" \
  > /usr/share/nginx/html/config.js
exec nginx -g 'daemon off;'
