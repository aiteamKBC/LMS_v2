"""No import-time framework startup or connection. Called only by run.py."""
import os
from pathlib import Path
import sys
from .safety import Refused, Target, application_lists, audit_event, check_sql, no_command

ACTIVE = False
QUARANTINED = False


def quarantine():
    global QUARANTINED
    QUARANTINED = True


def boot(approval, credential):
    global ACTIVE
    target = Target.parse(approval)
    if ACTIVE or 'django.conf' in sys.modules or 'config.settings' in sys.modules:
        raise Refused('Use a fresh process')
    if set(credential) != {'password'} or not isinstance(credential['password'], str) or not credential['password']:
        raise Refused('Private stdin must contain only the disposable password')
    # Drop inherited endpoint/key configuration without reading any env file.
    system = {key: value for key, value in os.environ.items()
              if key.upper() in {'SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP'}}
    os.environ.clear()
    os.environ.update(system)
    os.environ.update(AZURE_MAIL_ENABLED='false', CURRICULUM_WARM='0',
                      LEARNER_API_REQUIRE_AUTH='1', ENROLMENT_API_REQUIRE_AUTH='1')
    sys.dont_write_bytecode = True
    sys.addaudithook(audit_event)
    import psycopg
    raw_connect = psycopg.connect
    writable = False

    class GuardedCursor(psycopg.Cursor):
        def execute(self, query, params=None, **kwargs):
            rendered = query.as_string(self.connection) if hasattr(query, 'as_string') else query
            check_sql(rendered, writable)
            return super().execute(query, params, **kwargs)

        def executemany(self, query, params_seq, **kwargs):
            rendered = query.as_string(self.connection) if hasattr(query, 'as_string') else query
            check_sql(rendered, writable)
            return super().executemany(query, params_seq, **kwargs)

        def copy(self, *args, **kwargs):
            raise Refused('COPY forbidden')

    def connect(conninfo='', **kwargs):
        if conninfo:
            raise Refused('DSN strings forbidden; use approved explicit parameters')
        target.connection(kwargs)
        if set(kwargs) - {'host', 'hostaddr', 'port', 'dbname', 'user', 'password', 'sslmode',
                          'connect_timeout', 'options', 'cursor_factory', 'context', 'autocommit',
                          'prepare_threshold', 'client_encoding'}:
            raise Refused('Unreviewed libpq connection option')
        if kwargs.get('password') != credential['password']:
            raise Refused('Unexpected credentials')
        kwargs.update(sslmode='verify-full', connect_timeout=10, client_encoding='UTF8',
                      options='-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000',
                      cursor_factory=GuardedCursor)
        conn = raw_connect(**kwargs)
        try:
            # Raw cursor used only for this fixed read-only verification and SET.
            with psycopg.Cursor(conn) as cur:
                cur.execute('SELECT current_database(),current_user,current_setting(%s,true),'
                            'current_setting(%s),project_id,parent_id,host,run_id,approval_id '
                            'FROM public.f01_f02_test_target', ['neon.branch_id', 'transaction_read_only'])
                rows = cur.fetchall()
                if len(rows) != 1:
                    raise Refused('Exactly one independently provisioned approval sentinel required')
                target.verify(rows[0])
                cur.execute('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')
                if cur.fetchone() != (False, False, False):
                    raise Refused('Privileged role forbidden')
                cur.execute("SELECT has_database_privilege(current_user,current_database(),'CREATE'),"
                            "EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' "
                            "AND nspname <> 'information_schema' AND has_schema_privilege(current_user,oid,'CREATE'))")
                if cur.fetchone() != (False, False):
                    raise Refused('DDL-capable database role forbidden')
                cur.execute("SELECT has_table_privilege(current_user,'public.f01_f02_test_target',"
                            "'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),"
                            "EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                            "WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' "
                            "AND pg_has_role(current_user,c.relowner,'USAGE'))")
                if cur.fetchone() != (False, False):
                    raise Refused('Mutable approval sentinel or owned relations forbidden')
            conn.rollback()
            with psycopg.Cursor(conn) as cur:
                cur.execute('SET default_transaction_read_only=off')
            conn.commit()
            return conn
        except BaseException:
            conn.close()
            raise Refused('Connection verification failed') from None

    # Django and direct concurrency connections must pass the same gate.
    psycopg.connect = connect
    psycopg.Connection.connect = staticmethod(connect)
    psycopg.AsyncConnection.connect = no_command
    params = dict(host=target.host, hostaddr=target.address, port=target.port,
                  dbname=target.database, user=target.user, password=credential['password'])
    with connect(**params) as conn:
        # Require a preprovisioned, sanitized EMPTY application database. No
        # inherited learners/history are permitted; setup never deletes data.
        with conn.cursor() as cur:
            cur.execute("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN "
                        "('pg_catalog','information_schema') ORDER BY schemaname,tablename")
            for schema, table in cur.fetchall():
                if (schema, table) in {('public', 'f01_f02_test_target'), ('public', 'django_migrations'),
                                       ('public', 'django_content_type'), ('public', 'auth_permission')}:
                    continue
                identifier = psycopg.sql.Identifier(schema, table)
                cur.execute(psycopg.sql.SQL('SELECT 1 FROM {} LIMIT 1').format(identifier))
                if cur.fetchone():
                    raise Refused('Target contains application data; no cleanup attempted')

    from django.conf import settings
    from django.core import management
    management.call_command = no_command
    management.execute_from_command_line = no_command
    from django.db.backends.base.creation import BaseDatabaseCreation
    BaseDatabaseCreation.create_test_db = no_command
    BaseDatabaseCreation.destroy_test_db = no_command
    from django.db.migrations.executor import MigrationExecutor
    MigrationExecutor.migrate = no_command
    backend = Path(__file__).resolve().parents[1]
    lists = application_lists(backend / 'config/settings.py')
    db = {'ENGINE': 'django.db.backends.postgresql', 'NAME': target.database,
          'USER': target.user, 'PASSWORD': credential['password'], 'HOST': target.host,
          'PORT': target.port, 'CONN_MAX_AGE': 0,
          'DISABLE_SERVER_SIDE_CURSORS': True,
          'OPTIONS': {'hostaddr': target.address, 'sslmode': 'verify-full'}}
    settings.configure(**lists, SECRET_KEY='synthetic-f01-f02-only', DEBUG=False,
        ROOT_URLCONF='config.urls', ALLOWED_HOSTS=['testserver', 'localhost'],
        DATABASES={'default': dict(db), 'enrolment': dict(db)},
        DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'],
        USE_TZ=True, TIME_ZONE='Europe/London', DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': target.run_id}},
        CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}},
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        STORAGES={'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
                  'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'}},
        SESSION_ENGINE='django.contrib.sessions.backends.signed_cookies',
        STATIC_URL='/static/', MEDIA_URL='/synthetic-media/',
        READ_MODEL_OUTBOX_ENABLED=False, READ_MODEL_DUAL_WRITE_ENABLED=False,
        COACH_DASHBOARD_BACKGROUND_REFRESH_ENABLED=False,
        CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP=False,
        TEMPLATES=[{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'APP_DIRS': True}],
        PASSWORD_HASHERS=['django.contrib.auth.hashers.PBKDF2PasswordHasher'])
    import django
    # Actual AppConfig code recognizes 'test' and does not warm serving caches.
    sys.argv = [sys.argv[0], 'test']
    django.setup()
    from django.db import connections
    if set(connections) != {'default', 'enrolment'}:
        raise Refused('Unexpected database alias')
    for alias in connections:
        with connections[alias].cursor() as cur:
            cur.execute('SELECT current_database(),current_user')
            if cur.fetchone() != (target.database, target.user):
                raise Refused('Alias identity drift')
    writable = True
    ACTIVE = True
    return target


def require_active():
    if not ACTIVE or QUARANTINED:
        raise Refused('Fixtures/tests require the explicitly authorized bootstrap')
