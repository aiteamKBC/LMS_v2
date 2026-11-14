"""Migration-owned preparation for independent free-course storage.

No request handler may call this module. Preparation copies the existing
authoring rows into the three free-course tables without changing their IDs,
learner history, video jobs, or the ordinary authoring tables. Cutover is a
separate, transactionally verified migration step.
"""
from psycopg import sql
from .free_course_contract import COLUMNS, NATIVE_VIEWS


TABLES = {
    'modules': ('learning_courses', 'free_courses'),
    'weeks': ('learning_weeks', 'free_course_weeks'),
    'components': ('learning_components', 'free_programme_components'),
    'module_details': ('learning_course_details', 'free_courses'),
    'module_completion_criteria': ('learning_completion_criteria', 'free_courses'),
    'ksb_mappings': ('learning_ksb_mappings', 'free_courses'),
}

REFERENCES = (
    ('Learner', 'learner_training_plan_modules', 'curriculum_module_id', 'free_course_ref', 'free_courses'),
    ('Learner', 'learner_training_plan_weeks', 'curriculum_week_id', 'free_week_ref', 'free_course_weeks'),
    ('Learner', 'learner_training_plan_components', 'curriculum_component_id', 'free_component_ref', 'free_programme_components'),
    ('curriculum', 'source_courses', 'curriculum_module_ref', 'free_course_ref', 'free_courses'),
    ('curriculum', 'source_activities', 'curriculum_component_ref', 'free_component_ref', 'free_programme_components'),
    ('curriculum', 'historical_components', 'curriculum_module_ref', 'free_course_ref', 'free_courses'),
    ('curriculum', 'historical_components', 'curriculum_week_ref', 'free_week_ref', 'free_course_weeks'),
    ('curriculum', 'live_sessions', 'module_catalogue_id', 'free_course_ref', 'free_courses'),
    ('curriculum', 'module_teams_shares', 'module_catalogue_id', 'free_course_ref', 'free_courses'),
    ('curriculum', 'module_teams_shares', 'source_module_catalogue_id', 'free_source_course_ref', 'free_courses'),
    ('curriculum', 'qr_attendance', 'module_id', 'free_course_ref', 'free_courses'),
)

REFERENCE_VIEWS = {table: 'learning_' + table for schema, table, *_ in REFERENCES if schema == 'curriculum'}


def verify_remaining_references(cursor, course_refs):
    """Reject unhandled links, including CASCADE/SET NULL, before removing copies."""
    cursor.execute('''SELECT ns.nspname, child.relname, parent.relname,
        array_agg(ca.attname ORDER BY keys.position), array_agg(pa.attname ORDER BY keys.position)
        FROM pg_constraint fk
        JOIN pg_class child ON child.oid=fk.conrelid
        JOIN pg_namespace ns ON ns.oid=child.relnamespace
        JOIN pg_class parent ON parent.oid=fk.confrelid
        CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY keys(child_key,parent_key,position)
        JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=keys.child_key
        JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=keys.parent_key
        WHERE fk.contype='f' AND fk.confrelid IN (
            'curriculum.modules'::regclass,'curriculum.weeks'::regclass,'curriculum.components'::regclass)
        GROUP BY fk.oid,ns.nspname,child.relname,parent.relname''')
    for namespace, table, parent, child_keys, parent_keys in cursor.fetchall():
        predicates = sql.SQL(' AND ').join(
            sql.SQL('child.{}=parent.{}').format(sql.Identifier(left), sql.Identifier(right))
            for left, right in zip(child_keys, parent_keys))
        query = sql.SQL('''SELECT EXISTS (SELECT 1 FROM {} child JOIN curriculum.{} parent ON {}
            WHERE parent.module_catalogue_id=ANY(%s)''').format(
                sql.Identifier(namespace, table), sql.Identifier(parent), predicates)
        params = [course_refs]
        if namespace == 'curriculum' and table in TABLES:
            # These source rows are removed explicitly after their complete
            # native copy is verified; rows owned by other courses must survive.
            query += sql.SQL(' AND (child.module_catalogue_id IS NULL OR child.module_catalogue_id<>ALL(%s))')
            params.append(course_refs)
        cursor.execute(query + sql.SQL(')'), params)
        if cursor.fetchone()[0]:
            raise RuntimeError(f'Unmigrated free-course relationship in {namespace}.{table}; cutover stopped.')


def create_reference_views(cursor):
    """Preserve existing read identities after physical foreign keys move."""
    for table, view in REFERENCE_VIEWS.items():
        cursor.execute('SELECT to_regclass(%s)', ['curriculum.' + table])
        if cursor.fetchone()[0] is None:
            continue
        cursor.execute('''SELECT column_name FROM information_schema.columns
            WHERE table_schema='curriculum' AND table_name=%s ORDER BY ordinal_position''', [table])
        columns = [row[0] for row in cursor.fetchall()]
        replacements = {}
        for namespace, owner, old, new, _ in REFERENCES:
            if namespace != 'curriculum' or owner != table:
                continue
            if old in columns and new in columns:
                replacements[old] = sql.SQL('coalesce(t.{},t.{}) AS {}').format(
                    sql.Identifier(old), sql.Identifier(new), sql.Identifier(old))
        # Direct column projection lets PostgreSQL push learner/source filters
        # into the underlying indexes without expanding large history JSON.
        fields = [replacements.get(column, sql.Identifier('t', column)) for column in columns]
        cursor.execute(sql.SQL('CREATE OR REPLACE VIEW curriculum.{} AS SELECT {} FROM curriculum.{} t').format(
            sql.Identifier(view), sql.SQL(',').join(fields), sql.Identifier(table)))


def prepare(connection):
    """Add independent metadata and copy authoring state; do not detach yet."""
    if connection.vendor != 'postgresql':
        raise RuntimeError('Independent course storage requires PostgreSQL.')
    with connection.cursor() as cursor:
        cursor.execute('''
            ALTER TABLE curriculum.free_courses
                ADD COLUMN IF NOT EXISTS content_ref varchar(128) UNIQUE,
                ADD COLUMN IF NOT EXISTS authoring_data jsonb NOT NULL DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS details_json jsonb NOT NULL DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS completion_json jsonb NOT NULL DEFAULT '{}',
                ADD COLUMN IF NOT EXISTS ksb_mappings jsonb NOT NULL DEFAULT '[]',
                ADD COLUMN IF NOT EXISTS storage_version integer NOT NULL DEFAULT 1;
            ALTER TABLE curriculum.free_course_weeks
                ADD COLUMN IF NOT EXISTS content_ref varchar(128) UNIQUE,
                ADD COLUMN IF NOT EXISTS authoring_data jsonb NOT NULL DEFAULT '{}';
            ALTER TABLE curriculum.free_programme_components
                ADD COLUMN IF NOT EXISTS content_ref varchar(128) UNIQUE,
                ADD COLUMN IF NOT EXISTS authoring_data jsonb NOT NULL DEFAULT '{}';
        ''')
        # An interrupted preparation is safe to repeat. Once a course has cut
        # over, its independent data must never be overwritten from old tables.
        cursor.execute('''UPDATE curriculum.free_courses f SET
            content_ref=m.module_catalogue_id, authoring_data=to_jsonb(m),
            details_json=coalesce((SELECT to_jsonb(d) FROM curriculum.module_details d
                WHERE d.module_catalogue_id=m.module_catalogue_id), '{}'::jsonb),
            completion_json=coalesce((SELECT to_jsonb(c) FROM curriculum.module_completion_criteria c
                WHERE c.module_catalogue_id=m.module_catalogue_id), '{}'::jsonb),
            ksb_mappings=coalesce((SELECT jsonb_agg(to_jsonb(k) ORDER BY k.id)
                FROM curriculum.ksb_mappings k WHERE k.module_catalogue_id=m.module_catalogue_id), '[]'::jsonb)
            FROM curriculum.modules m WHERE f.module_catalogue_id=m.module_catalogue_id
              AND m.source_type='free_course' AND f.storage_version=1''')
        cursor.execute('''UPDATE curriculum.free_course_weeks f SET
            content_ref=w.id, authoring_data=to_jsonb(w)
            FROM curriculum.weeks w, curriculum.free_courses course
            WHERE f.authoring_week_id=w.id AND course.id=f.course_id
              AND course.content_ref=w.module_catalogue_id AND course.storage_version=1''')
        cursor.execute('''UPDATE curriculum.free_programme_components f SET
            content_ref=c.id, authoring_data=to_jsonb(c)
            FROM curriculum.components c, curriculum.free_course_weeks w, curriculum.free_courses course
            WHERE f.authoring_component_id=c.id AND w.id=f.free_module_id
              AND course.id=w.course_id AND course.content_ref=c.module_catalogue_id
              AND course.storage_version=1''')
        # Converted catalogue entries remain historical records and continue
        # suppressing the legacy API. Preserve their opaque identities too.
        for table, old in (('free_courses', 'module_catalogue_id'),
                           ('free_course_weeks', 'authoring_week_id'),
                           ('free_programme_components', 'authoring_component_id')):
            cursor.execute(sql.SQL('UPDATE curriculum.{} SET content_ref={} WHERE content_ref IS NULL').format(
                sql.Identifier(table), sql.Identifier(old)))
        cursor.execute('''SELECT count(*) FROM curriculum.modules m
            WHERE m.source_type='free_course' AND NOT EXISTS (
                SELECT 1 FROM curriculum.free_courses f WHERE f.content_ref=m.module_catalogue_id)''')
        if cursor.fetchone()[0]:
            raise RuntimeError('A free course has no independent storage identity; preparation stopped.')
        for ordinary, free, key in (
            ('weeks', 'free_course_weeks', 'id'),
            ('components', 'free_programme_components', 'id'),
        ):
            cursor.execute(sql.SQL('''SELECT count(*) FROM curriculum.{} item
                JOIN curriculum.modules m ON m.module_catalogue_id=item.module_catalogue_id
                WHERE m.source_type='free_course' AND NOT EXISTS (
                    SELECT 1 FROM curriculum.{} f WHERE f.content_ref=item.{})''').format(
                        sql.Identifier(ordinary), sql.Identifier(free), sql.Identifier(key)))
            if cursor.fetchone()[0]:
                raise RuntimeError('Free-course child rows are missing; preparation stopped.')
    create_read_views(connection)


def create_read_views(connection):
    """Create native reads with no dependency on ordinary tables or row types.

    storage_version=2 is the cutover marker. Prepared rows are not exposed twice.
    The retained content_ref is an opaque learning identity, not a foreign key
    to modules/weeks/components. It preserves existing bookmarks and evidence.
    Mixed catalogue views combine two independently defined contracts. Native
    authoring never uses those mixed views. Dropping an ordinary table must not
    drop a native view or make a free course unavailable.
    """
    projections = {
        'modules': '''SELECT row.* FROM curriculum.free_courses f
            CROSS JOIN LATERAL jsonb_to_record(
                f.authoring_data || jsonb_build_object(
                    'module_catalogue_id',f.content_ref,'title',f.course_name,
                    'description',f.description,'cover_image_url',f.cover_image_url,
                    'total_otjh',f.total_otjh,'is_for_sale',f.is_for_sale,'price',f.price,'currency',f.currency,
                    'source_type','free_course','learner_roster_mode','manual',
                    'deleted_at',f.deleted_at,
                    'created_at',f.created_at,'updated_at',f.updated_at,'weeks_number',f.week_count)) row
            WHERE f.storage_version=2 AND f.converted_at IS NULL''',
        'weeks': '''SELECT row.* FROM curriculum.free_course_weeks w
            JOIN curriculum.free_courses f ON f.id=w.course_id
            CROSS JOIN LATERAL jsonb_to_record(
                w.authoring_data || jsonb_build_object('id',w.content_ref,'module_catalogue_id',f.content_ref,
                    'week_number',w.week_number,'title',w.week_title,'display_order',w.display_order,
                    'deleted_at',w.deleted_at,'created_at',w.created_at,'updated_at',w.updated_at)) row
            WHERE f.storage_version=2 AND f.converted_at IS NULL''',
        'components': '''SELECT row.* FROM curriculum.free_programme_components c
            JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id
            JOIN curriculum.free_courses f ON f.id=w.course_id
            CROSS JOIN LATERAL jsonb_to_record(
                c.authoring_data || jsonb_build_object('id',c.content_ref,'module_catalogue_id',f.content_ref,
                    'week_id',w.content_ref,'type',c.type,'title',c.title,'description',c.description,
                    'expected_otjh',c.expected_otjh,'points',c.points,'reflection_required',c.reflection_required,
                    'workplace_evidence_required',c.workplace_evidence_required,
                    'tutor_validation_required',c.tutor_validation_required,'settings_json',c.settings_json,
                    'display_order',c.display_order,'deleted_at',c.deleted_at,
                    'created_at',c.created_at,'updated_at',c.updated_at)) row
            WHERE f.storage_version=2 AND f.converted_at IS NULL''',
        'module_details': '''SELECT row.* FROM curriculum.free_courses f
            CROSS JOIN LATERAL jsonb_to_record(
                f.details_json || jsonb_build_object('module_catalogue_id',f.content_ref)) row
            WHERE f.storage_version=2 AND f.converted_at IS NULL AND f.details_json <> '{}'::jsonb''',
        'module_completion_criteria': '''SELECT row.* FROM curriculum.free_courses f
            CROSS JOIN LATERAL jsonb_to_record(
                f.completion_json || jsonb_build_object('module_catalogue_id',f.content_ref)) row
            WHERE f.storage_version=2 AND f.converted_at IS NULL AND f.completion_json <> '{}'::jsonb''',
        'ksb_mappings': '''SELECT row.* FROM curriculum.free_courses f
            CROSS JOIN LATERAL jsonb_array_elements(f.ksb_mappings) item
            CROSS JOIN LATERAL jsonb_to_record(
                item || jsonb_build_object('module_catalogue_id',f.content_ref)) row
            WHERE f.storage_version=2 AND f.converted_at IS NULL''',
    }
    with connection.cursor() as cursor:
        for table, (view, _) in TABLES.items():
            definition = sql.SQL(', ').join(sql.SQL('{} {}').format(sql.Identifier(name), sql.SQL(kind))
                                            for name, kind in COLUMNS[table])
            before, after = projections[table].split(') row', 1)
            native = sql.SQL(before + ') AS row (') + definition + sql.SQL(')' + after)
            cursor.execute(sql.SQL('CREATE OR REPLACE VIEW curriculum.{} AS {}').format(
                sql.Identifier(NATIVE_VIEWS[table]), native))
            # Ordinary column discovery belongs only to this mixed-catalogue
            # migration step; the native contract above is independently owned.
            cursor.execute('''SELECT column_name FROM information_schema.columns
                WHERE table_schema='curriculum' AND table_name=%s''', [table])
            available = {row[0] for row in cursor.fetchall()}
            ordinary = sql.SQL(', ').join(
                sql.SQL('{}::{} AS {}').format(sql.Identifier(name) if name in available else sql.SQL('NULL'),
                                               sql.SQL(kind), sql.Identifier(name))
                for name, kind in COLUMNS[table])
            cursor.execute(sql.SQL('CREATE OR REPLACE VIEW curriculum.{} AS SELECT {} FROM curriculum.{} UNION ALL SELECT * FROM curriculum.{}').format(
                sql.Identifier(view), ordinary, sql.Identifier(table), sql.Identifier(NATIVE_VIEWS[table])))


def detach(connection):
    """Move prepared courses out of module storage in the caller's transaction.

    Production callers must verify their backup and release plan before invoking
    this data migration. Any missing owner/reference aborts the entire cutover.
    No history/attempt/progress/attendance row is deleted or recreated.
    """
    if not connection.in_atomic_block:
        raise RuntimeError('Free-course cutover requires one explicit transaction.')
    with connection.cursor() as cursor:
        cursor.execute('''LOCK TABLE curriculum.modules, curriculum.weeks, curriculum.components,
            curriculum.free_courses, curriculum.free_course_weeks, curriculum.free_programme_components
            IN SHARE ROW EXCLUSIVE MODE''')
        prepare(connection)
        cursor.execute("SELECT module_catalogue_id FROM curriculum.modules WHERE source_type='free_course' ORDER BY 1")
        course_refs = [row[0] for row in cursor.fetchall()]

        def exists(schema, table):
            cursor.execute('SELECT to_regclass(%s)', [f'"{schema}"."{table}"'])
            return cursor.fetchone()[0] is not None

        def move_reference(schema, table, old, new, free_table):
            if not exists(schema, table):
                return
            cursor.execute('''SELECT is_nullable FROM information_schema.columns
                WHERE table_schema=%s AND table_name=%s AND column_name=%s''', [schema, table, old])
            column = cursor.fetchone()
            if not column:
                return
            owner = sql.Identifier(schema, table)
            cursor.execute(sql.SQL('''ALTER TABLE {} ADD COLUMN IF NOT EXISTS {} varchar(128)
                REFERENCES curriculum.{}(content_ref) ON DELETE RESTRICT''').format(
                    owner, sql.Identifier(new), sql.Identifier(free_table)))
            identities = {'free_courses': course_refs}
            for physical, free_name in (('weeks', 'free_course_weeks'), ('components', 'free_programme_components')):
                cursor.execute(sql.SQL('SELECT id FROM curriculum.{} WHERE module_catalogue_id=ANY(%s)').format(sql.Identifier(physical)), [course_refs])
                identities[free_name] = [row[0] for row in cursor.fetchall()]
            cursor.execute(sql.SQL('SELECT count(*) FROM {} WHERE {}=ANY(%s)').format(
                owner, sql.Identifier(old)), [identities[free_table]])
            if not cursor.fetchone()[0]:
                return
            if column[0] == 'NO':
                cursor.execute(sql.SQL('ALTER TABLE {} ALTER COLUMN {} DROP NOT NULL').format(owner, sql.Identifier(old)))
                cursor.execute(sql.SQL('ALTER TABLE {} ADD CONSTRAINT {} CHECK (num_nonnulls({}, {})=1)').format(
                    owner, sql.Identifier((table + '_' + new + '_owner')[:63]), sql.Identifier(old), sql.Identifier(new)))
            cursor.execute(sql.SQL('''UPDATE {} owner SET {}=f.content_ref, {}=NULL
                FROM curriculum.{} f WHERE owner.{}=f.content_ref AND f.content_ref=ANY(%s)''').format(
                    owner, sql.Identifier(new), sql.Identifier(old), sql.Identifier(free_table), sql.Identifier(old)),
                    [identities[free_table]])

        for schema, table, old, new, free_table in REFERENCES:
            move_reference(schema, table, old, new, free_table)
        create_reference_views(cursor)

        # Populate the learner's native indexes before dropping bridge columns.
        # This copies existing achievements only; the hours/evidence ledger is
        # deliberately untouched, including zero-hour imported history.
        if exists('Learner', 'learner_training_plan_modules'):
            cursor.execute('''INSERT INTO "Learner".learner_free_courses
                (learner_id, position, free_course_ref, free_course_title)
                SELECT p.learner_id, min(p.position), f.id, f.course_name
                FROM "Learner".learner_training_plan_modules p
                JOIN curriculum.free_courses f ON f.content_ref=p.module_ref
                WHERE f.content_ref=ANY(%s) AND NOT EXISTS (
                    SELECT 1 FROM "Learner".learner_free_courses a
                    WHERE a.learner_id=p.learner_id AND a.free_course_ref=f.id)
                GROUP BY p.learner_id,f.id,f.course_name''', [course_refs])
        if exists('Learner', 'learner_free_course_progress'):
            cursor.execute('''INSERT INTO "Learner".learner_free_course_progress
                (learner_id,component_ref,free_course_ref,completed_at)
                SELECT p.learner_id,c.id,f.id,min(coalesce(p.submitted_at,p.declared_completed_at))
                FROM "Learner".learner_progress_entries p
                JOIN curriculum.free_programme_components c ON c.content_ref=p.component_ref
                JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id
                JOIN curriculum.free_courses f ON f.id=w.course_id
                WHERE f.content_ref=ANY(%s) AND p.passed IS DISTINCT FROM false
                  AND (lower(btrim(coalesce(p.kind,'')))<>'quiz' OR p.passed=true)
                  AND coalesce(p.submitted_at,p.declared_completed_at) IS NOT NULL
                GROUP BY p.learner_id,c.id,f.id
                ON CONFLICT (learner_id,component_ref) DO NOTHING''', [course_refs])

        # Stop the old mirroring/archive triggers before removing source rows.
        # The independent rows must remain live, not be archived by the move.
        for table in ('modules', 'weeks', 'components'):
            for trigger in ('free_course_storage_sync', 'free_course_storage_archive'):
                cursor.execute(sql.SQL('DROP TRIGGER IF EXISTS {} ON curriculum.{}').format(
                    sql.Identifier(trigger), sql.Identifier(table)))
        for table, trigger in (
            ('free_courses', 'free_course_price_sync'),
            ('free_course_weeks', 'free_course_storage_owner'),
            ('free_programme_components', 'free_course_storage_owner'),
        ):
            cursor.execute(sql.SQL('DROP TRIGGER IF EXISTS {} ON curriculum.{}').format(
                sql.Identifier(trigger), sql.Identifier(table)))
        # These columns were foreign keys to ordinary storage. content_ref is
        # the retained learning identity and has no dependency on those tables.
        for table, column in (
            ('free_courses', 'module_catalogue_id'),
            ('free_course_weeks', 'authoring_week_id'),
            ('free_programme_components', 'authoring_component_id'),
        ):
            cursor.execute(sql.SQL('ALTER TABLE curriculum.{} DROP COLUMN {}').format(
                sql.Identifier(table), sql.Identifier(column)))

        # The video journal uses opaque API identities, not foreign keys to
        # modules. Leave its scope, fingerprints, timestamps and assets intact:
        # changing them would enqueue duplicate imports during later saves.

        # Constraints with CASCADE/SET NULL would not raise an integrity error.
        # Check their live references explicitly before deleting copied rows.
        verify_remaining_references(cursor, course_refs)
        for table in ('ksb_mappings', 'module_details', 'module_completion_criteria', 'components', 'weeks', 'modules'):
            cursor.execute(sql.SQL('DELETE FROM curriculum.{} WHERE module_catalogue_id=ANY(%s)').format(
                sql.Identifier(table)), [course_refs])
        cursor.execute('UPDATE curriculum.free_courses SET storage_version=2 WHERE content_ref=ANY(%s)', [course_refs])
        cursor.execute("SELECT count(*) FROM curriculum.modules WHERE source_type='free_course'")
        if cursor.fetchone()[0]:
            raise RuntimeError('Some free-course module rows survived cutover.')
        cursor.execute('''ALTER TABLE curriculum.modules ADD CONSTRAINT modules_regular_storage_only
            CHECK (source_type IS DISTINCT FROM 'free_course')''')
        cursor.execute('''ALTER TABLE curriculum.free_courses ALTER COLUMN storage_version SET DEFAULT 2,
            ADD CONSTRAINT free_courses_native_storage CHECK (storage_version=2 OR converted_at IS NOT NULL)''')
    from .learning_storage import reset
    reset()
