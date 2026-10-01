# syntax=docker/dockerfile:1
# Build context: repository root  →  docker build -f apps/web/Dockerfile .

# ---- deps: the web workspace only ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@caas/web --no-audit --no-fund

# ---- builder ----
FROM deps AS builder
# Baked into the /api/* rewrite at build time (only used outside K8s; see next.config.ts).
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN --mount=type=cache,target=/app/apps/web/.next/cache \
    npm run build --workspace=@caas/web

# ---- runner: Next.js standalone server only ----
FROM node:26-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
