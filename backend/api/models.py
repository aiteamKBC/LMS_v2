"""Unmanaged mapping of the existing Neon table enrolment."Enrolment_Users".

The table was created outside Django, so `managed = False` — Django never issues
DDL for it. Column names in the source table are irregular (leading spaces, mixed
case, slashes), so each field pins its exact `db_column`. The schema is targeted
with the `schema"."table` quoting trick, which Django emits as
`"enrolment"."Enrolment_Users"` — avoiding a search_path startup option that the
Neon connection pooler may reject.
"""
from django.db import models


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
    learning_plan = models.TextField(db_column="Learning_plan", null=True, blank=True)
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
