"""Index existing source/upload ownership without moving or deleting media."""
import hashlib
import json
import re
from urllib.parse import parse_qs, urlsplit

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


def source_key_v1(row):
    # Frozen v1 identity shared with video_dedup.source_key, excluding device
    # imports with no durable source: their original bytes cannot be inferred.
    source = str(row.source_url or '').strip()
    if row.target_kind not in ('module', 'template', 'free_course') or not source:
        return ''
    try:
        parsed = urlsplit(source)
        youtube = parsed.hostname in ('youtu.be', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com')
        if youtube:
            if parsed.scheme not in ('https', 'http') or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
                return ''
            parts = parsed.path.strip('/').split('/')
            video_id = (parts[0] if parsed.hostname == 'youtu.be' and len(parts) == 1 else
                        (parse_qs(parsed.query).get('v') or [''])[0] if parsed.path == '/watch' else
                        parts[1] if len(parts) == 2 and parts[0] in ('embed', 'shorts', 'live', 'v') else '')
            if not re.fullmatch(r'[a-zA-Z0-9_-]{11}', video_id):
                return ''
            identity = ('youtube', 'https://www.youtube.com/watch?v=' + video_id)
        else:
            uploaded = re.fullmatch(r'/curriculum_api/curriculum/uploads/videos/(?:module|template|free_course)/[\w-]+/[\w-]+/([a-f0-9]{64})\.mp4', source, re.ASCII)
            identity = ('sha256', uploaded[1]) if uploaded else ('url', source)
    except ValueError:
        return ''
    return hashlib.sha256(json.dumps([str(row.library_id), *identity], separators=(',', ':')).encode()).hexdigest()


def seed_sources(apps, schema_editor):
    Import = apps.get_model('curriculum_api', 'CurriculumVideoImport')
    Source = apps.get_model('curriculum_api', 'CurriculumVideoSource')
    alias = schema_editor.connection.alias
    owners = {}
    ranks = {'ready': 0, 'superseded': 1, 'processing': 2, 'uploading': 3}
    for row in Import.objects.using(alias).exclude(video_id='').exclude(target_kind='live_session').order_by('created_at', 'id').iterator():
        key = source_key_v1(row)
        rank = ranks.get(row.status, 4)
        if key and (key not in owners or rank < owners[key][0]):
            owners[key] = (rank, row)
    Source.objects.using(alias).bulk_create([
        Source(source_key=key, library_id=row.library_id, owner_import_id=row.pk)
        for key, (_rank, row) in owners.items()
    ], ignore_conflicts=True)


def install(apps, schema_editor):
    model = apps.get_model('curriculum_api', 'CurriculumVideoSource')
    connection = schema_editor.connection
    table = model._meta.db_table
    with connection.cursor() as cursor:
        exists = table in connection.introspection.table_names(cursor)
        if exists:
            columns = {column.name for column in connection.introspection.get_table_description(cursor, table)}
            constraints = connection.introspection.get_constraints(cursor, table)
            valid = (columns == {field.column for field in model._meta.local_fields}
                     and any(c['primary_key'] and c['columns'] == ['source_key'] for c in constraints.values())
                     and any(c.get('foreign_key') == ('curriculum_video_import', 'id')
                             and c['columns'] == ['owner_import_id'] for c in constraints.values()))
            if not valid:
                raise RuntimeError('Existing video source registry does not match migration 0091.')
    if not exists:
        schema_editor.create_model(model)


def uninstall(apps, schema_editor):
    schema_editor.delete_model(apps.get_model('curriculum_api', 'CurriculumVideoSource'))


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0090_free_course_video_changes')]
    operations = [
        # The standalone curriculum database also supports scoped installation.
        # Replaying this migration verifies that table before seeding it again.
        migrations.SeparateDatabaseAndState(state_operations=[migrations.CreateModel(
            name='CurriculumVideoSource',
            fields=[
                ('source_key', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('library_id', models.CharField(max_length=32)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('owner_import', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='owned_video_sources', to='curriculum_api.curriculumvideoimport')),
            ],
            options={'db_table': 'curriculum_video_source'},
        )]),
        migrations.RunPython(install, uninstall),
        migrations.RunPython(seed_sources, migrations.RunPython.noop),
    ]
