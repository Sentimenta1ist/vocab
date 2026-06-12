FROM nginx:1.27-alpine

COPY index.html app.js style.css manifest.json sw.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Bake BACKEND_URL into config.js at build time.
# In Coolify: set BACKEND_URL=https://vocab-api.qear.net and enable "Available at Buildtime".
# Locally: empty string → API calls use relative /api (FastAPI serves everything).
ARG BACKEND_URL=
RUN echo "window.VOCAB_BACKEND = '${BACKEND_URL}';" > /usr/share/nginx/html/config.js

EXPOSE 80
