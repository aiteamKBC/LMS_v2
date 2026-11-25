"""Canonical source-activity KSB projection and additive, versioned maintenance.

Legacy JSON is retained as provenance. No reads provision or repair data.
The command/API boundary must authorize the activity before invoking the writer.
"""
import json
import re

CACHE_GENERATION_KEY = 'source-activity-ksbs:generation'


class KsbVersionConflict(ValueError):
    pass


def relation(source_activity_sql=None):
    """One row per legacy activity; suitable for existing LEFT JOIN consumers.

    An optional trusted SQL column scopes restoration to one canonical activity.
    Without that scope, multiple copies must agree on the exact definition before
    the legacy element can be presented as verified. Invalid mappings fail closed.
    """
    if source_activity_sql and not re.fullmatch(r'[a-z_]+\.[a-z_]+', source_activity_sql):
        raise ValueError('Expected a trusted source activity column.')
    scope = f'AND (n.source_activity_id={source_activity_sql} OR n.source_activity_id IS NULL)' if source_activity_sql else ''
    return f'''(WITH candidates AS (
        SELECT n.legacy_activity_id,n.legacy_ksb_code,n.mapping_status,
            min(n.id) AS ordinal,
            count(DISTINCT n.standard_ksb_id) AS definitions,
            bool_and(coalesce(s.id IS NOT NULL AND source_a.id IS NOT NULL
                AND source_a.source_material_id=n.legacy_activity_id
                AND p.standard_ref=s.standard_ref
                AND p.standard_version=s.standard_version,false)) IS TRUE AS compatible,
            min(s.id) AS definition_id,min(s.ksb_code) AS code,
            min(s.ksb_description) AS description,min(s.ksb_type) AS kind,
            min(s.standard_ref) AS standard_ref,min(s.standard_version) AS standard_version,
            (array_agg(n.legacy_ksb_snapshot ORDER BY n.id))[1] AS snapshot
        FROM curriculum.ksb_source_activity_mappings n
        LEFT JOIN curriculum.ksb_standard_definitions s ON s.id=n.standard_ksb_id
        LEFT JOIN curriculum.source_activities source_a ON source_a.id=n.source_activity_id
        LEFT JOIN curriculum.source_courses c ON c.id=source_a.source_course_id
        LEFT JOIN curriculum.programmes p ON p.programme_id=c.curriculum_programme_ref
        WHERE true {scope}
        GROUP BY n.legacy_activity_id,n.legacy_ksb_code,n.mapping_status
    ), metadata AS (
        SELECT legacy_activity_id,max(version) AS version,min(created_by) AS created_by,
            (array_agg(updated_by ORDER BY updated_at DESC,id DESC))[1] AS updated_by,
            min(created_at) AS created_at,max(updated_at) AS updated_at
        FROM curriculum.ksb_source_activity_mappings GROUP BY legacy_activity_id
    ) SELECT c.legacy_activity_id AS activity_id,m.version,m.created_by,m.updated_by,m.created_at,m.updated_at,
        jsonb_agg(
            CASE WHEN c.mapping_status='verified' AND c.definitions=1 AND c.compatible THEN
                coalesce(c.snapshot,'{{}}'::jsonb) || jsonb_build_object(
                    'code',c.code,'description',c.description,'type',c.kind,
                    'standardKsbId',c.definition_id,'standardRef',c.standard_ref,
                    'standardVersion',c.standard_version,'legacyCode',c.legacy_ksb_code,
                    'resolutionStatus','verified')
            ELSE (coalesce(c.snapshot,jsonb_build_object('code',c.legacy_ksb_code))
                - 'standardKsbId' - 'standardRef' - 'standardVersion') ||
                jsonb_build_object('resolutionStatus',CASE WHEN c.mapping_status='unresolved'
                    THEN 'unresolved' ELSE 'ambiguous_or_incompatible' END)
            END ORDER BY c.ordinal) AS ksbs
        FROM candidates c JOIN metadata m ON m.legacy_activity_id=c.legacy_activity_id
        GROUP BY c.legacy_activity_id,m.version,m.created_by,m.updated_by,m.created_at,m.updated_at)'''


def add_mapping(connection, *, source_activity_id, standard_ksb_id, expected_version,
                actor, legacy_code=None):
    """Add one validated relationship without deleting/replacing legacy evidence.

Use a psycopg connection (or Django's underlying psycopg connection) owned by
the caller. Transaction nesting uses a savepoint. A transaction advisory lock serializes
all copies of a legacy activity, including an initially empty mapping set. Existing identical requests are idempotent, including
retries after a lost response. Conflicting provenance never overwrites a row.
No schema creation, definition writes or Programme changes occur here.
"""
    if not actor or not str(actor).strip():
        raise ValueError('An audit actor is required.')
    if not isinstance(expected_version, int) or isinstance(expected_version, bool) or expected_version < 1:
        raise ValueError('A positive expected version is required.')
    with connection.transaction():
        with connection.cursor() as cursor:
            # Lock the parent scope as well: an incompatible concurrent remap
            # cannot commit between validation and insertion.
            cursor.execute('''SELECT a.source_material_id,p.standard_ref,p.standard_version
                FROM curriculum.source_activities a
                JOIN curriculum.source_courses c ON c.id=a.source_course_id
                JOIN curriculum.programmes p ON p.programme_id=c.curriculum_programme_ref
                WHERE a.id=%s FOR SHARE OF a,c,p''', [source_activity_id])
            source = cursor.fetchone()
            if not source or source[0] is None:
                raise ValueError('Source activity has no unambiguous legacy/Programme lineage.')
            legacy_id, applied_ref, applied_version = source
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))",
                           [f'ksb-source-activity:{legacy_id}'])
            cursor.execute('''SELECT coalesce(max(version),1)
                FROM curriculum.ksb_source_activity_mappings WHERE legacy_activity_id=%s''', [legacy_id])
            version = cursor.fetchone()[0]
            cursor.execute('''SELECT ksb_code,ksb_description,ksb_type,standard_ref,standard_version
                FROM curriculum.ksb_standard_definitions WHERE id=%s FOR SHARE''', [standard_ksb_id])
            definition = cursor.fetchone()
            if not definition:
                raise ValueError('Unknown canonical KSB definition.')
            code, description, kind, reference, standard_version = definition
            if (applied_ref, applied_version) != (reference, standard_version):
                raise ValueError('Definition does not match the exact applied Standard version.')
            legacy_code = legacy_code or code
            cursor.execute('''SELECT legacy_activity_id,legacy_ksb_code
                FROM curriculum.ksb_source_activity_mappings
                WHERE source_activity_id=%s AND standard_ksb_id=%s''',
                [source_activity_id, standard_ksb_id])
            existing = cursor.fetchone()
            if existing:
                if tuple(existing) != (legacy_id, legacy_code):
                    raise ValueError('Existing relationship has different provenance.')
                return {'version': version, 'changed': False}
            # Existing approved aliases can be retried, but this writer does
            # not invent new code remaps (including a blanket B7 -> B8 rule).
            if legacy_code != code:
                raise ValueError('New code remapping requires a separately reviewed migration.')
            cursor.execute('''SELECT 1 FROM curriculum.ksb_source_activity_mappings
                WHERE legacy_activity_id=%s AND standard_ksb_id=%s AND legacy_ksb_code<>%s LIMIT 1''',
                [legacy_id, standard_ksb_id, legacy_code])
            if cursor.fetchone():
                raise ValueError('Definition already has different legacy provenance on another activity copy.')
            if version != expected_version:
                raise KsbVersionConflict('KSB evidence changed; reload before writing.')
            cursor.execute('''SELECT standard_ksb_id FROM curriculum.ksb_source_activity_mappings
                WHERE source_activity_id=%s AND legacy_ksb_code=%s''', [source_activity_id, legacy_code])
            if cursor.fetchone():
                raise ValueError('Legacy element already has a different definition.')
            # Unresolved snapshots remain separate historical rows. Explicitly
            # adding a verified relationship never rewrites their identity.
            cursor.execute('''UPDATE curriculum.ksb_source_activity_mappings
                SET version=%s,updated_by=%s,updated_at=clock_timestamp()
                WHERE legacy_activity_id=%s''', [version + 1, actor, legacy_id])
            cursor.execute('''INSERT INTO curriculum.ksb_source_activity_mappings
                (source_activity_id,standard_ksb_id,legacy_activity_id,legacy_ksb_code,
                 legacy_ksb_snapshot,version,created_by,updated_by)
                VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s,%s)''',
                [source_activity_id, standard_ksb_id, legacy_id, legacy_code,
                 json.dumps({'code': code, 'description': description, 'type': kind}),
                 version + 1, actor, actor])
            return {'version': version + 1, 'changed': True}
