"""SELECT-only Development verification; no learner identifiers in output."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from learner_api.lms_alias_reconciliation import inspect
from verify_inclusion_canonical_targets import connect_development


def main():
    conn = connect_development()  # Exact endpoint/branch allowlist; read-only transaction.
    try:
        with conn.cursor() as cursor:
            cursor.execute('''SELECT
                count(*) AS total_results,
                count(*) FILTER (WHERE r.membership_id IS NULL) AS missing_membership,
                count(*) FILTER (WHERE r.membership_id IS NOT NULL AND m.id IS NULL) AS orphan_membership,
                count(*) FILTER (WHERE m.id IS NOT NULL AND l.id IS NULL) AS missing_canonical_learner,
                count(*) FILTER (WHERE m.deleted_at IS NOT NULL) AS inactive_membership_results
                FROM "Learner".source_lms_activity_results r
                LEFT JOIN "Learner".learner_source_course_memberships m ON m.id=r.membership_id
                LEFT JOIN "Learner".learners l ON l.id=m.learner_id''')
            baseline = dict(zip((col.name for col in cursor.description), cursor.fetchone()))
            cursor.execute('''SELECT
                to_regclass('"Learner".source_lms_group_learners') IS NULL,
                EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid='"Learner".source_lms_activity_results'::regclass
                    AND conname='source_activity_membership_id_fk' AND convalidated
                    AND pg_get_constraintdef(oid) = 'FOREIGN KEY (membership_id) REFERENCES "Learner".learner_source_course_memberships(id) ON DELETE RESTRICT'),
                NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid='"Learner".source_lms_activity_results'::regclass
                    AND conname='source_activity_results_membership_fk')''')
            baseline.update(zip(('old_table_absent', 'membership_fk_validated', 'old_fk_absent'),
                                cursor.fetchone()))
            _, _, summary = inspect(cursor)
            print(json.dumps({'database': baseline, 'reconciliation_dry_run': summary}, indent=2))
            return int(bool(baseline['missing_membership'] or baseline['orphan_membership']
                            or baseline['missing_canonical_learner']
                            or not all(baseline[key] for key in
                                       ('old_table_absent', 'membership_fk_validated', 'old_fk_absent'))
                            or summary['unresolved_activity_ownership']))
    finally:
        conn.rollback()
        conn.close()


if __name__ == '__main__':
    raise SystemExit(main())
