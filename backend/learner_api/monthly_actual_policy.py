"""Eligibility shared by the canonical refresh worker and scoped remediation."""


def eligible(alias='t'):
    # Fixed application aliases only; no user input is interpolated.
    if alias not in ('t', 'chosen'):
        raise ValueError('Unknown target alias')
    return f'''{alias}.month_status='open'
        AND NOT EXISTS (SELECT 1 FROM "Learner".learner_monthly_signatures s
            WHERE s.learner_id={alias}.learner_id AND s.report_month={alias}.report_month
              AND s.review_confirmed IS TRUE AND s.source_system='lms'
              AND s.source_ref LIKE 'lms-monthly:%%')
        AND (SELECT e.event_type FROM "Learner".manual_month_finalization_events e
             WHERE e.learner_id={alias}.learner_id AND e.report_month={alias}.report_month
             ORDER BY e.id DESC LIMIT 1) IS DISTINCT FROM 'finalized' '''


MISSING = '(t.actual_seconds_total IS NULL OR t.actual_updated_at IS NULL OR t.actual_summary IS NULL)'
