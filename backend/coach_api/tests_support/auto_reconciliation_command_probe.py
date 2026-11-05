"""Cold CLI startup/default-mode purity; synthetic in-memory tables only."""
import json
import os
from pathlib import Path
import re
import runpy
import socket
import sys
import threading
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch


def main():
    mode = sys.argv[1]
    assert mode in {"old", "new"}
    backend = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(backend))
    os.environ.update(DJANGO_SETTINGS_MODULE="config.settings_sqlite_test", DJANGO_USE_SQLITE="true",
                      USE_SECURITY_TEST_BRANCH="false", RUN_APP_ON_TEST_BRANCH="false", CURRICULUM_WARM="1")
    sys.argv = [str(backend / "manage.py"), "auto_reconcile_legacy_aptem_reviews", "--actor-id", "990"]
    phase, statements, denied = "startup", [], []

    def forbid(*args, **kwargs):
        denied.append(phase)
        raise AssertionError("Unexpected database/network/thread/application mutation")

    with ExitStack() as stack:
        original_pair, original_connect = socket.socketpair, socket.socket.connect

        def private_pair(*args, **kwargs):
            with patch.object(socket.socket, "connect", original_connect):
                return original_pair(*args, **kwargs)

        stack.enter_context(patch.object(socket, "socketpair", private_pair))
        for obj, attr in ((socket.socket, "connect"), (socket.socket, "connect_ex"),
                          (socket, "create_connection"), (threading.Thread, "start")):
            stack.enter_context(patch.object(obj, attr, forbid))
        import psycopg
        import requests
        import httpx
        import smtplib
        import urllib.request
        from django.core.mail.message import EmailMessage
        from django.core.files.storage import Storage
        for obj, attr in ((psycopg, "connect"), (requests.sessions.Session, "request"),
                          (httpx.Client, "send"), (httpx.AsyncClient, "send"), (smtplib.SMTP, "sendmail"),
                          (urllib.request, "urlopen"), (EmailMessage, "send"), (Storage, "save")):
            stack.enter_context(patch.object(obj, attr, forbid))
        from django.conf import settings
        for config in settings.DATABASES.values():
            assert config["ENGINE"] == "django.db.backends.sqlite3"
            config["NAME"] = ":memory:"
        settings.INSTALLED_APPS = [app for app in settings.INSTALLED_APPS if app != "daphne"]
        settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
        settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
        from django.db.backends.base.base import BaseDatabaseWrapper
        original_ensure = BaseDatabaseWrapper.ensure_connection

        def ensure(db):
            assert db.settings_dict["ENGINE"] == "django.db.backends.sqlite3" and db.settings_dict["NAME"] == ":memory:"
            return original_ensure(db)

        stack.enter_context(patch.object(BaseDatabaseWrapper, "ensure_connection", ensure))
        from django.db.backends.utils import CursorWrapper
        mutation = re.compile(r"\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|VACUUM|ATTACH|NEXTVAL|SETVAL)\b", re.I)

        def guard(original):
            def execute(cursor, sql, params=None):
                if phase != "fixtures":
                    statements.append((phase, str(sql)))
                    if mutation.search(str(sql)):
                        forbid()
                return original(cursor, sql, params)
            return execute

        stack.enter_context(patch.object(CursorWrapper, "execute", guard(CursorWrapper.execute)))
        stack.enter_context(patch.object(CursorWrapper, "executemany", guard(CursorWrapper.executemany)))
        import django
        django.setup()
        assert not statements and not denied
        phase = "fixtures"
        from django.db import connection
        from coach_api.models import CoachCalendarEvent, MigratedReviewTemplate, ImportedReviewInstance, ReviewSourceReconciliation
        with connection.schema_editor() as editor:
            for model in (CoachCalendarEvent, MigratedReviewTemplate, ImportedReviewInstance):
                editor.create_model(model)
            if mode == "new":
                editor.create_model(ReviewSourceReconciliation)
        stack.enter_context(patch("coach_api.review_reconciliation.require_operator", return_value=SimpleNamespace(pk=990)))
        phase = "command"
        runpy.run_path(str(backend / "manage.py"), run_name="__main__")
        assert not denied
        assert statements and all(p == "command" for p, _ in statements)
        print("AUTO_PROBE_RESULT=" + json.dumps({"mode": mode, "startup_queries": 0,
                                               "read_statements": len(statements), "forbidden_attempts": len(denied)}))


if __name__ == "__main__":
    main()
