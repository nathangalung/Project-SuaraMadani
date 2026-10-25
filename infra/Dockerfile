# syntax=docker/dockerfile:1
# Build from the repo root
# Base: oven/bun 1.4.3, Debian trixie
FROM oven/bun:1.4.3-debian@sha256:923bedb355f7746666659f71e724998159a5c8c54bd1cb1030e1975a0698415b AS base

# Decoders for worker-media
FROM base AS media
# Security fixes past the base
ARG DEBIAN_SECURITY_SNAPSHOT=20261016T152439Z
# Archive pinned, digest moves it
# Base names its snapshot date
RUN snapshot="$(sed -n 's|^# http://snapshot.debian.org/archive/debian/\([0-9]*T[0-9]*Z\)$|\1|p' /etc/apt/sources.list.d/debian.sources)" \
  && test -n "$snapshot" \
  && expr "$DEBIAN_SECURITY_SNAPSHOT" : '[0-9]\{8\}T[0-9]\{6\}Z$' >/dev/null \
  && printf 'APT::Snapshot "%s";\nAcquire::Check-Valid-Until "false";\n' "$snapshot" \
    >/etc/apt/apt.conf.d/50snapshot \
  && sed -i "\|^URIs: http://deb.debian.org/debian-security\$|a Snapshot: $DEBIAN_SECURITY_SNAPSHOT" \
    /etc/apt/sources.list.d/debian.sources \
  && grep -q "^Snapshot: $DEBIAN_SECURITY_SNAPSHOT\$" /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    libheif-examples \
    libheif1 \
    libheif-plugin-libde265 \
    poppler-utils \
    qpdf \
    ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Dev and CI test runner
FROM media AS media-test
# HEIC encoder, git for tooling.test
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    libheif-plugin-x265 \
  && rm -rf /var/lib/apt/lists/*
USER bun
WORKDIR /app

# Full install for the build
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

# Runtime only, no optional peers
FROM base AS prod-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
# Peers would pull drizzle-kit, esbuild
RUN bun install --frozen-lockfile --production --omit=peer

# One image: web, workers, migrate
FROM media AS runtime
ARG GIT_SHA=dev
ARG PGBOSS_VERSION
COPY package.json /tmp/package.json
# Label must match the lockfile
RUN test -n "$PGBOSS_VERSION" \
  && grep -q "\"pg-boss\": \"$PGBOSS_VERSION\"" /tmp/package.json \
  && rm /tmp/package.json
LABEL org.opencontainers.image.revision="$GIT_SHA" \
  org.sadarbersuara.pg-boss="$PGBOSS_VERSION"
ENV NODE_ENV=production \
  GIT_SHA=$GIT_SHA \
  PORT=3000 \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
WORKDIR /app
# Root-owned code, read-only
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY package.json tsconfig.json ./
COPY server ./server
COPY worker ./worker
COPY db ./db
COPY shared ./shared
COPY messages ./messages
USER bun
EXPOSE 3000
CMD ["bun", "server/index.ts"]
