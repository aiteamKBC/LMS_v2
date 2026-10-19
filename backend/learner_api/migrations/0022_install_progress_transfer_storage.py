"""Install transfer storage through the project's schema migration route.

0021 targeted enrolment, where EnrolmentRouter rejects migrations. Reapply its
idempotent DDL on default, including for databases that already recorded 0021.
"""
from importlib import import_module

from django.db import migrations


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(import_module('learner_api.migrations.0021_progress_transfer').SQL)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0021_progress_transfer')]
    operations = [migrations.RunPython(
        install, hints={'learner_schema_migration': True},
    )]
