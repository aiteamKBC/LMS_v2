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
from .settings import MIGRATION_MODULES

if any(config.get('ENGINE') != 'django.db.backends.sqlite3' for config in DATABASES.values()):
    raise RuntimeError('settings_sqlite_test only permits SQLite database connections.')

MIGRATION_MODULES = {**MIGRATION_MODULES, 'curriculum_api': None}
