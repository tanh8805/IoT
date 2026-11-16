FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY check-certs.sh /docker-entrypoint.d/05-check-certs.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/05-check-certs.sh && chmod +x /docker-entrypoint.d/05-check-certs.sh
COPY --from=build /app/dist /usr/share/nginx/html
# Chứng chỉ không nằm trong image: mount từ deployment/certs vào /etc/nginx/certs.
EXPOSE 80 443
