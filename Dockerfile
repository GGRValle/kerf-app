# V1.5 Field Daily — internet-deployable demo image (Step C.4).
#
# Multi-stage build:
#   1. deps stage  — install npm deps (including tsx for runtime)
#   2. build stage — bundle the browser-side esbuild bundles
#   3. runtime stage — lean image that runs scripts/serve-v15-vertical-slice.ts
#
# Persistence note: the JSONL event log + projection cache lives at
# /data/.kerf (set via PERSISTENCE_DIR env var in fly.toml). Mount a Fly
# volume at /data so events survive container restarts + redeploys.
#
# Runtime env vars (set via `fly secrets set`):
#   - PORT=8080
#   - PERSISTENCE_DIR=/data/.kerf
#   - GROQ_API_KEY=<...>     (optional — /transcribe returns 503 if absent)
#   - GROQ_BASE_URL=<...>    (optional — same)
#   - BASIC_AUTH_USER=<...>  (optional — gates all routes if set)
#   - BASIC_AUTH_PASS=<...>  (optional — must be set alongside USER)
#
# Build: `fly deploy` uses Fly's remote builder; local Docker not required.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the browser bundle used by the SPA. The serve script doesn't
# bundle itself — it runs through tsx at startup — but it serves the
# pre-built browser bundle.
RUN npx --yes esbuild@0.25.0 \
      src/examples/v15-vertical-slice/app.ts \
      --bundle \
      --platform=browser \
      --format=iife \
      --outfile=src/examples/v15-vertical-slice/app.bundle.js

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV PERSISTENCE_DIR=/data/.kerf

# Create the persistence dir mount point (Fly volume mounts here at runtime)
RUN mkdir -p /data/.kerf

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/data ./data
COPY --from=build /app/package.json ./package.json

EXPOSE 8080
CMD ["node", "--import", "tsx", "scripts/serve-v15-vertical-slice.ts"]
