"""Add module-owned defaults/history without rewriting existing targets or learners."""
from pathlib import Path

from django.db import migrations


def forwards(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        raise RuntimeError('Module Hours workflows require PostgreSQL.')
    schema_editor.execute(Path(__file__).resolve().parents[1].joinpath(
        'module_hours_workflow.sql').read_text(encoding='utf-8'))


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0100_normalized_tutor_notifications')]
    # Deliberately irreversible: rollback code, never delete durable history.
    operations = [migrations.RunPython(forwards)]
