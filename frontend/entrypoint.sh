#!/bin/sh
set -e
printf 'window.__API_URL__ = "%s";\n' "${API_URL:-/api}" \
  > /usr/share/nginx/html/config.js
exec nginx -g 'daemon off;'
