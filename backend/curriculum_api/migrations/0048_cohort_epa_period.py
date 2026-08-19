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
    # A cohort now carries two end dates. end_date keeps its meaning — the end of
    # the practical period — and apprenticeship_end_date is where the End Point
    # Assessment window that follows it lands: the practical end date plus
    # epa_months, same day of the month (a practical period ending 2027-03-04
    # with a 5 month EPA period ends 2027-08-04).
    #
    # Both nullable on purpose: NULL epa_months means "no EPA period recorded",
    # which is not the same as zero. Existing cohorts have none, and the wizard
    # needs to tell "not set yet" apart from "the apprenticeship ends the day the
    # practical period does" so it can prompt for a period instead of showing the
    # practical end date twice.
    #
    # apprenticeship_end_date is a derived cache, not an override: the API always
    # recomputes it from end_date + epa_months, and every write path rewrites the
    # column. It exists so SQL consumers (the enrolment learner-date backfill)
    # can read the date without repeating the month arithmetic.
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'cohorts'):
            return
        cursor.execute('''
            alter table curriculum."cohorts"
            add column if not exists epa_months integer
        ''')
        cursor.execute('''
            alter table curriculum."cohorts"
            add column if not exists apprenticeship_end_date date
        ''')


def revert_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        if not table_exists(cursor, 'cohorts'):
            return
        for column in ('apprenticeship_end_date', 'epa_months'):
            if column_exists(cursor, 'cohorts', column):
                cursor.execute(f'alter table curriculum."cohorts" drop column {column}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0047_programme_required_otjh'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
