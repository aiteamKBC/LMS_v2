from django.apps import AppConfig


class LearnerApiConfig(AppConfig):
    name = 'learner_api'

    def ready(self):
        # Registers the two-database consistency checks (see checks.py and
        # ENROLMENT_GAP_ANALYSIS.md 7.2). Import for the @register side effect.
        from . import checks  # noqa: F401
