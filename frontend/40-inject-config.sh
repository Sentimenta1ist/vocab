#!/bin/sh
# Runs as part of nginx startup (docker-entrypoint.d).
# Replaces ${BACKEND_URL} in config.js with the actual env var value.
envsubst '${BACKEND_URL}' \
  < /usr/share/nginx/html/config.js \
  > /usr/share/nginx/html/config.js.tmp \
  && mv /usr/share/nginx/html/config.js.tmp /usr/share/nginx/html/config.js
