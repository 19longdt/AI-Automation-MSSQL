FROM node:22-alpine AS builder

WORKDIR /app

# Install deps — copy all package.json manifests first for layer caching
COPY package*.json ./
COPY apps/api/package*.json     ./apps/api/
COPY apps/web-v2/package*.json  ./apps/web-v2/
COPY packages/core/package*.json ./packages/core/

RUN npm ci

COPY . .

# Build: core types → web-v2 (Vite) → API (tsc)
RUN npm run build

# ── Runtime image ───────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV API_PORT=3000

# API runtime deps
COPY --from=builder /app/package*.json         ./
COPY --from=builder /app/node_modules          ./node_modules
COPY --from=builder /app/apps/api/dist         ./apps/api/dist

# React frontend (Vite build output)
COPY --from=builder /app/dist-v2               ./dist-v2

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD wget -q -O - http://127.0.0.1:3000/health >/dev/null || exit 1

CMD ["node", "apps/api/dist/main.js"]
