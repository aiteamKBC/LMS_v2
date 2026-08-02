"""Unmanaged mapping of the Neon learner table enrolment."Created_users".

ONE table holds every learner. `Created_users` is written by the user-creation
form; its leading columns are exactly that form's fields, followed by the
operational columns the rest of the app reads. "Learner_type" tells the two kinds
apart ('apprenticeship' | 'commercial'), which is what the old
Enrolment_Users + Commercial_users table pair used to encode structurally.

`EnrolmentUser` keeps its historical class name (it is referenced across ~20
modules) but now maps `Created_users`; `CommercialUser` is a proxy over the same
table, scoped to the commercial rows.

The tables were created outside Django, so `managed = False` — Django never issues
DDL for them. Column names are irregular (leading spaces, mixed case, slashes), so
each field pins its exact `db_column`. The schema is targeted with the
`schema"."table` quoting trick, which Django emits as
`"enrolment"."Created_users"` — avoiding a search_path startup option that the
Neon connection pooler may reject.
"""
import json

from django.db import models
from django.db.models.functions import Lower, Trim


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


class LearnerTypeQuerySet(models.QuerySet):
    """Queryset for the merged learner table, scoped by "Learner_type"."""

    def apprenticeship(self):
        return self.filter(learner_type="apprenticeship")

    def commercial(self):
        return self.filter(learner_type="commercial")


class CommercialManager(models.Manager):
    """Default manager for CommercialUser: only ever sees commercial rows.

    Both learner kinds live in one table since the merge, so the proxy's manager
    filters on "Learner_type" — otherwise CommercialUser.objects.all() would
    return apprenticeship learners too.
    """

    def get_queryset(self):
        return LearnerTypeQuerySet(self.model, using=self._db).filter(learner_type="commercial")


class ApprenticeshipManager(models.Manager):
    """Default manager for EnrolmentUser: apprenticeship rows only.

    Since the merge both kinds share one table, so an unfiltered manager would
    make every apprenticeship listing include commercial learners. Rows predating
    the merge are treated as apprenticeship (Learner_type is backfilled, but a
    NULL is included defensively so a row can never vanish from both managers).
    Use EnrolmentUser.all_learners for queries that intentionally span both.
    """

    def get_queryset(self):
        return LearnerTypeQuerySet(self.model, using=self._db).exclude(learner_type="commercial")


class EnrolmentUser(models.Model):
    # `objects` is scoped to apprenticeship learners; `all_learners` spans both
    # kinds (used by lookups that resolve a learner by id regardless of type).
    objects = ApprenticeshipManager()
    all_learners = models.Manager()

    id = models.AutoField(primary_key=True, db_column="id")

    # Which kind of learner this row is: 'apprenticeship' | 'commercial'.
    # Added by the merge_commercial_into_enrolment management command, which
    # folded enrolment."Commercial_users" into this table.
    learner_type = models.TextField(db_column="Learner_type", null=True, blank=True)

    # --- flat text columns ---
    username = models.TextField(db_column="Username", null=True, blank=True)
    email = models.TextField(db_column="Email", null=True, blank=True)
    status = models.TextField(db_column=" Status", null=True, blank=True)  # NB: leading space
    type = models.TextField(db_column="Type", null=True, blank=True)
    programme_status = models.TextField(db_column="Programme_status", null=True, blank=True)
    programme = models.TextField(db_column="Programme", null=True, blank=True)
    cohort = models.TextField(db_column="Cohort", null=True, blank=True)
    group = models.TextField(db_column="Group", null=True, blank=True)
    # Cohort delivery window, copied from curriculum."cohort_authoring_details"
    # (matched by Programme + Cohort name — see cohort_dates in active_users.py).
    # Populated on create; refreshed on the Active mirror.
    start_date = models.DateField(db_column="Start_date", null=True, blank=True)
    end_date = models.DateField(db_column="End_date", null=True, blank=True)
    # Structured training plan (see mappers.TRAINING_PLAN docstring for shape).
    # This column pre-existed as unused free text; repurposed here since apprentice
    # learners previously had no way to persist a training plan at all.
    learning_plan = SafeJSONField(db_column="Learning_plan", null=True, blank=True)
    # Merged in from Commercial_users. Commercial learners store their plan here;
    # apprenticeship learners use learning_plan above. get_training_plan() reads
    # whichever is populated.
    training_plan = SafeJSONField(db_column="Training_plan", null=True, blank=True)
    # Legacy comma-joined summary columns, also merged in from Commercial_users.
    # Superseded by training_plan; kept so old saved values stay visible.
    modules = models.TextField(db_column="Modules", null=True, blank=True)
    weeks = models.TextField(db_column="Weeks", null=True, blank=True)
    components = models.TextField(db_column="Components", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    date_of_birth = models.TextField(db_column="Date_of_birth", null=True, blank=True)
    organization = models.TextField(db_column="Orgnization", null=True, blank=True)  # source spelling
    employer = models.TextField(db_column="Employer", null=True, blank=True)
    line_manager = models.TextField(db_column="Line_manager", null=True, blank=True)
    start_date = models.TextField(db_column="Start_date", null=True, blank=True)
    end_date = models.TextField(db_column="End_date", null=True, blank=True)
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

    # --- Aptem "Add user" fields (see apply_aptem_create_columns) ---
    # Captured by the create-user form, which mirrors Aptem's own Add-user screen.
    title = models.TextField(db_column="Title", null=True, blank=True)
    preferred_name = models.TextField(db_column="Preferred_name", null=True, blank=True)
    gender = models.TextField(db_column="Gender", null=True, blank=True)
    referrer = models.TextField(db_column="Referrer", null=True, blank=True)
    referrer_address = models.TextField(db_column="Referrer_address", null=True, blank=True)
    referrer_contact = models.TextField(db_column="Referrer_contact", null=True, blank=True)
    country = models.TextField(db_column="Country", null=True, blank=True)
    case_owner = models.TextField(db_column="Case_owner", null=True, blank=True)
    learning_provider = models.TextField(db_column="Learning_provider", null=True, blank=True)
    mentor = models.TextField(db_column="Mentor", null=True, blank=True)
    reference_number = models.TextField(db_column="Reference_number", null=True, blank=True)
    extended_break = models.TextField(db_column="Extended_break", null=True, blank=True)
    employer_address = models.TextField(db_column="Employer_address", null=True, blank=True)
    target_programme = models.TextField(db_column="Target_programme", null=True, blank=True)
    invite_to_platform = models.BooleanField(db_column="Invite_to_platform", null=True, blank=True)
    allow_access_to_checkpoint = models.BooleanField(db_column="Allow_access_to_checkpoint", null=True, blank=True)
    allow_access_to_console = models.BooleanField(db_column="Allow_access_to_console", null=True, blank=True)
    allow_access_to_classic = models.BooleanField(db_column="Allow_access_to_classic", null=True, blank=True)

    # --- personal / address (pre-existing columns, now written by the form) ---
    legal_sex = models.TextField(db_column="Legal_Sex", null=True, blank=True)
    age = models.TextField(db_column="Age", null=True, blank=True)
    address = models.TextField(db_column="Address", null=True, blank=True)
    current_postcode = models.TextField(db_column="Current_postcode", null=True, blank=True)
    address_line_1 = models.TextField(db_column="Current_address_line_1", null=True, blank=True)
    address_line_2 = models.TextField(db_column="Current_address_line_2", null=True, blank=True)
    address_line_3 = models.TextField(db_column="Current_address_line_3", null=True, blank=True)
    address_line_4 = models.TextField(db_column="Current_address_line_4", null=True, blank=True)
    national_insurance_number = models.TextField(db_column="National_insurance_number", null=True, blank=True)

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
        # Emitted by Django as "enrolment"."Created_users".
        # The single learner table: both apprenticeship and commercial learners
        # live here, told apart by "Learner_type". It replaced the old
        # Enrolment_Users + Commercial_users pair — see the
        # create_created_users_table management command.
        db_table = 'enrolment"."Created_users'

    def save(self, *args, **kwargs):
        # Default a new row to apprenticeship. The CommercialUser proxy overrides
        # this with 'commercial'; without a value the row would be invisible to
        # the commercial manager and only reachable via all_learners.
        if not self.learner_type:
            self.learner_type = "apprenticeship"
            update_fields = kwargs.get("update_fields")
            if update_fields is not None and "learner_type" not in update_fields:
                kwargs["update_fields"] = [*update_fields, "learner_type"]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}>"


class CommercialUser(EnrolmentUser):
    """Commercial (delivery) learners — a view onto the merged learner table.

    Commercial_users was folded into Enrolment_Users by the
    merge_commercial_into_enrolment command, so this is now a proxy over the same
    table whose default manager only sees rows with Learner_type='commercial'.
    Existing call sites (CommercialUser.objects.get/filter/create) keep working
    and stay scoped to commercial learners.

    Because it's a proxy, every column on EnrolmentUser is available here too —
    including the apprenticeship-only compliance/ILR columns, which commercial
    rows simply leave null.
    """

    objects = CommercialManager()

    class Meta:
        proxy = True

    def save(self, *args, **kwargs):
        # A row created through this proxy is a commercial learner; stamp the
        # discriminator so the manager's filter can find it again.
        if not self.learner_type:
            self.learner_type = "commercial"
            update_fields = kwargs.get("update_fields")
            if update_fields is not None and "learner_type" not in update_fields:
                kwargs["update_fields"] = [*update_fields, "learner_type"]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}>"


class StaffUser(models.Model):
    """Unmanaged mapping of enrolment."Staff_users" — non-learner accounts.

    Backs the Create menu's "Create admin" path. Case owners, admins, enrolment
    officers and the curriculum/operations teams are staff, not learners, so they
    get their own table rather than sharing Enrolment_Users. `position` is
    constrained to constants.POSITION_CHOICES by the API.

    Created by the apply_staff_users_table management command; `id` is GENERATED
    ALWAYS AS IDENTITY, so Django never supplies it on insert.
    """

    id = models.AutoField(primary_key=True, db_column="id")

    username = models.TextField(db_column="Username", null=True, blank=True)
    email = models.TextField(db_column="Email", null=True, blank=True)
    phone_number = models.TextField(db_column="Phone_number", null=True, blank=True)
    type = models.TextField(db_column="Type", null=True, blank=True)
    status = models.TextField(db_column=" Status", null=True, blank=True)  # NB: leading space, matches the learner tables
    # One of constants.POSITION_CHOICES.
    position = models.TextField(db_column="Position", null=True, blank=True)

    title = models.TextField(db_column="Title", null=True, blank=True)
    preferred_name = models.TextField(db_column="Preferred_name", null=True, blank=True)
    gender = models.TextField(db_column="Gender", null=True, blank=True)
    date_of_birth = models.TextField(db_column="Date_of_birth", null=True, blank=True)
    organization = models.TextField(db_column="Orgnization", null=True, blank=True)  # source spelling, as elsewhere
    case_owner = models.TextField(db_column="Case_owner", null=True, blank=True)
    learning_provider = models.TextField(db_column="Learning_provider", null=True, blank=True)
    reference_number = models.TextField(db_column="Reference_number", null=True, blank=True)

    invite_to_platform = models.BooleanField(db_column="Invite_to_platform", null=True, blank=True)
    allow_access_to_checkpoint = models.BooleanField(db_column="Allow_access_to_checkpoint", null=True, blank=True)
    allow_access_to_console = models.BooleanField(db_column="Allow_access_to_console", null=True, blank=True)
    allow_access_to_classic = models.BooleanField(db_column="Allow_access_to_classic", null=True, blank=True)

    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)
    updated_at = models.DateTimeField(db_column="Updated_at", auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "enrolment"."Staff_users".
        db_table = 'enrolment"."Staff_users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}> [{self.position or 'no position'}]"


class LearnerProfile(models.Model):
    """Permanent learner identity shared by active and inactive workflows."""

    id = models.BigAutoField(primary_key=True)
    full_name = models.TextField()
    email = models.EmailField(max_length=320, unique=True)
    # GENERATED ALWAYS in Postgres — the database derives it from `email`, and an
    # INSERT/UPDATE that names the column is rejected outright. `editable=False`
    # only hides a field from forms; it stays in the write. GeneratedField with
    # db_persist=True tells Django the DB owns the value, so it is read back but
    # never written. (Without this, promoting a learner to Active fails with
    # "cannot insert a non-DEFAULT value into column email_normalized".)
    email_normalized = models.GeneratedField(
        expression=Lower(Trim("email")),
        output_field=models.TextField(),
        db_persist=True,
    )
    phone_number = models.TextField(blank=True)
    lifecycle_status = models.CharField(max_length=50, db_index=True)
    programme = models.TextField(blank=True)
    programme_status = models.CharField(max_length=100, blank=True)
    cohort = models.TextField(blank=True)
    group_name = models.TextField(blank=True)
    completed_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    target_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    minimum_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    maximum_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    planned_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    progress_hours = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    progress_variance = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    otjh_status = models.CharField(max_length=50, blank=True)
    coach_name = models.TextField(blank=True)
    coach_email = models.EmailField(max_length=320, blank=True)
    coach_rag = models.CharField(max_length=20, blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    gateway_review_date = models.DateField(null=True, blank=True)
    alert_notify_for_epa = models.DateField(null=True, blank=True)
    enter_epa = models.DateField(null=True, blank=True)
    # NOT NULL with a now() default in Postgres. Declared bare, Django sent an
    # explicit NULL on insert and the constraint rejected the row, so promoting a
    # learner to Active could not create their mirror. auto_now_add/auto_now make
    # Django supply the timestamps itself.
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learners'

    def __str__(self):
        return f"{self.full_name or 'Unnamed'} <{self.email}>"

    @property
    def username(self):
        return self.full_name

    @property
    def group(self):
        return self.group_name

    @property
    def status(self):
        return self.lifecycle_status

    @property
    def ksbs(self):
        return [
            {
                "code": item.code,
                "number": item.number,
                "type": item.ksb_type,
                "description": item.description,
            }
            for item in self.assigned_ksbs.all()
        ]

    @property
    def training_plan(self):
        modules = []
        for module in self.plan_modules.all():
            weeks = []
            for week in module.weeks.all():
                components = [
                    {
                        "componentId": component.component_ref,
                        "componentTitle": component.component_title,
                    }
                    for component in week.components.all()
                ]
                weeks.append(
                    {
                        "weekId": week.week_ref,
                        "weekTitle": week.week_title,
                        "components": components,
                    }
                )
            modules.append(
                {
                    "moduleId": module.module_ref,
                    "moduleTitle": module.module_title,
                    "weeks": weeks,
                }
            )
        return modules

    @property
    def training_plan_progress(self):
        records = []
        for entry in self.progress_entries.all():
            record = {
                "kind": entry.kind,
                "moduleId": entry.module_ref,
                "moduleTitle": entry.module_title,
                "weekId": entry.week_ref,
                "weekTitle": entry.week_title,
                "componentId": entry.component_ref,
                "componentTitle": entry.component_title,
                "componentType": entry.component_type,
                "quizId": _serialise_quiz_ref(entry.quiz_ref),
                "attempt": entry.attempt,
                "grade": float(entry.grade) if entry.grade is not None else None,
                "achievedScore": float(entry.achieved_score) if entry.achieved_score is not None else None,
                "totalScore": float(entry.total_score) if entry.total_score is not None else None,
                "passed": entry.passed,
                "feedback": entry.feedback,
                "reportedTime": entry.reported_time,
                "startedAt": entry.started_at.isoformat() if entry.started_at else "",
                "submittedAt": entry.submitted_at.isoformat() if entry.submitted_at else "",
                "timeTaken": entry.time_taken,
                "ksbs": [
                    row.ksb_code
                    for row in entry.ksb_links.all()
                ],
            }
            if entry.kind == "quiz":
                record["questions"] = [
                    {
                        "questionId": answer.question_ref,
                        "chosenAnswerId": (
                            [
                                choice.answer_ref
                                for choice in answer.chosen_answers.all()
                            ]
                            if answer.chosen_answers.exists()
                            else answer.chosen_answer_ref
                        ),
                        "correct": answer.is_correct,
                        "earned": float(answer.earned) if answer.earned is not None else None,
                        "correctAnswerId": [
                            key.answer_ref
                            for key in answer.correct_answers.all()
                        ],
                    }
                    for answer in entry.quiz_answers.all()
                ]
            records.append({key: value for key, value in record.items() if value not in (None, "")})
        return records

    @property
    def activity_feed(self):
        return self.activity_feed_entries()

    def activity_feed_entries(self, *, newest_first=False):
        entries = [
            {
                "kind": event.kind,
                "action": event.action,
                "title": event.title,
                "detail": event.detail,
                "componentId": event.component_ref,
                "componentType": event.component_type,
                "quizId": _serialise_quiz_ref(event.quiz_ref),
                "module": event.module_title,
                "week": event.week_title,
                "passed": event.passed,
                "at": event.occurred_at.isoformat() if event.occurred_at else "",
            }
            for event in self.activity_events.all()
        ]
        return list(reversed(entries)) if newest_first else entries

    @property
    def latest_activity_feed(self):
        """Newest-first feed from Learner.learner_activity_events."""
        return self.activity_feed_entries(newest_first=True)


class LearnerKsb(models.Model):
    learner = models.ForeignKey(LearnerProfile, on_delete=models.CASCADE, related_name="assigned_ksbs")
    position = models.PositiveIntegerField()
    code = models.CharField(max_length=100)
    number = models.CharField(max_length=100, blank=True)
    ksb_type = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_ksbs'
        ordering = ("position", "id")


class LearnerTrainingPlanModule(models.Model):
    learner = models.ForeignKey(LearnerProfile, on_delete=models.CASCADE, related_name="plan_modules")
    position = models.PositiveIntegerField()
    module_ref = models.TextField(null=True, blank=True)
    module_title = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_training_plan_modules'
        ordering = ("position", "id")


class LearnerTrainingPlanWeek(models.Model):
    plan_module = models.ForeignKey(
        LearnerTrainingPlanModule,
        on_delete=models.CASCADE,
        related_name="weeks",
    )
    position = models.PositiveIntegerField()
    week_ref = models.TextField(null=True, blank=True)
    week_title = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_training_plan_weeks'
        ordering = ("position", "id")


class LearnerTrainingPlanComponent(models.Model):
    plan_week = models.ForeignKey(
        LearnerTrainingPlanWeek,
        on_delete=models.CASCADE,
        related_name="components",
    )
    position = models.PositiveIntegerField()
    component_ref = models.TextField(null=True, blank=True)
    component_title = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_training_plan_components'
        ordering = ("position", "id")


class LearnerProgressEntry(models.Model):
    learner = models.ForeignKey(LearnerProfile, on_delete=models.CASCADE, related_name="progress_entries")
    entry_order = models.PositiveIntegerField()
    kind = models.CharField(max_length=30)
    module_ref = models.TextField(null=True, blank=True)
    module_title = models.TextField(blank=True)
    week_ref = models.TextField(null=True, blank=True)
    week_title = models.TextField(blank=True)
    component_ref = models.TextField(null=True, blank=True)
    component_title = models.TextField(blank=True)
    component_type = models.CharField(max_length=100, blank=True)
    quiz_ref = models.TextField(null=True, blank=True)
    attempt = models.PositiveIntegerField(null=True, blank=True)
    grade = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    achieved_score = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_score = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    passed = models.BooleanField(null=True, blank=True)
    feedback = models.TextField(blank=True)
    reported_time = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    time_taken = models.TextField(blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_progress_entries'
        ordering = ("entry_order", "id")


class LearnerProgressKsb(models.Model):
    pk = models.CompositePrimaryKey("progress_id", "position")
    progress = models.ForeignKey(LearnerProgressEntry, on_delete=models.CASCADE, related_name="ksb_links")
    position = models.PositiveIntegerField()
    ksb_code = models.CharField(max_length=100)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_progress_ksbs'
        unique_together = (("progress", "position"),)
        ordering = ("position",)


class LearnerQuizAnswer(models.Model):
    progress = models.ForeignKey(LearnerProgressEntry, on_delete=models.CASCADE, related_name="quiz_answers")
    position = models.PositiveIntegerField()
    question_ref = models.BigIntegerField()
    chosen_answer_ref = models.BigIntegerField(null=True, blank=True)
    is_correct = models.BooleanField(null=True, blank=True)
    earned = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_quiz_answers'
        ordering = ("position", "id")


class LearnerQuizCorrectAnswer(models.Model):
    pk = models.CompositePrimaryKey("quiz_answer_id", "position")
    quiz_answer = models.ForeignKey(
        LearnerQuizAnswer,
        on_delete=models.CASCADE,
        related_name="correct_answers",
    )
    position = models.PositiveIntegerField()
    answer_ref = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'Learner"."learner_quiz_correct_answers'
        unique_together = (("quiz_answer", "position"),)
        ordering = ("position",)


class LearnerQuizChosenAnswer(models.Model):
    pk = models.CompositePrimaryKey("quiz_answer_id", "position")
    quiz_answer = models.ForeignKey(
        LearnerQuizAnswer,
        on_delete=models.CASCADE,
        related_name="chosen_answers",
    )
    position = models.PositiveIntegerField()
    answer_ref = models.BigIntegerField()

    class Meta:
        managed = False
        db_table = 'Learner"."learner_quiz_chosen_answers'
        unique_together = (("quiz_answer", "position"),)
        ordering = ("position",)


class LearnerActivityEvent(models.Model):
    learner = models.ForeignKey(LearnerProfile, on_delete=models.CASCADE, related_name="activity_events")
    event_order = models.PositiveIntegerField()
    kind = models.CharField(max_length=30, blank=True)
    action = models.TextField(blank=True)
    title = models.TextField(blank=True)
    detail = models.TextField(blank=True)
    component_ref = models.TextField(null=True, blank=True)
    component_type = models.CharField(max_length=100, blank=True)
    quiz_ref = models.TextField(null=True, blank=True)
    module_title = models.TextField(blank=True)
    week_title = models.TextField(blank=True)
    passed = models.BooleanField(null=True, blank=True)
    occurred_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."learner_activity_events'
        ordering = ("event_order", "id")


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
    # Cohort delivery window, copied from curriculum."cohort_authoring_details"
    # (matched by Programme + Cohort name — see cohort_dates in active_users.py).
    # Refreshed on every Active mirror sync.
    start_date = models.DateField(db_column="Start_date", null=True, blank=True)
    end_date = models.DateField(db_column="End_date", null=True, blank=True)
    # Maintained by a database trigger whenever End_date changes.
    alert_notify_for_epa = models.DateField(db_column="Alert_notify_for_EPA", null=True, blank=True)
    enter_epa = models.DateField(db_column="Enter_EPA", null=True, blank=True)
    gateway_review_date = models.DateField(db_column="Gateway_review_date", null=True, blank=True)
    minimum_hours = models.TextField(db_column="Minimum_hours", null=True, blank=True)
    maximum_hours = models.TextField(db_column="Maximum_hours", null=True, blank=True)
    # Coach contact, set per-learner on the delivery "Enrolled learners" page and
    # stored on the mirror only. Preserved across re-syncs because sync_active_user
    # uses UPDATE with a fixed field list that excludes these (see active_users.py);
    # a status toggle to non-Active deletes the row, so coach data is re-entered on
    # reactivation. Real DB columns are lowercase (unlike the rest of this table).
    coach_name = models.TextField(db_column="coach_name", null=True, blank=True)
    coach_email = models.TextField(db_column="coach_email", null=True, blank=True)
    coach_rag = models.TextField(db_column="coach_rag", null=True, blank=True)
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
    ksbs = SafeJSONField(db_column="KSBs", null=True, blank=True)
    # Quiz attempts: [{week, attempt, grade, Score, module, passed, quizId, quizName,
    # ksbs, feedback, reportedTime, questions, startedAt, submittedAt, timeTaken}, ...]
    # — legacy read-only store; new attempts go to training_plan_progress.
    weekly_quizzes = SafeJSONField(db_column="Weekly_Quizzes", null=True, blank=True)
    # Legacy mirror of the learner activity feed. Current dashboards read from
    # Learner.learner_activity_events via LearnerProfile.activity_feed_entries().
    activity_feed = SafeJSONField(db_column="Activity_Feed", null=True, blank=True)
    # Legacy mirror of the learner progress log. Current dashboards read from
    # Learner.learner_progress_entries via LearnerProfile.training_plan_progress.
    training_plan_progress = SafeJSONField(db_column="Training_plan_progress", null=True, blank=True)

    class Meta:
        managed = False
        # Emitted by Django as "Learner"."Active_users".
        db_table = 'Learner"."Active_users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}>"


class UnactiveUser(models.Model):
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
    # Cohort delivery window, mirrored from the Active_users row on archive
    # (copied automatically by _archive_active_user's shared-field loop).
    start_date = models.DateField(db_column="Start_date", null=True, blank=True)
    end_date = models.DateField(db_column="End_date", null=True, blank=True)
    # Maintained by the same database trigger as the active mirror.
    alert_notify_for_epa = models.DateField(db_column="Alert_notify_for_EPA", null=True, blank=True)
    enter_epa = models.DateField(db_column="Enter_EPA", null=True, blank=True)
    gateway_review_date = models.DateField(db_column="Gateway_review_date", null=True, blank=True)
    coach_name = models.TextField(db_column="coach_name", null=True, blank=True)
    coach_email = models.TextField(db_column="coach_email", null=True, blank=True)
    coach_rag = models.TextField(db_column="coach_rag", null=True, blank=True)
    completed_hours = models.TextField(db_column="Completed_hours", null=True, blank=True)
    # The non-Active status the learner currently holds (e.g. "Withdrawn", "On break").
    status = models.TextField(db_column="status", null=True, blank=True)

    training_plan = SafeJSONField(db_column="Training_plan", null=True, blank=True)
    ksbs = SafeJSONField(db_column="KSBs", null=True, blank=True)
    # Legacy archive mirror retained for compatibility; current UI reads from
    # Learner.learner_progress_entries when a learner profile is available.
    training_plan_progress = SafeJSONField(db_column="Training_plan_progress", null=True, blank=True)
    # Legacy mirror retained for archive compatibility; current UI reads from
    # Learner.learner_activity_events when the learner has an active profile.
    activity_feed = SafeJSONField(db_column="Activity_Feed", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'Learner"."Unactive_users'

    def __str__(self):
        return f"{self.username or 'Unnamed'} <{self.email or 'no-email'}> [{self.status or '?'}]"


class LearnerAbsence(models.Model):
    """Stored attendance/absence summary used by the coach attendance table."""

    learner_email = models.EmailField(primary_key=True, db_column="learner_email")
    learner_id = models.IntegerField(db_column="learner_id")
    learner_name = models.TextField(db_column="learner_name")
    sessions = models.PositiveIntegerField(db_column="sessions", default=0)
    present = models.PositiveIntegerField(db_column="present", default=0)
    absent = models.PositiveIntegerField(db_column="absent", default=0)
    late = models.PositiveIntegerField(db_column="late", default=0)
    catchup = models.PositiveIntegerField(db_column="catchup", default=0)
    risk = models.CharField(db_column="risk", max_length=16, blank=True)
    last_session_date = models.DateField(db_column="last_session_date", null=True, blank=True)
    consecutive_missed = models.PositiveIntegerField(db_column="consecutive_missed", default=0)
    updated_at = models.DateTimeField(db_column="updated_at", auto_now=True)

    class Meta:
        managed = False
        db_table = 'Learner"."Absence'

    def __str__(self):
        return f"{self.learner_name}: {self.present}/{self.sessions} present"
