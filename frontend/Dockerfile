FROM nginx:1.27-alpine

# Static assets
COPY index.html app.js style.css manifest.json sw.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/

# nginx:alpine processes /etc/nginx/templates/*.template with envsubst at startup,
# outputting the result to /etc/nginx/conf.d/.  No custom entrypoint needed.
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80
