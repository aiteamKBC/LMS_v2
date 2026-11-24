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
    scope = f'WHERE n.source_activity_id={source_activity_sql}' if source_activity_sql else ''
    return f'''(WITH candidates AS (
        SELECT n.legacy_activity_id,n.legacy_ksb_code,
            count(DISTINCT n.standard_ksb_id) AS definitions,
            bool_and(coalesce(s.id IS NOT NULL AND source_a.id IS NOT NULL
                AND source_a.source_material_id=n.legacy_activity_id
                AND lower(p.ksb_profile_source_id)=
                    'standard:'||lower(s.standard_ref)||'-v'||replace(s.standard_version,'.','-')
                AND n.version=l.version,false)) IS TRUE AS compatible,
            min(s.id) AS definition_id,min(s.ksb_code) AS code,
            min(s.ksb_description) AS description,min(s.ksb_type) AS kind,
            min(s.standard_ref) AS standard_ref,min(s.standard_version) AS standard_version
        FROM curriculum.source_activity_ksbs_normalized n
        LEFT JOIN curriculum.standard_ksbs s ON s.id=n.standard_ksb_id
        LEFT JOIN curriculum.source_activities source_a ON source_a.id=n.source_activity_id
        LEFT JOIN curriculum.source_courses c ON c.id=source_a.source_course_id
        LEFT JOIN curriculum.programmes p ON p.programme_id=c.curriculum_programme_ref
        LEFT JOIN curriculum.source_activity_ksbs l ON l.activity_id=n.legacy_activity_id
        {scope}
        GROUP BY n.legacy_activity_id,n.legacy_ksb_code
    ) SELECT l.activity_id,l.version,l.created_by,l.updated_by,l.created_at,l.updated_at,
        coalesce(jsonb_agg(
            CASE WHEN c.definitions=1 AND c.compatible THEN
                e.item || jsonb_build_object('code',c.code,'description',c.description,
                    'type',c.kind,'standardKsbId',c.definition_id,
                    'standardRef',c.standard_ref,'standardVersion',c.standard_version,
                    'legacyCode',e.item->>'code','resolutionStatus','verified')
            ELSE (e.item - 'standardKsbId' - 'standardRef' - 'standardVersion') ||
                jsonb_build_object('resolutionStatus',CASE WHEN c.definitions IS NULL
                    THEN 'unresolved' ELSE 'ambiguous_or_incompatible' END)
            END ORDER BY e.ordinality) FILTER (WHERE e.ordinality IS NOT NULL),'[]'::jsonb) AS ksbs
        FROM curriculum.source_activity_ksbs l
        LEFT JOIN LATERAL jsonb_array_elements(l.ksbs) WITH ORDINALITY e(item,ordinality) ON true
        LEFT JOIN candidates c ON c.legacy_activity_id=l.activity_id
            AND c.legacy_ksb_code=e.item->>'code'
        GROUP BY l.activity_id,l.version,l.created_by,l.updated_by,l.created_at,l.updated_at)'''


def add_mapping(connection, *, source_activity_id, standard_ksb_id, expected_version,
                actor, legacy_code=None):
    """Add one validated relationship without deleting/replacing legacy evidence.

Use a psycopg connection (or Django's underlying psycopg connection) owned by
the caller. Transaction nesting uses a savepoint. The legacy row serializes
all copies of an activity. Existing identical requests are idempotent, including
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
            cursor.execute('''SELECT a.source_material_id,p.ksb_profile_source_id
                FROM curriculum.source_activities a
                JOIN curriculum.source_courses c ON c.id=a.source_course_id
                JOIN curriculum.programmes p ON p.programme_id=c.curriculum_programme_ref
                WHERE a.id=%s FOR SHARE OF a,c,p''', [source_activity_id])
            source = cursor.fetchone()
            if not source or source[0] is None:
                raise ValueError('Source activity has no unambiguous legacy/Programme lineage.')
            legacy_id, applied = source
            cursor.execute('''SELECT ksbs,version FROM curriculum.source_activity_ksbs
                WHERE activity_id=%s FOR UPDATE''', [legacy_id])
            legacy = cursor.fetchone()
            if not legacy:
                raise ValueError('Legacy activity evidence is required; creation is not implicit.')
            items, version = legacy
            if isinstance(items, str):
                items = json.loads(items)
            cursor.execute('''SELECT ksb_code,ksb_description,ksb_type,standard_ref,standard_version
                FROM curriculum.standard_ksbs WHERE id=%s FOR SHARE''', [standard_ksb_id])
            definition = cursor.fetchone()
            if not definition:
                raise ValueError('Unknown canonical KSB definition.')
            code, description, kind, reference, standard_version = definition
            exact_source = f'standard:{reference.lower()}-v{standard_version.replace(".", "-")}'
            if (applied or '').lower() != exact_source:
                raise ValueError('Definition does not match the exact applied Standard version.')
            legacy_code = legacy_code or code
            cursor.execute('''SELECT legacy_activity_id,legacy_ksb_code
                FROM curriculum.source_activity_ksbs_normalized
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
            cursor.execute('''SELECT 1 FROM curriculum.source_activity_ksbs_normalized
                WHERE legacy_activity_id=%s AND standard_ksb_id=%s AND legacy_ksb_code<>%s LIMIT 1''',
                [legacy_id, standard_ksb_id, legacy_code])
            if cursor.fetchone():
                raise ValueError('Definition already has different legacy provenance on another activity copy.')
            if version != expected_version:
                raise KsbVersionConflict('KSB evidence changed; reload before writing.')
            cursor.execute('''SELECT standard_ksb_id FROM curriculum.source_activity_ksbs_normalized
                WHERE source_activity_id=%s AND legacy_ksb_code=%s''', [source_activity_id, legacy_code])
            if cursor.fetchone():
                raise ValueError('Legacy element already has a different definition.')
            if not any(item.get('code') == legacy_code for item in items):
                items.append({'code': code, 'description': description, 'type': kind})
            cursor.execute('''UPDATE curriculum.source_activity_ksbs
                SET ksbs=%s::jsonb,version=version+1,updated_by=%s,updated_at=clock_timestamp()
                WHERE activity_id=%s''', [json.dumps(items), actor, legacy_id])
            cursor.execute('''UPDATE curriculum.source_activity_ksbs_normalized n
                SET version=l.version,updated_by=l.updated_by,updated_at=l.updated_at
                FROM curriculum.source_activity_ksbs l
                WHERE l.activity_id=%s AND n.legacy_activity_id=l.activity_id''', [legacy_id])
            cursor.execute('''INSERT INTO curriculum.source_activity_ksbs_normalized
                (source_activity_id,standard_ksb_id,legacy_activity_id,legacy_ksb_code,
                 version,created_by,updated_by,created_at,updated_at)
                SELECT %s,%s,l.activity_id,%s,l.version,l.created_by,l.updated_by,l.created_at,l.updated_at
                FROM curriculum.source_activity_ksbs l WHERE l.activity_id=%s''',
                [source_activity_id, standard_ksb_id, legacy_code, legacy_id])
            return {'version': version + 1, 'changed': True}
