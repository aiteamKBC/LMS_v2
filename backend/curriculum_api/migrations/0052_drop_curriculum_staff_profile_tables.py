"""Drop ``curriculum.tutors`` / ``curriculum.coaches``.

Curriculum does not own staff records. A tutor or a coach is a staff user an
administrator invited and gave that access to, so Curriculum reads them from
``enrolment.Staff_users`` (filtered by ``Access``) and owns only the assignment:
which modules name a tutor (``curriculum.modules.tutor_name``) and which groups
name a coach (``curriculum.groups.coach_name``).

These two tables were the second copy. They held the person again -- name, email,
phone -- plus an ``assigned_module_ids`` / ``assigned_group_ids`` mirror of the
assignment the curriculum already stated, and the read model used to derive a
stand-in profile from any name typed onto a delivery row. That meant one person
could exist twice, a tutor could exist whom nobody had granted tutor access, and
deleting them in Users left the curriculum copy behind, still attached to live
curriculum. Curriculum itself reads and writes neither table any more.

``chat`` did. ``chat.ChatCoach`` mapped ``curriculum.coaches`` as its coach
identity and three foreign keys referenced it, so this drop failed outright until
``chat.0006_chat_coach_from_staff_directory`` moved them to the directory.
That migration declares the ordering, with ``run_before`` pointing here -- the
dependency cannot be stated from this side, because ``DJANGO_USE_SQLITE`` swaps
chat's migrations out for ``None`` and the node would not exist. PostgreSQL's
``DROP ... CASCADE`` hint was a trap here: it would have let this migration
through and taken chat's coach identity with it.

Verified before writing this: one row in each table, both people present in
``Staff_users`` under the matching access, so the drop loses no person the
directory does not already hold. The reverse recreates the empty schema -- the
rows themselves are not recoverable, which is why that check was made first.

The Django model state for these tables was already removed in 0012, so this is
a database-only operation.
"""

from django.db import migrations


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def drop_staff_profile_tables(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        for table in ('coaches', 'tutors'):
            cursor.execute(f'drop table if exists {table_name(connection, table)}')


def create_staff_profile_tables(apps, schema_editor):
    """Put the (empty) tables back, as 0008 first created them."""
    connection = schema_editor.connection
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('create schema if not exists curriculum')
        for table in ('coaches', 'tutors'):
            assignment_column = 'assigned_group_ids' if table == 'coaches' else 'assigned_module_ids'
            cursor.execute(f'''
                create table if not exists {table_name(connection, table)} (
                    id varchar(128) primary key,
                    name varchar(255) not null,
                    email varchar(255) not null default '',
                    phone varchar(64) not null default '',
                    job_title varchar(255) not null default '',
                    status varchar(32) not null default 'active',
                    specialisms {json_type},
                    {assignment_column} {json_type},
                    notes text not null default '',
                    is_archived boolean not null default false,
                    created_at timestamp not null default current_timestamp,
                    updated_at timestamp not null default current_timestamp
                )
            ''')
            cursor.execute(
                f'create index if not exists curriculum_{table}_name_idx '
                f'on {table_name(connection, table)} (name)'
            )


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0051_live_session_occurrence_online_meeting_id'),
    ]

    operations = [
        migrations.RunPython(drop_staff_profile_tables, create_staff_profile_tables),
    ]
