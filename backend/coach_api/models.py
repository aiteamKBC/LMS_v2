from django.conf import settings
from django.db import models
import uuid


COACH_TEST_MODE = getattr(settings, "COACH_TEST_MODE", False)


def _table_name(test_name, production_name):
    return test_name if COACH_TEST_MODE else production_name


class CoachCalendarEvent(models.Model):
    SYNC_PENDING = "pending"
    SYNC_SYNCING = "syncing"
    SYNC_SYNCED = "synced"
    SYNC_FAILED = "failed"
    SYNC_RECONCILIATION = "reconciliation"
    SYNC_CANCELLED = "cancelled"
    SYNC_STATE_CHOICES = [
        (SYNC_PENDING, "Pending"),
        (SYNC_SYNCING, "Syncing"),
        (SYNC_SYNCED, "Synced"),
        (SYNC_FAILED, "Failed"),
        (SYNC_RECONCILIATION, "Reconciliation Required"),
        (SYNC_CANCELLED, "Cancelled"),
    ]

    STATUS_NOT_SCHEDULED = "not-scheduled"
    STATUS_SCHEDULED = "scheduled"
    STATUS_IN_PROGRESS = "in-progress"
    STATUS_AWAITING_SIGNATURE = "awaiting-signature"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_NOT_SCHEDULED, "Not Scheduled"),
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_AWAITING_SIGNATURE, "Awaiting Signature"),
        (STATUS_COMPLETED, "Completed"),
        # Legacy value retained for reading old deployments. Application
        # actions normalise it to Not Scheduled and never create new rows.
        (STATUS_CANCELLED, "Cancelled"),
    ]

    event_key = models.CharField(max_length=255, unique=True)
    operation_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    idempotency_key = models.CharField(max_length=255, blank=True)
    owner_email = models.EmailField(max_length=255, db_index=True)
    owner_name = models.CharField(max_length=255, blank=True)
    learner_id = models.IntegerField(db_index=True)
    learner_name = models.CharField(max_length=255, blank=True)
    learner_email = models.EmailField(max_length=255, blank=True)
    event_type = models.CharField(max_length=32, db_index=True)
    sequence = models.PositiveIntegerField(default=1)
    target_date = models.DateField(db_index=True)
    scheduled_date = models.DateField(null=True, blank=True)
    scheduled_time = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveIntegerField(default=60)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_NOT_SCHEDULED, db_index=True)
    meeting_provider = models.CharField(max_length=64, blank=True)
    meeting_link = models.URLField(max_length=1000, blank=True)
    graph_event_id = models.CharField(max_length=255, blank=True)
    graph_web_link = models.URLField(max_length=1000, blank=True)
    # Mailbox the Graph event was created on, i.e. its organizer. Learner-booked
    # sessions organize from the learner's mailbox so the owner gets emailed, so
    # this is not always owner_email -- reads/deletes must target the right one.
    graph_organizer_email = models.EmailField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    review_responses = models.JSONField(default=dict, blank=True)
    review_completed_at = models.DateTimeField(null=True, blank=True)
    manager_signed_at = models.DateTimeField(null=True, blank=True)
    manager_signed_by = models.CharField(max_length=255, blank=True)
    last_graph_sync_error = models.TextField(blank=True)
    sync_state = models.CharField(
        max_length=24,
        choices=SYNC_STATE_CHOICES,
        default=SYNC_PENDING,
        db_index=True,
    )
    sync_attempt_count = models.PositiveIntegerField(default=0)
    last_sync_attempt_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = _table_name('coach_test_calendar_events', 'Coach"."coach_calendar_event')
        ordering = ["target_date", "learner_name", "event_type", "sequence"]
        indexes = [
            models.Index(fields=["owner_email", "target_date", "status"], name="coach_owner_date_status_idx"),
            models.Index(fields=["learner_id", "event_type", "target_date"], name="coach_learner_type_date_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                # Literal values rather than the STATUS_* class attributes above:
                # a nested `class Meta` does not see its enclosing class's
                # namespace (Python class bodies aren't closures the way
                # function bodies are), so referencing them by name here raises
                # NameError at import time. Kept in sync with STATUS_CHOICES.
                condition=models.Q(
                    status__in=[
                        "not-scheduled",
                        "scheduled",
                        "in-progress",
                        "awaiting-signature",
                        "completed",
                        "cancelled",
                    ]
                ),
                name="coach_calendar_event_status_valid",
            ),
            models.UniqueConstraint(
                fields=["learner_id", "event_type", "sequence"],
                condition=models.Q(
                    event_type__in=[
                        "catch-up",
                        "student-support",
                        "eligibility-review",
                        "workspace",
                        "training-plan",
                    ]
                ),
                name="coach_calendar_booking_seq_uniq",
            ),
            models.UniqueConstraint(
                fields=["owner_email", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="coach_calendar_owner_idempotency_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.event_type} #{self.sequence} for {self.learner_name or self.learner_id}"


class CoachCalendarSequence(models.Model):
    """Cross-process sequence allocator for a learner/session-type scope."""

    learner_id = models.IntegerField()
    event_type = models.CharField(max_length=32)
    last_sequence = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = _table_name(
            "coach_test_calendar_sequences",
            'Coach"."coach_calendar_sequence',
        )
        constraints = [
            models.UniqueConstraint(
                fields=["learner_id", "event_type"],
                name="coach_calendar_sequence_scope_uniq",
            ),
        ]


class CoachAbsenceReport(models.Model):
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_DECLINED = "declined"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_DECLINED, "Declined"),
    ]

    attendance_id = models.BigIntegerField(unique=True)
    owner_email = models.EmailField(max_length=255, db_index=True)
    owner_name = models.CharField(max_length=255, blank=True)
    learner_id = models.IntegerField(db_index=True)
    learner_name = models.CharField(max_length=255)
    learner_email = models.EmailField(max_length=255, blank=True)
    session_title = models.CharField(max_length=255)
    session_date = models.DateField(db_index=True)
    session_time = models.TimeField(null=True, blank=True)
    reason_category = models.CharField(max_length=64, blank=True)
    reason = models.TextField()
    reported_by = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    evidence_provided = models.BooleanField(default=False)
    evidence_kind = models.CharField(max_length=20, default="none")
    evidence_text = models.TextField(blank=True)
    evidence_image_url = models.URLField(max_length=1000, blank=True)
    previous_absences = models.PositiveIntegerField(default=0)
    attendance_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    coach_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = _table_name('coach_test_absence_reports', 'Coach"."coach_absence_report')
        ordering = ["-session_date", "learner_name"]
        indexes = [
            models.Index(fields=["owner_email", "status", "-session_date"], name="coach_abs_owner_status_idx"),
            models.Index(fields=["learner_id", "-session_date"], name="coach_abs_learner_date_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                # Literal values, not the STATUS_* class attributes: see the
                # matching comment on CoachCalendarEvent's constraint above.
                condition=models.Q(status__in=["pending", "approved", "declined"]),
                name="coach_absence_report_status_valid",
            ),
            models.CheckConstraint(
                condition=models.Q(attendance_rate__isnull=True)
                | (models.Q(attendance_rate__gte=0) & models.Q(attendance_rate__lte=100)),
                name="coach_absence_attendance_0_100",
            ),
        ]

    def __str__(self):
        return f"{self.learner_name}: {self.session_title} ({self.status})"
