# ─── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./

# Install ALL deps (including devDeps) so the build toolchain is available
RUN npm ci

COPY . .

# Build the React Router app.
# SHOPIFY_APP_URL is intentionally NOT set here — the Vite build uses base: "/"
# (relative paths). The runtime container receives SHOPIFY_APP_URL via env_file.
RUN npm run build

# Generate the Prisma client into node_modules (will be copied to runner)
RUN npx prisma generate

# Strip devDependencies — leaves only runtime deps
RUN npm prune --omit=dev


# ─── Stage 2: Production Runner ────────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Create a non-root system user
RUN addgroup --system --gid 1001 appgroup && \
    adduser  --system --uid 1001 --ingroup appgroup appuser

# Copy only what the app needs at runtime
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/build       ./build
COPY --from=builder --chown=appuser:appgroup /app/public      ./public
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json
COPY --from=builder --chown=appuser:appgroup /app/server.mjs  ./server.mjs
COPY --from=builder --chown=appuser:appgroup /app/prisma      ./prisma

ENV NODE_ENV=production

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["npm", "run", "docker-start"]
