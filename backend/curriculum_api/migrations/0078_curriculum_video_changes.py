"""Capture future video writes, including SQL writes made outside the LMS API.

The trigger only appends an event in the writer's transaction. No network IO,
historical backfill, source replacement or learner/Teams data changes occur.
"""
from django.db import migrations, models
import django.utils.timezone


TABLES = (
    ('components', 'module', 'module_catalogue_id'),
    ('week_template_components', 'template', 'week_template_id'),
)


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        # Fail the migration if a source table is absent: never claim that all
        # writers are covered while silently omitting a trigger.
        for table, _, _ in TABLES:
            cursor.execute('SELECT to_regclass(%s)', [f'curriculum.{table}'])
            if cursor.fetchone()[0] is None:
                raise RuntimeError('Curriculum authoring tables must exist before video change capture.')
        cursor.execute('''SELECT n.nspname, c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.oid=to_regclass('curriculum_video_change')''')
        schema, table = cursor.fetchone()
        events = f'{quote(schema)}.{quote(table)}'
        cursor.execute(f'''
            CREATE FUNCTION curriculum.capture_bunny_video_change()
            RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
            SET search_path = pg_catalog AS $body$
            DECLARE
                current_row jsonb := to_jsonb(NEW);
                previous_row jsonb := '{{}}'::jsonb;
                current_settings jsonb;
                previous_settings jsonb := '{{}}'::jsonb;
                current_source text;
                previous_source text;
                parent_id text;
            BEGIN
                IF current_row->>'type' IS DISTINCT FROM 'video'
                    OR current_row->>'deleted_at' IS NOT NULL
                    OR coalesce(current_row->>'is_programme_deleted', 'false') = 'true'
                THEN RETURN NEW; END IF;
                parent_id := current_row->>TG_ARGV[1];
                IF coalesce(parent_id, '') = '' THEN RETURN NEW; END IF;
                current_settings := jsonb_build_object(
                    'videoUrl', current_row->'settings_json'->'videoUrl',
                    'embedCode', current_row->'settings_json'->'embedCode');
                current_source := btrim(coalesce(nullif(current_settings->>'videoUrl', ''),
                                                current_settings->>'embedCode', ''));
                IF current_source = '' THEN RETURN NEW; END IF;
                IF TG_OP = 'UPDATE' THEN
                    previous_row := to_jsonb(OLD);
                    IF previous_row->>'type' = 'video'
                        AND previous_row->>TG_ARGV[1] = parent_id
                        AND previous_row->>'deleted_at' IS NULL
                        AND coalesce(previous_row->>'is_programme_deleted', 'false') <> 'true'
                    THEN
                        previous_settings := jsonb_build_object(
                            'videoUrl', previous_row->'settings_json'->'videoUrl',
                            'embedCode', previous_row->'settings_json'->'embedCode');
                    END IF;
                    previous_source := btrim(coalesce(nullif(previous_settings->>'videoUrl', ''),
                                                     previous_settings->>'embedCode', ''));
                    IF current_source = previous_source THEN RETURN NEW; END IF;
                END IF;
                INSERT INTO {events}
                    (target_kind,target_id,component_id,previous_settings,settings,
                     created_at,available_at,attempts,error)
                VALUES (TG_ARGV[0],parent_id,current_row->>'id',previous_settings,current_settings,
                        clock_timestamp(),clock_timestamp(),0,'');
                RETURN NEW;
            END;
            $body$;
            REVOKE ALL ON FUNCTION curriculum.capture_bunny_video_change() FROM PUBLIC;
        ''')
        for table, kind, parent in TABLES:
            cursor.execute(f'''CREATE TRIGGER bunny_video_source_changed
                AFTER INSERT OR UPDATE ON curriculum.{quote(table)}
                FOR EACH ROW EXECUTE FUNCTION curriculum.capture_bunny_video_change('{kind}', '{parent}')''')


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for table, _, _ in TABLES:
            cursor.execute(f'DROP TRIGGER bunny_video_source_changed ON curriculum.{table}')
        cursor.execute('DROP FUNCTION curriculum.capture_bunny_video_change()')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0077_curriculum_video_import')]
    operations = [
        migrations.CreateModel(
            name='CurriculumVideoChange',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False, auto_created=True, verbose_name='ID')),
                ('target_kind', models.CharField(max_length=16)),
                ('target_id', models.CharField(max_length=128)),
                ('component_id', models.CharField(max_length=128)),
                ('previous_settings', models.JSONField(default=dict)),
                ('settings', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('available_at', models.DateTimeField(default=django.utils.timezone.now, db_index=True)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('error', models.TextField(blank=True, default='')),
            ],
            options={'db_table': 'curriculum_video_change'},
        ),
        migrations.RunPython(install, uninstall),
    ]
