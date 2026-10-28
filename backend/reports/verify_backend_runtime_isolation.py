"""Sanitised, read-only proof of the Phase 4G benchmark runtime boundary.

The caller must provide the benchmark environment variables. This probe never
prints connection strings, credentials, user identities, or row data. It does
not start a listening server and executes SELECT statements only.
"""
from __future__ import annotations

import io
import json
import os
from pathlib import Path
import sys
import threading


BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def _threads():
    return sorted(thread.name for thread in threading.enumerate())


def main():
    if os.environ.get("RUN_APP_ON_TEST_BRANCH", "").lower() != "true":
        raise RuntimeError("RUN_APP_ON_TEST_BRANCH=true is required")
    if os.environ.get("LMS_TEST_MODE") != "postgres-read-only":
        raise RuntimeError("LMS_TEST_MODE=postgres-read-only is required")

    before_setup = _threads()

    import django

    django.setup()

    from django.conf import settings
    from django.core.wsgi import get_wsgi_application
    from django.db import connections

    after_setup = _threads()
    aliases = {}
    role_capabilities = None
    for alias in connections:
        config = settings.DATABASES[alias]
        with connections[alias].cursor() as cursor:
            cursor.execute(
                """
                SELECT current_database(),
                       current_setting('transaction_read_only'),
                       current_setting('neon.branch_id', true),
                       current_setting('neon.endpoint_id', true),
                       pg_is_in_recovery()
                """
            )
            database, read_only, branch_id, endpoint_id, recovery = cursor.fetchone()
            if role_capabilities is None:
                cursor.execute(
                    """
                    SELECT rolcreatedb, rolcreaterole, rolreplication, rolbypassrls,
                           has_table_privilege(
                               current_user,
                               'enrolment."Created_users"',
                               'INSERT,UPDATE,DELETE'
                           )
                    FROM pg_roles
                    WHERE rolname = current_user
                    """
                )
                create_db, create_role, replication, bypass_rls, table_dml = cursor.fetchone()
                role_capabilities = {
                    "create_database": create_db,
                    "create_role": create_role,
                    "replication": replication,
                    "bypass_rls": bypass_rls,
                    "learner_table_dml": table_dml,
                }
        aliases[alias] = {
            "configured_host": config.get("HOST"),
            "configured_database": config.get("NAME"),
            "configured_read_only": (
                "default_transaction_read_only=on"
                in str(config.get("OPTIONS", {}).get("options", ""))
            ),
            "actual_database": database,
            "transaction_read_only": read_only,
            "actual_branch_id": branch_id,
            "actual_endpoint_id": endpoint_id,
            "in_recovery": recovery,
        }

    status = {}

    def start_response(value, headers, exc_info=None):
        status["value"] = value
        status["headers"] = dict(headers)

    environ = {
        "REQUEST_METHOD": "GET",
        "SCRIPT_NAME": "",
        "PATH_INFO": "/learner_api/learner-summary/apprenticeship/1/",
        "QUERY_STRING": "",
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
        "SERVER_PROTOCOL": "HTTP/1.1",
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(b""),
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": True,
    }
    body = b"".join(get_wsgi_application()(environ, start_response))
    after_request = _threads()

    result = {
        "database_aliases": aliases,
        "role_capabilities": role_capabilities,
        "runtime_controls": {
            "cache_backend": settings.CACHES["default"]["BACKEND"],
            "channel_layer": settings.CHANNEL_LAYERS["default"]["BACKEND"],
            "email_backend": settings.EMAIL_BACKEND,
            "api_auth_required": os.environ.get("API_REQUIRE_AUTH"),
            "learner_api_auth_required": os.environ.get("LEARNER_API_REQUIRE_AUTH"),
            "runtime_schema_bootstrap": settings.CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP,
            "read_model_outbox": settings.READ_MODEL_OUTBOX_ENABLED,
            "read_model_dual_write": settings.READ_MODEL_DUAL_WRITE_ENABLED,
            "mobile_push": settings.KBC_MOBILE_PUSH_ENABLED,
            "mobile_calendar_writes": settings.KBC_MOBILE_CALENDAR_WRITES_ENABLED,
        },
        "threads": {
            "before_setup": before_setup,
            "after_setup": after_setup,
            "after_request": after_request,
        },
        "anonymous_wsgi_request": {
            "path": environ["PATH_INFO"],
            "status": status.get("value"),
            "response_bytes": len(body),
        },
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
