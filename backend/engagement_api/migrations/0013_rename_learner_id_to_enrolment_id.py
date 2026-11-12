"""Rename the Engagement/Feedback field learner_id -> enrolment_id in Django state only.

The value is str(enrolment."Created_users".id), so the Python name now says so.
The physical column stays learner_id (models keep db_column='learner_id'), so
this migration is state-only: every model here is unmanaged and it issues no
DDL. It is safe to apply before the coordinated identity release.

RenameField alone would move the implied column to enrolment_id; the
AlterField pins it back to learner_id so state matches models.py exactly.

The column rename itself ships with that release as reviewed SQL
(backend/sql/identity_normalisation/), together with the code change that
drops the db_column shim. Never put that DDL back here: a migration that
renames a column ahead of the matching code breaks every running service.
"""
from django.db import migrations, models


REQUIRED = (
    'voucherclaim',
    'recognition',
    'eventbooking',
    'clubmembership',
    'clubmeetingattendance',
    'eventattendance',
    'attendanceintervention',
    'pointsgrant',
    'flashcardview',
    'feedbackdeliveryrecipient',
    'feedbackreviewdelivery',
    'feedbackemployerreviewdelivery',
)
OPTIONAL = (
    'feedbackeventrecipient',
    'eventrsvprecipient',
    'feedbackresponse',
)


def _rename(model_name, field):
    return [
        migrations.RenameField(model_name, 'learner_id', 'enrolment_id'),
        migrations.AlterField(model_name=model_name, name='enrolment_id', field=field),
    ]


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0012_epa_review_feedback')]

    operations = [
        op
        for model_name in REQUIRED
        for op in _rename(model_name, models.CharField(max_length=100, db_column='learner_id'))
    ] + [
        op
        for model_name in OPTIONAL
        for op in _rename(
            model_name,
            models.CharField(max_length=100, blank=True, default='', db_column='learner_id'),
        )
    ]
