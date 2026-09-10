"""Local-only settings for running curriculum_api tests on SQLite.

curriculum_api's migration graph manipulates PostgreSQL schemas and externally
owned tables, which SQLite cannot execute (0058 queries ``live_sessions``). The
app's models are all ``managed = False`` and the suites build their own tables,
so nulling the app's migrations here costs nothing and lets the tests run
locally. Not imported by production.
"""

from .settings import *  # noqa: F401,F403
from .settings import MIGRATION_MODULES

MIGRATION_MODULES = {**MIGRATION_MODULES, 'curriculum_api': None}
