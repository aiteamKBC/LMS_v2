"""Read-only aggregate evidence for historical Free Course attempts; no PII export."""
import json
from pathlib import Path
from verify_inclusion_canonical_targets import connect_development

def audit():
    with connect_development() as c:
        report = {}
        report['attempt_columns'] = [r[0] for r in c.execute('''SELECT column_name FROM information_schema.columns
            WHERE table_schema='Learner' AND table_name='subject_activity_attempts' ORDER BY ordinal_position''')]
        report['counts'] = c.execute('''SELECT count(*),count(*) FILTER(WHERE free_component_ref IS NOT NULL),
            count(*) FILTER(WHERE definition->'historical_import'='true'::jsonb),
            count(*) FILTER(WHERE free_component_ref IS NOT NULL AND definition->'historical_import'='true'::jsonb),
            md5(string_agg(md5(to_jsonb(a)::text),'' ORDER BY id)) FROM "Learner".subject_activity_attempts a''').fetchone()
        report['historical_definition_keys'] = [r[0] for r in c.execute('''SELECT DISTINCT jsonb_object_keys(definition)
            FROM "Learner".subject_activity_attempts WHERE definition->'historical_import'='true'::jsonb ORDER BY 1''')]
        report['snapshot_keys'] = [r[0] for r in c.execute('''SELECT DISTINCT jsonb_object_keys(source_activity_snapshot)
            FROM "Learner".subject_activity_attempts WHERE free_component_ref IS NOT NULL ORDER BY 1''')]
        report['free_course_integrity'] = c.execute('''SELECT count(*),
            count(*) FILTER(WHERE f.id IS NULL OR w.id IS NULL OR l.id IS NULL),
            count(*) FILTER(WHERE a.completed IS TRUE),count(*) FILTER(WHERE a.passed IS TRUE),
            count(*) FILTER(WHERE a.submitted_at IS NULL),count(*) FILTER(WHERE a.score_percent IS NULL),
            count(*) FILTER(WHERE EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p
                WHERE p.learner_id=a.learner_id AND p.free_component_ref=a.free_component_ref)),
            count(*) FILTER(WHERE EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p
                WHERE p.learner_id=a.learner_id AND p.free_component_ref=a.free_component_ref AND p.accepted IS TRUE))
            FROM "Learner".subject_activity_attempts a
            LEFT JOIN curriculum.free_programme_components f ON f.id=a.free_component_ref
            LEFT JOIN curriculum.free_course_weeks w ON w.id=f.free_module_id
            LEFT JOIN "Learner".learners l ON l.id=a.learner_id WHERE a.free_component_ref IS NOT NULL''').fetchone()
        report['duplicate_historical_fingerprints'] = c.execute('''SELECT count(*) FROM (
            SELECT learner_id,free_component_ref,definition,answers,score_percent,submitted_at,count(*)
            FROM "Learner".subject_activity_attempts WHERE definition->'historical_import'='true'::jsonb
            GROUP BY 1,2,3,4,5,6 HAVING count(*)>1) duplicates''').fetchone()[0]
        report['historical_snapshot_checks'] = c.execute('''SELECT
            count(*) FILTER(WHERE source_activity_snapshot->'original_attempt_time_known'='false'::jsonb AND submitted_at IS NULL),
            count(*) FILTER(WHERE source_activity_snapshot->'original_attempt_time_known'='true'::jsonb AND submitted_at IS NULL),
            count(*) FILTER(WHERE definition->'original_definition' IS DISTINCT FROM source_activity_snapshot->'original_definition'),
            count(*) FILTER(WHERE source_activity_snapshot->>'original_attempt_number' IS NULL),
            count(*) FILTER(WHERE source_activity_snapshot->>'original_score' IS NULL),
            count(*) FILTER(WHERE source_activity_snapshot->>'original_maximum_score' IS NULL)
            FROM "Learner".subject_activity_attempts WHERE definition->'historical_import'='true'::jsonb''').fetchone()
        report['historical_mapping_links'] = c.execute('''SELECT
            count(*) FILTER(WHERE EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p WHERE
                p.learner_id=a.learner_id AND p.free_component_ref=a.free_component_ref)),
            count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p WHERE
                p.learner_id=a.learner_id AND p.free_component_ref=a.free_component_ref)),
            count(*) FILTER(WHERE a.completed IS TRUE),count(*) FILTER(WHERE a.passed IS TRUE)
            FROM "Learner".subject_activity_attempts a WHERE definition->'historical_import'='true'::jsonb''').fetchone()
        report['historical_current_quiz_links'] = c.execute('''SELECT count(*),
            count(*) FILTER(WHERE coalesce(f.type,'') NOT ILIKE '%%quiz%%'),
            count(*) FILTER(WHERE q.id IS NULL),count(*) FILTER(WHERE f.deleted_at IS NOT NULL)
            FROM "Learner".subject_activity_attempts a
            LEFT JOIN curriculum.free_programme_components f ON f.id=a.free_component_ref
            LEFT JOIN curriculum.quizzes q ON q.id=CASE WHEN f.settings_json->>'linkedQuizId' ~ '^[0-9]+$'
                THEN (f.settings_json->>'linkedQuizId')::bigint END
            WHERE a.definition->'historical_import'='true'::jsonb''').fetchone()
        from decimal import Decimal, InvalidOperation
        score_checks = {'ratio_matches': 0, 'ratio_differs': 0, 'uncheckable': 0}
        for score, snapshot in c.execute('''SELECT score_percent,source_activity_snapshot FROM "Learner".subject_activity_attempts
            WHERE definition->'historical_import'='true'::jsonb'''):
            try:
                numerator, denominator = Decimal(str(snapshot['original_score'])), Decimal(str(snapshot['original_maximum_score']))
                if not denominator or score is None:
                    raise ValueError()
                matches = abs(Decimal(str(score)) - numerator * 100 / denominator) <= Decimal('0.005')
                score_checks['ratio_matches' if matches else 'ratio_differs'] += 1
            except (KeyError, TypeError, ValueError, InvalidOperation):
                score_checks['uncheckable'] += 1
        report['scores_against_retained_original_ratio'] = score_checks
        report['limitations'] = ['Counts alone do not establish completeness of the 134 historical attempts.',
            'Source attempt manifest and original per-attempt scores/timestamps are required for exact parity; no rows were manufactured or changed.']
        return report


if __name__ == '__main__':
    result = audit()
    path = Path(__file__).resolve().parents[2] / 'specs/lms-master-completion/historical-attempts.json'
    path.write_text(json.dumps(result, indent=2, default=str), encoding='utf-8')
    print(json.dumps(result, indent=2, default=str))
