"""Fail-closed network and database isolation for backend test processes.

The guard is installed before Django initialises for ``manage.py test`` and by
the pytest session hook.  Production commands never install it.  Unit tests may
use loopback sockets and local databases, but every remote destination is
blocked below the SDK/HTTP-client layer.

Live integration access is deliberately awkward: it needs an explicit mode,
an exact destination allowlist, and separate mutation/database-write switches.
"""
from __future__ import annotations

import ipaddress
import os
from pathlib import Path
import re
import smtplib
import socket
import sys
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
import urllib.request


UNIT_MODE = "unit"
POSTGRES_READ_ONLY_MODE = "postgres-read-only"
INTEGRATION_MODE = "integration"
LOCAL_BENCHMARK_MODE = "local-benchmark"
VALID_MODES = {
    UNIT_MODE, POSTGRES_READ_ONLY_MODE, INTEGRATION_MODE,
    LOCAL_BENCHMARK_MODE,
}
AFFIRMATIVE = {"1", "true", "yes", "on"}
SAFE_HTTP_METHODS = {"GET", "HEAD", "OPTIONS"}

# Phase 4G is deliberately pinned to one control-plane-verified Neon target.
# These identifiers are metadata, not credentials. A recreated branch or
# endpoint must be re-verified and deliberately updated rather than silently
# accepted because its environment variable happens to look plausible.
BENCHMARK_BRANCH_NAME = "lms_ideal_test"
BENCHMARK_BRANCH_ID = "br-orange-shadow-abm8uwwe"
BENCHMARK_ENDPOINT_ID = "ep-dawn-block-ab5vob3x"
BENCHMARK_DATABASE_NAME = "neondb"
BENCHMARK_DIRECT_HOST = f"{BENCHMARK_ENDPOINT_ID}.eu-west-2.aws.neon.tech"
BENCHMARK_POOLED_HOST = f"{BENCHMARK_ENDPOINT_ID}-pooler.eu-west-2.aws.neon.tech"


class TestIsolationError(RuntimeError):
    """Raised before a test can reach an unauthorised remote destination."""


def is_test_process(argv=None, environ=None):
    argv = list(sys.argv if argv is None else argv)
    environ = os.environ if environ is None else environ
    names = {Path(str(value)).name.lower() for value in argv}
    return (
        "test" in argv
        or bool(names & {
            "pytest", "pytest.exe", "py.test", "py.test.exe",
            "unittest", "unittest.exe", "unittest.py",
        })
        or any(name.startswith("test_") and name.endswith(".py") for name in names)
        or "PYTEST_CURRENT_TEST" in environ
        or environ.get("LMS_TEST_ACTIVE", "").strip().lower() in AFFIRMATIVE
        or environ.get("RUN_APP_ON_TEST_BRANCH", "").strip().lower() in AFFIRMATIVE
    )


def test_mode(environ=None):
    environ = os.environ if environ is None else environ
    value = environ.get("LMS_TEST_MODE", UNIT_MODE).strip().lower() or UNIT_MODE
    if value not in VALID_MODES:
        raise TestIsolationError(
            "Invalid LMS_TEST_MODE; expected unit, local-benchmark, "
            "postgres-read-only, or integration."
        )
    return value


def _true(environ, key):
    return environ.get(key, "").strip().lower() in AFFIRMATIVE


def _host(value):
    text = str(value or "").strip().strip("[]")
    return text.casefold().rstrip(".")


def _local_host(value):
    host = _host(value)
    if host in {"", "localhost", "0.0.0.0", "::", "::1"} or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _allowlist(environ, mode):
    entries = set()
    if mode == POSTGRES_READ_ONLY_MODE:
        dsn = environ.get("LMS_BENCHMARK_READER_URL", "").strip()
        endpoint_id = environ.get("LMS_TEST_POSTGRES_ENDPOINT_ID", "").strip()
        branch_id = environ.get("LMS_TEST_POSTGRES_BRANCH_ID", "").strip()
        branch_name = environ.get("LMS_TEST_POSTGRES_BRANCH_NAME", "").strip()
        parsed = urlsplit(dsn)
        host = _host(parsed.hostname)
        if parsed.scheme not in {"postgres", "postgresql"}:
            raise TestIsolationError("The Benchmark Reader URL must be a PostgreSQL connection URL.")
        if not dsn or not host or not endpoint_id or not branch_id or not branch_name:
            raise TestIsolationError(
                "postgres-read-only mode requires the Benchmark Reader URL plus explicit endpoint, branch name, and branch ID."
            )
        if endpoint_id != BENCHMARK_ENDPOINT_ID or host not in {
            BENCHMARK_DIRECT_HOST, BENCHMARK_POOLED_HOST,
        }:
            raise TestIsolationError(
                "The Benchmark Reader URL does not match the authorised endpoint."
            )
        if branch_name != BENCHMARK_BRANCH_NAME or branch_id != BENCHMARK_BRANCH_ID:
            raise TestIsolationError(
                "The configured PostgreSQL branch is not the authorised benchmark branch."
            )
        if parsed.path.lstrip("/") != BENCHMARK_DATABASE_NAME:
            raise TestIsolationError(
                "The Benchmark Reader URL does not name the authorised database."
            )
        sslmode = dict(parse_qsl(parsed.query, keep_blank_values=True)).get("sslmode", "")
        if sslmode not in {"require", "verify-ca", "verify-full"}:
            raise TestIsolationError("The Benchmark Reader URL must require TLS.")
        if unquote(parsed.username or "") != "lms_benchmark_reader":
            raise TestIsolationError(
                "postgres-read-only mode requires the lms_benchmark_reader role."
            )
        entries.add((host, parsed.port or 5432))
        entries.add((BENCHMARK_DIRECT_HOST, parsed.port or 5432))
        entries.add((BENCHMARK_POOLED_HOST, parsed.port or 5432))
        return entries
    if mode != INTEGRATION_MODE:
        return entries
    raw = environ.get("LMS_TEST_INTEGRATION_ALLOW_HOSTS", "")
    for item in (part.strip() for part in raw.split(",")):
        if not item:
            continue
        if "*" in item or "/" in item or "@" in item:
            raise TestIsolationError("Integration destinations must be exact hosts, without wildcards or credentials.")
        if item.startswith("[") and "]:" in item:
            host, port = item[1:].split("]:", 1)
        elif item.count(":") == 1 and item.rsplit(":", 1)[1].isdigit():
            host, port = item.rsplit(":", 1)
        else:
            host, port = item, ""
        entries.add((_host(host), int(port) if port else None))
    if not entries:
        raise TestIsolationError(
            "integration mode requires a non-empty exact LMS_TEST_INTEGRATION_ALLOW_HOSTS allowlist."
        )
    return entries


def _destination(address):
    if isinstance(address, tuple):
        return _host(address[0]), int(address[1]) if len(address) > 1 and str(address[1]).isdigit() else None
    if isinstance(address, (str, bytes)):
        text = address.decode(errors="replace") if isinstance(address, bytes) else address
        if text.startswith(("/", "\\")) or text.startswith("\\\\.\\pipe\\"):
            return "", None
        return _host(text), None
    return "", None


def _safe_destination(host, port):
    return f"{host}:{port}" if port else host or "unknown destination"


class IsolationPolicy:
    def __init__(self, environ=None):
        self.environ = dict(os.environ if environ is None else environ)
        self.mode = test_mode(self.environ)
        self.allowed = _allowlist(self.environ, self.mode)
        self.external_mutations = _true(self.environ, "LMS_TEST_ALLOW_EXTERNAL_MUTATIONS")
        self.database_writes = _true(self.environ, "LMS_TEST_ALLOW_DATABASE_WRITES")

    def permits(self, host, port=None):
        if _local_host(host):
            return True
        return (host, port) in self.allowed or (host, None) in self.allowed

    def require_destination(self, host, port=None, *, client="network"):
        host = _host(host)
        if not self.permits(host, port):
            raise TestIsolationError(
                f"Blocked {client} connection in {self.mode} test mode: "
                f"{_safe_destination(host, port)}. Use a fake client or an explicitly allowlisted test mode."
            )

    def require_http(self, method, url, *, client):
        parsed = urlsplit(str(url))
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        self.require_destination(parsed.hostname or "", port, client=client)
        local_benchmark_request = (
            self.mode == LOCAL_BENCHMARK_MODE
            and _host(parsed.hostname) in {"localhost", "127.0.0.1", "::1"}
        )
        if (
            str(method).upper() not in SAFE_HTTP_METHODS
            and not self.external_mutations
            and not local_benchmark_request
        ):
            raise TestIsolationError(
                f"Blocked {client} mutation in {self.mode} test mode: "
                f"{_safe_destination(_host(parsed.hostname), port)}. "
                "Set the explicit external-mutation switch only for an approved integration test."
            )

    def require_database(self, host, port, options, database="", user=""):
        if self.mode == LOCAL_BENCHMARK_MODE:
            if _host(host) not in {"localhost", "127.0.0.1", "::1"}:
                raise TestIsolationError(
                    "local-benchmark mode requires an explicit loopback PostgreSQL host."
                )
            expected = urlsplit(
                self.environ.get("LMS_LOCAL_BENCHMARK_DATABASE_URL", "")
            ).path.lstrip("/")
            if not expected or str(database or "") != expected:
                raise TestIsolationError(
                    "local-benchmark mode requires the exact disposable database."
                )
        if self.mode == POSTGRES_READ_ONLY_MODE and not _host(host):
            raise TestIsolationError(
                "postgres-read-only mode requires an explicit authorised PostgreSQL host."
            )
        self.require_destination(host, port, client="PostgreSQL")
        if self.mode == POSTGRES_READ_ONLY_MODE and "default_transaction_read_only=on" not in options:
            raise TestIsolationError(
                "postgres-read-only mode requires default_transaction_read_only=on before connecting."
            )
        if self.mode == POSTGRES_READ_ONLY_MODE and str(database or "") != BENCHMARK_DATABASE_NAME:
            raise TestIsolationError(
                "postgres-read-only mode requires the authorised benchmark database."
            )
        if self.mode == POSTGRES_READ_ONLY_MODE and str(user or "") != "lms_benchmark_reader":
            raise TestIsolationError(
                "postgres-read-only mode requires the lms_benchmark_reader role."
            )
        if self.mode == INTEGRATION_MODE:
            if not self.database_writes:
                raise TestIsolationError(
                    "Remote PostgreSQL integration access requires LMS_TEST_ALLOW_DATABASE_WRITES=true."
                )
            if not (
                self.environ.get("LMS_TEST_POSTGRES_BRANCH_ID", "").strip()
                or self.environ.get("SECURITY_TEST_BRANCH_ID", "").strip()
            ):
                raise TestIsolationError(
                    "Writable PostgreSQL integration access requires an explicit expected Neon branch ID."
                )


_installed_policy = None
_originals = {}


def active_policy():
    return _installed_policy


def _remember(owner, name):
    key = (owner, name)
    if key not in _originals:
        _originals[key] = getattr(owner, name)
    return _originals[key]


def _database_call_target(args, kwargs, environ=None):
    environ = os.environ if environ is None else environ
    values = {}
    raw = args[0] if args and isinstance(args[0], str) else kwargs.get("conninfo", "")
    if raw:
        if raw.startswith(("postgres://", "postgresql://")):
            parsed = urlsplit(raw)
            query = dict(parse_qsl(parsed.query, keep_blank_values=True))
            values.update(
                host=parsed.hostname,
                port=parsed.port or 5432,
                dbname=parsed.path.lstrip("/"),
                options=query.get("options", ""),
                user=unquote(parsed.username or ""),
            )
        else:
            try:
                from psycopg.conninfo import conninfo_to_dict
                values.update(conninfo_to_dict(raw))
            except Exception:
                match = re.search(r"(?:^|\s)host=([^\s]+)", raw)
                if match:
                    values["host"] = match.group(1)
    values.update({key: value for key, value in kwargs.items() if key in {"host", "port", "dbname", "database", "options", "user"}})
    if not values.get("host"):
        values["host"] = environ.get("PGHOST", "")
    if not values.get("port"):
        values["port"] = environ.get("PGPORT", "")
    if not values.get("dbname") and not values.get("database"):
        values["dbname"] = environ.get("PGDATABASE", "")
    if not values.get("options"):
        values["options"] = environ.get("PGOPTIONS", "")
    if not values.get("user"):
        values["user"] = environ.get("PGUSER", "")
    if not values.get("host") and (values.get("service") or environ.get("PGSERVICE")):
        raise TestIsolationError(
            "PostgreSQL service definitions are not allowed because their destination cannot be verified."
        )
    try:
        port = int(values.get("port") or 5432)
    except (TypeError, ValueError) as exc:
        raise TestIsolationError("PostgreSQL port must be explicit and numeric.") from exc
    return (
        _host(values.get("host")), port,
        str(values.get("dbname") or values.get("database") or ""),
        str(values.get("options") or ""),
        str(values.get("user") or ""),
    )


def verify_neon_connection(connection, policy):
    expected_branch = (
        policy.environ.get("LMS_TEST_POSTGRES_BRANCH_ID", "").strip()
        or policy.environ.get("SECURITY_TEST_BRANCH_ID", "").strip()
    )
    expected_database = urlsplit(
        policy.environ.get("LMS_BENCHMARK_READER_URL", "")
    ).path.lstrip("/")
    with connection.cursor() as cursor:
        cursor.execute(
            "select current_database(), current_user, current_setting(%s), current_setting(%s, true)",
            ["transaction_read_only", "neon.branch_id"],
        )
        database, role, read_only, branch_id = cursor.fetchone()
    # A raw psycopg connection defaults to autocommit=False. The verification
    # SELECT must not leave it INTRANS: Django still has to establish its own
    # autocommit state immediately after get_new_connection() returns.
    if not getattr(connection, "autocommit", False):
        connection.rollback()
    if policy.mode == POSTGRES_READ_ONLY_MODE and read_only != "on":
        connection.close()
        raise TestIsolationError("The authorised PostgreSQL test connection is not read-only.")
    if expected_database and database != expected_database:
        connection.close()
        raise TestIsolationError("The authorised PostgreSQL test connection reached an unexpected database.")
    if expected_branch and branch_id != expected_branch:
        connection.close()
        raise TestIsolationError("The authorised PostgreSQL test connection reached an unexpected Neon branch.")
    if policy.mode == POSTGRES_READ_ONLY_MODE and role != "lms_benchmark_reader":
        connection.close()
        raise TestIsolationError("The authorised PostgreSQL connection did not use the Benchmark Reader role.")


def verify_local_benchmark_connection(connection, policy):
    """Prove a connected benchmark session still targets the disposable DB."""
    expected_database = urlsplit(
        policy.environ.get("LMS_LOCAL_BENCHMARK_DATABASE_URL", "")
    ).path.lstrip("/")
    with connection.cursor() as cursor:
        cursor.execute(
            "select current_database(), coalesce(inet_server_addr()::text, 'local-socket')"
        )
        database, server_address = cursor.fetchone()
    if not getattr(connection, "autocommit", False):
        connection.rollback()
    if database != expected_database or server_address not in {
        "127.0.0.1", "::1", "local-socket",
    }:
        connection.close()
        raise TestIsolationError(
            "The local benchmark connection failed runtime identity verification."
        )


def install_test_isolation(environ=None):
    """Install the process-wide guard once and return its immutable policy."""
    global _installed_policy
    if _installed_policy is not None:
        return _installed_policy
    policy = IsolationPolicy(environ)
    if policy.mode == UNIT_MODE:
        # The Graph mail adapter checks this at send time. Keep its documented
        # kill switch off even for unittest entry points that bypass Django's
        # custom test runner; the network guard remains the final backstop.
        os.environ["AZURE_MAIL_ENABLED"] = "false"

    original_getaddrinfo = _remember(socket, "getaddrinfo")
    def guarded_getaddrinfo(host, port, *args, **kwargs):
        policy.require_destination(host, int(port) if str(port).isdigit() else None, client="DNS/network")
        return original_getaddrinfo(host, port, *args, **kwargs)
    socket.getaddrinfo = guarded_getaddrinfo

    original_connect = _remember(socket.socket, "connect")
    def guarded_connect(instance, address):
        host, port = _destination(address)
        policy.require_destination(host, port, client="socket")
        return original_connect(instance, address)
    socket.socket.connect = guarded_connect

    original_connect_ex = _remember(socket.socket, "connect_ex")
    def guarded_connect_ex(instance, address):
        host, port = _destination(address)
        policy.require_destination(host, port, client="socket")
        return original_connect_ex(instance, address)
    socket.socket.connect_ex = guarded_connect_ex

    original_smtp = _remember(smtplib.SMTP, "connect")
    def guarded_smtp(instance, host="localhost", port=0, source_address=None):
        policy.require_destination(host, int(port or 25), client="SMTP")
        if not _local_host(host) and not policy.external_mutations:
            raise TestIsolationError(
                f"Blocked SMTP delivery in {policy.mode} test mode: {_safe_destination(_host(host), int(port or 25))}."
            )
        return original_smtp(instance, host, port, source_address)
    smtplib.SMTP.connect = guarded_smtp

    try:
        import requests
        original_requests = _remember(requests.sessions.Session, "request")
        def guarded_requests(instance, method, url, *args, **kwargs):
            policy.require_http(method, url, client="requests")
            return original_requests(instance, method, url, *args, **kwargs)
        requests.sessions.Session.request = guarded_requests
    except ImportError:
        pass

    try:
        import httpx
        original_httpx = _remember(httpx.Client, "request")
        def guarded_httpx(instance, method, url, *args, **kwargs):
            policy.require_http(method, url, client="httpx")
            return original_httpx(instance, method, url, *args, **kwargs)
        httpx.Client.request = guarded_httpx
        original_async_httpx = _remember(httpx.AsyncClient, "request")
        async def guarded_async_httpx(instance, method, url, *args, **kwargs):
            policy.require_http(method, url, client="httpx async")
            return await original_async_httpx(instance, method, url, *args, **kwargs)
        httpx.AsyncClient.request = guarded_async_httpx
    except ImportError:
        pass

    original_urlopen = _remember(urllib.request, "urlopen")
    def guarded_urlopen(url, *args, **kwargs):
        target = url.full_url if isinstance(url, urllib.request.Request) else url
        method = url.get_method() if isinstance(url, urllib.request.Request) else "GET"
        policy.require_http(method, target, client="urllib")
        return original_urlopen(url, *args, **kwargs)
    urllib.request.urlopen = guarded_urlopen

    try:
        import psycopg
        original_psycopg = _remember(psycopg, "connect")
        def guarded_psycopg(*args, **kwargs):
            host, port, database, options, user = _database_call_target(args, kwargs, policy.environ)
            policy.require_database(host, port, options, database, user)
            connection = original_psycopg(*args, **kwargs)
            if policy.mode in {POSTGRES_READ_ONLY_MODE, INTEGRATION_MODE} and not _local_host(host):
                verify_neon_connection(connection, policy)
            elif policy.mode == LOCAL_BENCHMARK_MODE:
                verify_local_benchmark_connection(connection, policy)
            return connection
        psycopg.connect = guarded_psycopg

        # ``psycopg.connect`` is only an alias of this classmethod. Django's
        # pool and direct callers can retain/use the classmethod independently,
        # so both sync entry points need the same guard.
        original_connection_connect = _remember(psycopg.Connection, "connect")
        def guarded_connection_connect(cls, *args, **kwargs):
            host, port, database, options, user = _database_call_target(args, kwargs, policy.environ)
            policy.require_database(host, port, options, database, user)
            connection = original_connection_connect(*args, **kwargs)
            if policy.mode in {POSTGRES_READ_ONLY_MODE, INTEGRATION_MODE} and not _local_host(host):
                verify_neon_connection(connection, policy)
            elif policy.mode == LOCAL_BENCHMARK_MODE:
                verify_local_benchmark_connection(connection, policy)
            return connection
        psycopg.Connection.connect = classmethod(guarded_connection_connect)

        original_async_connect = _remember(psycopg.AsyncConnection, "connect")
        async def guarded_async_connect(cls, *args, **kwargs):
            host, port, database, options, user = _database_call_target(args, kwargs, policy.environ)
            policy.require_database(host, port, options, database, user)
            connection = await original_async_connect(*args, **kwargs)
            if policy.mode in {POSTGRES_READ_ONLY_MODE, INTEGRATION_MODE} and not _local_host(host):
                expected_branch = policy.environ.get("LMS_TEST_POSTGRES_BRANCH_ID", "").strip()
                expected_database = urlsplit(
                    policy.environ.get("LMS_BENCHMARK_READER_URL", "")
                ).path.lstrip("/")
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "select current_database(), current_user, current_setting(%s), current_setting(%s, true)",
                        ["transaction_read_only", "neon.branch_id"],
                    )
                    actual_database, actual_role, read_only, branch_id = await cursor.fetchone()
                if not getattr(connection, "autocommit", False):
                    await connection.rollback()
                if (
                    policy.mode == POSTGRES_READ_ONLY_MODE and read_only != "on"
                    or policy.mode == POSTGRES_READ_ONLY_MODE and actual_role != "lms_benchmark_reader"
                    or expected_database and actual_database != expected_database
                    or expected_branch and branch_id != expected_branch
                ):
                    await connection.close()
                    raise TestIsolationError(
                        "The authorised async PostgreSQL connection failed runtime identity verification."
                    )
            elif policy.mode == LOCAL_BENCHMARK_MODE:
                expected_database = urlsplit(
                    policy.environ.get("LMS_LOCAL_BENCHMARK_DATABASE_URL", "")
                ).path.lstrip("/")
                async with connection.cursor() as cursor:
                    await cursor.execute(
                        "select current_database(), coalesce(inet_server_addr()::text, 'local-socket')"
                    )
                    actual_database, server_address = await cursor.fetchone()
                if not getattr(connection, "autocommit", False):
                    await connection.rollback()
                if actual_database != expected_database or server_address not in {
                    "127.0.0.1", "::1", "local-socket",
                }:
                    await connection.close()
                    raise TestIsolationError(
                        "The local async PostgreSQL connection failed runtime identity verification."
                    )
            return connection
        psycopg.AsyncConnection.connect = classmethod(guarded_async_connect)
    except ImportError:
        pass

    # Not installed in the current environment, but fail closed if a future
    # dependency brings psycopg2 back without updating this boundary.
    try:
        import psycopg2
        original_psycopg2 = _remember(psycopg2, "connect")
        def guarded_psycopg2(*args, **kwargs):
            host, port, database, options, user = _database_call_target(args, kwargs, policy.environ)
            policy.require_database(host, port, options, database, user)
            connection = original_psycopg2(*args, **kwargs)
            if policy.mode in {POSTGRES_READ_ONLY_MODE, INTEGRATION_MODE} and not _local_host(host):
                verify_neon_connection(connection, policy)
            elif policy.mode == LOCAL_BENCHMARK_MODE:
                verify_local_benchmark_connection(connection, policy)
            return connection
        psycopg2.connect = guarded_psycopg2
    except ImportError:
        pass

    _installed_policy = policy
    return policy


def configure_read_only_database_url(dsn):
    """Return the approved DSN with server-enforced read-only transactions."""
    policy = IsolationPolicy()
    if policy.mode != POSTGRES_READ_ONLY_MODE:
        raise TestIsolationError("The Benchmark Reader URL is available only in postgres-read-only mode here.")
    approved = policy.environ.get("LMS_BENCHMARK_READER_URL", "").strip()
    if dsn.strip() != approved:
        raise TestIsolationError("The requested database is not the approved Benchmark Reader target.")
    parsed = urlsplit(approved)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing = query.get("options", "")
    option = "-c default_transaction_read_only=on"
    query["options"] = f"{existing} {option}".strip() if option not in existing else existing
    # libpq URI options require percent-encoded spaces. ``urlencode`` defaults
    # to ``+`` (HTML form encoding), which libpq treats as part of the setting
    # name rather than as whitespace.
    encoded = urlencode(query, quote_via=quote)
    # Benchmark Django through the direct compute endpoint. The pool remains
    # recognised by the deny-list guard only so an input copied from Neon can
    # be normalised without confusing it for a different branch.
    netloc = parsed.netloc.replace(BENCHMARK_POOLED_HOST, BENCHMARK_DIRECT_HOST)
    return urlunsplit((parsed.scheme, netloc, parsed.path, encoded, parsed.fragment))


def assert_unit_database_aliases(databases):
    """Refuse any remote Django database alias in default unit-test mode."""
    for alias, config in databases.items():
        engine = str(config.get("ENGINE") or "")
        host = _host(config.get("HOST"))
        if engine.endswith("sqlite3") or _local_host(host):
            continue
        raise TestIsolationError(
            f"Unit test database alias {alias!r} targets a remote host; use SQLite, a verified local database, or an explicit authorised mode."
        )

