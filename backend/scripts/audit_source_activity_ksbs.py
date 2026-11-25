"""SELECT-only closure checks against the allowlisted Development branch.

Run from the repository root with backend/.venv/Scripts/python.exe.
No Django startup, migrations, DML, learner records, or credentials in output.
Exit 1 means at least one closure assertion failed.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from curriculum_api.source_activity_ksbs import relation
from learner_api import journal_sources

from verify_inclusion_canonical_targets import connect_development


CHECKS = {
    'preserved_elements': (57485, '''SELECT sum(jsonb_array_length(ksbs))
        FROM curriculum.source_activity_ksbs'''),
    'normalized_relationships': (39903, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized'''),
    'normalized_original_elements': (29593, '''SELECT count(DISTINCT
        (legacy_activity_id,legacy_ksb_code)) FROM curriculum.source_activity_ksbs_normalized'''),
    'unresolved_elements_preserved': (27892, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs l CROSS JOIN LATERAL jsonb_array_elements(l.ksbs) e
        WHERE NOT EXISTS (SELECT 1 FROM curriculum.source_activity_ksbs_normalized n
            WHERE n.legacy_activity_id=l.activity_id AND n.legacy_ksb_code=e->>'code')'''),
    'orphan_relationships': (0, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        LEFT JOIN curriculum.source_activities a ON a.id=n.source_activity_id
        LEFT JOIN curriculum.standard_ksbs s ON s.id=n.standard_ksb_id
        LEFT JOIN curriculum.source_activity_ksbs l ON l.activity_id=n.legacy_activity_id
        WHERE a.id IS NULL OR s.id IS NULL OR l.activity_id IS NULL'''),
    'metadata_mismatches': (0, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        JOIN curriculum.source_activity_ksbs l ON l.activity_id=n.legacy_activity_id
        WHERE (n.version,n.created_by,n.updated_by,n.created_at,n.updated_at)
          IS DISTINCT FROM (l.version,l.created_by,l.updated_by,l.created_at,l.updated_at)'''),
    'missing_original_codes': (0, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        JOIN curriculum.source_activity_ksbs l ON l.activity_id=n.legacy_activity_id
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l.ksbs) e
            WHERE e->>'code'=n.legacy_ksb_code)'''),
    'duplicate_original_codes': (0, '''SELECT count(*) FROM (
        SELECT l.activity_id,e->>'code' FROM curriculum.source_activity_ksbs l
        CROSS JOIN LATERAL jsonb_array_elements(l.ksbs) e
        GROUP BY 1,2 HAVING count(*)>1) d'''),
    'source_identity_mismatches': (0, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        JOIN curriculum.source_activities a ON a.id=n.source_activity_id
        WHERE a.source_material_id IS DISTINCT FROM n.legacy_activity_id
           OR a.source_payload->>'activity_id' IS DISTINCT FROM n.legacy_activity_id::text'''),
    'programme_standard_version_mismatches': (0, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        JOIN curriculum.standard_ksbs s ON s.id=n.standard_ksb_id
        JOIN curriculum.source_activities a ON a.id=n.source_activity_id
        LEFT JOIN curriculum.source_courses c ON c.id=a.source_course_id
        LEFT JOIN curriculum.programmes p ON p.programme_id=c.curriculum_programme_ref
        WHERE lower(p.ksb_profile_source_id) IS DISTINCT FROM
            'standard:'||lower(s.standard_ref)||'-v'||replace(s.standard_version,'.','-')'''),
    'unresolvable_applied_standards': (0, '''SELECT count(*) FROM curriculum.programmes p
        WHERE p.ksb_profile_source_id LIKE 'standard:%' AND NOT EXISTS (
            SELECT 1 FROM curriculum.standard_ksbs s WHERE lower(p.ksb_profile_source_id)=
            'standard:'||lower(s.standard_ref)||'-v'||replace(s.standard_version,'.','-'))'''),
    'approved_b7_b8_relationships': (25, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        JOIN curriculum.standard_ksbs s ON s.id=n.standard_ksb_id
        WHERE n.legacy_ksb_code='B7' AND s.ksb_code='B8'
            AND s.standard_ref='ST0612' AND s.standard_version='1.0' '''),
    'other_code_changes': (0, '''SELECT count(*)
        FROM curriculum.source_activity_ksbs_normalized n
        JOIN curriculum.standard_ksbs s ON s.id=n.standard_ksb_id
        WHERE n.legacy_ksb_code<>s.ksb_code AND NOT
            (n.legacy_ksb_code='B7' AND s.ksb_code='B8'
             AND s.standard_ref='ST0612' AND s.standard_version='1.0')'''),
    'canonical_activity_coverage_gaps': (0, f'''SELECT count(*)
        FROM curriculum.source_activity_ksbs l
        LEFT JOIN {relation()} canonical USING(activity_id)
        WHERE canonical.activity_id IS NULL'''),
    'canonical_unresolved_elements_retained': (27892, f'''SELECT count(*)
        FROM {relation()} canonical CROSS JOIN LATERAL jsonb_array_elements(ksbs) e
        WHERE e->>'resolutionStatus'='unresolved' '''),
    'canonical_verified_elements': (29593, f'''SELECT count(*)
        FROM {relation()} canonical CROSS JOIN LATERAL jsonb_array_elements(ksbs) e
        WHERE e->>'resolutionStatus'='verified' '''),
    'canonical_duplicate_activity_codes': (0, f'''SELECT count(*) FROM (
        SELECT activity_id,e->>'code' FROM {relation()} canonical
        CROSS JOIN LATERAL jsonb_array_elements(ksbs) e GROUP BY 1,2 HAVING count(*)>1) d'''),
}


def main():
    results = {}
    coach = journal_sources.table('activity_ksbs')
    with journal_sources.learner_journal_reads():
        assert coach == journal_sources.table('activity_ksbs'), 'Roles must share the canonical activity source.'
    with connect_development() as connection:
        identity = connection.execute("SELECT current_database(),"
            "current_setting('neon.branch_id'),current_setting('transaction_read_only')").fetchone()
        for name, (expected, sql) in CHECKS.items():
            actual = connection.execute(sql).fetchone()[0]
            results[name] = dict(expected=expected, actual=actual,
                                 status='PASS' if actual == expected else 'FAIL')
        # Historical descriptions are evidence, not definitions to rewrite.
        snapshots = connection.execute('''SELECT count(*)
            FROM curriculum.source_activity_ksbs_normalized n
            JOIN curriculum.standard_ksbs s ON s.id=n.standard_ksb_id
            JOIN curriculum.source_activity_ksbs l ON l.activity_id=n.legacy_activity_id
            CROSS JOIN LATERAL jsonb_array_elements(l.ksbs) e
            WHERE e->>'code'=n.legacy_ksb_code
                AND e->>'description' IS DISTINCT FROM s.ksb_description''').fetchone()[0]
        # Retained physical history is deliberately not backfilled. Application
        # parity now depends on shared routing, not equality of archived copies.
        retained_gap = connection.execute('''SELECT count(*) FROM curriculum.source_activity_ksbs l
            LEFT JOIN structured_manual_activities.activity_ksbs o USING(activity_id)
            WHERE o.activity_id IS NULL''').fetchone()[0]
        connection.rollback()
    print(json.dumps(dict(identity=identity, checks=results,
        historical_description_differences=snapshots, retained_coach_copy_missing_rows=retained_gap), indent=2))
    return int(any(row['status'] == 'FAIL' for row in results.values()))


if __name__ == '__main__':
    raise SystemExit(main())
