"""Write-driven invalidation/notifications; never scan for changed learners.

One statement collects its affected owners from PostgreSQL transition tables.
The same transaction invalidates their snapshots and publishes bounded IDs on
commit. A missing listener is safe: ordinary reads use the canonical fallback.
"""
from django.db import migrations

TARGET = '"Learner".learner_monthly_targets'
PREFIX = 'monthly_actual_event_'
CHANNEL = 'lms_monthly_actuals_changed'


def direct(field):
    return f"SELECT (c.row->>'{field}')::bigint AS learner_id FROM changed c"


def learner_lookup(field):
    return f'''SELECT l.id AS learner_id FROM changed c JOIN "Learner".learners l
        ON l.{field}::text=c.row->>'{field}' '''


PROGRESS_OWNER = '''SELECT p.learner_id FROM changed c JOIN "Learner".learner_progress_entries p
    ON p.id=(c.row->>'progress_id')::bigint'''
SPECS = [
    ('Learner', 'learner_progress_entries', direct('learner_id'), '''id learner_id kind module_ref module_title
        component_ref component_title component_type quiz_ref passed reported_time submitted_at declared_completed_at
        started_at time_tracking_source time_tracking_session_ref claimed_seconds verified_seconds expected_otjh
        source_system component_link_source actual_seconds accepted reporting_started_at reporting_ended_at
        reporting_month achieved_score total_score activity_status source_payload feed_kind actual_basis feedback
        group_title reporting_timestamp_label curriculum_component_ref deleted_at kbc_attendance_key'''.split()),
    ('Learner', 'learner_monthly_targets', direct('learner_id'),
        'id learner_id programme_id programme_profile_id report_month target_hours updated_at'.split()),
    ('Learner', 'learners', direct('id'), 'id enrolment_id aptem_id programme_id learner_type'.split()),
    ('Learner', 'learning_reflection_submissions', direct('learner_id'), '''id learner_id learner_kind component_ref
        progress_entry_id status actual_time_hours submitted_at activity_type activity_title module_title
        ksb_codes full_submission'''.split()),
    ('Learner', 'learner_activity_sources', direct('learner_id'), '''id learner_id canonical_progress_id
        source_system source_activity_id completed activity_status source_catalog_activity_id deleted_at'''.split()),
    ('Learner', 'learner_activity_reporting_segments', direct('learner_id'), 'id learner_id progress_id'.split()),
    ('Learner', 'learner_journal_rows', direct('learner_id'),
        'id learner_id progress_id source_id group_id activity_id source_ref month activity_date planned_hours deleted_at'.split()),
    ('Learner', 'learner_activity_documents', direct('learner_id'),
        'id learner_id progress_id display_name content_type deleted_at'.split()),
    ('Learner', 'learner_progress_ksbs', PROGRESS_OWNER, 'progress_id position ksb_code'.split()),
    ('Learner', 'learner_progress_ksb_exclusions', PROGRESS_OWNER, 'progress_id position ksb_code status'.split()),
    ('Learner', 'learner_progress_historical_components', PROGRESS_OWNER, 'progress_id historical_component_ref'.split()),
    ('Learner', 'subject_activity_attempts', '''SELECT l.id AS learner_id FROM changed c
        JOIN "Learner".learners l ON l.enrolment_id::text=c.row->>'enrolment_id'
        AND l.aptem_id::text=c.row->>'aptem_id' ''',
        'id enrolment_id aptem_id group_id activity_id definition completed score_percent submitted_at'.split()),
    ('Learner', 'progress_transfer_requests', learner_lookup('enrolment_id'),
        'id enrolment_id status requested_at approved_at records'.split()),
    ('Learner', 'progress_transfer_items', learner_lookup('enrolment_id'),
        'request_id enrolment_id course_ref snapshot'.split()),
    # monthly_audit_signoffs is a compatibility view over this physical table.
    # Its learner_id projects source_learner_id (Aptem), not the canonical ID.
    ('Learner', 'learner_monthly_signatures', direct('learner_id') + '''
        UNION SELECT l.id AS learner_id FROM changed c JOIN "Learner".learners l
        ON l.aptem_id::text=c.row->>'source_learner_id' ''',
        'id learner_id source_learner_id report_month review_confirmed signature_data signed_at'.split()),
    ('Learner', 'learner_monthly_locks', direct('learner_id'),
        'learner_id report_month locked_at unlocked_at'.split()),
    ('Learner', 'manual_month_finalization_events', learner_lookup('aptem_id'),
        'id aptem_id report_month event_type'.split()),
    ('Learner', 'source_lms_attendance', learner_lookup('aptem_id'), 'source_key aptem_id'.split()),
    ('curriculum', 'live_session_learner_attendance', direct('learner_profile_id'),
        'id learner_profile_id occurrence_id live_session_id module_catalogue_id attendance_status'.split()),
    ('curriculum', 'live_session_occurrences', '''SELECT r.learner_profile_id AS learner_id FROM changed c
        JOIN curriculum.live_session_learner_attendance r ON r.occurrence_id::text=c.row->>'id' ''',
        'id live_session_id session_number scheduled_start scheduled_end status'.split()),
    ('curriculum', 'live_sessions', '''SELECT r.learner_profile_id AS learner_id FROM changed c
        JOIN curriculum.live_session_learner_attendance r ON r.live_session_id::text=c.row->>'id' ''', 'id status'.split()),
    ('curriculum', 'modules', '''SELECT r.learner_profile_id AS learner_id FROM changed c
        JOIN curriculum.live_session_learner_attendance r ON r.module_catalogue_id=c.row->>'module_catalogue_id' ''',
        'module_catalogue_id title'.split()),
    ('curriculum', 'components', '''SELECT p.learner_id FROM changed c JOIN "Learner".learner_progress_entries p
        ON p.component_ref=c.row->>'id' OR p.curriculum_component_ref=c.row->>'id'
        UNION SELECT r.learner_profile_id FROM changed c JOIN curriculum.live_session_learner_attendance r
        ON r.module_catalogue_id=c.row->>'module_catalogue_id' ''', 'id module_catalogue_id type settings_json'.split()),
    ('curriculum', 'source_activities', '''SELECT s.learner_id FROM changed c JOIN "Learner".learner_activity_sources s
        ON s.source_catalog_activity_id::text=c.row->>'id' ''', 'id source_course_id deleted_at'.split()),
    ('curriculum', 'source_courses', '''SELECT s.learner_id FROM changed c
        JOIN curriculum.source_activities a ON a.source_course_id::text=c.row->>'id'
        JOIN "Learner".learner_activity_sources s ON s.source_catalog_activity_id=a.id''',
        'id source_course_ref deleted_at'.split()),
    ('curriculum', 'historical_components', '''SELECT p.learner_id FROM changed c
        JOIN "Learner".learner_progress_historical_components h ON h.historical_component_ref=c.row->>'id'
        JOIN "Learner".learner_progress_entries p ON p.id=h.progress_id''',
        'id source_system source_course_ref source_activity_id historical_only deleted_at'.split()),
    # These physical tables have both legacy and native layouts. JSON keys
    # tolerate optional content_ref/authoring columns without changing either.
    ('curriculum', 'free_courses', '''SELECT p.learner_id FROM changed c
        JOIN "Learner".learner_progress_entries p ON p.module_ref=coalesce(c.row->>'content_ref',c.row->>'id')
        UNION SELECT r.learner_profile_id FROM changed c JOIN curriculum.live_session_learner_attendance r
        ON r.module_catalogue_id=coalesce(c.row->>'content_ref',c.row->>'id')''', None),
    ('curriculum', 'free_course_weeks', '''SELECT r.learner_profile_id AS learner_id FROM changed c
        JOIN curriculum.free_courses f ON f.id::text=c.row->>'course_id'
        JOIN curriculum.live_session_learner_attendance r
        ON r.module_catalogue_id=coalesce(to_jsonb(f)->>'content_ref',f.id::text)''', None),
    ('curriculum', 'free_programme_components', '''SELECT p.learner_id FROM changed c
        JOIN "Learner".learner_progress_entries p
        ON p.component_ref=coalesce(c.row->>'content_ref',c.row->>'id')
          OR p.curriculum_component_ref=coalesce(c.row->>'content_ref',c.row->>'id')
        UNION SELECT r.learner_profile_id FROM changed c
        JOIN curriculum.free_course_weeks w ON w.id::text=c.row->>'free_module_id'
        JOIN curriculum.free_courses f ON f.id=w.course_id
        JOIN curriculum.live_session_learner_attendance r
        ON r.module_catalogue_id=coalesce(to_jsonb(f)->>'content_ref',f.id::text)''', None),
]


def definition(index, owner_sql, fields):
    # All identifiers come from the migration's static schema contract.
    values = ','.join(f"'{field}',r.\"{field}\"" for field in fields or ())
    payload = f'jsonb_build_object({values})' if fields else 'to_jsonb(r)'
    project = f'SELECT {payload} AS row FROM {{relation}} r'
    new, old = (project.format(relation=name) for name in ('new_rows', 'old_rows'))
    changes = {'INSERT': new, 'DELETE': old,
               'UPDATE': f'({new} EXCEPT {old}) UNION ({old} EXCEPT {new})'}
    branches = []
    for operation, change in changes.items():
        branches.append(f"""{'IF' if operation == 'INSERT' else 'ELSIF'} TG_OP='{operation}' THEN
            WITH changed AS ({change}), owners AS ({owner_sql})
            SELECT array_agg(DISTINCT learner_id ORDER BY learner_id)
            INTO owner_ids FROM owners WHERE learner_id IS NOT NULL;""")
    return f'''CREATE OR REPLACE FUNCTION "Learner".{PREFIX}{index}() RETURNS trigger
        LANGUAGE plpgsql AS $body$
        DECLARE owner_ids bigint[];
        BEGIN {' '.join(branches)} END IF;
            PERFORM "Learner".invalidate_monthly_actuals(owner_ids);
            RETURN NULL;
        END $body$'''


def install(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        cursor.execute("SET LOCAL statement_timeout='90s'")
        cursor.execute('SELECT to_regclass(%s)', [TARGET])
        if cursor.fetchone()[0] is None:
            return
        # Validate every dependency before installing any partial event contract.
        for schema, table, _owner_sql, fields in SPECS:
            cursor.execute('SELECT relkind FROM pg_class WHERE oid=to_regclass(%s)', [f'"{schema}".{table}'])
            if cursor.fetchone() not in [('r',), ('p',)]:
                raise RuntimeError(f'Monthly actual events require the physical {schema}.{table} table')
            cursor.execute('''SELECT attname FROM pg_attribute WHERE attrelid=to_regclass(%s)
                AND attnum>0 AND NOT attisdropped''', [f'"{schema}".{table}'])
            found = {row[0] for row in cursor.fetchall()}
            if set(fields or ['id']) - found:
                raise RuntimeError(f'Monthly actual events require the verified {schema}.{table} schema')
        cursor.execute('''SELECT format_type(atttypid,atttypmod),attnotnull
            FROM pg_attribute WHERE attrelid=to_regclass(%s)
              AND attname='actual_summary' AND NOT attisdropped''', [TARGET])
        existing = cursor.fetchone()
        if existing is not None and existing != ('jsonb', False):
            raise RuntimeError('Existing monthly actual_summary column has an unexpected definition')
        cursor.execute(f'ALTER TABLE {TARGET} ADD COLUMN IF NOT EXISTS actual_summary jsonb NULL')
        cursor.execute('''CREATE OR REPLACE FUNCTION "Learner".invalidate_monthly_actuals(owner_ids bigint[])
            RETURNS void LANGUAGE plpgsql AS $body$
            DECLARE offset_index integer;
            BEGIN
                IF coalesce(cardinality(owner_ids),0)=0 THEN RETURN; END IF;
                UPDATE "Learner".learner_monthly_targets
                  SET actual_seconds_total=NULL,actual_updated_at=NULL,actual_summary=NULL
                  WHERE learner_id=ANY(owner_ids);
                FOR offset_index IN 1..cardinality(owner_ids) BY 200 LOOP
                    PERFORM pg_notify('lms_monthly_actuals_changed',
                        to_json(owner_ids[offset_index:offset_index+199])::text);
                END LOOP;
            END $body$''')
        for index, (schema, table, owner_sql, fields) in enumerate(SPECS):
            cursor.execute(definition(index, owner_sql, fields))
            for operation in ('INSERT', 'UPDATE', 'DELETE'):
                name = f'{PREFIX}{index}_{operation.lower()}'
                relation = f'"{schema}".{table}'
                cursor.execute(f'DROP TRIGGER IF EXISTS {name} ON {relation}')
                references = ('OLD TABLE AS old_rows ' if operation != 'INSERT' else '') + (
                    'NEW TABLE AS new_rows' if operation != 'DELETE' else '')
                cursor.execute(f'''CREATE TRIGGER {name} AFTER {operation} ON {relation}
                    REFERENCING {references} FOR EACH STATEMENT
                    EXECUTE FUNCTION "Learner".{PREFIX}{index}()''')


def uninstall(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='5s'")
        # Retain stored snapshots as historical data, but prevent their use once
        # the invalidation contract is removed. No original activity is changed.
        cursor.execute(f'UPDATE {TARGET} SET actual_summary=NULL WHERE actual_summary IS NOT NULL')
        for index, (schema, table, _owner_sql, _fields) in enumerate(SPECS):
            for operation in ('insert', 'update', 'delete'):
                cursor.execute(f'DROP TRIGGER IF EXISTS {PREFIX}{index}_{operation} ON "{schema}".{table}')
            cursor.execute(f'DROP FUNCTION IF EXISTS "Learner".{PREFIX}{index}()')
        cursor.execute('DROP FUNCTION IF EXISTS "Learner".invalidate_monthly_actuals(bigint[])')


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0029_monthly_actual_summary_storage')]
    operations = [migrations.RunPython(install, uninstall, hints={'learner_schema_migration': True})]
