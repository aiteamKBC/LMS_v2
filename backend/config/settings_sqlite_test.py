"""Local-only settings for running curriculum_api tests on SQLite.

curriculum_api's migration graph manipulates PostgreSQL schemas and externally
owned tables, which SQLite cannot execute (0058 queries ``live_sessions``). The
app's models are all ``managed = False`` and the suites build their own tables,
so nulling the app's migrations here costs nothing and lets the tests run
locally. Not imported by production.
"""

import os

# Selecting this module must be sufficient to isolate tests, even when the
# application environment contains PostgreSQL credentials.
os.environ['DJANGO_USE_SQLITE'] = 'true'

from .settings import *  # noqa: F401,F403
from .settings import DATABASES, MIGRATION_MODULES

if any(config.get('ENGINE') != 'django.db.backends.sqlite3' for config in DATABASES.values()):
    raise RuntimeError('settings_sqlite_test only permits SQLite database connections.')

MIGRATION_MODULES = {**MIGRATION_MODULES, 'curriculum_api': None}

# ``learner_api``/``login`` (and anything else routed by
# learner_api.routers.EnrolmentRouter) reads and writes via the 'enrolment'
# connection alias. Under DJANGO_USE_SQLITE there is no 'enrolment' entry in
# DATABASES at all (settings.py only adds it when not USE_SQLITE_FOR_TESTS),
# so any test that actually exercises a router-routed query fails with
# ConnectionDoesNotExist for alias 'enrolment' before it gets anywhere near
# its own assertions -- including the Django system check, which blocks the
# whole suite from running.
#
# This just gives 'enrolment' a reachable sqlite connection of its own so
# that failure mode goes away. It is deliberately NOT pointed at the same
# physical database as 'default' (e.g. via a shared-cache in-memory URI or
# TEST['MIRROR']): EnrolmentRouter.allow_migrate refuses every one of
# learner_api/enrolment_api/login's own models on every database (they are
# all managed=False, see routers.py), so their tables are never created by
# `migrate` in the first place, on 'default' or anywhere else -- sharing a
# database with 'default' would not have made them visible. Those tables
# only ever exist via the Postgres-only apply_* commands
# (login.test_runner.EnrolmentTestRunner), which sqlite cannot run (see
# learner_api.checks). A test that touches one of those tables still fails
# here, with "no such table", same as it would with no 'enrolment' alias
# configured at all -- just without also taking down every other test in the
# same run via a hard ConnectionDoesNotExist/system-check crash. Making that
# class of test genuinely pass under sqlite would mean re-implementing the
# apply_* DDL for sqlite, which is a much larger, separate piece of work (see
# the Phase 0 report) and is out of scope here.
if DATABASES.get('default', {}).get('ENGINE', '').endswith('sqlite3'):
    DATABASES['enrolment'] = {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
