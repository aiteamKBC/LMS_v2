"""Columns read by catalogue summaries and programme workspace projections."""

REFLECTION_QUESTION_COLUMN = 'Reflection_Question'

CATALOGUE_SUMMARY_COMPONENT_COLUMNS = (
    'id', 'week_id', 'module_catalogue_id', 'type', 'title', 'description',
    'expected_otjh', 'points', 'display_order',
    'reflection_required', REFLECTION_QUESTION_COLUMN,
    'workplace_evidence_required', 'tutor_validation_required',
    'coach_validation_required', 'status',
)

def workspace_component_text_columns():
    return ('title', 'description', REFLECTION_QUESTION_COLUMN)
