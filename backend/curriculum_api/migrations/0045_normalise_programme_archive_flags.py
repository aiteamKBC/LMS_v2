from django.db import migrations


def table_exists(cursor, table):
    cursor.execute(
        """
        select exists (
            select 1
              from information_schema.tables
             where table_schema = 'curriculum'
               and table_name = %s
        )
        """,
        [table],
    )
    return bool(cursor.fetchone()[0])


def column_exists(cursor, table, column):
    cursor.execute(
        """
        select exists (
            select 1
              from information_schema.columns
             where table_schema = 'curriculum'
               and table_name = %s
               and column_name = %s
        )
        """,
        [table, column],
    )
    return bool(cursor.fetchone()[0])


def normalise_programme_flags(apps, schema_editor):
    # The `curriculum` schema and `information_schema` only exist on PostgreSQL;
    # the SQLite test database has neither, and probing it there raises before
    # `table_exists` can answer. Same guard as every sibling migration in this
    # family (0040-0044).
    if schema_editor.connection.vendor != 'postgresql':
        return
    cursor = schema_editor.connection.cursor()
    if not table_exists(cursor, 'programmes'):
        return

    has_status = column_exists(cursor, 'programmes', 'status')
    has_archived = column_exists(cursor, 'programmes', 'is_archived')
    has_active = column_exists(cursor, 'programmes', 'is_active')
    has_deleted_at = column_exists(cursor, 'programmes', 'deleted_at')

    archived_condition = []
    if has_archived:
        archived_condition.append('coalesce(is_archived, false) = true')
    if has_deleted_at:
        archived_condition.append('deleted_at is not null')
    if has_status:
        archived_condition.append("lower(coalesce(status, '')) = 'archived'")
    archived_sql = ' or '.join(archived_condition) or 'false'

    if has_status:
        cursor.execute(
            f"""
            update curriculum.programmes
               set status = 'archived'
             where {archived_sql}
               and lower(coalesce(status, '')) <> 'archived'
            """
        )
        if has_active:
            not_archived_checks = []
            if has_archived:
                not_archived_checks.append('coalesce(is_archived, false) = false')
            if has_deleted_at:
                not_archived_checks.append('deleted_at is null')
            not_archived_sql = ' and '.join(not_archived_checks) or 'true'
            cursor.execute(
                f"""
                update curriculum.programmes
                   set status = 'draft'
                 where coalesce(is_active, true) = false
                   and lower(coalesce(status, '')) not in ('draft', 'archived')
                   and {not_archived_sql}
                """
            )
        cursor.execute(
            f"""
            update curriculum.programmes
               set status = 'active'
             where coalesce(nullif(btrim(status), ''), '') = ''
               and not ({archived_sql})
            """
        )

    if has_archived:
        cursor.execute(
            f"""
            update curriculum.programmes
               set is_archived = true
             where ({archived_sql})
               and coalesce(is_archived, false) = false
            """
        )
        if has_status:
            not_deleted_sql = 'deleted_at is null' if has_deleted_at else 'true'
            cursor.execute(
                f"""
                update curriculum.programmes
                   set is_archived = false
                 where lower(coalesce(status, 'active')) in ('active', 'draft')
                   and {not_deleted_sql}
                   and coalesce(is_archived, false) = true
                """
            )

    if has_active:
        cursor.execute(
            f"""
            update curriculum.programmes
               set is_active = false
             where ({archived_sql}
                    or lower(coalesce(status, 'active')) in ('draft', 'archived'))
               and coalesce(is_active, true) = true
            """
        )
        active_archived_check = 'coalesce(is_archived, false) = false' if has_archived else 'true'
        active_deleted_check = 'deleted_at is null' if has_deleted_at else 'true'
        cursor.execute(
            f"""
            update curriculum.programmes
               set is_active = true
             where lower(coalesce(status, 'active')) = 'active'
               and {active_archived_check}
               and {active_deleted_check}
               and coalesce(is_active, false) = false
            """
        )


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum_api', '0044_programme_draft_status'),
    ]

    operations = [
        migrations.RunPython(normalise_programme_flags, migrations.RunPython.noop),
    ]
