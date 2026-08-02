"""Database router: send Neon-backed apps' models to the `enrolment` DB.

`learner_api` and `enrolment_api` both map unmanaged tables that live in the Neon
`enrolment` schema. Everything else (auth, sessions, admin, migrations) stays on
`default` (SQLite). Those tables are created outside Django — by the app's
`apply_*` management commands — so migrations never touch them.
"""

APP_LABELS = frozenset({"learner_api", "enrolment_api"})
ENROLMENT_DB = "enrolment"


class EnrolmentRouter:
    def db_for_read(self, model, **hints):
        if model._meta.app_label in APP_LABELS:
            return ENROLMENT_DB
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label in APP_LABELS:
            return ENROLMENT_DB
        return None

    def allow_relation(self, obj1, obj2, **hints):
        # Don't assert cross-database relations; leave the decision open.
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        # These apps' models are unmanaged (managed=False) — never migrate them.
        if app_label in APP_LABELS:
            return False
        # Keep every other app off the Neon database entirely.
        if db == ENROLMENT_DB:
            return False
        return None
