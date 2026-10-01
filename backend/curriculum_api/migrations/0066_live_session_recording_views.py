from django.db import migrations


def create_recording_views(apps, schema_editor):
    postgres = schema_editor.connection.vendor == 'postgresql'
    views = '"curriculum"."live_session_recording_views"' if postgres else '"live_session_recording_views"'
    sessions = '"curriculum"."live_sessions"' if postgres else '"live_sessions"'
    occurrences = '"curriculum"."live_session_occurrences"' if postgres else '"live_session_occurrences"'
    with schema_editor.connection.cursor() as cursor:
        # One row per learner and recording: seconds actually played, reported by the player.
        cursor.execute(f'''
            create table if not exists {views} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                occurrence_id varchar(128) not null, artifact_id varchar(128) not null,
                learner_kind varchar(32) not null, learner_id bigint not null,
                viewer_email varchar(320) not null default '',
                watched_seconds integer not null default 0, duration_seconds integer not null default 0,
                last_position_seconds integer not null default 0,
                first_viewed_at timestamp not null default current_timestamp,
                last_heartbeat_at timestamp not null default current_timestamp,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                unique (artifact_id, learner_kind, learner_id),
                foreign key (live_session_id) references {sessions} (id) on delete cascade,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade
            )
        ''')
        cursor.execute(
            f'create index if not exists curriculum_recording_view_learner_idx '
            f'on {views} (learner_kind, learner_id, occurrence_id)'
        )


def drop_recording_views(apps, schema_editor):
    views = '"curriculum"."live_session_recording_views"' if schema_editor.connection.vendor == 'postgresql' else '"live_session_recording_views"'
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f'drop table if exists {views}')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0065_direct_entry_lobby_policy')]
    operations = [migrations.RunPython(create_recording_views, drop_recording_views)]
