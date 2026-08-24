"""Give weeks and components a library state so content is never destroyed.

``curriculum.weeks`` and ``curriculum.components`` carry no foreign keys, so
every cascade in this schema is hand-written Python. That means a permanent
programme delete used to physically ``DELETE`` authored content, and there was
no way to reuse a component once its module was gone.

These columns let a delete *detach* content instead: the parent ids are cleared
to the empty string, the origin is recorded denormalised (so the label survives
its module row), and ``library_state`` marks the row as reusable. The empty
parent id matters - ``repair_curriculum_parent_links`` guards every orphan sweep
with ``coalesce(<parent_id>, '') <> ''``, so a detached row is already invisible
to it and cannot be swept away.

``week_templates`` is given the soft-delete columns it was missed out of in
0041, so its delete path can stop being a hard one.
"""

from django.db import migrations


# Both sides of the week/component pair get the same shape. ``origin_week_*``
# is meaningful only for components in practice, but keeping the two tables
# structurally identical is what lets one helper detach either of them.
LIBRARY_TABLES = (
    'weeks',
    'components',
)

# Missed out of 0041's list, so this table has no deleted_at at all today.
SOFT_DELETE_BACKFILL_TABLES = (
    'week_templates',
)


def qualified(table):
    return f'curriculum."{table}"'


def table_exists(cursor, table):
    cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
    return bool(cursor.fetchone()[0])


def add_library_columns(cursor, table):
    if not table_exists(cursor, table):
        return
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists library_state varchar(16) not null default ''
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists detached_at timestamp with time zone
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists origin_module_catalogue_id varchar(128)
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists origin_module_title varchar(500)
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists origin_week_id varchar(128)
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists origin_week_label varchar(500)
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists copied_from_id varchar(128)
    ''')
    # Partial: the overwhelming majority of rows are attached, and the library
    # read is the only query that filters on this.
    cursor.execute(f'''
        create index if not exists curriculum_{table}_library_state_idx
        on {qualified(table)} (library_state)
        where library_state <> ''
    ''')
    cursor.execute(f'''
        create index if not exists curriculum_{table}_copied_from_idx
        on {qualified(table)} (copied_from_id)
        where copied_from_id is not null
    ''')


def add_soft_delete_columns(cursor, table):
    """The same three columns 0041 added, for a table it skipped."""
    if not table_exists(cursor, table):
        return
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists deleted_at timestamp with time zone
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists deleted_by varchar(255)
    ''')
    cursor.execute(f'''
        alter table {qualified(table)}
        add column if not exists deleted_via_parent varchar(255)
    ''')
    cursor.execute(f'''
        create index if not exists curriculum_{table}_deleted_at_idx
        on {qualified(table)} (deleted_at)
    ''')


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for table in LIBRARY_TABLES:
            add_library_columns(cursor, table)
        for table in SOFT_DELETE_BACKFILL_TABLES:
            add_soft_delete_columns(cursor, table)


def revert_schema(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for table in SOFT_DELETE_BACKFILL_TABLES:
            if not table_exists(cursor, table):
                continue
            cursor.execute(f'drop index if exists curriculum."curriculum_{table}_deleted_at_idx"')
            for column in ('deleted_via_parent', 'deleted_by', 'deleted_at'):
                cursor.execute(f'alter table {qualified(table)} drop column if exists {column}')
        for table in reversed(LIBRARY_TABLES):
            if not table_exists(cursor, table):
                continue
            cursor.execute(f'drop index if exists curriculum."curriculum_{table}_copied_from_idx"')
            cursor.execute(f'drop index if exists curriculum."curriculum_{table}_library_state_idx"')
            for column in (
                'copied_from_id',
                'origin_week_label',
                'origin_week_id',
                'origin_module_title',
                'origin_module_catalogue_id',
                'detached_at',
                'library_state',
            ):
                cursor.execute(f'alter table {qualified(table)} drop column if exists {column}')


class Migration(migrations.Migration):
    atomic = False

    # Ordered before 0052 rather than after it, deliberately.
    #
    # 0052 drops curriculum.coaches, and it cannot: chat.ChatCoach
    # (chat/models.py) maps a live model onto that table, and
    # chat.conversations / chat.messages / chat.message_receipts hold foreign
    # keys into it, so Postgres refuses the drop. Its premise that "nothing
    # reads or writes them any more" holds for curriculum.tutors but not for
    # coaches, and repointing chat at enrolment.Staff_users is a separate piece
    # of work in a different app.
    #
    # This migration is unrelated to any of that, so it depends on 0051 and
    # declares run_before instead of sitting behind a migration that fails.
    # 0052 stays the single leaf of the graph - no conflicting leaves, and it
    # remains pending until whoever owns chat resolves the coaches question.
    dependencies = [
        ('curriculum_api', '0051_live_session_occurrence_online_meeting_id'),
    ]

    run_before = [
        ('curriculum_api', '0052_drop_curriculum_staff_profile_tables'),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
