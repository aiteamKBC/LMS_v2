"""Database router: send the `learner_api` app's models to the Neon `enrolment` DB.

Everything else (auth, sessions, admin, migrations) stays on `default` (SQLite).
The enrolment table is managed outside Django, so migrations never touch it.
"""

APP_LABEL = "learner_api"
ENROLMENT_DB = "enrolment"


class EnrolmentRouter:
    def db_for_read(self, model, **hints):
        if model._meta.app_label == APP_LABEL:
            return ENROLMENT_DB
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label == APP_LABEL:
            return ENROLMENT_DB
        return None

    def allow_relation(self, obj1, obj2, **hints):
        # Don't assert cross-database relations; leave the decision open.
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        # learner_api models are unmanaged (managed=False) — never migrate them.
        if app_label == APP_LABEL:
            return False
        # Keep every other app off the Neon database entirely.
        if db == ENROLMENT_DB:
            return False
        return None
