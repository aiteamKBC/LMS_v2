"""Give a live-session occurrence its own Teams online meeting ID.

Graph refuses to move a recurring occurrence across a neighbour, so a
holiday-shifted session is recreated as an event of its own -- and Teams builds
that event a brand-new online meeting. Attendance, transcripts and recordings
are only listed under the meeting that actually ran, so a session that carries
its own meeting has to say so; asking the series for it returns nothing.
"""
from django.db import migrations, models


def add_occurrence_meeting_column(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute("select to_regclass('curriculum.live_session_occurrences')")
            if not cursor.fetchone()[0]:
                return
            cursor.execute(
                "alter table curriculum.live_session_occurrences "
                "add column if not exists online_meeting_id text not null default ''"
            )
            return
        cursor.execute(
            "select name from sqlite_master where type='table' and name='live_session_occurrences'"
        )
        if not cursor.fetchone():
            return
        cursor.execute('pragma table_info("live_session_occurrences")')
        if "online_meeting_id" not in {row[1] for row in cursor.fetchall()}:
            cursor.execute(
                'alter table "live_session_occurrences" '
                "add column online_meeting_id text not null default ''"
            )


class Migration(migrations.Migration):
    dependencies = [
        ("curriculum_api", "0050_cohort_apprenticeship_end_override"),
    ]

    operations = [
        # The model is unmanaged, so this records the field and writes no DDL --
        # the column itself is added below, for databases of either vendor.
        migrations.AddField(
            model_name="livesessionoccurrence",
            name="online_meeting_id",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.RunPython(add_occurrence_meeting_column, migrations.RunPython.noop),
    ]
