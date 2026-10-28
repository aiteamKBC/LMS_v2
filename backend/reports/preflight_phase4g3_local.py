"""Sanitised, read-only preflight for the Phase 4G.3 local benchmark."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_local_benchmark")


def main() -> int:
    evidence = {"status": "blocked", "remote_access_attempted": False}
    try:
        import django
        django.setup()
        from django.conf import settings
        from django.db import connections

        evidence["aliases"] = sorted(settings.DATABASES)
        evidence["hosts"] = {
            alias: settings.DATABASES[alias]["HOST"] for alias in settings.DATABASES
        }
        evidence["databases"] = {
            alias: settings.DATABASES[alias]["NAME"] for alias in settings.DATABASES
        }
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "select version(), current_database(), current_user, "
                "coalesce(inet_server_addr()::text, 'local-socket')"
            )
            version, database, role, server_address = cursor.fetchone()
        evidence.update({
            "status": "ready",
            "postgresql_version": version.split(",", 1)[0],
            "database": database,
            "role": role,
            "server_address": server_address,
            "external_email_backend": settings.EMAIL_BACKEND,
        })
        return_code = 0
    except Exception as exc:
        evidence["error_type"] = type(exc).__name__
        return_code = 2
    print(json.dumps(evidence, sort_keys=True))
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
