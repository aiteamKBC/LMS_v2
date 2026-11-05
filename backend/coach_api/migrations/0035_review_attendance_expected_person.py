from django.db import migrations, models


def remove_learner_index(_apps, schema_editor):
    # Django's conditional-constraint removal uses an unqualified index name.
    # The production index lives in Coach, outside the normal search_path.
    name = '"review_att_link_active_learner"'
    if schema_editor.connection.vendor == 'postgresql':
        name = '"Coach".' + name
    schema_editor.execute('DROP INDEX ' + name)


def restore_learner_index(apps, schema_editor):
    schema_editor.add_constraint(apps.get_model('coach_api', 'ReviewAttendanceLink'), models.UniqueConstraint(
        fields=('calendar_event_id', 'session_key', 'learner_id'),
        condition=models.Q(revoked_at__isnull=True), name='review_att_link_active_learner'))


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0034_review_attendance_link')]
    operations = [
        migrations.AddField(model_name='reviewattendancelink', name='target_role',
                            field=models.CharField(default='learner', max_length=16)),
        migrations.AddField(model_name='reviewattendancelink', name='target_key',
                            field=models.CharField(default='learner', max_length=64)),
        migrations.AddField(model_name='reviewattendancelink', name='target_name',
                            field=models.CharField(blank=True, default='', max_length=255)),
        migrations.AddConstraint(model_name='reviewattendancelink', constraint=models.UniqueConstraint(
            fields=('calendar_event_id', 'session_key', 'target_key'),
            condition=models.Q(revoked_at__isnull=True), name='review_att_link_active_target')),
        migrations.SeparateDatabaseAndState(
            database_operations=[migrations.RunPython(remove_learner_index, restore_learner_index)],
            state_operations=[migrations.RemoveConstraint(model_name='reviewattendancelink', name='review_att_link_active_learner')]),
    ]
