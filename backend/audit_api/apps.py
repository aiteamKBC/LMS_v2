from django.apps import AppConfig


class AuditApiConfig(AppConfig):
    name = "audit_api"

    def ready(self):
        # Records the auditor's corrections in the Audit Trail. Raw tables, so
        # nothing is connected to a signal here -- this only declares what the
        # write paths in `audit_trail` may keep. Never fails a start-up: it logs
        # and moves on.
        from system_audit.records import register_audit_records
        register_audit_records()
