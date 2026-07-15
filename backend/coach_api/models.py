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
