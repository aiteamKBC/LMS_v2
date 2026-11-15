"""Journal future independent Free Course video writes; never backfill content."""
from django.db import migrations


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    quote = connection.ops.quote_name
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        # Native authoring projections already use the module import identity.
        # Only the standalone canonical schema needs this separate journal.
        cursor.execute('''SELECT 1 FROM information_schema.columns
            WHERE table_schema='curriculum' AND table_name='free_programme_components'
              AND column_name='content_ref' ''')
        if cursor.fetchone():
            return
        cursor.execute('''SELECT n.nspname,c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.oid=to_regclass('curriculum_video_change')''')
        row = cursor.fetchone()
        if not row:
            raise RuntimeError('Apply the curriculum video queue migrations before Free Course capture.')
        events = f'{quote(row[0])}.{quote(row[1])}'
        cursor.execute(f'''
            CREATE OR REPLACE FUNCTION curriculum.capture_free_course_bunny_video_change()
            RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
            DECLARE
                owner_id varchar(128);
                current_source text;
                previous_source text := '';
                previous_settings jsonb := '{{}}'::jsonb;
                current_settings jsonb;
            BEGIN
                IF NEW.type IS DISTINCT FROM 'video' OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
                SELECT course_id INTO owner_id FROM curriculum.free_course_weeks
                    WHERE id=NEW.free_module_id AND deleted_at IS NULL;
                IF owner_id IS NULL THEN RETURN NEW; END IF;
                current_settings := jsonb_build_object('videoUrl',NEW.settings_json->'videoUrl','embedCode',NEW.settings_json->'embedCode');
                current_source := btrim(coalesce(nullif(current_settings->>'videoUrl',''),current_settings->>'embedCode',''));
                IF current_source='' THEN RETURN NEW; END IF;
                IF TG_OP='UPDATE' THEN
                    IF OLD.type='video' AND OLD.deleted_at IS NULL AND OLD.free_module_id=NEW.free_module_id THEN
                        previous_settings := jsonb_build_object('videoUrl',OLD.settings_json->'videoUrl','embedCode',OLD.settings_json->'embedCode');
                    END IF;
                    previous_source := btrim(coalesce(nullif(previous_settings->>'videoUrl',''),previous_settings->>'embedCode',''));
                    IF current_source=previous_source THEN RETURN NEW; END IF;
                END IF;
                INSERT INTO {events} (target_kind,target_id,component_id,previous_settings,settings,created_at,available_at,attempts,error)
                    VALUES ('free_course',owner_id,NEW.id,previous_settings,current_settings,clock_timestamp(),clock_timestamp(),0,'');
                RETURN NEW;
            END;
            $body$;
            REVOKE ALL ON FUNCTION curriculum.capture_free_course_bunny_video_change() FROM PUBLIC;
            DROP TRIGGER IF EXISTS bunny_free_course_video_source_changed ON curriculum.free_programme_components;
            CREATE TRIGGER bunny_free_course_video_source_changed
                AFTER INSERT OR UPDATE ON curriculum.free_programme_components
                FOR EACH ROW EXECUTE FUNCTION curriculum.capture_free_course_bunny_video_change();
        ''')


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        with schema_editor.connection.cursor() as cursor:
            cursor.execute('DROP TRIGGER IF EXISTS bunny_free_course_video_source_changed ON curriculum.free_programme_components')
            cursor.execute('DROP FUNCTION IF EXISTS curriculum.capture_free_course_bunny_video_change()')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0089_free_course_content_soft_delete')]
    operations = [migrations.RunPython(install, uninstall)]
