FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Webpack 4 compatibility on modern Node/OpenSSL
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN npm run webpack

FROM nginx:1.27-alpine

WORKDIR /usr/share/nginx/html

# Serve the repository as static files so examples/upload.html can be opened directly.
COPY --from=builder /app ./
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
