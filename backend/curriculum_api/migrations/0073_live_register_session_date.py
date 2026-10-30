"""Keep a date-only copy of the scheduled occurrence in the learner register."""
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import migrations, models


def add_session_date(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    zone = settings.TIME_ZONE
    ZoneInfo(zone)
    zone_sql = "'" + zone.replace("'", "''") + "'"
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("""SELECT data_type FROM information_schema.columns
            WHERE table_schema='curriculum' AND table_name='live_session_occurrences'
              AND column_name='scheduled_start'""")
        column = cursor.fetchone()
        if not column or column[0] not in {'timestamp without time zone', 'timestamp with time zone'}:
            raise RuntimeError('Attendance dates require the scheduled occurrence timestamp.')

        def date_sql(value):
            # Legacy occurrence timestamps are UTC without a timezone. Do not
            # interpret them in the SQL client's or developer machine's zone.
            utc = f"({value} AT TIME ZONE 'UTC')" if column[0] == 'timestamp without time zone' else value
            return f'({utc} AT TIME ZONE {zone_sql})::date'

        # Keep schedule writes stable throughout the additive backfill.
        cursor.execute('LOCK TABLE curriculum.live_session_occurrences IN SHARE MODE')
        cursor.execute('ALTER TABLE curriculum.live_session_learner_attendance ADD COLUMN session_date date')
        cursor.execute(f"""COMMENT ON COLUMN curriculum.live_session_learner_attendance.session_date
            IS 'Scheduled session date in {zone.replace("'", "''")}; derived from live_session_occurrences.scheduled_start.'""")
        cursor.execute(f'''UPDATE curriculum.live_session_learner_attendance r
            SET session_date={date_sql('o.scheduled_start')}
            FROM curriculum.live_session_occurrences o
            WHERE o.id=r.occurrence_id
              AND r.session_date IS DISTINCT FROM {date_sql('o.scheduled_start')}''')
        cursor.execute(f'''CREATE FUNCTION curriculum.live_register_set_session_date()
            RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN
                SELECT {date_sql('o.scheduled_start')} INTO NEW.session_date
                FROM curriculum.live_session_occurrences o WHERE o.id=NEW.occurrence_id;
                RETURN NEW;
            END;
            $body$''')
        cursor.execute('''CREATE TRIGGER live_register_set_session_date
            BEFORE INSERT OR UPDATE OF occurrence_id,session_date
            ON curriculum.live_session_learner_attendance
            FOR EACH ROW EXECUTE FUNCTION curriculum.live_register_set_session_date()''')
        cursor.execute(f'''CREATE FUNCTION curriculum.live_register_refresh_session_dates()
            RETURNS trigger LANGUAGE plpgsql AS $body$
            BEGIN
                UPDATE curriculum.live_session_learner_attendance
                SET session_date={date_sql('NEW.scheduled_start')}
                WHERE occurrence_id=NEW.id
                  AND session_date IS DISTINCT FROM {date_sql('NEW.scheduled_start')};
                RETURN NEW;
            END;
            $body$''')
        cursor.execute('''CREATE TRIGGER live_register_refresh_session_dates
            AFTER INSERT OR UPDATE OF scheduled_start ON curriculum.live_session_occurrences
            FOR EACH ROW EXECUTE FUNCTION curriculum.live_register_refresh_session_dates()''')


def remove_session_date(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('DROP TRIGGER live_register_refresh_session_dates ON curriculum.live_session_occurrences')
        cursor.execute('DROP TRIGGER live_register_set_session_date ON curriculum.live_session_learner_attendance')
        cursor.execute('DROP FUNCTION curriculum.live_register_refresh_session_dates()')
        cursor.execute('DROP FUNCTION curriculum.live_register_set_session_date()')
        cursor.execute('ALTER TABLE curriculum.live_session_learner_attendance DROP COLUMN session_date')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0072_module_scoped_live_attendance')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(add_session_date, remove_session_date)],
        state_operations=[migrations.AddField(
            model_name='livesessionlearnerattendance', name='session_date',
            field=models.DateField(null=True, blank=True, editable=False),
        )],
    )]
