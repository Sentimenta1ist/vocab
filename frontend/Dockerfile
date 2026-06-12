FROM nginx:1.27-alpine

COPY index.html app.js style.css manifest.json sw.js config.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/

# nginx.conf (no proxy — browser calls backend directly)
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Injects BACKEND_URL into config.js at container start
COPY 40-inject-config.sh /docker-entrypoint.d/40-inject-config.sh
RUN chmod +x /docker-entrypoint.d/40-inject-config.sh

EXPOSE 80
