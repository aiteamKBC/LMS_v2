from django.db import migrations


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def column_exists(cursor, table, column):
    cursor.execute(
        '''
        select 1
          from information_schema.columns
         where table_schema = 'curriculum'
           and table_name = %s
           and column_name = %s
        ''',
        [table, column],
    )
    return bool(cursor.fetchone())


def apply_schema(apps, schema_editor):
    # The apprenticeship end date is now editable. 0048 introduced it as a pure
    # cache of end_date + epa_months; a delivery team that has to move the date
    # for a real cohort (a break in learning, a resit window, an EPAO with no
    # capacity) has no whole number of months that lands on the date they were
    # given, so the calculated date has to be overridable.
    #
    # apprenticeship_end_override holds only what a human typed. NULL means "no
    # override" — the calculated date stands — which is why it cannot simply be
    # folded into apprenticeship_end_date: there would be no way to tell an
    # authored date from a stale cache, and moving the practical end date could
    # no longer move the apprenticeship one.
    #
    # apprenticeship_end_date keeps its name and its role as the cache SQL
    # consumers read (the enrolment learner-date backfill joins on it), but now
    # caches the *effective* date: the override when one is set, the calculated
    # date otherwise. Those consumers therefore need no change.
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'cohorts'):
            return
        cursor.execute('''
            alter table curriculum."cohorts"
            add column if not exists apprenticeship_end_override date
        ''')


def revert_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'cohorts'):
            return
        if column_exists(cursor, 'cohorts', 'apprenticeship_end_override'):
            cursor.execute('alter table curriculum."cohorts" drop column apprenticeship_end_override')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0049_tutor_module_notifications'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
