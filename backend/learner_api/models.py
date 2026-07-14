"""Unmanaged mapping of the existing Neon table enrolment."Enrolment_Users".

The table was created outside Django, so `managed = False` — Django never issues
DDL for it. Column names in the source table are irregular (leading spaces, mixed
case, slashes), so each field pins its exact `db_column`. The schema is targeted
with the `schema"."table` quoting trick, which Django emits as
`"enrolment"."Enrolment_Users"` — avoiding a search_path startup option that the
Neon connection pooler may reject.
"""
import json

from django.db import models


class SafeJSONField(models.JSONField):
    """JSONField tolerant of psycopg3 already-parsed values.

    psycopg 3 decodes `json`/`jsonb` columns into Python objects itself, but
    Django's JSONField.from_db_value then calls json.loads() on them and blows up
    on a list/dict. This accepts a value that's already parsed and only parses
    when handed a raw string.
    """

    def from_db_value(self, value, expression, connection):
        if value is None or isinstance(value, (list, dict)):
            return value
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value


class EnrolmentUser(models.Model):
    id = models.AutoField(primary_key=True, db_column="id")

    # --- flat text columns ---
    username = models.TextField(db_column="Username", null=True, blank=True)
    email = models.TextField(db_column="Email", null=True, blank=True)
    status = models.TextField(db_column=" Status", null=True, blank=True)  # NB: leading space
    type = models.TextField(db_column="Type", null=True, blank=True)
    programme_status = models.TextField(db_column="Programme_status", null=True, blank=True)
    programme = models.TextField(db_column="Programme", null=True, blank=True)
    cohort = models.TextField(db_column="Cohort", null=True, blank=True)
    group = models.TextField(db_column="Group", null=True, blank=True)
    # Structured training plan (see mappers.TRAINING_PLAN docstring for shape).
    # This column pre-existed as unused free text; repurposed here since apprentice
    # learners previously had no way to persist a training plan at all.
    learning_plan = SafeJSONField(db_column="Learning_plan", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    date_of_birth = models.TextField(db_column="Date_of_birth", null=True, blank=True)
    organization = models.TextField(db_column="Orgnization", null=True, blank=True)  # source spelling
    employer = models.TextField(db_column="Employer", null=True, blank=True)
    line_manager = models.TextField(db_column="Line_manager", null=True, blank=True)
    practical_period_end_date = models.TextField(db_column="Practical_period_end_date", null=True, blank=True)
    apprenticeship_end_date = models.TextField(db_column="Apprenticeship_End_date", null=True, blank=True)
    minimum_required_hours = models.TextField(db_column="Minimum_required_hours", null=True, blank=True)
    planned_hours = models.TextField(db_column="Planned_hours", null=True, blank=True)
    enrolled_time_and_user = models.TextField(db_column="Enrolled_time_and_user", null=True, blank=True)
    rpl_hours = models.TextField(db_column="RPL_Hours", null=True, blank=True)
    onboarding_status = models.TextField(db_column="Onboarding_status", null=True, blank=True)
    onboarding_completed = models.TextField(db_column="Onboarding_completed", null=True, blank=True)
    managed_jobs = models.TextField(db_column="Managed_jobs_and_placements/workshops", null=True, blank=True)
    competencies = models.TextField(db_column="Competencies", null=True, blank=True)

    # --- json columns ---
    sub_programme = models.JSONField(db_column="Sub-programme", null=True, blank=True)
    aims_qualifications = models.JSONField(db_column="Aims/Qualifications", null=True, blank=True)
    english_assessments = models.JSONField(db_column=" English_Assessments", null=True, blank=True)  # leading space
    maths_assessments = models.JSONField(db_column="Maths_Assessments", null=True, blank=True)
    ict_assessments = models.JSONField(db_column="ICT_Assessments", null=True, blank=True)
    english_exemption = models.JSONField(db_column="English_Exemption_from_Functional_Skills", null=True, blank=True)
    maths_exemption = models.JSONField(db_column="Maths_Exemption_from_Functional_Skills", null=True, blank=True)
    ict_exemption = models.JSONField(db_column="ICT_Exemption_from_Functional_Skills", null=True, blank=True)
    reviews = models.JSONField(db_column="Reviews", null=True, blank=True)
    tracker = models.JSONField(db_column="Tracker", null=True, blank=True)
    milestones = models.JSONField(db_column="Milestones", null=True, blank=True)
    contacts = models.JSONField(db_column="Contacts", null=True, blank=True)
    activity = models.JSONField(db_column="Activity", null=True, blank=True)
    compliance_documents = models.JSONField(db_column=" Compliance_documents", null=True, blank=True)  # leading space
    review_documents = models.JSONField(db_column=" Review_documents", null=True, blank=True)  # leading space
    documents = models.JSONField(db_column="Documents", null=True, blank=True)
    subscription_details = models.JSONField(db_column="Subscription_details", null=True, blank=True)

    class Meta:
        managed = False
        # Emitted by Django as "enrolment"."Enrolment_Users".
        db_table = 'enrolment"."Enrolment_Users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}>"


class CommercialUser(models.Model):
    """Unmanaged mapping of enrolment."Commercial_users" (delivery)."""

    id = models.AutoField(primary_key=True, db_column="id")

    # --- step 1: user details ---
    username = models.TextField(db_column="Username", null=True, blank=True)
    email = models.TextField(db_column="Email", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    employer = models.TextField(db_column="Employer", null=True, blank=True)
    line_manager = models.TextField(db_column="Line_manager", null=True, blank=True)
    organization = models.TextField(db_column="Orgnization", null=True, blank=True)  # source spelling
    programme_status = models.TextField(db_column="Programme_status", null=True, blank=True)

    # --- step 2: programme details ---
    programme = models.TextField(db_column="Programme", null=True, blank=True)
    cohort = models.TextField(db_column="Cohort", null=True, blank=True)
    group = models.TextField(db_column="Group", null=True, blank=True)

    # Legacy comma-joined summary columns — superseded by `training_plan` below,
    # kept only so old saved values remain visible until a learner's plan is
    # re-saved. Never written to by current code.
    modules = models.TextField(db_column="Modules", null=True, blank=True)
    weeks = models.TextField(db_column="Weeks", null=True, blank=True)
    components = models.TextField(db_column="Components", null=True, blank=True)

    # Structured training plan (see mappers.TRAINING_PLAN docstring for shape).
    # New column — added by the apply_training_plan_column management command.
    training_plan = SafeJSONField(db_column="Training_plan", null=True, blank=True)

    class Meta:
        managed = False
        # Emitted by Django as "enrolment"."Commercial_users".
        db_table = 'enrolment"."Commercial_users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}>"


class ActiveUser(models.Model):
    """Unmanaged mapping of "Learner"."Active_users".

    Populated automatically whenever an apprenticeship (EnrolmentUser) or
    commercial (CommercialUser) learner's programme status is set to "Active".
    The `id` column is GENERATED ALWAYS AS IDENTITY, so Django never supplies it
    on insert. Lives in the case-sensitive `Learner` schema of the same Neon DB.
    """

    id = models.AutoField(primary_key=True, db_column="id")

    username = models.TextField(db_column="Username ", null=True, blank=True)  # NB: trailing space
    email = models.TextField(db_column="Email", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    programme = models.TextField(db_column="Programme", null=True, blank=True)
    programme_status = models.TextField(db_column="Programme_status", null=True, blank=True)
    cohort = models.TextField(db_column="Cohort", null=True, blank=True)
    group = models.TextField(db_column="Group", null=True, blank=True)
    completed_hours = models.TextField(db_column="Completed_hours", null=True, blank=True)
    target_hours = models.TextField(db_column="Target_hours", null=True, blank=True)
    minimum_hours = models.TextField(db_column="Minimum_hours", null=True, blank=True)
    maximum_hours = models.TextField(db_column="Maximum_hours", null=True, blank=True)
    progress_variance = models.TextField(db_column="Progress_variance", null=True, blank=True)
    progress_hours = models.TextField(db_column="Progress_Hours", null=True, blank=True)
    otjh_status = models.TextField(db_column="OTJHoursStatus", null=True, blank=True)
    coach_name = models.TextField(db_column="coach_name", null=True, blank=True)
    coach_email = models.TextField(db_column="coach_email", null=True, blank=True)
    planned_hours = models.TextField(db_column="planned_hours", null=True, blank=True)
    # Coach contact, set per-learner on the delivery "Enrolled learners" page and
    # stored on the mirror only. Preserved across re-syncs because sync_active_user
    # uses UPDATE with a fixed field list that excludes these (see active_users.py);
    # a status toggle to non-Active deletes the row, so coach data is re-entered on
    # reactivation. Real DB columns are lowercase (unlike the rest of this table).
    coach_name = models.TextField(db_column="coach_name", null=True, blank=True)
    coach_email = models.TextField(db_column="coach_email", null=True, blank=True)
    # Total on-the-job hours the learner has completed, summed from the reflection
    # time on their training_plan_progress records. Stored as text (this table
    # keeps all hour columns as text). Recomputed on every progress submit.
    completed_hours = models.TextField(db_column="Completed_hours", null=True, blank=True)
    # Total OTJ hours the learner's training plan plans for (sum of every
    # component's authored expected_otjh). Written on learner-detail load.
    planned_hours = models.TextField(db_column="planned_hours", null=True, blank=True)
    # Cumulative planned hours up to & including the current week (the "target"
    # the learner should have reached by now). Grows week by week.
    target_hours = models.TextField(db_column="Target_hours", null=True, blank=True)
    # completed - target (hours ahead[+]/behind[-] the current-week target).
    progress_hours = models.TextField(db_column="Progress_Hours", null=True, blank=True)
    # (completed - target) / target, as a decimal (e.g. -0.88). '' when target=0.
    progress_variance = models.TextField(db_column="Progress_variance", null=True, blank=True)
    # RAG status derived from progress_variance: "On track" (> -5%),
    # "Need attention" (-15% < v <= -5%), "At risk" (v <= -15%).
    otjh_status = models.TextField(db_column="OTJHoursStatus", null=True, blank=True)

    # --- json columns (SafeJSONField: psycopg3 pre-parses json) ---
    # Structured plan: [{moduleId, moduleTitle, weeks: [{weekId, weekTitle,
    # components: [{componentId, componentTitle}]}]}] — same shape as
    # CommercialUser.training_plan / EnrolmentUser.learning_plan.
    training_plan = SafeJSONField(db_column="Training_plan", null=True, blank=True)
    training_plan_progress = SafeJSONField(db_column="Training_plan_progress", null=True, blank=True)
    ksbs = SafeJSONField(db_column="KSBs", null=True, blank=True)
    # Quiz attempts: [{week, attempt, grade, Score, module, passed, quizId, quizName,
    # ksbs, feedback, reportedTime, questions, startedAt, submittedAt, timeTaken}, ...]
    # — appended to by learner_api.quizzes.submit_quiz_attempt.
    weekly_quizzes = SafeJSONField(db_column="Weekly_Quizzes", null=True, blank=True)
    activity_feed = SafeJSONField(db_column="Activity_Feed", null=True, blank=True)
    # Chronological activity log (newest appended last). Each entry:
    # {kind:'quiz'|'video', action, title, detail, at, quizId?/componentId?, week, module}.
    # Appended when a learner finishes a component (quizzes.py / videos.py).
    activity_feed = SafeJSONField(db_column="Activity_Feed", null=True, blank=True)
    # Unified training-plan progress log. Every record carries a "kind":
    #   "quiz"  -> {kind, week, attempt, grade, Score, module, passed, quizId,
    #              quizName, ksbs, feedback, reportedTime, questions, startedAt,
    #              submittedAt, timeTaken}
    #   "video" -> {kind, week, module, componentId, videoTitle, ksbs, feedback,
    #              reportedTime, startedAt, submittedAt, timeTaken}
    # Appended to by learner_api.quizzes.submit_quiz_attempt and
    # learner_api.videos.submit_video_progress.
    training_plan_progress = SafeJSONField(db_column="Training_plan_progress", null=True, blank=True)

    class Meta:
        managed = False
        # Emitted by Django as "Learner"."Active_users".
        db_table = 'Learner"."Active_users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}>"


class UnactiveUser(models.Model):
    """Unmanaged mapping of "Learner"."Unactive_users"."""

    id = models.AutoField(primary_key=True, db_column="id")

    username = models.TextField(db_column="Username ", null=True, blank=True)  # NB: trailing space
    email = models.TextField(db_column="Email", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    programme = models.TextField(db_column="Programme", null=True, blank=True)
    status = models.TextField(db_column="status", null=True, blank=True)
    cohort = models.TextField(db_column="Cohort", null=True, blank=True)
    group = models.TextField(db_column="Group", null=True, blank=True)
    completed_hours = models.TextField(db_column="Completed_hours", null=True, blank=True)
    target_hours = models.TextField(db_column="Target_hours", null=True, blank=True)
    minimum_hours = models.TextField(db_column="Minimum_hours", null=True, blank=True)
    maximum_hours = models.TextField(db_column="Maximum_hours", null=True, blank=True)
    progress_variance = models.TextField(db_column="Progress_variance", null=True, blank=True)
    progress_hours = models.TextField(db_column="Progress_Hours", null=True, blank=True)
    otjh_status = models.TextField(db_column="OTJHoursStatus", null=True, blank=True)
    coach_name = models.TextField(db_column="coach_name", null=True, blank=True)
    coach_email = models.TextField(db_column="coach_email", null=True, blank=True)
    planned_hours = models.TextField(db_column="planned_hours", null=True, blank=True)

    training_plan = SafeJSONField(db_column="Training_plan", null=True, blank=True)
    training_plan_progress = SafeJSONField(db_column="Training_plan_progress", null=True, blank=True)
    ksbs = SafeJSONField(db_column="KSBs", null=True, blank=True)
    """Unmanaged mapping of "Learner"."Unactive_users" — the archive for learners
    whose programme status is NOT Active.

    Same shape as ActiveUser so a learner's full row (coach, progress, hours,
    KSBs, plan) is preserved when they leave Active, and restored when they
    return. NB the column names differ slightly from Active_users: Username has
    NO trailing space here, and there is an extra `status` column (the non-Active
    status the learner was moved out under). Move logic lives in active_users.py.
    """

    id = models.AutoField(primary_key=True, db_column="id")

    username = models.TextField(db_column="Username", null=True, blank=True)  # no trailing space (unlike Active_users)
    email = models.TextField(db_column="Email", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    programme = models.TextField(db_column="Programme", null=True, blank=True)
    programme_status = models.TextField(db_column="Programme_status", null=True, blank=True)
    cohort = models.TextField(db_column="Cohort", null=True, blank=True)
    group = models.TextField(db_column="Group", null=True, blank=True)
    coach_name = models.TextField(db_column="coach_name", null=True, blank=True)
    coach_email = models.TextField(db_column="coach_email", null=True, blank=True)
    completed_hours = models.TextField(db_column="Completed_hours", null=True, blank=True)
    # The non-Active status the learner currently holds (e.g. "Withdrawn", "On break").
    status = models.TextField(db_column="status", null=True, blank=True)

    training_plan = SafeJSONField(db_column="Training_plan", null=True, blank=True)
    ksbs = SafeJSONField(db_column="KSBs", null=True, blank=True)
    training_plan_progress = SafeJSONField(db_column="Training_plan_progress", null=True, blank=True)
    activity_feed = SafeJSONField(db_column="Activity_Feed", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."Unactive_users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}> [{self.status or '?'}]"
