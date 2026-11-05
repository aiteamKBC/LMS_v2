#!/bin/sh
# Container start-up (AWS ECS). Files the app expects on disk can't be mounted
# on Fargate, so they arrive base64-encoded in a setting from Secrets Manager
# and are written here, private to the app user, before Uvicorn starts.
set -eu

# YouTube-only Netscape cookies file for video imports (curriculum_api/youtube_download.py)
if [ -n "${YOUTUBE_COOKIES_B64:-}" ] && [ -z "${YOUTUBE_COOKIES_FILE:-}" ]; then
    umask 077
    mkdir -p /tmp/lms-secrets
    printf '%s' "$YOUTUBE_COOKIES_B64" | base64 -d > /tmp/lms-secrets/youtube-cookies.txt
    chmod 600 /tmp/lms-secrets/youtube-cookies.txt
    export YOUTUBE_COOKIES_FILE=/tmp/lms-secrets/youtube-cookies.txt
fi
unset YOUTUBE_COOKIES_B64

exec "$@"
