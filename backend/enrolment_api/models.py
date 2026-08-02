"""Unmanaged mapping of enrolment."Extended_ILR".

One row per learner, holding the answers captured on the wizard's Extended ILR
step. The learner is identified by (learner_kind, learner_id) rather than a
foreign key: the pairing dates from when apprenticeship and commercial learners
lived in two separate tables. They now share enrolment."Created_users" (told
apart by its "Learner_type" column), so learner_id alone is unique and
learner_kind is retained only to keep existing rows resolvable.

The answers themselves are stored as a single jsonb document rather than ~45
columns: the form is a compliance questionnaire that gets reworded whenever the
ESFA revises it, and a document column absorbs added or renamed questions
without DDL. The columns broken out flat are the ones other features need to
query or report on (signature state and completion).

`managed = False` — the table is created by the apply_extended_ilr_table
management command, matching how every other enrolment table is handled here.
"""
from django.db import models

from learner_api.models import SafeJSONField


class ExtendedIlr(models.Model):
    id = models.AutoField(primary_key=True, db_column="id")

    # --- learner identity (see module docstring: two source tables) ---
    learner_kind = models.TextField(db_column="Learner_kind")  # 'apprenticeship' | 'commercial'
    learner_id = models.BigIntegerField(db_column="Learner_id")
    learner_name = models.TextField(db_column="Learner_name", null=True, blank=True)

    # --- the questionnaire itself ---
    answers = SafeJSONField(db_column="Answers", null=True, blank=True)

    # The wizard's other steps (personal details, skills radar, PLR, CV/job,
    # policies). Same reasoning as Answers: one document rather than columns, so
    # a step gaining a field needs no DDL.
    wizard_draft = SafeJSONField(db_column="Wizard_draft", null=True, blank=True)

    # --- flat columns other features report on ---
    learner_signed = models.BooleanField(db_column="Learner_signed", default=False)
    learner_signed_date = models.TextField(db_column="Learner_signed_date", null=True, blank=True)
    provider_signed = models.BooleanField(db_column="Provider_signed", default=False)
    provider_signed_date = models.TextField(db_column="Provider_signed_date", null=True, blank=True)
    completed = models.BooleanField(db_column="Completed", default=False)

    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)
    updated_at = models.DateTimeField(db_column="Updated_at", auto_now=True)

    class Meta:
        managed = False
        # Emitted by Django as "enrolment"."Extended_ILR".
        db_table = 'enrolment"."Extended_ILR'

    def __str__(self):
        return f"Extended ILR {self.learner_kind}:{self.learner_id}"


# ---------------------------------------------------------------------------
# Per-step wizard tables.
#
# These hold the same data as ExtendedIlr.wizard_draft, but as real columns and
# rows so it can be queried and reported on ("who hasn't acknowledged policy X",
# "every learner rating themselves 'rarely' on K3"). The draft column remains the
# resume/audit snapshot. Created by apply_enrolment_wizard_tables, hence
# managed = False like every other table in this schema.
# ---------------------------------------------------------------------------


class _LearnerScoped(models.Model):
    """Shared identity for the wizard tables: (learner_kind, learner_id).

    Not a foreign key: the pairing dates from when apprenticeship and commercial
    learners lived in two separate tables. Both now share
    enrolment."Created_users", so learner_id alone identifies a learner and
    learner_kind is kept only so existing rows keep resolving.
    """

    id = models.AutoField(primary_key=True, db_column="id")
    learner_kind = models.TextField(db_column="Learner_kind")
    learner_id = models.BigIntegerField(db_column="Learner_id")
    created_at = models.DateTimeField(db_column="Created_at", auto_now_add=True)
    updated_at = models.DateTimeField(db_column="Updated_at", auto_now=True)

    class Meta:
        abstract = True


class WizardPersonalDetails(_LearnerScoped):
    first_name = models.TextField(db_column="First_name", null=True, blank=True)
    last_name = models.TextField(db_column="Last_name", null=True, blank=True)
    email = models.TextField(db_column="Email", null=True, blank=True)
    phone = models.TextField(db_column="Phone", null=True, blank=True)
    address = models.TextField(db_column="Address", null=True, blank=True)
    date_of_birth = models.DateField(db_column="Date_of_birth", null=True, blank=True)
    age = models.IntegerField(db_column="Age", null=True, blank=True)
    sex = models.TextField(db_column="Sex", null=True, blank=True)
    # PNG data URL — drawn in the browser or uploaded (see SignaturePad.tsx).
    signature = models.TextField(db_column="Signature", null=True, blank=True)
    signature_date = models.DateField(db_column="Signature_date", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Personal_Details'


class WizardSkillsRadar(_LearnerScoped):
    standard_id = models.TextField(db_column="Standard_id", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Skills_Radar'


class WizardKsbAssessment(_LearnerScoped):
    ksb_id = models.TextField(db_column="Ksb_id")
    level = models.TextField(db_column="Level", null=True, blank=True)
    # 8..1 for `level`, denormalised for reporting (see LEVEL_SCORES).
    score = models.IntegerField(db_column="Score", null=True, blank=True)
    note = models.TextField(db_column="Note", null=True, blank=True)
    action_text = models.TextField(db_column="Action_text", null=True, blank=True)
    action = models.TextField(db_column="Action", null=True, blank=True)
    goal = models.TextField(db_column="Goal", null=True, blank=True)
    due_date = models.DateField(db_column="Due_date", null=True, blank=True)
    evidence_files = SafeJSONField(db_column="Evidence_files", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Ksb_Assessments'


class WizardPlr(_LearnerScoped):
    uln = models.TextField(db_column="ULN", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Plr'


class WizardPlrRecord(_LearnerScoped):
    record_ref = models.TextField(db_column="Record_ref")
    place_of_study = models.TextField(db_column="Place_of_study", null=True, blank=True)
    qualification_type = models.TextField(db_column="Qualification_type", null=True, blank=True)
    subject = models.TextField(db_column="Subject", null=True, blank=True)
    level = models.TextField(db_column="Level", null=True, blank=True)
    award_date = models.DateField(db_column="Award_date", null=True, blank=True)
    credits = models.IntegerField(db_column="Credits", null=True, blank=True)
    grade = models.TextField(db_column="Grade", null=True, blank=True)
    record_type = models.TextField(db_column="Record_type", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Plr_Records'


class WizardCvJob(_LearnerScoped):
    cv_file = models.TextField(db_column="Cv_file", null=True, blank=True)
    experience_text = models.TextField(db_column="Experience_text", null=True, blank=True)
    pm_qualifications = models.TextField(db_column="PM_qualifications", null=True, blank=True)
    functional_skills_enrol = models.TextField(db_column="Functional_skills_enrol", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Cv_Job'


class WizardPolicyAck(_LearnerScoped):
    policy_id = models.TextField(db_column="Policy_id")
    acknowledged = models.BooleanField(db_column="Acknowledged", default=False)
    acknowledged_at = models.DateTimeField(db_column="Acknowledged_at", null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'enrolment"."Wizard_Policy_Acks'
