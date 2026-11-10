import uuid

from django.db import models
from django.db.models import Q
from django.utils import timezone

# Lifecycle on the normalised curriculum schema is one ``status`` column:
# 'inactive' is archived, anything else is live. ('archived' is read as
# inactive too, so a value from an older writer is never shown as live.)
INACTIVE_STATUSES = ('inactive', 'archived')


class LegacyLifecycleQuerySet(models.QuerySet):
    """Bridge for code outside Curriculum that still queries the old columns.

    The normalised schema dropped ``deleted_at`` and ``is_programme_deleted``
    (one ``status`` instead) and the copied ``*_name`` columns (read by id).
    learner_api, coach_api and engagement_api still filter with
    ``deleted_at__isnull=True`` / ``is_programme_deleted=False`` and ask for
    ``.only(..., 'group_name')``. This translates exactly those spellings so
    their code keeps its meaning without edits; Curriculum's own code uses
    ``status`` directly. Owners of those apps should move to ``status`` and
    drop these spellings; then this class can go.

    Translated: ``deleted_at__isnull=<bool>``, ``is_programme_deleted=<bool>``
    (in filter/exclude); unknown names in ``only()``/``defer()`` are dropped.
    """

    def _translate(self, kwargs):
        condition = Q()
        rest = {}
        for key, value in kwargs.items():
            if key == 'deleted_at__isnull':
                condition &= ~Q(status__in=INACTIVE_STATUSES) if value else Q(status__in=INACTIVE_STATUSES)
            elif key == 'is_programme_deleted':
                condition &= Q(status__in=INACTIVE_STATUSES) if value else ~Q(status__in=INACTIVE_STATUSES)
            else:
                rest[key] = value
        return condition, rest

    def filter(self, *args, **kwargs):
        condition, rest = self._translate(kwargs)
        return super().filter(condition, *args, **rest)

    def exclude(self, *args, **kwargs):
        condition, rest = self._translate(kwargs)
        return super().exclude(condition, *args, **rest)

    def _known(self, fields):
        names = {field.name for field in self.model._meta.concrete_fields}
        return [field for field in fields if field.split('__', 1)[0] in names]

    def only(self, *fields):
        return super().only(*self._known(fields))

    def defer(self, *fields):
        return super().defer(*self._known(fields))


class StatusLifecycleModel(models.Model):
    """Read-only legacy attributes derived from ``status`` (see the bridge above)."""

    objects = LegacyLifecycleQuerySet.as_manager()

    class Meta:
        abstract = True

    @property
    def is_inactive(self):
        return str(self.status or '').strip().lower() in INACTIVE_STATUSES

    @property
    def is_programme_deleted(self):
        return self.is_inactive

    @property
    def deleted_at(self):
        return (self.updated_at or self.created_at) if self.is_inactive else None


class QRAttendance(models.Model):
    """Independent email-submitted evidence; never grants attendance or hours.

    Identity fields are scalar snapshots. The migration installs real database
    foreign keys because the external enrolment/curriculum tables are unmanaged.
    """
    enrolment_id = models.IntegerField()
    programme_id = models.CharField(max_length=150)
    module_id = models.CharField(max_length=128)
    occurrence_id = models.CharField(max_length=128)
    assigned_group_id = models.CharField(max_length=128, null=True, blank=True)
    attended_group_id = models.CharField(max_length=128, null=True, blank=True)
    assigned_cohort_id = models.CharField(max_length=128, null=True, blank=True)
    attended_cohort_id = models.CharField(max_length=128, null=True, blank=True)
    source = models.CharField(max_length=2, default='qr', editable=False)
    confirmed_at = models.DateTimeField(default=timezone.now, editable=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        managed = False
        db_table = 'curriculum"."qr_attendance'
        constraints = [models.UniqueConstraint(fields=['enrolment_id', 'occurrence_id'], name='qr_attendance_student_occurrence_uniq')]


class CurriculumVideoImport(models.Model):
    """Durable import identity, source and outcome; no learner records."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target_kind = models.CharField(max_length=16)
    target_id = models.CharField(max_length=128)
    component_id = models.CharField(max_length=128)
    fingerprint = models.CharField(max_length=64, unique=True)
    title = models.TextField()
    source_url = models.TextField(blank=True, default='')
    source_at_start = models.TextField(blank=True, default='')
    scope = models.JSONField(default=dict)
    library_id = models.CharField(max_length=32, default='798153')
    collection_id = models.CharField(max_length=64, blank=True, default='')
    video_id = models.CharField(max_length=64, blank=True, default='')
    status = models.CharField(max_length=24, default='queued', db_index=True)
    error = models.TextField(blank=True, default='')
    lease_until = models.DateTimeField(null=True, blank=True)
    requested_at = models.DateTimeField(default=timezone.now)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum_video_import'


class CurriculumVideoChange(models.Model):
    """Database-captured source changes awaiting the Bunny import worker."""

    target_kind = models.CharField(max_length=16)
    target_id = models.CharField(max_length=128)
    component_id = models.CharField(max_length=128)
    previous_settings = models.JSONField(default=dict)
    settings = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)
    available_at = models.DateTimeField(default=timezone.now, db_index=True)
    attempts = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True, default='')

    class Meta:
        db_table = 'curriculum_video_change'


class ModuleAuthoringModule(StatusLifecycleModel):
    """``curriculum.modules`` on the normalised schema.

    Placement and staff are keys (programme/cohort/group/tutor ids); the names
    are read from their own rows (``curriculum_names``), never stored here.
    """
    module_catalogue_id = models.CharField(max_length=128, primary_key=True)
    # No sale fields: course pricing lives on curriculum.free_courses. The
    # current curriculum database has no is_for_sale/price/currency on modules,
    # and sql/2026-11-10_drop_module_pricing_columns.sql removes them from the
    # old one; mapping them here failed every whole-row read of this model.
    programme_id = models.CharField(max_length=255, blank=True, null=True)
    cohort_id = models.CharField(max_length=255, blank=True, null=True)
    group_id = models.CharField(max_length=255, blank=True, null=True)
    tutor_id = models.CharField(max_length=255, blank=True, null=True)
    title = models.TextField()
    description = models.TextField(blank=True, null=True)
    total_otjh = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    quality_score = models.IntegerField(default=0)
    status = models.CharField(max_length=32, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."modules'
        managed = False

    # Read-only names for callers outside Curriculum (see LegacyLifecycleQuerySet).
    @property
    def programme_name(self):
        from .curriculum_names import name_of
        return name_of('programmes', self.programme_id, using=self._state.db or 'default')

    @property
    def cohort_name(self):
        from .curriculum_names import name_of
        return name_of('cohorts', self.cohort_id, using=self._state.db or 'default')

    @property
    def group_name(self):
        from .curriculum_names import name_of
        return name_of('groups', self.group_id, using=self._state.db or 'default')

    @property
    def tutor_name(self):
        from .curriculum_names import name_of
        return name_of('tutors', self.tutor_id, using=self._state.db or 'default')


class ModuleAuthoringWeek(StatusLifecycleModel):
    """``curriculum.weeks``: a normal Programme Module week."""
    id = models.CharField(max_length=128, primary_key=True)
    module_catalogue_id = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    week_number = models.IntegerField(default=1)
    title = models.TextField(blank=True, default='')
    summary = models.TextField(blank=True, null=True)
    learning_outcomes = models.JSONField(default=list, blank=True, null=True)
    display_order = models.IntegerField(default=0)
    # The author's holiday hint for this week, and whether it is published.
    # Held apart so turning the hint off keeps the text, and so a week that was
    # never touched publishes nothing. See sql/2026-09-22_week_holiday_note.sql.
    holiday_note_enabled = models.BooleanField(default=False)
    holiday_note = models.TextField(blank=True, default='')
    status = models.CharField(max_length=32, default='active')
    copied_from_id = models.CharField(max_length=128, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."weeks'
        managed = False


class ModuleAuthoringComponent(StatusLifecycleModel):
    TYPE_CHOICES = [
        ('live_session', 'Live session'),
        ('video', 'Video'),
        ('podcast', 'Podcast'),
        ('reading', 'Reading'),
        ('quiz', 'Quiz'),
        ('reflection', 'Reflection'),
        ('assignment', 'Assignment'),
        ('checkpoint', 'Checkpoint'),
    ]

    id = models.CharField(max_length=128, primary_key=True)
    week_id = models.CharField(max_length=128, db_index=True)
    module_catalogue_id = models.CharField(max_length=128, db_index=True)
    type = models.CharField(max_length=64, choices=TYPE_CHOICES)
    title = models.TextField(blank=True, default='')
    description = models.TextField(blank=True, null=True)
    expected_otjh = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    points = models.IntegerField(default=0)
    reflection_required = models.BooleanField(default=False)
    workplace_evidence_required = models.BooleanField(default=False)
    tutor_validation_required = models.BooleanField(default=False)
    coach_validation_required = models.BooleanField(default=False)
    display_order = models.IntegerField(default=0)
    settings_json = models.JSONField(default=dict, blank=True, null=True)
    reflection_question = models.TextField(
        db_column='Reflection_Question', blank=True, null=True,
    )
    live_sessions_link = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=32, default='active')
    copied_from_id = models.CharField(max_length=128, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."components'
        managed = False


class ModuleAuthoringKsbMapping(StatusLifecycleModel):
    """``curriculum.ksb_mappings``: a component's link to one standard KSB.

    The module and week are the component's; the KSB code and description are
    the ``standard_ksbs`` row's (``standard_ksb_id``).
    """
    CLASSIFICATION_CHOICES = [
        ('main', 'Main'),
        ('secondary', 'Secondary'),
        ('possible', 'Possible'),
        ('practice', 'Practice (legacy)'),
    ]

    id = models.CharField(max_length=128, primary_key=True)
    component_id = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    ksb_id = models.CharField(max_length=255, blank=True, null=True)
    standard_ksb_id = models.BigIntegerField()
    source_type = models.CharField(max_length=32, blank=True, null=True)
    source_id = models.CharField(max_length=255, blank=True, null=True)
    classification = models.CharField(max_length=32, choices=CLASSIFICATION_CHOICES, default='secondary')
    weight = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    weight_class = models.CharField(max_length=32, blank=True, default='soft')
    status = models.CharField(max_length=32, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."ksb_mappings'
        managed = False


class ModuleAuthoringCompletionCriteria(models.Model):
    module_catalogue_id = models.CharField(max_length=128, primary_key=True)
    quizzes_completed_required = models.BooleanField(default=False)
    checkpoints_completed_required = models.BooleanField(default=False)
    average_score_required_enabled = models.BooleanField(default=False)
    average_score_required = models.IntegerField(default=70)
    total_score_required_enabled = models.BooleanField(default=False)
    total_score_required = models.IntegerField(default=100)
    additional_notes = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_completion_criteria'
        managed = False


class ProgrammeAuditAsset(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    programme_id = models.CharField(max_length=255, db_index=True)
    programme_source_id = models.CharField(max_length=255, blank=True, default='')
    programme_name = models.TextField(blank=True, default='')
    module_catalogue_id = models.CharField(max_length=128, blank=True, default='', db_index=True)
    module_title = models.TextField(blank=True, default='')
    week_id = models.CharField(max_length=128, blank=True, default='', db_index=True)
    week_number = models.IntegerField(blank=True, null=True)
    week_title = models.TextField(blank=True, default='')
    component_id = models.CharField(max_length=128, blank=True, default='', db_index=True)
    component_type = models.CharField(max_length=64, blank=True, default='')
    content_kind = models.CharField(max_length=64, blank=True, default='', db_index=True)
    title = models.TextField(blank=True, default='')
    description = models.TextField(blank=True, default='')
    source_url = models.TextField(blank=True, default='')
    embed_url = models.TextField(blank=True, default='')
    embed_code = models.TextField(blank=True, default='')
    render_mode = models.CharField(max_length=64, blank=True, default='')
    file_name = models.TextField(blank=True, default='')
    content_type = models.CharField(max_length=255, blank=True, default='')
    file_size = models.BigIntegerField(blank=True, null=True)
    duration_minutes = models.IntegerField(blank=True, null=True)
    expected_otjh = models.DecimalField(max_digits=8, decimal_places=2, blank=True, null=True)
    points = models.IntegerField(blank=True, null=True)
    status = models.CharField(max_length=64, blank=True, default='')
    ksb_mappings = models.JSONField(default=list, blank=True)
    settings = models.JSONField(default=dict, blank=True)
    raw_component = models.JSONField(default=dict, blank=True)
    raw_payload = models.JSONField(default=dict, blank=True)
    imported_from = models.CharField(max_length=255, blank=True, default='')
    source_key = models.CharField(max_length=512, blank=True, default='')
    imported_at = models.DateTimeField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'programme_audit"."assets'
        managed = False


class ModuleAuthoringAdvancedDetails(models.Model):
    module_catalogue_id = models.CharField(max_length=128, primary_key=True)
    background = models.TextField(blank=True, default='')
    epa_requirements = models.JSONField(default=list, blank=True)
    professional_qualification_outcomes = models.JSONField(default=list, blank=True)
    intent = models.TextField(blank=True, default='')
    learner_benefit = models.TextField(blank=True, default='')
    employer_benefit = models.TextField(blank=True, default='')
    sequence_purpose = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."module_authoring_advanced_details'
        managed = False


class LiveSession(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    module_catalogue_id = models.CharField(max_length=128, blank=True, null=True, db_index=True)
    module_draft_id = models.CharField(max_length=255, blank=True, default='', db_index=True)
    module_title = models.TextField(blank=True, default='')
    provider = models.CharField(max_length=64, default='Microsoft Teams')
    graph_event_id = models.CharField(max_length=512, blank=True, null=True)
    online_meeting_id = models.TextField(blank=True, default='')
    join_url = models.TextField(blank=True, default='')
    web_link = models.TextField(blank=True, default='')
    meeting_options_url = models.TextField(blank=True, default='')
    organizer_email = models.CharField(max_length=320)
    attendees = models.JSONField(default=list, blank=True)
    presenters = models.JSONField(default=list, blank=True)
    start_datetime = models.DateTimeField(blank=True, null=True)
    timezone = models.CharField(max_length=128, blank=True, default='')
    duration_minutes = models.IntegerField(default=60)
    repeat_pattern = models.CharField(max_length=32, default='none')
    repeat_occurrences = models.IntegerField(default=1)
    lobby_bypass = models.CharField(max_length=64, default='everyone')
    recording = models.CharField(max_length=64, default='none')
    spoken_language = models.CharField(max_length=32, default='en-GB')
    meeting_type = models.CharField(max_length=64, default='live-session')
    request_responses = models.BooleanField(default=True)
    allow_time_proposals = models.BooleanField(default=True)
    hide_attendees = models.BooleanField(default=False)
    status = models.CharField(max_length=32, default='active')
    warnings = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_sessions'
        managed = False


class LiveSessionOccurrence(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    live_session_id = models.CharField(max_length=128, db_index=True)
    session_number = models.IntegerField()
    graph_event_id = models.CharField(max_length=512, blank=True, default='')
    scheduled_start = models.DateTimeField()
    scheduled_end = models.DateTimeField()
    actual_start = models.DateTimeField(blank=True, null=True)
    actual_end = models.DateTimeField(blank=True, null=True)
    join_url = models.TextField(blank=True, default='')
    online_meeting_id = models.TextField(blank=True, default='')
    attendance_report_id = models.CharField(max_length=512, blank=True, default='')
    participant_count = models.IntegerField(default=0)
    status = models.CharField(max_length=32, default='scheduled')
    artifacts_synced_at = models.DateTimeField(blank=True, null=True)
    last_sync_error = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_occurrences'
        managed = False


class LiveSessionAttendance(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    occurrence_id = models.CharField(max_length=128, db_index=True)
    graph_record_id = models.CharField(max_length=512, blank=True, default='')
    email = models.CharField(max_length=320, blank=True, default='')
    display_name = models.CharField(max_length=500, blank=True, default='')
    role = models.CharField(max_length=64, blank=True, default='')
    total_attendance_seconds = models.IntegerField(default=0)
    intervals = models.JSONField(default=list, blank=True)
    raw_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_attendance'
        managed = False


class LiveSessionLearnerAttendance(models.Model):
    """Final per-learner register derived from module assignments and Teams evidence."""

    STATUS_PRESENT = 'present'
    STATUS_ABSENT = 'absent'
    STATUS_CHOICES = [
        (STATUS_PRESENT, 'Present'),
        (STATUS_ABSENT, 'Absent'),
    ]
    RECOVERY_NONE = 'none'
    RECOVERY_REQUESTED = 'requested'
    RECOVERY_CATCHUP_BOOKED = 'catchup_booked'
    RECOVERY_COMPLETED = 'completed'
    RECOVERY_CHOICES = [
        (RECOVERY_NONE, 'Not requested'),
        (RECOVERY_REQUESTED, 'Recovery requested'),
        (RECOVERY_CATCHUP_BOOKED, 'Catch-up booked'),
        (RECOVERY_COMPLETED, 'Catch-up completed'),
    ]

    occurrence_id = models.CharField(max_length=128, db_index=True)
    live_session_id = models.CharField(max_length=128, db_index=True)
    module_catalogue_id = models.CharField(max_length=128, db_index=True)
    learner_profile_id = models.BigIntegerField(db_index=True)
    learner_email = models.EmailField(max_length=320, blank=True, default='')
    learner_name = models.CharField(max_length=500, blank=True, default='')
    attendance_status = models.CharField(max_length=16, choices=STATUS_CHOICES)
    recovery_status = models.CharField(max_length=24, choices=RECOVERY_CHOICES, default=RECOVERY_NONE)
    attended_seconds = models.PositiveIntegerField(default=0)
    attendance_report_id = models.TextField(blank=True, default='')
    first_join_at = models.DateTimeField(blank=True, null=True)
    last_leave_at = models.DateTimeField(blank=True, null=True)
    calculated_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_learner_attendance'
        managed = False
        constraints = [
            models.UniqueConstraint(
                fields=['occurrence_id', 'learner_profile_id', 'module_catalogue_id'],
                name='curriculum_live_learner_attendance_uniq',
            ),
        ]


class LiveSessionAttendanceAlias(models.Model):
    """A reviewed Teams email identity for one delivery module."""

    module_catalogue_id = models.CharField(max_length=128, db_index=True)
    alias_email = models.EmailField(max_length=320)
    learner_profile_id = models.BigIntegerField(db_index=True)
    canonical_email = models.EmailField(max_length=320)
    created_by = models.CharField(max_length=320, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_attendance_aliases'
        managed = False
        constraints = [
            models.UniqueConstraint(
                fields=['module_catalogue_id', 'alias_email'],
                name='curriculum_live_attendance_alias_uniq',
            ),
        ]


class LiveSessionAttendanceIdentityLink(models.Model):
    """A reviewed raw Teams attendance row linked to one module learner."""

    occurrence_id = models.CharField(max_length=128, db_index=True)
    attendance_row_id = models.CharField(max_length=128)
    learner_profile_id = models.BigIntegerField(db_index=True)
    canonical_email = models.EmailField(max_length=320)
    display_name = models.CharField(max_length=500, blank=True, default='')
    created_by = models.CharField(max_length=320, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_attendance_identity_links'
        managed = False
        constraints = [
            models.UniqueConstraint(
                fields=['occurrence_id', 'attendance_row_id'],
                name='curriculum_live_attendance_identity_link_uniq',
            ),
        ]


class LiveSessionAbsence(models.Model):
    """One learner's reported absence and recovery choice for one live session.

    Teams attendance evidence remains in ``live_session_attendance``.  This
    table records the complementary fact that an assigned learner reported an
    absence, without putting learner state on the shared occurrence row.
    """

    RECOVERY_NONE = 'none'
    RECOVERY_REQUESTED = 'requested'
    RECOVERY_CATCHUP_BOOKED = 'catchup_booked'
    RECOVERY_COMPLETED = 'completed'
    RECOVERY_CHOICES = [
        (RECOVERY_NONE, 'No recovery requested'),
        (RECOVERY_REQUESTED, 'Recovery requested'),
        (RECOVERY_CATCHUP_BOOKED, 'Catch-up booked'),
        (RECOVERY_COMPLETED, 'Catch-up completed'),
    ]

    occurrence_id = models.CharField(max_length=128, db_index=True)
    learner_profile_id = models.BigIntegerField(db_index=True)
    source_kind = models.CharField(max_length=32, blank=True, default='')
    source_learner_id = models.IntegerField(blank=True, null=True)
    learner_email = models.EmailField(max_length=320, blank=True, default='')
    learner_name = models.CharField(max_length=500, blank=True, default='')
    recovery_status = models.CharField(max_length=24, choices=RECOVERY_CHOICES, default=RECOVERY_NONE)
    recovery_method = models.CharField(max_length=16, blank=True, default='')
    recovery_reference = models.CharField(max_length=255, blank=True, default='')
    reported_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_absences'
        managed = False
        constraints = [
            models.UniqueConstraint(
                fields=['occurrence_id', 'learner_profile_id'],
                name='curriculum_live_absence_learner_occurrence_uniq',
            ),
        ]


class LiveSessionArtifact(models.Model):
    id = models.CharField(max_length=128, primary_key=True)
    occurrence_id = models.CharField(max_length=128, db_index=True)
    artifact_type = models.CharField(max_length=32)
    graph_artifact_id = models.TextField()
    call_id = models.TextField(blank=True, default='')
    content_correlation_id = models.TextField(blank=True, default='')
    content_url = models.TextField(blank=True, default='')
    created_datetime = models.DateTimeField(blank=True, null=True)
    end_datetime = models.DateTimeField(blank=True, null=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."live_session_artifacts'
        managed = False


class WeekTemplate(models.Model):
    # A reusable week authored in the standalone Week Builder. Not bound to a
    # module (unlike ModuleAuthoringWeek); Phase 2 will copy its content into a
    # module's weeks. course_type drives the paid/free split: paid templates are
    # scoped to programme + module + group; free templates carry none of them
    # (the view enforces that — the columns stay nullable at the DB level).
    COURSE_TYPE_CHOICES = [
        ('paid', 'Paid / normal course'),
        ('free', 'Free course'),
    ]

    id = models.CharField(max_length=128, primary_key=True)
    title = models.TextField(blank=True, default='')
    summary = models.TextField(blank=True, null=True)
    learning_outcomes = models.JSONField(default=list, blank=True)
    course_type = models.CharField(max_length=16, choices=COURSE_TYPE_CHOICES, default='paid')
    programme_id = models.CharField(max_length=255, blank=True, null=True)
    programme_name = models.CharField(max_length=255, blank=True, null=True)
    module_catalogue_id = models.CharField(max_length=128, blank=True, null=True)
    group_id = models.CharField(max_length=255, blank=True, null=True)
    group_name = models.CharField(max_length=255, blank=True, null=True)
    status = models.CharField(max_length=32, default='draft')
    ksb_mappings = models.JSONField(default=list, blank=True)
    total_otjh = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    points = models.IntegerField(default=0)
    component_count = models.IntegerField(default=0)
    author = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."week_templates'
        managed = False


class WeekTemplateComponent(models.Model):
    # The atomic learning items inside a week template. Same shape as
    # ModuleAuthoringComponent (type + settings_json + per-component KSBs) so a
    # template's components stay compatible with modules for the Phase 2 import.
    id = models.CharField(max_length=128, primary_key=True)
    week_template_id = models.CharField(max_length=128, db_index=True)
    type = models.CharField(max_length=64)
    title = models.TextField(blank=True, default='')
    description = models.TextField(blank=True, null=True)
    expected_otjh = models.DecimalField(max_digits=8, decimal_places=2, default=2)
    points = models.IntegerField(default=0)
    reflection_required = models.BooleanField(default=False)
    workplace_evidence_required = models.BooleanField(default=False)
    tutor_validation_required = models.BooleanField(default=False)
    ksb_mappings = models.JSONField(default=list, blank=True)
    settings_json = models.JSONField(default=dict, blank=True, null=True)
    display_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."week_template_components'
        managed = False


class EnglandHoliday(models.Model):
    # Bank holidays as gov.uk publishes them, loaded by the
    # fetch_england_holidays command. This is the curriculum's whole holiday
    # calendar: the authored 'holidays' table that used to hold the college's
    # own closure periods is no longer read by anything. Reference data nobody
    # here edits, so every route onto it is read-only.
    id = models.CharField(max_length=128, primary_key=True)
    division = models.CharField(max_length=64, default='england-and-wales')
    title = models.CharField(max_length=255)
    holiday_date = models.DateField(db_index=True)
    notes = models.CharField(max_length=255, blank=True, default='')
    bunting = models.BooleanField(default=False)
    # Last time the feed still listed this date, which is how a stale load is
    # spotted: updated_at only moves when the holiday itself changed.
    fetched_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'curriculum"."england_holidays'
        managed = False
