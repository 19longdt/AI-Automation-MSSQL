FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/
COPY packages/core/package*.json ./packages/core/
RUN npm ci

COPY . .

# Webpack 4 compatibility on modern Node/OpenSSL.
ENV NODE_OPTIONS=--openssl-legacy-provider
RUN npm run build

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/pages ./apps/web/pages
COPY --from=builder /app/apps/web/css ./apps/web/css
COPY --from=builder /app/css ./css
COPY --from=builder /app/examples ./examples
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/images ./images

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -q -O - http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "apps/api/dist/main.js"]
