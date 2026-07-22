from django.db import models


class CoachCalendarEvent(models.Model):
    STATUS_NOT_SCHEDULED = "not-scheduled"
    STATUS_SCHEDULED = "scheduled"
    STATUS_IN_PROGRESS = "in-progress"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_NOT_SCHEDULED, "Not Scheduled"),
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    event_key = models.CharField(max_length=255, unique=True)
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
    notes = models.TextField(blank=True)
    last_graph_sync_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'Coach"."coach_calendar_event'
        ordering = ["target_date", "learner_name", "event_type", "sequence"]

    def __str__(self):
        return f"{self.event_type} #{self.sequence} for {self.learner_name or self.learner_id}"


class CoachAbsenceReport(models.Model):
    owner_email = models.EmailField(max_length=255, db_index=True)
    owner_name = models.CharField(max_length=255)
    learner_id = models.IntegerField(db_index=True)
    learner_name = models.CharField(max_length=255)
    learner_email = models.EmailField(max_length=255)
    session_title = models.CharField(max_length=255)
    session_date = models.DateField(db_index=True)
    session_time = models.TimeField(null=True, blank=True)
    reason_category = models.CharField(max_length=64)
    reason = models.TextField()
    reported_by = models.CharField(max_length=255)
    status = models.CharField(max_length=20, default="Pending", db_index=True)
    evidence_provided = models.BooleanField(default=False)
    coach_note = models.TextField(blank=True)
    attendance_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    evidence_image_url = models.URLField(max_length=1000, blank=True)
    evidence_kind = models.CharField(max_length=20, blank=True)
    evidence_text = models.TextField(blank=True)
    previous_absences = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'Coach"."coach_absence_report'
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(attendance_rate__isnull=True)
                | (models.Q(attendance_rate__gte=0) & models.Q(attendance_rate__lte=100)),
                name="coach_absence_attendance_0_100",
            ),
        ]

    def __str__(self):
        return f"{self.learner_name}: {self.session_title} ({self.status})"
