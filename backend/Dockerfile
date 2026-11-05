# syntax=docker/dockerfile:1
# ------------------------------------------------------------
# LMS backend image: Django ASGI (HTTP + WebSocket chat) served by Uvicorn
# with several worker processes.
# Settings are NOT baked in: ECS injects them from AWS Secrets Manager.
# ------------------------------------------------------------
FROM python:3.12-slim

# PIP_DEFAULT_TIMEOUT / PIP_RETRIES: tolerate slow or flaky connections to PyPI
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

WORKDIR /app

# Dependencies first so this layer is cached when only code changes.
# The cache mount keeps pip's downloads on the build machine between builds
# (not in the image), so a failed or changed install doesn't re-download everything.
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Uvicorn for the container only (the VPS keeps Daphne from requirements.txt).
# Unlike Daphne it runs several worker processes on one port; [standard] adds
# WebSocket support for chat.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install "uvicorn[standard]==0.34.0"

COPY . .

# Run as an unprivileged user
RUN useradd --create-home --uid 10001 appuser
USER appuser

# Each API runs as its own ECS service on its own port, as on the VPS
# (8001 curriculum_api ... 8009 login_api; see infrastructure/variables.tf).
# The service sets PORT; 8000 is only the local default.
# WEB_CONCURRENCY = worker processes per container (ECS sets it).
ENV PORT=8000 \
    WEB_CONCURRENCY=1
EXPOSE 8000-8009

# Uvicorn serves HTTP and WebSockets on one port with WEB_CONCURRENCY processes,
# so one container can use more than one CPU thread for ordinary Django views.
#   --proxy-headers/--forwarded-allow-ips: client IP from the load balancer's
#     X-Forwarded-For (tasks are only reachable through the load balancer)
#   --lifespan off: the Channels router has no lifespan handler
#   /health/ is answered in config/health.py for the load balancer.
# `exec` makes Uvicorn PID 1, so it receives ECS's stop signal and shuts down cleanly.
# docker-entrypoint.sh writes secret files (e.g. the YouTube cookies) first
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn config.asgi:application --host 0.0.0.0 --port \"$PORT\" --workers \"$WEB_CONCURRENCY\" --proxy-headers --forwarded-allow-ips '*' --lifespan off"]
