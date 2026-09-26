from django.db import migrations


def migrate_live_session_lobby_policy(apps, schema_editor):
    """Move stored LMS live-session policy to direct entry.

    The Graph meeting itself is patched by the reapply command after deploy;
    this migration keeps the LMS source of truth from asking that command to
    restore the old ``invited`` scope on a later update.
    """
    with schema_editor.connection.cursor() as cursor:
        if schema_editor.connection.vendor == 'postgresql':
            cursor.execute("select to_regclass('curriculum.live_sessions')")
            if not cursor.fetchone()[0]:
                return
            table = '"curriculum"."live_sessions"'
        else:
            cursor.execute("pragma table_info(live_sessions)")
            if not cursor.fetchall():
                return
            table = 'live_sessions'
        cursor.execute(f"update {table} set lobby_bypass = %s", ['everyone'])


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0064_module_session_holidays')]
    operations = [migrations.RunPython(migrate_live_session_lobby_policy, migrations.RunPython.noop)]
