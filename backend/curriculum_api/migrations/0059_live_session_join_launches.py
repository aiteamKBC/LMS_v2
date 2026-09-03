from django.db import migrations


def create_join_launches(apps, schema_editor):
    postgres = schema_editor.connection.vendor == 'postgresql'
    launches = '"curriculum"."live_session_join_launches"' if postgres else '"live_session_join_launches"'
    sessions = '"curriculum"."live_sessions"' if postgres else '"live_sessions"'
    occurrences = '"curriculum"."live_session_occurrences"' if postgres else '"live_session_occurrences"'
    json_type = 'jsonb' if postgres else 'text'
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f'''
            create table if not exists {launches} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                occurrence_id varchar(128) not null, launched_at timestamp not null default current_timestamp,
                attendance_report_id varchar(512) not null default '', viewer_id varchar(255) not null default '',
                viewer_email varchar(320) not null default '', viewer_name varchar(500) not null default '',
                user_agent text not null default '', referrer text not null default '', metadata {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (live_session_id) references {sessions} (id) on delete cascade,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade
            )
        ''')
        cursor.execute(f'create index if not exists curriculum_join_launch_occurrence_time_idx on {launches} (occurrence_id, launched_at)')
        cursor.execute(f'create index if not exists curriculum_join_launch_report_idx on {launches} (attendance_report_id)')


def drop_join_launches(apps, schema_editor):
    launches = '"curriculum"."live_session_join_launches"' if schema_editor.connection.vendor == 'postgresql' else '"live_session_join_launches"'
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f'drop table if exists {launches}')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0058_unique_active_teams_calendar')]
    operations = [migrations.RunPython(create_join_launches, drop_join_launches)]
