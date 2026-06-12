FROM nginx:alpine

COPY index.html app.js style.css manifest.json sw.js config.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY nginx.conf /etc/nginx/conf.d/default.conf

ARG BACKEND_URL=
RUN echo "window.VOCAB_BACKEND = '${BACKEND_URL}';" > /usr/share/nginx/html/config.js

EXPOSE 80
