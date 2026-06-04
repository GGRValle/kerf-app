# Kerf shell — internet-deployable Astro + Hono image.
#
# Multi-stage build:
#   1. deps stage  — install npm deps (including tsx for runtime)
#   2. build stage — build the Astro SSR output
#   3. runtime stage — lean image that runs scripts/serve-kerf-shell.ts
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
# Build: `npm run deploy:fly` passes GIT_COMMIT/GIT_DIRTY into the
# Docker build. The runtime /health stamp is baked into the image, not
# injected later by mutable Fly env/secrets.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# --ignore-scripts: the package.json `prepare` hook runs `tsc`, which
# needs tsconfig.json + source files (not present in this layer). The
# build stage runs the real compile via esbuild; npm lifecycle scripts
# aren't needed for dependency install.
RUN npm ci --no-audit --no-fund --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
ARG GIT_COMMIT=unknown
ARG GIT_DIRTY=true
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN printf '{"commit":"%s","dirty":%s,"source":"image"}\n' "$GIT_COMMIT" "$GIT_DIRTY" > /app/build-stamp.json
# Build Astro SSR output used by scripts/serve-kerf-shell.ts.
RUN npm run build:astro

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV PERSISTENCE_DIR=/data/.kerf

# Create the persistence dir mount point (Fly volume mounts here at runtime)
RUN mkdir -p /data/.kerf

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/build-stamp.json ./build-stamp.json

EXPOSE 8080
CMD ["node", "--import", "tsx", "scripts/serve-kerf-shell.ts"]
