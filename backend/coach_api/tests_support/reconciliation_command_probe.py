"""Subprocess-only synthetic command probe. Never accepts a database URL.

Cold startup and the real manage.py command are measured separately from explicit
in-memory fixture construction. SQL hooks are process-wide (including threads
and newly opened aliases); forbidden attempts are recorded even if swallowed.
"""
import json
import os
from pathlib import Path
import re
import runpy
import socket
import sys
import threading
from contextlib import ExitStack
from unittest.mock import patch


def main():
    mode = sys.argv[1]
    assert mode in {"old", "new", "mapped", "default", "detectors"}
    backend = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(backend))
    os.environ.update(DJANGO_SETTINGS_MODULE="config.settings_sqlite_test", DJANGO_USE_SQLITE="true",
                      USE_SECURITY_TEST_BRANCH="false", RUN_APP_ON_TEST_BRANCH="false", CURRICULUM_WARM="1")
    sys.argv = [str(backend / "manage.py"), "reconcile_review_booking", "--dry-run",
                "--actor-id", "990", "--calendar-event-id", "1", "--source-review-id", "501"]
    phase = "startup"
    denied, statements = [], []

    def forbid(kind):
        def fail(*args, **kwargs):
            denied.append((phase, kind))
            raise AssertionError(f"Forbidden probe side effect: {kind}")
        return fail

    # Windows asyncio's private socketpair is not an application connection.
    original_pair, original_connect = socket.socketpair, socket.socket.connect
    def private_pair(*args, **kwargs):
        socket.socket.connect = original_connect
        try:
            return original_pair(*args, **kwargs)
        finally:
            socket.socket.connect = forbid("socket.connect")

    with ExitStack() as stack:
        stack.enter_context(patch.object(socket, "socketpair", private_pair))
        for obj, attr in ((socket.socket, "connect"), (socket.socket, "connect_ex"), (socket, "create_connection")):
            stack.enter_context(patch.object(obj, attr, forbid(attr)))
        import psycopg
        stack.enter_context(patch.object(psycopg, "connect", forbid("PostgreSQL connection")))
        from django.conf import settings
        assert all(c["ENGINE"] == "django.db.backends.sqlite3" for c in settings.DATABASES.values())
        for config in settings.DATABASES.values():
            config["NAME"] = ":memory:"
        settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
        settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
        settings.CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
        from django.db.backends.base.base import BaseDatabaseWrapper
        original_ensure = BaseDatabaseWrapper.ensure_connection
        def ensure_memory(db):
            config = db.settings_dict
            assert config["ENGINE"] == "django.db.backends.sqlite3", "Only synthetic SQLite is permitted"
            name = str(config["NAME"])
            assert name == ":memory:" or (name.startswith("file:memorydb_") and "mode=memory" in name)
            return original_ensure(db)
        stack.enter_context(patch.object(BaseDatabaseWrapper, "ensure_connection", ensure_memory))
        from django.db.backends.utils import CursorWrapper
        original_execute, original_many = CursorWrapper.execute, CursorWrapper.executemany
        mutation = re.compile(r"\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|VACUUM|ATTACH)\b", re.I)
        def checked(original):
            def execute(cursor, sql, params=None):
                if phase != "fixtures":
                    statements.append((phase, cursor.db.alias, str(sql)))
                    if mutation.search(str(sql)):
                        return forbid("mutating SQL")()
                return original(cursor, sql, params)
            return execute
        stack.enter_context(patch.object(CursorWrapper, "execute", checked(original_execute)))
        stack.enter_context(patch.object(CursorWrapper, "executemany", checked(original_many)))
        stack.enter_context(patch.object(threading.Thread, "start", forbid("background thread")))
        # Twisted's Windows reactor also uses a private loopback self-pipe.
        # Permit only construction of that pipe, never general loopback IO.
        from twisted.internet import _signals
        original_waker = _signals._SocketWaker.__init__
        def private_waker(self):
            with patch.object(socket.socket, "connect", original_connect):
                original_waker(self)
        stack.enter_context(patch.object(_signals._SocketWaker, "__init__", private_waker))
        import requests
        import httpx
        import urllib.request
        import smtplib
        from django.core.mail.message import EmailMessage
        from django.core.files.storage import Storage
        for obj, attr, kind in (
            (requests.sessions.Session, "request", "HTTP requests"),
            (httpx.Client, "send", "HTTPX"), (httpx.AsyncClient, "send", "async HTTPX"),
            (urllib.request, "urlopen", "urllib HTTP"), (smtplib.SMTP, "sendmail", "SMTP"),
            (EmailMessage, "send", "email"), (Storage, "save", "storage upload"),
        ):
            stack.enter_context(patch.object(obj, attr, forbid(kind)))
        import django
        django.setup()  # Actual cold AppConfig.ready, with warming explicitly enabled.
        assert not denied, denied
        assert not statements, "Startup must not access application databases"

        if mode == "detectors":
            from django.db import connections
            connections.databases["extra_probe"] = {**connections.databases["default"], "NAME": ":memory:"}
            for alias in ("default", "enrolment", "extra_probe"):
                for sql in ("INSERT INTO x VALUES (1)", "WITH x AS (DELETE FROM y RETURNING *) SELECT * FROM x"):
                    try:
                        with connections[alias].cursor() as cursor:
                            cursor.execute(sql)
                    except AssertionError:
                        pass
            for action in (lambda: threading.Thread(target=lambda: None).start(),
                           lambda: requests.get("https://example.invalid/graph"),
                           lambda: EmailMessage().send(),
                           lambda: Storage().save("synthetic", None)):
                try:
                    action()
                except AssertionError:
                    pass
            assert len(denied) == 10, denied
            print("PROBE_RESULT=" + json.dumps({"mode": mode, "detected": len(denied), "aliases": 3}))
            return

        # Controlled writes exist only to build disposable synthetic fixtures.
        phase = "fixtures"
        from django.test.runner import DiscoverRunner
        from django.db import connection, connections
        from coach_api.test_review_reconciliation import ReviewReconciliationTests
        from coach_api.models import ReviewSourceReconciliation, ImportedReviewInstance
        runner = DiscoverRunner(verbosity=0, interactive=False)
        runner.setup_databases(aliases={"default"})
        # This process-purity probe deliberately controls all external identity
        # reads. Its in-memory schema has never represented PostgreSQL's
        # unmanaged FK targets. Keep that narrow fixture boundary here; the
        # persisted PostgreSQL suite always constructs the real parents.
        assert connection.vendor == "sqlite" and settings.COACH_TEST_MODE
        stack.enter_context(patch.object(ReviewReconciliationTests, "persist_identity_parents"))
        stack.enter_context(patch.object(ReviewReconciliationTests, "cleanup_identity_parents"))
        fixture = ReviewReconciliationTests("test_preview_and_missing_explicit_id_never_write")
        fixture.setUp()
        stack.callback(fixture.doCleanups)
        if mode == "mapped":
            fixture.apply()
            fixture.definition.update(migratedForm=True, canInitialize=False)
        if mode == "old":
            with connection.cursor() as cursor:
                cursor.execute(f"DROP TABLE {connection.ops.quote_name(ReviewSourceReconciliation._meta.db_table)}")

        # Account/profile/source/canonical-definition/dependency reads use the
        # existing synthetic suite's fixtures. Calendar/Native/overlay/ledger
        # reads and command/service/ORM code execute normally.
        def actor_read():
            # Exercise a second alias during actual command execution as well.
            with connections["enrolment"].cursor() as cursor:
                cursor.execute("SELECT 1")
            return fixture.actor
        fixture.account.return_value.first.side_effect = actor_read
        # Django's CLI system checks can rebuild a model's cached managers.
        # Keep the synthetic account read attached to the manager type rather
        # than one cached instance; every other model uses its actual query.
        from login.models import LoginAccount
        manager_type = type(LoginAccount.objects)
        original_filter = manager_type.filter
        def account_filter(manager, *args, **kwargs):
            if manager.model is LoginAccount:
                assert kwargs == {"pk": 990, "is_active": True, "role": "admin"}
                return fixture.account.return_value
            return original_filter(manager, *args, **kwargs)
        stack.enter_context(patch.object(manager_type, "filter", account_filter))
        before = fixture.snapshot()
        before_overlay = list(ImportedReviewInstance.objects.values())
        before_links = list(ReviewSourceReconciliation.objects.values()) if mode != "old" else []
        sys.argv[sys.argv.index("--calendar-event-id") + 1] = str(fixture.record.pk)
        if mode == "default":
            sys.argv.remove("--dry-run")
        phase = "command"
        exit_code = 0
        try:
            runpy.run_path(str(backend / "manage.py"), run_name="__main__")
        except SystemExit as exc:
            exit_code = exc.code
        assert exit_code == (1 if mode == "old" else 0), exit_code
        assert not denied, denied
        assert fixture.snapshot() == before
        assert list(ImportedReviewInstance.objects.values()) == before_overlay
        if mode != "old":
            assert list(ReviewSourceReconciliation.objects.values()) == before_links
        aliases = sorted({alias for _, alias, _ in statements})
        assert aliases == ["default", "enrolment"], aliases
        print("PROBE_RESULT=" + json.dumps({"mode": mode, "exit": exit_code, "denied": denied,
            "startup_queries": 0, "read_queries": len(statements), "aliases": aliases,
            "fixture_reads_mocked": ["account", "profile", "source", "canonical definition", "dependency counts"]}))


if __name__ == "__main__":
    main()
