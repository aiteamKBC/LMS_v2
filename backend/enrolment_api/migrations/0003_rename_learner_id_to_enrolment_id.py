"""Rename Learner_id → enrolment_id in all 9 enrolment wizard/ILR tables.

The Python ORM fields were already renamed in models.py from learner_id to
enrolment_id with db_column="Learner_id" as a backward-compatibility shim.
This migration applies the matching DDL and updates Django's state table.

After this migration runs, the db_column="Learner_id" shims in models.py
must be removed (the field name 'enrolment_id' then maps directly).

Rollback: apply the ROLLBACK SQL, re-add db_column="Learner_id" to all 9.
"""
from django.db import migrations, models


FORWARD_SQL = '''
SET LOCAL lock_timeout = '5s';

ALTER TABLE enrolment."Extended_ILR"              RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Personal_Details"   RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Ilr_Learner_Details" RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Skills_Radar"       RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Ksb_Assessments"    RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Plr"                RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Plr_Records"        RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Policy_Acks"        RENAME COLUMN "Learner_id" TO enrolment_id;
ALTER TABLE enrolment."Wizard_Cv_Job"             RENAME COLUMN "Learner_id" TO enrolment_id;
'''

ROLLBACK_SQL = '''
SET LOCAL lock_timeout = '5s';

ALTER TABLE enrolment."Extended_ILR"              RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Personal_Details"   RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Ilr_Learner_Details" RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Skills_Radar"       RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Ksb_Assessments"    RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Plr"                RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Plr_Records"        RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Policy_Acks"        RENAME COLUMN enrolment_id TO "Learner_id";
ALTER TABLE enrolment."Wizard_Cv_Job"             RENAME COLUMN enrolment_id TO "Learner_id";
'''


def apply_forward(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Tests create unmanaged tables in temporary SQLite files.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Learner_id rename requires the canonical PostgreSQL default database.')
    schema_editor.execute(FORWARD_SQL, params=None)


def apply_rollback(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Learner_id rename rollback requires the canonical PostgreSQL default database.')
    schema_editor.execute(ROLLBACK_SQL, params=None)


class Migration(migrations.Migration):
    dependencies = [('enrolment_api', '0002_wizardilrlearnerdetails')]

    operations = [
        # Step 1: rename the field in Django's migration state (managed=False
        # means no DDL is generated — the RunPython above handles the DDL).
        migrations.RenameField('extendedilr', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardpersonaldetails', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardilrlearnerdetails', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardskillsradar', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardksbassessment', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardplr', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardplrrecord', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardpolicyack', 'learner_id', 'enrolment_id'),
        migrations.RenameField('wizardcvjob', 'learner_id', 'enrolment_id'),

        # Step 2: apply the actual DDL column renames.
        migrations.RunPython(apply_forward, apply_rollback),

        # Step 3: drop the db_column="Learner_id" shim from state so Django
        # derives the column name from the Python field name 'enrolment_id'.
        migrations.AlterField(
            model_name='extendedilr', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardpersonaldetails', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardilrlearnerdetails', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardskillsradar', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardksbassessment', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardplr', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardplrrecord', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardpolicyack', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
        migrations.AlterField(
            model_name='wizardcvjob', name='enrolment_id',
            field=models.BigIntegerField(),
        ),
    ]
