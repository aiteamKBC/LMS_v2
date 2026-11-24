"""Existing opt-in authoring schema provisioning SQL; runtime gates and ready flags remain at the composition seam.

Explicit capabilities preserve existing caller contracts during migration.
No views, settings or provider runtime is imported here.
"""


def provision_module_authoring_tables(
    *,
    AI_MATERIAL_COLUMN,
    AUTHORING_ADVANCED_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    CURRICULUM_SCHEMA,
    GROUPS_TABLE,
    MODULE_TEAMS_SHARES_TABLE,
    _TABLE_COLUMNS_CACHE,
    authoring_json_type,
    authoring_table_name,
    connection,
    provision_course_pricing,
    quote_ident,
):
    """Create the module-authoring schema in its current shape. NOT for request paths.

    Only reached from the SQLite test runner or an explicit local opt-in
    (CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP). Production provisions the same
    objects through migrations.

    The columns mirror the current curriculum database: ``status`` is the archive
    record (``active`` / ``inactive``; cohorts also ``planned``), children hold
    their parents' ids and read names through them, a module names its tutor by
    ``tutor_id``, a group's coaches live in ``group_coaches``, a cohort's holiday
    choices in ``cohort_calendar_holidays``, and a KSB mapping belongs to its
    component and points at ``standard_ksbs``. Foreign keys are left out so the
    SQLite harness can seed rows in any order; ``standard_ksb_id`` is nullable
    here because the harness carries no Skills England catalogue to resolve it.
    """
    json_type = authoring_json_type()
    postgres = connection.vendor == 'postgresql'
    serial_key = 'bigserial primary key' if postgres else 'integer primary key autoincrement'
    with connection.cursor() as cursor:
        if postgres:
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_MODULES_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                programme_id varchar(255),
                title text not null,
                description text,
                quality_score integer not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                sessions_number integer not null default 0,
                start_date date,
                end_date date,
                cohort_id varchar(255),
                group_id varchar(255),
                color varchar(32),
                session_week_day varchar(255),
                session_start_time varchar(32),
                session_end_time varchar(32),
                ksb_profile_source_id varchar(128),
                schedule_mode varchar(16) not null default 'group',
                week_starts_on varchar(9),
                week_boundary_mode varchar(16),
                calendar_policy {json_type},
                source_type varchar(64),
                source_id varchar(255),
                cover_image_url text,
                weekly_schedule {json_type},
                session_holidays {json_type},
                session_overrides {json_type} not null default '{{}}',
                learner_roster_mode varchar(32) not null default 'inherited',
                teams_shared_source_module_id varchar(128),
                ksb_remap_report text,
                status varchar(32) not null default 'active',
                tutor_id varchar(128)
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists sessions_number integer not null default 0')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists weeks_number integer')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists start_date date')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists end_date date')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists cohort_id varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists cohort_name varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists group_id varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists group_name varchar(255)')
            cursor.execute(f"alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists learner_roster_mode varchar(32) not null default 'inherited'")
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists teams_shared_source_module_id varchar(128)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists ksb_remap_report text')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists ksb_profile_source_id varchar(128)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists session_week_day varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists session_start_time varchar(32)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists session_end_time varchar(32)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists weekly_schedule {json_type}')
            cursor.execute(f"alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists schedule_mode varchar(16) not null default 'group'")
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists week_starts_on varchar(9)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists week_boundary_mode varchar(16)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists source_type varchar(64)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists source_id varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists tutor_name varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists tutor_email varchar(320)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists is_programme_deleted boolean not null default false')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists cover_image_url text')
        else:
            cursor.execute(f'pragma table_info({quote_ident(AUTHORING_MODULES_TABLE)})')
            columns = {row[1] for row in cursor.fetchall()}
            if 'sessions_number' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column sessions_number integer not null default 0')
            if 'weeks_number' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column weeks_number integer')
            if 'start_date' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column start_date date')
            if 'end_date' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column end_date date')
            if 'cohort_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column cohort_id varchar(255)')
            if 'cohort_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column cohort_name varchar(255)')
            if 'group_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column group_id varchar(255)')
            if 'group_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column group_name varchar(255)')
            if 'learner_roster_mode' not in columns:
                cursor.execute(f"alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column learner_roster_mode varchar(32) not null default 'inherited'")
            if 'teams_shared_source_module_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column teams_shared_source_module_id varchar(128)')
            if 'ksb_remap_report' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column ksb_remap_report text')
            if 'ksb_profile_source_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column ksb_profile_source_id varchar(128)')
            if 'session_week_day' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column session_week_day varchar(255)')
            if 'session_start_time' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column session_start_time varchar(32)')
            if 'session_end_time' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column session_end_time varchar(32)')
            if 'weekly_schedule' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column weekly_schedule {json_type}')
            if 'schedule_mode' not in columns:
                cursor.execute(f"alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column schedule_mode varchar(16) not null default 'group'")
            if 'week_boundary_mode' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column week_boundary_mode varchar(16)')
            if 'week_starts_on' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column week_starts_on varchar(9)')
            if 'source_type' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column source_type varchar(64)')
            if 'source_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column source_id varchar(255)')
            if 'tutor_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column tutor_name varchar(255)')
            if 'tutor_email' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column tutor_email varchar(320)')
            if 'is_programme_deleted' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column is_programme_deleted boolean not null default false')
            if 'cover_image_url' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column cover_image_url text')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(MODULE_TEAMS_SHARES_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                source_module_catalogue_id varchar(128) not null,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (module_catalogue_id)
                    references {authoring_table_name(AUTHORING_MODULES_TABLE)} (module_catalogue_id)
                    on delete cascade,
                foreign key (source_module_catalogue_id)
                    references {authoring_table_name(AUTHORING_MODULES_TABLE)} (module_catalogue_id)
                    on delete restrict
            )
        ''')
        cursor.execute(
            f'create index if not exists curriculum_module_teams_shares_source_idx '
            f'on {authoring_table_name(MODULE_TEAMS_SHARES_TABLE)} (source_module_catalogue_id)'
        )
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_WEEKS_TABLE)} (
                id varchar(128) primary key,
                module_catalogue_id varchar(128) not null,
                week_number integer not null default 1,
                title text not null default '',
                summary text,
                learning_outcomes {json_type},
                display_order integer not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                copied_from_id varchar(128),
                holiday_note_enabled boolean not null default false,
                holiday_note text not null default '',
                status varchar(32) not null default 'active'
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (
                id varchar(128) primary key,
                week_id varchar(128) not null,
                module_catalogue_id varchar(128) not null,
                type varchar(64) not null,
                title text not null default '',
                description text,
                expected_otjh numeric(8,2) not null default 2,
                points integer not null default 0,
                reflection_required boolean not null default false,
                workplace_evidence_required boolean not null default false,
                tutor_validation_required boolean not null default false,
                display_order integer not null default 0,
                settings_json {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                live_sessions_link text,
                copied_from_id varchar(128),
                "Reflection_Question" text,
                coach_validation_required boolean not null default true,
                status varchar(32) not null default 'active'
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name('standard_ksbs')} (
                id {serial_key},
                standard_ref text not null,
                standard_version text not null default '',
                standard_title text,
                status text,
                date_updated text,
                ksb_code text not null,
                ksb_type text not null default '',
                ksb_description text not null default '',
                created_at timestamp default current_timestamp,
                updated_at timestamp default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (
                id varchar(128) primary key,
                component_id varchar(128) not null,
                ksb_id varchar(255),
                classification varchar(32) not null default 'secondary',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                weight numeric(5,2) not null default 0,
                source_type varchar(32),
                source_id varchar(255),
                weight_class varchar(32) not null default 'soft'
                    check (weight_class in ('hard', 'soft', 'possible')),
                standard_ksb_id bigint,
                status varchar(32) not null default 'active'
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_COMPLETION_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                quizzes_completed_required boolean not null default false,
                checkpoints_completed_required boolean not null default false,
                average_score_required_enabled boolean not null default false,
                average_score_required integer not null default 70,
                total_score_required_enabled boolean not null default false,
                total_score_required integer not null default 100,
                additional_notes text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_ADVANCED_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                background text,
                epa_requirements {json_type},
                professional_qualification_outcomes {json_type},
                intent text,
                learner_benefit text,
                employer_benefit text,
                sequence_purpose text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                {quote_ident(AI_MATERIAL_COLUMN)} {json_type}
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)} (
                cohort_id varchar(128) primary key,
                cohort_name varchar(500) not null default '',
                programme_id varchar(255),
                start_date date,
                end_date date,
                duration_months integer not null default 0,
                color varchar(32),
                status varchar(32) not null default 'planned',
                training_plan_ids {json_type},
                group_ids {json_type},
                module_names {json_type},
                holiday_ids {json_type},
                selected_holidays {json_type},
                holidays_in_range {json_type},
                holiday_summary {json_type},
                -- The holidays a human unticked in the cohort drawer, from the
                -- holidays_in_range list above. A deny-list, not the selection
                -- itself: empty means nothing excluded, so a fresh cohort and
                -- one whose period later grows to include a new holiday both
                -- default to every holiday applying, same as before this
                -- column existed.
                excluded_holiday_ids {json_type},
                calendar_policy {json_type},
                notes text,
                source_type varchar(64) not null default 'training_plan',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                -- end_date is the practical period end. epa_months is the End
                -- Point Assessment window that follows it, and
                -- apprenticeship_end_date is where that window lands; the
                -- override is the authored date a human typed (NULL: none).
                epa_months integer,
                apprenticeship_end_date date,
                apprenticeship_end_override date
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name('cohort_calendar_holidays')} (
                id {serial_key},
                cohort_id varchar(128) not null,
                calendar_holiday_id text not null,
                is_selected boolean not null default false,
                is_excluded boolean not null default false
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(GROUPS_TABLE)} (
                group_id varchar(128) primary key,
                group_name varchar(500) not null default '',
                cohort_id varchar(128) not null default '',
                programme_id varchar(255) not null default '',
                notes text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                color varchar(32),
                session_week_day varchar(255),
                session_start_time varchar(32),
                session_end_time varchar(32),
                status varchar(32) not null default 'active'
            )
        ''')
        for staff_table in ('tutors', 'coaches'):
            extra = "phone varchar(64) not null default ''," if staff_table == 'tutors' else ''
            cursor.execute(f'''
                create table if not exists {authoring_table_name(staff_table)} (
                    id varchar(128) primary key,
                    name varchar(255) not null,
                    email varchar(320) not null default '',
                    {extra}
                    created_at timestamp not null default current_timestamp,
                    updated_at timestamp not null default current_timestamp,
                    status varchar(32) not null default 'active'
                )
            ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name('group_coaches')} (
                group_id varchar(128) not null,
                coach_id varchar(128) not null,
                created_at timestamp not null default current_timestamp,
                primary key (group_id, coach_id)
            )
        ''')
        for statement in (
            f'create index if not exists curriculum_groups_programme_idx on {authoring_table_name(GROUPS_TABLE)} (programme_id)',
            f'create index if not exists curriculum_groups_cohort_idx on {authoring_table_name(GROUPS_TABLE)} (cohort_id)',
            f'create index if not exists curriculum_groups_programme_cohort_idx on {authoring_table_name(GROUPS_TABLE)} (programme_id, cohort_id)',
            f'create index if not exists curriculum_modules_title_idx on {authoring_table_name(AUTHORING_MODULES_TABLE)} (title)',
            f'create index if not exists curriculum_modules_programme_idx on {authoring_table_name(AUTHORING_MODULES_TABLE)} (programme_id, module_catalogue_id)',
            f'create index if not exists curriculum_modules_cohort_idx on {authoring_table_name(AUTHORING_MODULES_TABLE)} (cohort_id, module_catalogue_id)',
            f'create index if not exists curriculum_modules_group_idx on {authoring_table_name(AUTHORING_MODULES_TABLE)} (group_id, module_catalogue_id)',
            f'create index if not exists curriculum_weeks_module_idx on {authoring_table_name(AUTHORING_WEEKS_TABLE)} (module_catalogue_id)',
            f'create index if not exists curriculum_weeks_module_order_idx on {authoring_table_name(AUTHORING_WEEKS_TABLE)} (module_catalogue_id, display_order, id)',
            f'create index if not exists curriculum_components_module_idx on {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (module_catalogue_id)',
            f'create index if not exists curriculum_components_week_idx on {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (week_id)',
            f'create index if not exists curriculum_components_module_week_order_idx on {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (module_catalogue_id, week_id, display_order, id)',
            f'create index if not exists curriculum_components_updated_idx on {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (updated_at desc)',
            f'create index if not exists curriculum_ksb_mapping_component_idx on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (component_id)',
            # One row per component and standard KSB, archived rows included.
            f'create unique index if not exists curriculum_ksb_mapping_component_standard_idx '
            f'on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (component_id, standard_ksb_id)',
            f'create index if not exists curriculum_cohort_calendar_holidays_cohort_idx '
            f'on {authoring_table_name("cohort_calendar_holidays")} (cohort_id)',
        ):
            cursor.execute(statement)
    provision_course_pricing(connection)
    for table in (
        AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE, AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE, AUTHORING_COMPLETION_TABLE, AUTHORING_ADVANCED_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE, MODULE_TEAMS_SHARES_TABLE,
        'standard_ksbs', 'cohort_calendar_holidays', 'tutors', 'coaches', 'group_coaches',
    ):
        _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)
        _TABLE_COLUMNS_CACHE.pop(table, None)


def provision_free_programme_tables(
    *,
    CURRICULUM_SCHEMA,
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    authoring_json_type,
    authoring_table_name,
    connection,
    quote_ident,
):
    """Create/upgrade free-course schema. NOT for request paths."""
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(FREE_COURSES_TABLE)} (
                id varchar(128) primary key,
                course_name text not null default '',
                description text,
                cover_image_url text,
                week_builder_week_ids {json_type} not null default '[]',
                display_order integer not null default 0,
                week_count integer not null default 0,
                component_count integer not null default 0,
                total_otjh numeric(8,2) not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} (
                id varchar(128) primary key,
                course_id varchar(128) not null,
                week_id varchar(128),
                course_name text not null,
                description text,
                cover_image_url text,
                week_number integer not null default 1,
                week_title text not null default '',
                display_order integer not null default 0,
                component_count integer not null default 0,
                total_otjh numeric(8,2) not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} (
                id varchar(128) primary key,
                free_module_id varchar(128) not null,
                week_id varchar(128),
                programme_id varchar(255) not null,
                type varchar(64) not null,
                title text not null default '',
                description text,
                expected_otjh numeric(8,2) not null default 2,
                points integer not null default 0,
                reflection_required boolean not null default false,
                workplace_evidence_required boolean not null default false,
                tutor_validation_required boolean not null default false,
                display_order integer not null default 0,
                settings_json {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists course_name text not null default ''
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists description text
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists cover_image_url text
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists week_builder_week_ids {json_type} not null default '[]'
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists display_order integer not null default 0
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists week_count integer not null default 0
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists component_count integer not null default 0
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_COURSES_TABLE)}
                add column if not exists total_otjh numeric(8,2) not null default 0
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)}
                add column if not exists course_id varchar(128)
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)}
                add column if not exists week_id varchar(128)
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)}
                add column if not exists course_name text not null default ''
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)}
                add column if not exists week_number integer not null default 1
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)}
                add column if not exists week_title text not null default ''
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)}
                add column if not exists cover_image_url text
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists week_id varchar(128)
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists reflection_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists workplace_evidence_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists tutor_validation_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists settings_json {json_type}
            ''')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} alter column expected_otjh set default 2')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} drop column if exists programme_id')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} drop column if exists programme_name')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} drop column if exists title')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} drop column if exists status')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} drop column if exists color')
            cursor.execute(f'create index if not exists curriculum_free_courses_order_idx on {authoring_table_name(FREE_COURSES_TABLE)} (display_order, id)')
            cursor.execute(f'create index if not exists curriculum_free_course_weeks_course_idx on {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} (course_id)')
            cursor.execute(f'create index if not exists curriculum_free_courses_week_idx on {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} (week_id)')
            cursor.execute(f'create index if not exists curriculum_free_programme_components_week_idx on {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} (week_id)')
        else:
            cursor.execute(f'pragma table_info({quote_ident(FREE_PROGRAMME_COMPONENTS_TABLE)})')
            columns = {row[1] for row in cursor.fetchall()}
            cursor.execute(f'pragma table_info({quote_ident(FREE_PROGRAMME_MODULES_TABLE)})')
            module_columns = {row[1] for row in cursor.fetchall()}
            cursor.execute(f'pragma table_info({quote_ident(FREE_COURSES_TABLE)})')
            course_columns = {row[1] for row in cursor.fetchall()}
            if 'course_name' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column course_name text not null default ""')
            if 'description' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column description text')
            if 'cover_image_url' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column cover_image_url text')
            if 'week_builder_week_ids' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column week_builder_week_ids {json_type} not null default "[]"')
            if 'display_order' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column display_order integer not null default 0')
            if 'week_count' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column week_count integer not null default 0')
            if 'component_count' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column component_count integer not null default 0')
            if 'total_otjh' not in course_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_COURSES_TABLE)} add column total_otjh numeric(8,2) not null default 0')
            if 'course_id' not in module_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} add column course_id varchar(128) not null default ""')
            if 'week_id' not in module_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} add column week_id varchar(128)')
            if 'course_name' not in module_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} add column course_name text not null default ""')
            if 'week_number' not in module_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} add column week_number integer not null default 1')
            if 'week_title' not in module_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} add column week_title text not null default ""')
            if 'cover_image_url' not in module_columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} add column cover_image_url text')
            if 'week_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column week_id varchar(128)')
            if 'reflection_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column reflection_required boolean not null default false')
            if 'workplace_evidence_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column workplace_evidence_required boolean not null default false')
            if 'tutor_validation_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column tutor_validation_required boolean not null default false')
            if 'settings_json' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column settings_json {json_type}')


def provision_week_template_tables(
    *,
    CURRICULUM_SCHEMA,
    WEEK_TEMPLATES_TABLE,
    WEEK_TEMPLATE_COMPONENTS_TABLE,
    WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN,
    _TABLE_COLUMNS_CACHE,
    authoring_json_type,
    authoring_table_name,
    connection,
    quote_ident,
):
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(WEEK_TEMPLATES_TABLE)} (
                id varchar(128) primary key,
                title text not null default '',
                summary text,
                learning_outcomes {json_type},
                course_type varchar(16) not null default 'paid',
                programme_id varchar(255),
                programme_name varchar(255),
                module_catalogue_id varchar(128),
                group_id varchar(255),
                group_name varchar(255),
                status varchar(32) not null default 'draft',
                ksb_mappings {json_type},
                total_otjh numeric(8,2) not null default 0,
                points integer not null default 0,
                component_count integer not null default 0,
                author varchar(255),
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} (
                id varchar(128) primary key,
                week_template_id varchar(128) not null,
                type varchar(64) not null,
                title text not null default '',
                description text,
                expected_otjh numeric(8,2) not null default 2,
                points integer not null default 0,
                reflection_required boolean not null default false,
                reflection_question text,
                workplace_evidence_required boolean not null default false,
                tutor_validation_required boolean not null default false,
                coach_validation_required boolean not null default true,
                ksb_mappings {json_type},
                settings_json {json_type},
                display_order integer not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        # week_templates was left out of migration 0041's list, so it had no
        # soft-delete columns at all. It needs them for its DELETE to archive
        # rather than destroy a reusable template. Mirrors migration 0053.
        if connection.vendor == 'postgresql':
            for column, column_type in (
                ('deleted_at', 'timestamp with time zone'),
                ('deleted_by', 'varchar(255)'),
                ('deleted_via_parent', 'varchar(255)'),
            ):
                cursor.execute(
                    f'alter table {authoring_table_name(WEEK_TEMPLATES_TABLE)} '
                    f'add column if not exists {quote_ident(column)} {column_type}'
                )
        else:
            cursor.execute(f'pragma table_info({quote_ident(WEEK_TEMPLATES_TABLE)})')
            existing = {row[1] for row in cursor.fetchall()}
            for column, column_type in (
                ('deleted_at', 'timestamp with time zone'),
                ('deleted_by', 'varchar(255)'),
                ('deleted_via_parent', 'varchar(255)'),
            ):
                if column not in existing:
                    cursor.execute(
                        f'alter table {authoring_table_name(WEEK_TEMPLATES_TABLE)} '
                        f'add column {quote_ident(column)} {column_type}'
                    )
        # The reflection question is authored in the same component editor the
        # module builder uses, so a template has to be able to hold one too.
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'alter table {authoring_table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} '
                f'add column if not exists {quote_ident(WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN)} text'
            )
        else:
            cursor.execute(f'pragma table_info({quote_ident(WEEK_TEMPLATE_COMPONENTS_TABLE)})')
            existing = {row[1] for row in cursor.fetchall()}
            if WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN not in existing:
                cursor.execute(
                    f'alter table {authoring_table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} '
                    f'add column {quote_ident(WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN)} text'
                )
        # Coach validation is authored in the same component editor too, so a
        # template has to round-trip it rather than resetting every placed
        # component back to on. Default true, matching curriculum.components.
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'alter table {authoring_table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} '
                'add column if not exists coach_validation_required boolean not null default true'
            )
        else:
            cursor.execute(f'pragma table_info({quote_ident(WEEK_TEMPLATE_COMPONENTS_TABLE)})')
            existing = {row[1] for row in cursor.fetchall()}
            if 'coach_validation_required' not in existing:
                cursor.execute(
                    f'alter table {authoring_table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} '
                    'add column coach_validation_required boolean not null default 1'
                )
    # soft_delete_rows() decides what to write through has_column, so a cache
    # entry taken before those columns landed would make the archive a no-op.
    _TABLE_COLUMNS_CACHE.pop(WEEK_TEMPLATES_TABLE, None)
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{WEEK_TEMPLATES_TABLE}', None)
    # insert_row() filters against the cached column list, so the same applies
    # to the component table: a stale entry would silently drop the question.
    _TABLE_COLUMNS_CACHE.pop(WEEK_TEMPLATE_COMPONENTS_TABLE, None)
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{WEEK_TEMPLATE_COMPONENTS_TABLE}', None)


def ensure_columns(
    table, specs, *, CURRICULUM_SCHEMA, _TABLE_COLUMNS_CACHE, connection, has_column, quote_ident,
    table_name,
):
    missing = {column: definition for column, definition in specs.items() if not has_column(table, column)}
    if not missing:
        return
    with connection.cursor() as cursor:
        for column, definition in missing.items():
            if connection.vendor == 'postgresql':
                add_column = f'add column if not exists {quote_ident(column)} {definition}'
            else:
                # SQLite supports ADD COLUMN but not ADD COLUMN IF NOT EXISTS.
                # ``missing`` was already calculated through PRAGMA table_info.
                add_column = f'add column {quote_ident(column)} {definition}'
            cursor.execute(
                f'alter table {table_name(table)} {add_column}'
            )
    _TABLE_COLUMNS_CACHE.pop(table, None)
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)


def ensure_program_config_archive_columns(*, ensure_columns, has_column, logger, schema_gate, update_rows):
    if not schema_gate.runtime_bootstrap_allowed():
        return
    try:
        ensure_columns('programmes', {
            'level': 'varchar(64)',
            'color': 'varchar(32)',
            'description': 'text',
            'status': 'varchar(32)',
            'ksb_profile_source_id': 'varchar(128)',
            'required_otjh': 'numeric(8, 2)',
            'display_order': 'integer',
        })
    except Exception as exc:
        logger.warning('Could not inspect programme config archive columns: %s', exc)
        return
    if has_column('programmes', 'status'):
        try:
            update_rows('programmes', "coalesce(btrim(status), '') = ''", [], {'status': 'active'})
        except Exception:
            pass
