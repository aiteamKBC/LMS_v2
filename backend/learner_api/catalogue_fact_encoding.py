"""Positional JSON for internal catalogue reads; restore dictionaries before use.

No response or stored-data format changes. The explicit field order removes
repeated JSON object keys from large remote reads while retaining nulls/types.
"""
import json

PROGRESS_FIELDS = (
    'id', 'learner_id', 'kind', 'module_ref', 'module_title', 'component_ref',
    'component_title', 'component_type', 'quiz_ref', 'passed', 'reported_time',
    'submitted_at', 'declared_completed_at', 'started_at', 'time_tracking_source', 'claimed_seconds',
    'verified_seconds', 'expected_otjh', 'source_system', 'component_link_source',
    'actual_seconds', 'accepted', 'reporting_started_at', 'reporting_ended_at',
    'reporting_month', 'achieved_score', 'total_score', 'activity_status',
    'source_payload', 'feed_kind', 'actual_basis',
)

SOURCE_FIELDS = (
    ('source_id', 's.id'), ('source_system', 's.source_system'),
    ('source_activity_id', 's.source_activity_id'), ('completed', 's.completed'),
    ('source_course_ref', 'c.source_course_ref'), ('source_course_id', 'c.id'),
    ('course_title', 'c.source_course_title'), ('catalogue_id', 'a.id'),
    ('component_ref', "coalesce(nullif(s.curriculum_component_ref,''),a.curriculum_component_ref)"),
    ('module_ref', 'c.curriculum_module_ref'), ('group_ref', 'c.curriculum_group_ref'),
    ('activity_status', 's.activity_status'), ('source_activity_kind', 'a.source_activity_kind'),
)

JOURNAL_FIELDS = (
    ('group_id', 'j.group_id'), ('activity_id', 'j.activity_id'), ('source_ref', 'j.source_ref'),
    ('source_system', 's.source_system'), ('month', 'j.month'), ('activity_date', 'j.activity_date'),
)

HISTORICAL_FIELDS = (
    ('source_system', 'h.source_system'), ('source_course_ref', 'h.source_course_ref'),
    ('source_activity_id', 'h.source_activity_id'),
)

COURSE_FIELDS = (
    ('quiz_id', "a.source_payload->'quiz_id'"), ('activity_id', "a.source_payload->'activity_id'"),
    ('parent_activity_id', "a.source_payload->'parent_activity_id'"),
    ('section_title', "a.source_payload->'section_title'"),
    ('section_order', "coalesce(a.source_payload->'section_order',a.source_payload#>'{live_catalogue_recovery,section_order}')"),
    ('component_order', "coalesce(a.source_payload->'component_order',a.source_payload#>'{live_catalogue_recovery,component_order}')"),
    ('created_at', "a.source_payload->'created_at'"), ('created_at_utc', "a.source_payload->'created_at_utc'"),
)


def fact_sql(fields, *, compact):
    if compact:
        return 'jsonb_build_array(' + ','.join(expression for _, expression in fields) + ')'
    return 'jsonb_build_object(' + ','.join(f"'{name}',{expression}" for name, expression in fields) + ')'


def restore_fact(value, fields):
    # Raw SQL adapters may leave JSONB as text; ORM JSON fields may decode it.
    # Decode positional arrays in either representation. Leave other legacy
    # values to their existing decoder rather than changing their semantics.
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            decoded = None
        if isinstance(decoded, list):
            value = decoded
    # Dictionary inputs keep existing read doubles and legacy adapters usable.
    if not isinstance(value, list):
        return value
    if len(value) != len(fields):
        raise ValueError('Invalid internal catalogue fact length')
    return dict(zip(fields, value))
