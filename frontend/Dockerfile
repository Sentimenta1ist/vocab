FROM nginx:alpine

COPY index.html app.js style.css manifest.json sw.js /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
