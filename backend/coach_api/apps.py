from django.apps import AppConfig


class CoachApiConfig(AppConfig):
    name = 'coach_api'

    def ready(self):
        # Records coaching meetings and absence reports in the Audit Trail.
        # Here rather than in system_audit because the models have to be loaded
        # before their signals can be connected, and this is the app that owns
        # them. Never fails a start-up: it logs and moves on.
        from system_audit.records import register_coach_records
        register_coach_records()
