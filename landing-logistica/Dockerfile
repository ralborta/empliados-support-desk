FROM nginx:alpine

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static files to root (for / access)
COPY index.html /usr/share/nginx/html/
COPY styles.css /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets

# Copy static files to borrador-web/ (for /borrador-web/ access)
RUN mkdir -p /usr/share/nginx/html/borrador-web
COPY index.html /usr/share/nginx/html/borrador-web/
COPY styles.css /usr/share/nginx/html/borrador-web/
COPY script.js /usr/share/nginx/html/borrador-web/
COPY assets /usr/share/nginx/html/borrador-web/assets

# Create health check
RUN echo "OK" > /usr/share/nginx/html/health

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
