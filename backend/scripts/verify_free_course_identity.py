"""SELECT-only canonical identity verification; optional private recovery baseline.

Never migrates, recalculates, or prints learner identities. Supply --manifest and
--baseline from the private isolated-migration artifacts for exact parity checks.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.verify_inclusion_canonical_targets import connect_development
from learner_api.free_course_hours import HOURS_SQL, MAPPINGS_SQL
from psycopg.types.json import Jsonb


def verify(connection, manifest=None, baseline=None):
    connection.execute("SET LOCAL TIME ZONE 'UTC'")
    identities = connection.execute(MAPPINGS_SQL + ' ORDER BY id').fetchall()
    counts = connection.execute('''SELECT count(*) FILTER(WHERE free_component_ref IS NOT NULL),
        count(*) FILTER(WHERE (free_course_ref IS NULL)<>(free_component_ref IS NULL)),
        count(*) FILTER(WHERE free_component_ref IS NOT NULL AND deleted_at IS NOT NULL)
        FROM "Learner".learner_progress_entries''').fetchone()
    assert counts[1] == 0, 'Partial Free Course identity'
    invalid = connection.execute('''SELECT count(*) FROM "Learner".learner_progress_entries p
        LEFT JOIN curriculum.free_programme_components c ON c.id=p.free_component_ref
        LEFT JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id
        LEFT JOIN curriculum.free_courses f ON f.id=p.free_course_ref
        WHERE p.free_component_ref IS NOT NULL
          AND (c.id IS NULL OR f.id IS NULL OR w.course_id IS DISTINCT FROM p.free_course_ref)''').fetchone()[0]
    assert invalid == 0, 'Invalid component/course relationship'
    owners = sorted({row[1] for row in identities})
    courses = sorted({row[2] for row in identities})
    bulk = HOURS_SQL.replace('m.learner_id=%s', 'm.learner_id=ANY(%s)')
    readers = connection.execute(bulk, [owners, courses]).fetchall()
    unenrolled = connection.execute('''SELECT count(*) FROM "Learner".learner_progress_entries p
        WHERE p.free_component_ref IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM "Learner".learner_free_courses e WHERE e.learner_id=p.learner_id
            AND e.free_course_ref=p.free_course_ref)''').fetchone()[0]
    constraints = connection.execute('''SELECT conname,convalidated,pg_get_constraintdef(oid)
        FROM pg_constraint WHERE conrelid='"Learner".learner_progress_entries'::regclass
        AND conname IN ('lpe_free_course_fk','lpe_free_component_fk','lpe_free_identity_both_or_neither')
        ORDER BY conname''').fetchall()
    assert len(constraints) == 3 and all(row[1] for row in constraints), 'Missing or unvalidated identity constraint'
    assert all('ON DELETE RESTRICT' in row[2] for row in constraints if row[0].endswith('_fk'))
    fingerprints = {}
    ids = [row[0] for row in identities]
    for table, where, values, expression in [
        ('learner_progress_entries', 'id=ANY(%s)', ids, "to_jsonb(t)-'free_course_ref'-'free_component_ref'"),
        ('learner_monthly_targets', 'learner_id=ANY(%s)', owners, 'to_jsonb(t)'),
        ('learners', 'id=ANY(%s)', owners, 'to_jsonb(t)'),
    ]:
        count, digest = connection.execute(f'''SELECT count(*),md5(string_agg(({expression})::text,'' ORDER BY id))
            FROM "Learner".{table} t WHERE {where}''', [values]).fetchone()
        fingerprints[f'"Learner".{table}'] = {'count': count, 'md5': digest}
    if manifest is not None:
        expected = sorted((m['old_progress_id'],m['learner_id'],m['free_course_id'],m['free_component_id']) for m in manifest)
        assert identities == expected, 'Canonical identities differ from verified manifest'
        historical = '''SELECT old_progress_id,learner_id,free_course_id,free_component_id
            FROM jsonb_to_recordset(%s::jsonb) AS m(old_progress_id bigint,learner_id bigint,
                free_course_id text,free_component_id text)'''
        original_readers = connection.execute(bulk.replace(MAPPINGS_SQL, historical),
                                             [Jsonb(manifest), owners, courses]).fetchall()
        assert readers == original_readers, 'Reader rows differ from recovered identity projection'
        assert (counts[0], counts[2], unenrolled, len(readers)) == (790,109,244,300), 'Recovery cohort drift'
    if baseline is not None:
        assert fingerprints == baseline['before'], 'Progress/cache/learner baseline changed'
    return dict(mappings=counts[0], partial_mappings=counts[1], invalid_membership=invalid,
                soft_deleted=counts[2], unenrolled=unenrolled, eligible_reader_rows=len(readers),
                exact_manifest_parity=manifest is not None, baseline_verified=baseline is not None,
                constraints=constraints, fingerprints=fingerprints)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--baseline', type=Path)
    args = parser.parse_args()
    with connect_development() as connection:
        print(json.dumps(verify(connection,
            json.loads(args.manifest.read_text()) if args.manifest else None,
            json.loads(args.baseline.read_text()) if args.baseline else None), indent=2))
