"""Ledger of tutor assignment emails, seeded with every assignment that exists.

The seed is the whole point of doing this in a migration rather than letting the
table appear empty at runtime. ``tutor_notifications`` decides what to mail by
diffing live assignments against this ledger, so an empty ledger on a populated
database reads as "nobody has ever been told about anything" and mails every
tutor about every module they have ever held.

The seed is deliberately generous -- no archived/deleted filters, no email
validity check. Over-seeding suppresses a mail for a pair that already existed,
which is correct by definition; under-seeding sends a blast.
"""
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
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return

    with connection.cursor() as cursor:
        cursor.execute('create schema if not exists curriculum')
        cursor.execute('''
            create table if not exists curriculum."tutor_module_notifications" (
                id varchar(160) primary key,
                tutor_key varchar(320) not null default '',
                tutor_id varchar(128) not null default '',
                tutor_name varchar(255) not null default '',
                tutor_email varchar(255) not null default '',
                module_catalogue_id varchar(128) not null default '',
                status varchar(32) not null default 'sent',
                attempts integer not null default 0,
                detail text not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute('''
            create index if not exists curriculum_tutor_notify_key_idx
            on curriculum."tutor_module_notifications" (tutor_key)
        ''')

        if not (table_exists(cursor, 'tutors') and table_exists(cursor, 'modules')):
            return

        # An assignment can be recorded in either of two places, and an older
        # database may not have both columns. Build the join from whichever
        # exists rather than assuming: a missing column would abort the whole
        # migration, and a partial seed is still a seed.
        matchers = []
        if column_exists(cursor, 'modules', 'tutor_name'):
            matchers.append('''
                        regexp_replace(lower(coalesce(m.tutor_name, '')), '[^a-z0-9]+', '', 'g')
                          = regexp_replace(
                                lower(coalesce(nullif(btrim(t.name), ''), t.email, '')),
                                '[^a-z0-9]+', '', 'g'
                            )
            ''')
        # tutors.assigned_module_ids is jsonb everywhere the migration graph
        # provisioned it, but a database that grew the column through the old
        # runtime bootstrap can hold text -- and jsonb_typeof() on a text column
        # raises rather than returning null. Match on it only when it is JSON.
        cursor.execute(
            '''
            select data_type
              from information_schema.columns
             where table_schema = 'curriculum'
               and table_name = 'tutors'
               and column_name = 'assigned_module_ids'
            '''
        )
        stored_ids_column = cursor.fetchone()
        if stored_ids_column and stored_ids_column[0] in ('jsonb', 'json'):
            matchers.append('''
                        jsonb_typeof(t.assigned_module_ids) = 'array'
                        and t.assigned_module_ids @> to_jsonb(m.module_catalogue_id)
            ''')
        if not matchers:
            return
        join_condition = ' or '.join(f'({matcher})' for matcher in matchers)

        # tutor_key mirrors views.staff_assignment_key: lowercased with every
        # non-alphanumeric character removed, so "Jane O'Brien" and "jane obrien"
        # are one person. Kept in SQL rather than importing the helper so the
        # migration does not depend on the shape of views.py at replay time.
        cursor.execute(f'''
            insert into curriculum."tutor_module_notifications"
                (id, tutor_key, tutor_id, tutor_name, tutor_email,
                 module_catalogue_id, status, attempts, detail)
            select distinct on (pair.id)
                pair.id,
                pair.tutor_key,
                pair.tutor_id,
                pair.tutor_name,
                pair.tutor_email,
                pair.module_catalogue_id,
                'seeded',
                0,
                'Assignment predates the notification ledger.'
            from (
                select
                    left(
                        regexp_replace(
                            lower(coalesce(nullif(btrim(t.name), ''), t.email, '')),
                            '[^a-z0-9]+', '', 'g'
                        ) || '|' || m.module_catalogue_id,
                        160
                    ) as id,
                    regexp_replace(
                        lower(coalesce(nullif(btrim(t.name), ''), t.email, '')),
                        '[^a-z0-9]+', '', 'g'
                    ) as tutor_key,
                    coalesce(t.id, '') as tutor_id,
                    coalesce(t.name, '') as tutor_name,
                    coalesce(t.email, '') as tutor_email,
                    m.module_catalogue_id
                from curriculum."tutors" t
                join curriculum."modules" m
                  on {join_condition}
                where coalesce(m.module_catalogue_id, '') <> ''
                  and regexp_replace(
                          lower(coalesce(nullif(btrim(t.name), ''), t.email, '')),
                          '[^a-z0-9]+', '', 'g'
                      ) not in ('', 'unassigned', 'emptystring')
            ) as pair
            order by pair.id
            on conflict (id) do nothing
        ''')


def revert_schema(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute('drop table if exists curriculum."tutor_module_notifications"')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0048_cohort_epa_period'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
