# syntax=docker/dockerfile:1
# Build context: repository root  →  docker build -f apps/api/Dockerfile .

# ---- deps: the api workspace only (incl. dev deps for tsup); skips Next.js & friends ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace=@caas/api --no-audit --no-fund

# ---- builder: bundle src + @caas/shared into dist/ ----
FROM deps AS builder
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build --workspace=@caas/api

# ---- prod-deps: runtime dependencies of the api only ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@caas/api --no-audit --no-fund

# ---- runner ----
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
# "type": "module" so Node loads dist/index.js as ESM
COPY apps/api/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
