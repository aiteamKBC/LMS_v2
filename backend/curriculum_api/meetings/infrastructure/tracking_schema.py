"""Meeting storage and Graph adapters; runtime dependencies are supplied by the facade."""


def provision_live_sessions_table(
    *, AUTHORING_MODULES_TABLE, CURRICULUM_SCHEMA, LIVE_SESSIONS_TABLE, _TABLE_COLUMNS_CACHE,
    authoring_table_name, column_names, connection, quote_ident,
):
    """Create/upgrade the live-sessions table. NOT for request paths."""
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(LIVE_SESSIONS_TABLE)} (
                id varchar(128) primary key,
                module_catalogue_id varchar(128),
                module_draft_id varchar(255) not null default '',
                module_title text not null default '',
                provider varchar(64) not null default 'Microsoft Teams',
                graph_event_id varchar(512),
                join_url text not null default '',
                web_link text not null default '',
                meeting_options_url text not null default '',
                organizer_email varchar(320) not null,
                attendees {json_type},
                presenters {json_type},
                co_organizers {json_type},
                start_datetime timestamp,
                timezone varchar(128) not null default '',
                duration_minutes integer not null default 60,
                repeat_pattern varchar(32) not null default 'none',
                repeat_occurrences integer not null default 1,
                lobby_bypass varchar(64) not null default 'invited',
                recording varchar(64) not null default 'none',
                spoken_language varchar(32) not null default 'en-GB',
                meeting_type varchar(64) not null default 'live-session',
                request_responses boolean not null default true,
                allow_time_proposals boolean not null default true,
                hide_attendees boolean not null default false,
                status varchar(32) not null default 'active',
                warnings {json_type},
                calendar_series {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (module_catalogue_id)
                    references {authoring_table_name(AUTHORING_MODULES_TABLE)} (module_catalogue_id)
                    on delete cascade
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {authoring_table_name(LIVE_SESSIONS_TABLE)} add column if not exists calendar_series {json_type}')
        elif 'calendar_series' not in column_names(LIVE_SESSIONS_TABLE):
            cursor.execute(f'alter table {authoring_table_name(LIVE_SESSIONS_TABLE)} add column calendar_series {json_type}')
        cursor.execute(
            f'create index if not exists curriculum_live_sessions_module_idx '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (module_catalogue_id)'
        )
        cursor.execute(
            f'create index if not exists curriculum_live_sessions_draft_idx '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (module_draft_id)'
        )
        cursor.execute(
            f'create index if not exists curriculum_live_sessions_graph_event_idx '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (graph_event_id)'
        )
        cursor.execute(
            f'create unique index if not exists curriculum_one_active_teams_calendar_per_module '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (module_catalogue_id) '
            f"where status = 'active' and module_catalogue_id is not null and module_catalogue_id <> ''"
        )
        cursor.execute(
            f'create unique index if not exists curriculum_one_active_teams_calendar_per_draft '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (module_draft_id) '
            f"where status = 'active' and module_draft_id <> ''"
        )
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{LIVE_SESSIONS_TABLE}', None)


def provision_live_session_tracking_tables(
    *, CURRICULUM_SCHEMA, LIVE_SESSIONS_TABLE, LIVE_SESSION_ARTIFACTS_TABLE, LIVE_SESSION_ATTENDANCE_TABLE,
    LIVE_SESSION_JOIN_LAUNCHES_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, LIVE_SESSION_RECORDING_EVENTS_TABLE,
    _TABLE_COLUMNS_CACHE, authoring_table_name, column_names, connection, ensure_live_sessions_table,
):
    """Create/upgrade live-session tracking schema. NOT for request paths."""
    ensure_live_sessions_table()
    live_sessions = authoring_table_name(LIVE_SESSIONS_TABLE)
    occurrences = authoring_table_name(LIVE_SESSION_OCCURRENCES_TABLE)
    attendance = authoring_table_name(LIVE_SESSION_ATTENDANCE_TABLE)
    artifacts = authoring_table_name(LIVE_SESSION_ARTIFACTS_TABLE)
    recording_events = authoring_table_name(LIVE_SESSION_RECORDING_EVENTS_TABLE)
    join_launches = authoring_table_name(LIVE_SESSION_JOIN_LAUNCHES_TABLE)
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f"alter table {live_sessions} add column if not exists online_meeting_id text not null default ''")
            cursor.execute(f"alter table {live_sessions} add column if not exists presenters {json_type} not null default '[]'")
            cursor.execute(f"alter table {live_sessions} add column if not exists co_organizers {json_type} not null default '[]'")
        elif 'online_meeting_id' not in column_names(LIVE_SESSIONS_TABLE):
            cursor.execute(f"alter table {live_sessions} add column online_meeting_id text not null default ''")
        if connection.vendor != 'postgresql' and 'presenters' not in column_names(LIVE_SESSIONS_TABLE):
            cursor.execute(f"alter table {live_sessions} add column presenters {json_type} not null default '[]'")
        if connection.vendor != 'postgresql' and 'co_organizers' not in column_names(LIVE_SESSIONS_TABLE):
            cursor.execute(f"alter table {live_sessions} add column co_organizers {json_type} not null default '[]'")
        # The meeting ID and passcode under the join link (teams_dial_in.py).
        for column in ('join_meeting_code', 'join_passcode', 'dial_in_join_url'):
            if connection.vendor == 'postgresql':
                cursor.execute(f"alter table {live_sessions} add column if not exists {column} text not null default ''")
            elif column not in column_names(LIVE_SESSIONS_TABLE):
                cursor.execute(f"alter table {live_sessions} add column {column} text not null default ''")
        cursor.execute(f'''
            create table if not exists {occurrences} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                session_number integer not null, graph_event_id varchar(512) not null default '',
                scheduled_start timestamp not null, scheduled_end timestamp not null,
                actual_start timestamp, actual_end timestamp, join_url text not null default '',
                online_meeting_id text not null default '',
                attendance_report_id varchar(512) not null default '', participant_count integer not null default 0,
                status varchar(32) not null default 'scheduled', artifacts_synced_at timestamp,
                last_sync_error text not null default '', created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (live_session_id) references {live_sessions} (id) on delete cascade,
                unique (live_session_id, session_number)
            )
        ''')
        # A session the wizard had to move can end up on its own event with its
        # own online meeting, and Graph only answers for the meeting that ran.
        if connection.vendor == 'postgresql':
            cursor.execute(f"alter table {occurrences} add column if not exists online_meeting_id text not null default ''")
        elif 'online_meeting_id' not in column_names(LIVE_SESSION_OCCURRENCES_TABLE):
            cursor.execute(f"alter table {occurrences} add column online_meeting_id text not null default ''")
        cursor.execute(f'''
            create table if not exists {attendance} (
                id varchar(128) primary key, occurrence_id varchar(128) not null,
                graph_record_id varchar(512) not null default '', email varchar(320) not null default '',
                display_name varchar(500) not null default '', role varchar(64) not null default '',
                total_attendance_seconds integer not null default 0, intervals {json_type}, raw_data {json_type},
                created_at timestamp not null default current_timestamp, updated_at timestamp not null default current_timestamp,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade
            )
        ''')
        cursor.execute(f'''
            create table if not exists {artifacts} (
                id varchar(128) primary key, occurrence_id varchar(128) not null,
                artifact_type varchar(32) not null, graph_artifact_id text not null,
                call_id text not null default '', content_correlation_id text not null default '',
                content_url text not null default '', created_datetime timestamp, end_datetime timestamp,
                metadata {json_type}, created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade,
                unique (occurrence_id, artifact_type, graph_artifact_id)
            )
        ''')
        cursor.execute(f'''
            create table if not exists {recording_events} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                occurrence_id varchar(128) not null default '', artifact_id varchar(128) not null,
                preview_session_id varchar(128) not null, event_type varchar(64) not null,
                viewer_id varchar(255) not null default '', viewer_email varchar(320) not null default '',
                viewer_name varchar(500) not null default '', viewer_role varchar(128) not null default '',
                browser_session_id varchar(128) not null default '', client_event_id varchar(128) not null default '',
                event_time timestamp not null default current_timestamp, video_time_seconds double precision not null default 0,
                previous_video_time_seconds double precision, duration_seconds double precision,
                watched_seconds_delta double precision not null default 0, playback_rate double precision not null default 1,
                volume double precision, muted boolean, skipped boolean not null default false,
                skip_from_seconds double precision, skip_to_seconds double precision, skip_delta_seconds double precision,
                viewport_width integer, viewport_height integer, user_agent text not null default '',
                page_url text not null default '', referrer text not null default '', metadata {json_type},
                created_at timestamp not null default current_timestamp,
                foreign key (live_session_id) references {live_sessions} (id) on delete cascade,
                foreign key (artifact_id) references {artifacts} (id) on delete cascade on update cascade
            )
        ''')
        cursor.execute(f'''
            create table if not exists {join_launches} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                occurrence_id varchar(128) not null, launched_at timestamp not null default current_timestamp,
                attendance_report_id varchar(512) not null default '', viewer_id varchar(255) not null default '',
                viewer_email varchar(320) not null default '', viewer_name varchar(500) not null default '',
                user_agent text not null default '', referrer text not null default '', metadata {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (live_session_id) references {live_sessions} (id) on delete cascade,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade
            )
        ''')
        cursor.execute(f'create index if not exists curriculum_live_occurrence_series_idx on {occurrences} (live_session_id)')
        cursor.execute(f'create index if not exists curriculum_live_occurrence_start_idx on {occurrences} (scheduled_start)')
        cursor.execute(f'create index if not exists curriculum_live_attendance_occurrence_idx on {attendance} (occurrence_id)')
        cursor.execute(f'create index if not exists curriculum_live_artifact_occurrence_idx on {artifacts} (occurrence_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_artifact_idx on {recording_events} (artifact_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_preview_idx on {recording_events} (preview_session_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_viewer_idx on {recording_events} (viewer_email, viewer_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_time_idx on {recording_events} (event_time)')
        cursor.execute(f'create index if not exists curriculum_join_launch_occurrence_time_idx on {join_launches} (occurrence_id, launched_at)')
        cursor.execute(f'create index if not exists curriculum_join_launch_report_idx on {join_launches} (attendance_report_id)')
    for table in (LIVE_SESSIONS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, LIVE_SESSION_ATTENDANCE_TABLE, LIVE_SESSION_ARTIFACTS_TABLE, LIVE_SESSION_RECORDING_EVENTS_TABLE, LIVE_SESSION_JOIN_LAUNCHES_TABLE):
        _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)
