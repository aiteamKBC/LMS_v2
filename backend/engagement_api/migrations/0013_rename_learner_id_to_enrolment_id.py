"""Rename learner_id → enrolment_id in all 15 Engagement/Feedback unmanaged tables.

The Python ORM fields were already renamed in models.py with db_column='learner_id'
as a backward-compatibility shim. This migration applies the matching DDL so the
actual database columns align with the ORM field names.

After this migration runs, the db_column='learner_id' shims in models.py must be
removed (each model field's db_column kwarg is dropped — the field name 'enrolment_id'
then becomes the column name by Django's default convention).

Rollback: apply the ROLLBACK SQL, re-add db_column='learner_id' to all 15 fields.
"""
from django.db import migrations, models


FORWARD_SQL = '''
SET LOCAL lock_timeout = '5s';

-- Engagement schema tables
ALTER TABLE "Engagement"."voucher_claims"            RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."recognitions"              RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."event_bookings"            RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."club_memberships"          RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."club_meeting_attendance"   RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."event_attendance"          RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."attendance_interventions"  RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."points_grants"             RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Engagement"."flash_card_views"          RENAME COLUMN learner_id TO enrolment_id;

-- Feedback schema tables
ALTER TABLE "Feedback"."feedback_delivery_recipients"       RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback"."feedback_review_deliveries"         RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback"."feedback_employer_review_deliveries" RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback"."feedback_event_recipients"          RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback"."event_rsvp_recipients"              RENAME COLUMN learner_id TO enrolment_id;
ALTER TABLE "Feedback"."feedback_responses"                 RENAME COLUMN learner_id TO enrolment_id;
'''

ROLLBACK_SQL = '''
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Engagement"."voucher_claims"            RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."recognitions"              RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."event_bookings"            RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."club_memberships"          RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."club_meeting_attendance"   RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."event_attendance"          RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."attendance_interventions"  RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."points_grants"             RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Engagement"."flash_card_views"          RENAME COLUMN enrolment_id TO learner_id;

ALTER TABLE "Feedback"."feedback_delivery_recipients"       RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback"."feedback_review_deliveries"         RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback"."feedback_employer_review_deliveries" RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback"."feedback_event_recipients"          RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback"."event_rsvp_recipients"              RENAME COLUMN enrolment_id TO learner_id;
ALTER TABLE "Feedback"."feedback_responses"                 RENAME COLUMN enrolment_id TO learner_id;
'''


def apply_forward(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Tests create unmanaged tables in temporary SQLite files.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Learner-id rename requires the canonical PostgreSQL default database.')
    schema_editor.execute(FORWARD_SQL, params=None)


def apply_rollback(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Learner-id rename rollback requires the canonical PostgreSQL default database.')
    schema_editor.execute(ROLLBACK_SQL, params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0012_epa_review_feedback')]

    operations = [
        migrations.RunPython(apply_forward, apply_rollback),

        # State-only AlterField operations (managed=False means no DDL is generated
        # for these; they keep Django's migration state table in sync with models.py).
        migrations.AlterField(
            model_name='voucherclaim', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='recognition', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='eventbooking', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='clubmembership', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='clubmeetingattendance', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='eventattendance', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='attendanceintervention', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='pointsgrant', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='flashcardview', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='feedbackdeliveryrecipient', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='feedbackreviewdelivery', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='feedbackemployerreviewdelivery', name='enrolment_id',
            field=models.CharField(max_length=100),
        ),
        migrations.AlterField(
            model_name='feedbackeventrecipient', name='enrolment_id',
            field=models.CharField(max_length=100, blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='eventrsvprecipient', name='enrolment_id',
            field=models.CharField(max_length=100, blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='feedbackresponse', name='enrolment_id',
            field=models.CharField(max_length=100, blank=True, default=''),
        ),
    ]
