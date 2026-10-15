# Themis verification sandbox for Python repositories (pip + requirements*.txt).
# Built once per commit from a clean `git archive` export. Dependencies install with network during the build;
# every later step runs with `--network none`, a read-only root filesystem and no secrets.
ARG PYTHON_VERSION=3.12
FROM python:${PYTHON_VERSION}-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates build-essential \
  && rm -rf /var/lib/apt/lists/*

ENV CI=true \
    TZ=UTC \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/work

WORKDIR /work
COPY . /work

# REQ_FILES: space separated requirements files found in the export. EXTRA_PIP: tools the detected test runner needs.
ARG REQ_FILES=""
ARG EXTRA_PIP=""
RUN set -e; args=""; \
    for f in $REQ_FILES; do args="$args -r $f"; done; \
    if [ -n "$args$EXTRA_PIP" ]; then pip install $args $EXTRA_PIP; fi

# Source stays owned by root; tests run as an unprivileged user and write only to /tmp.
RUN useradd --uid 10001 --no-create-home themis
USER themis
ENV HOME=/tmp
