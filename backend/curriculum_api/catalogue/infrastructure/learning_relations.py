"""Existing physical/read relation names shared by storage readers and migrations."""

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
