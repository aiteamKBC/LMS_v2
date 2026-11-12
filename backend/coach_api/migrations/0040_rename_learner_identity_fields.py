"""Rename coach learner_id fields to the identity namespace they hold. State only.

Nine fields hold Learner.learners.id and become learner_profile_id;
CoachAbsenceReport's holds enrolment."Created_users".id and becomes
enrolment_id. Every physical column stays learner_id (models keep
db_column='learner_id').

These models are managed, so a bare RenameField would issue
ALTER TABLE ... RENAME COLUMN. SeparateDatabaseAndState keeps this migration
DDL-free; without it, makemigrations reads the rename as RemoveField +
AddField, which would drop the column and its history.

The column rename ships with the coordinated identity release as reviewed SQL
(backend/sql/identity_normalisation/), together with the code change that
drops the db_column shims.
"""
from django.db import migrations, models


FIELDS = (
    # (model, new name, field as declared in models.py)
    ('coachcalendarevent', 'learner_profile_id', models.IntegerField(db_index=True, db_column='learner_id')),
    ('reviewbookingreschedule', 'learner_profile_id', models.IntegerField(db_column='learner_id')),
    ('importedreviewinstance', 'learner_profile_id', models.IntegerField(db_index=True, db_column='learner_id')),
    ('importedmeetingownership', 'learner_profile_id', models.IntegerField(db_column='learner_id')),
    ('reviewsourcereconciliation', 'learner_profile_id', models.BigIntegerField(db_column='learner_id')),
    ('coachcalendarsequence', 'learner_profile_id', models.IntegerField(db_column='learner_id')),
    ('coachabsencereport', 'enrolment_id', models.IntegerField(db_index=True, db_column='learner_id')),
    ('coachmanualattendance', 'learner_profile_id', models.IntegerField(db_index=True, db_column='learner_id')),
    ('coachattendancesourceadjustment', 'learner_profile_id', models.IntegerField(db_index=True, db_column='learner_id')),
    ('reviewattendancelink', 'learner_profile_id', models.IntegerField(db_column='learner_id')),
)


# RenameField leaves the old name inside index/constraint definitions, so
# these are re-declared with the new name. The physical index/constraint is
# untouched: same name, same column.
INDEXES = (
    ('coachabsencereport', models.Index(fields=['enrolment_id', '-session_date'], name='coach_abs_learner_date_idx')),
    ('coachcalendarevent', models.Index(fields=['learner_profile_id', 'event_type', 'target_date'], name='coach_learner_type_date_idx')),
    ('coachmanualattendance', models.Index(fields=['owner_email', 'learner_profile_id', '-session_date'], name='coach_manual_att_owner_idx')),
)
CONSTRAINTS = (
    ('coachcalendarevent', models.UniqueConstraint(
        fields=['learner_profile_id', 'event_type', 'sequence'],
        condition=models.Q(event_type__in=[
            'catch-up', 'student-support', 'eligibility-review', 'workspace', 'training-plan', 'uln-privacy',
        ]),
        name='coach_calendar_booking_seq_uniq',
    )),
    ('coachcalendarsequence', models.UniqueConstraint(
        fields=['learner_profile_id', 'event_type'], name='coach_calendar_sequence_scope_uniq',
    )),
    ('coachattendancesourceadjustment', models.UniqueConstraint(
        fields=['learner_profile_id', 'source', 'source_id'], name='coach_attendance_adjustment_source_uniq',
    )),
)


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0039_review_reschedule_evidence')]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                op
                for model_name, new_name, field in FIELDS
                for op in (
                    migrations.RenameField(model_name, 'learner_id', new_name),
                    migrations.AlterField(model_name=model_name, name=new_name, field=field),
                )
            ] + [
                op
                for model_name, index in INDEXES
                for op in (
                    migrations.RemoveIndex(model_name=model_name, name=index.name),
                    migrations.AddIndex(model_name=model_name, index=index),
                )
            ] + [
                op
                for model_name, constraint in CONSTRAINTS
                for op in (
                    migrations.RemoveConstraint(model_name=model_name, name=constraint.name),
                    migrations.AddConstraint(model_name=model_name, constraint=constraint),
                )
            ],
        ),
    ]
