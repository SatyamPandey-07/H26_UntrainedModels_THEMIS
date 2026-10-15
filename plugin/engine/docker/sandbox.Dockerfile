# Themis verification sandbox.
# Built once per commit from a clean `git archive` export. Dependencies install with network during the build;
# every later step runs with `--network none`, a read-only root filesystem and no secrets.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    TZ=UTC \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false

WORKDIR /work
COPY . /work

RUN if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then corepack enable && yarn install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci; \
    else npm install; fi

# Source stays owned by root; tests run as the unprivileged node user and write only to /tmp.
USER node
ENV HOME=/tmp
