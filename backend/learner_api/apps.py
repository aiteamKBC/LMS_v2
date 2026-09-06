from django.apps import AppConfig


class LearnerApiConfig(AppConfig):
    name = 'learner_api'

    def ready(self):
        # psycopg3 reads `json` columns as dicts, but Django only text-loads
        # `jsonb`, so JSONField 500s on `json` columns (SECURITY_AUDIT.md A22).
        # Register a text loader for both, before any connection is used.
        from .pg_json_compat import register_json_text_loaders
        register_json_text_loaders()

        # Registers the two-database consistency checks (see checks.py and
        # ENROLMENT_GAP_ANALYSIS.md 7.2). Import for the @register side effect.
        from . import checks  # noqa: F401
