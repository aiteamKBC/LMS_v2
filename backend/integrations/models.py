from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


def _table_name(test_name: str, production_name: str) -> str:
    """Use plain names in SQLite tests and the dedicated Postgres schema live."""
    return test_name if getattr(settings, "INTEGRATIONS_TEST_MODE", False) else production_name


class IntegrationTenant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_key = models.CharField(max_length=120, unique=True)
    display_name = models.CharField(max_length=255)
    tenant_kind = models.CharField(max_length=32, default="employer")
    employer_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    retention_anchor = models.DateField(null=True, blank=True)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_tenants", 'integrations"."integration_tenants')


class IntegrationConnection(models.Model):
    STATUS_CHOICES = [(value, value.replace("_", " ").title()) for value in ("pending", "active", "attention", "disabled")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    provider = models.CharField(max_length=64, default="breathe")
    external_account_id = models.CharField(max_length=255)
    secret_ref = models.CharField(max_length=255)
    base_url = models.URLField(max_length=500, default="https://api.sandbox.breathehr.info")
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="pending", db_index=True)
    enabled_features = models.JSONField(default=list)
    last_verified_at = models.DateTimeField(null=True, blank=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_connections", 'integrations"."integration_connections')
        constraints = [
            models.UniqueConstraint(fields=("provider", "external_account_id"), name="integration_provider_account_uniq"),
        ]


class ExternalPersonLink(models.Model):
    STATUS_CHOICES = [(value, value.replace("_", " ").title()) for value in ("pending", "approved", "rejected", "inactive")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    external_employee_id = models.CharField(max_length=255)
    external_email = models.EmailField(blank=True, default="")
    display_name = models.CharField(max_length=255, blank=True, default="")
    job_title = models.CharField(max_length=255, blank=True, default="")
    department_external_id = models.CharField(max_length=255, blank=True, default="")
    department_name = models.CharField(max_length=255, blank=True, default="")
    manager_external_id = models.CharField(max_length=255, blank=True, default="")
    employment_status = models.CharField(max_length=64, blank=True, default="")
    employment_start_date = models.DateField(null=True, blank=True)
    contracted_hours = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    working_pattern = models.JSONField(default=dict)
    lms_account_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    mapping_status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="pending", db_index=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    source_updated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_person_links", 'integrations"."external_person_links')
        constraints = [
            models.UniqueConstraint(fields=("connection_id", "external_employee_id"), name="integration_person_connection_employee_uniq"),
        ]


class DepartmentMapping(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    external_department_id = models.CharField(max_length=255)
    external_name = models.CharField(max_length=255, blank=True, default="")
    lms_department_id = models.BigIntegerField(null=True, blank=True)
    status = models.CharField(max_length=24, default="pending", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_department_mappings", 'integrations"."department_mappings')
        constraints = [
            models.UniqueConstraint(fields=("connection_id", "external_department_id"), name="integration_department_connection_external_uniq"),
        ]


class ManagerRelationship(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    employee_link_id = models.UUIDField(db_index=True)
    manager_external_id = models.CharField(max_length=255)
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_manager_relationships", 'integrations"."manager_relationships')


class ManagerSignatoryGrant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    login_account_id = models.BigIntegerField(db_index=True)
    external_manager_id = models.CharField(max_length=255, blank=True, default="")
    granted_by = models.BigIntegerField(null=True, blank=True)
    can_sign = models.BooleanField(default=False)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_signatory_grants", 'integrations"."manager_signatory_grants')


class AvailabilityBlock(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    external_person_id = models.CharField(max_length=255, db_index=True)
    block_type = models.CharField(max_length=32, db_index=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    timezone = models.CharField(max_length=80, default="Europe/London")
    reason_category = models.CharField(max_length=64, blank=True, default="")
    source_ref = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_availability_blocks", 'integrations"."availability_blocks')
        constraints = [
            models.UniqueConstraint(fields=("connection_id", "source_ref"), name="integration_availability_connection_source_uniq"),
        ]


class SchedulingConflict(models.Model):
    STATUS_CHOICES = [(value, value.replace("_", " ").title()) for value in ("pending", "reviewed", "resolved", "dismissed")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    external_person_id = models.CharField(max_length=255, db_index=True)
    session_ref = models.CharField(max_length=255)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    block_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="pending", db_index=True)
    proposed_slots = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_scheduling_conflicts", 'integrations"."scheduling_conflicts')
        constraints = [
            models.UniqueConstraint(fields=("connection_id", "session_ref"), name="integration_conflict_connection_session_uniq"),
        ]


class ExternalTrainingRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    external_training_id = models.CharField(max_length=255)
    external_employee_id = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    category = models.CharField(max_length=255, blank=True, default="")
    completion_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=64, blank=True, default="")
    certificate_ref = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_training_records", 'integrations"."external_training_records')
        constraints = [
            models.UniqueConstraint(fields=("connection_id", "external_training_id"), name="integration_training_connection_external_uniq"),
        ]


class IntegrationSyncRun(models.Model):
    STATUS_CHOICES = [(value, value.replace("_", " ").title()) for value in ("queued", "running", "completed", "failed", "reconciliation")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant_id = models.UUIDField(db_index=True)
    connection_id = models.UUIDField(db_index=True)
    resources = models.JSONField(default=list)
    dry_run = models.BooleanField(default=False)
    idempotency_key = models.CharField(max_length=255)
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default="queued", db_index=True)
    counts = models.JSONField(default=dict)
    cursor = models.JSONField(default=dict)
    error_code = models.CharField(max_length=64, blank=True, default="")
    error_message = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_sync_runs", 'integrations"."integration_sync_runs')
        constraints = [
            models.UniqueConstraint(fields=("connection_id", "idempotency_key"), name="integration_sync_connection_idempotency_uniq"),
        ]


class IntegrationAuditLog(models.Model):
    id = models.BigAutoField(primary_key=True)
    tenant_id = models.UUIDField(db_index=True)
    actor_type = models.CharField(max_length=32)
    actor_id = models.BigIntegerField(null=True, blank=True)
    action = models.CharField(max_length=120)
    resource_ref = models.CharField(max_length=255, blank=True, default="")
    outcome = models.CharField(max_length=32, default="success")
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = _table_name("integrations_test_audit_logs", 'integrations"."integration_audit_logs')
