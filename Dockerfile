FROM node:22-bookworm-slim AS deps

RUN apt-get update -yy && \
    apt-get install -yy --no-install-recommends \
      ca-certificates python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /srv/app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc && cp -r src/migrations dist/

FROM node:22-bookworm-slim

RUN apt-get update -yy && \
    apt-get install -yy --no-install-recommends \
      ca-certificates curl git docker.io jq && \
    rm -rf /var/lib/apt/lists/*

RUN set -e; ARCH=$(dpkg --print-architecture); \
    DUFS_ARCH=$([ "$ARCH" = "amd64" ] && echo "x86_64" || echo "aarch64"); \
    DUFS_VER=$(curl -fsSL https://api.github.com/repos/sigoden/dufs/releases/latest | jq -r .tag_name); \
    curl -fsSL "https://github.com/sigoden/dufs/releases/download/${DUFS_VER}/dufs-${DUFS_VER}-${DUFS_ARCH}-unknown-linux-musl.tar.gz" \
      | tar xz -C /usr/local/bin dufs && chmod +x /usr/local/bin/dufs

WORKDIR /srv/app

COPY --from=build /srv/app/dist ./dist
COPY --from=deps /srv/app/node_modules ./node_modules
COPY --from=deps /srv/app/package.json ./package.json
COPY container/ ./container/
COPY templates/ ./templates/
COPY prototype/ /srv/app/prototype/

RUN mkdir -p /cfg
COPY kanipi ./kanipi
RUN chmod +x ./kanipi

RUN useradd -m -u 1000 node 2>/dev/null || true

CMD ["./kanipi"]
