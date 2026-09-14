from django.db import migrations


def apply_schema(apps, schema_editor):
    # A cohort's bank holidays used to be pure derivation: every England bank
    # holiday inside its dates applied, with nothing to tick. The cohort drawer
    # now lets a delivery team untick specific holidays for one cohort (a
    # college that stays open on a particular local closure, say), so there has
    # to be somewhere to store which ones were turned off.
    #
    # excluded_holiday_ids is a deny-list, not the selection itself: it holds
    # only the ids a human unticked. An empty list -- the default, and what
    # every existing row gets -- means nothing is excluded, which is exactly
    # today's "every holiday in the period applies" behaviour, so no backfill
    # is needed. A holiday that comes into a cohort's period later (its dates
    # moved, or GOV.UK published a new one) is therefore selected by default
    # too, the same as an untouched cohort always was.
    #
    # An allow-list would not have that property: snapshotting "the ids
    # currently selected" goes stale the moment the period changes, silently
    # dropping a holiday nobody chose to exclude. The deny-list never goes
    # stale that way.
    postgres = schema_editor.connection.vendor == 'postgresql'
    quoted = '"curriculum"."cohorts"' if postgres else '"cohorts"'
    with schema_editor.connection.cursor() as cursor:
        if postgres:
            cursor.execute('select to_regclass(%s)', ['curriculum.cohorts'])
            if not cursor.fetchone()[0]:
                return
            cursor.execute(
                f"alter table {quoted} add column if not exists excluded_holiday_ids jsonb not null default '[]'::jsonb"
            )
            return
        cursor.execute("select name from sqlite_master where type='table' and name='cohorts'")
        if not cursor.fetchone():
            return
        cursor.execute("pragma table_info('cohorts')")
        columns = {row[1] for row in cursor.fetchall()}
        if 'excluded_holiday_ids' not in columns:
            cursor.execute(f"alter table {quoted} add column excluded_holiday_ids text not null default '[]'")


def revert_schema(apps, schema_editor):
    postgres = schema_editor.connection.vendor == 'postgresql'
    with schema_editor.connection.cursor() as cursor:
        if postgres:
            cursor.execute('select to_regclass(%s)', ['curriculum.cohorts'])
            if not cursor.fetchone()[0]:
                return
            cursor.execute(
                'select 1 from information_schema.columns '
                "where table_schema = 'curriculum' and table_name = 'cohorts' "
                "and column_name = 'excluded_holiday_ids'"
            )
            if cursor.fetchone():
                cursor.execute('alter table curriculum."cohorts" drop column excluded_holiday_ids')
            return
        # sqlite does not support dropping a column cleanly across all versions
        # used in dev/test; leaving the column behind on revert is harmless.


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0060_live_session_join_launches_updated_at'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
