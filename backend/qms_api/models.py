import uuid

from django.db import models


class DeepDiveRecord(models.Model):
    """A normalized learner row imported from the Deep Dive workbook.

    This is deliberately separate from the LMS learner tables: the workbook
    contains operational planning fields that are not authoritative LMS
    fields (for example planned Gateway/EPA dates). ``lms_learner_id`` is an
    optional match, never a foreign key across the enrolment database.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    identity_key = models.CharField(max_length=255, unique=True)
    source_file_name = models.CharField(max_length=255, blank=True)
    source_file_hash = models.CharField(max_length=64, blank=True)
    source_sheet = models.CharField(max_length=128, blank=True)
    source_row = models.PositiveIntegerField(null=True, blank=True)

    lms_learner_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    first_name = models.CharField(max_length=255, blank=True)
    surname = models.CharField(max_length=255, blank=True)
    full_name = models.CharField(max_length=511, blank=True, db_index=True)
    date_of_birth = models.CharField(max_length=32, blank=True)
    uln = models.CharField(max_length=64, blank=True, db_index=True)
    qualification = models.CharField(max_length=255, blank=True)
    level = models.CharField(max_length=64, blank=True)
    start_date = models.CharField(max_length=32, blank=True)
    practical_end_date = models.CharField(max_length=32, blank=True)
    apprenticeship_end_date = models.CharField(max_length=32, blank=True)
    planned_gateway_date = models.CharField(max_length=32, blank=True)
    planned_epa_date = models.CharField(max_length=32, blank=True)
    observer = models.CharField(max_length=255, blank=True)
    reviewed_by = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    operational_overrides = models.JSONField(default=dict, blank=True)
    raw = models.JSONField(default=dict, blank=True)

    version = models.PositiveIntegerField(default=1)
    updated_by = models.CharField(max_length=255, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "qms_deep_dive_records"
        ordering = ("full_name", "id")
        indexes = [
            models.Index(fields=("source_sheet", "source_row")),
            models.Index(fields=("qualification", "level")),
        ]


class DeepDiveSyncRun(models.Model):
    """One controlled monthly batch copied from enrolment.Created_users."""

    month_key = models.CharField(max_length=7, unique=True)
    source = models.CharField(max_length=64, default="enrolment.Created_users")
    added_count = models.PositiveIntegerField(default=0)
    updated_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "qms_deep_dive_sync_runs"
        ordering = ("-month_key",)

