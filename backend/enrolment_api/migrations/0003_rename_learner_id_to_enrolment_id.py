"""Rename the wizard/ILR field learner_id -> enrolment_id in Django state only.

The value is enrolment."Created_users".id, so the Python name now says so.
The physical column stays "Learner_id" (models keep db_column="Learner_id"),
which makes this migration state-only: it issues no DDL and is safe to apply
before the coordinated identity release.

The column rename itself ships with that release as reviewed SQL
(backend/sql/identity_normalisation/), together with the code change that
drops the db_column shim. Never put that DDL back here: a migration that
renames a column ahead of the matching code breaks every running service.
"""
from django.db import migrations


MODELS = (
    'extendedilr',
    'wizardpersonaldetails',
    'wizardilrlearnerdetails',
    'wizardskillsradar',
    'wizardksbassessment',
    'wizardplr',
    'wizardplrrecord',
    'wizardpolicyack',
    'wizardcvjob',
)


class Migration(migrations.Migration):
    dependencies = [('enrolment_api', '0002_wizardilrlearnerdetails')]

    operations = [
        migrations.RenameField(model_name, 'learner_id', 'enrolment_id')
        for model_name in MODELS
    ]
