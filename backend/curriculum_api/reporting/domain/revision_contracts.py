"""Shared revision/snapshot contracts; legacy registrations retain object identity."""
import re

REVISIONS_TABLE = 'record_revisions'

VERSIONS_TABLE = 'record_versions'

VERSIONED_TABLES = {
    'programmes': {'entity_type': 'programme', 'key': 'programme_id', 'title': 'name'},
    'cohorts': {'entity_type': 'cohort', 'key': 'cohort_id', 'title': 'cohort_name'},
    'groups': {'entity_type': 'group', 'key': 'group_id', 'title': 'group_name'},
    'modules': {'entity_type': 'module', 'key': 'module_catalogue_id', 'title': 'title'},
    'module_details': {'entity_type': 'module_details', 'key': 'module_catalogue_id', 'title': ''},
    'module_completion_criteria': {'entity_type': 'module_completion', 'key': 'module_catalogue_id', 'title': ''},
    'weeks': {'entity_type': 'week', 'key': 'id', 'title': 'title'},
    'components': {'entity_type': 'component', 'key': 'id', 'title': 'title'},
    'ksb_mappings': {'entity_type': 'ksb_mapping', 'key': 'id', 'title': 'ksb_code'},
    'live_sessions': {'entity_type': 'live_session', 'key': 'id', 'title': 'module_title'},
    'holidays': {'entity_type': 'holiday', 'key': 'id', 'title': 'label'},
    'week_templates': {'entity_type': 'week_template', 'key': 'id', 'title': 'title'},
    'week_template_components': {'entity_type': 'week_template_component', 'key': 'id', 'title': 'title'},
}

ENTITY_TYPES = {config['entity_type'] for config in VERSIONED_TABLES.values()}

SNAPSHOT_COLUMNS = {
    'programme': (
        'programme_id', 'name', 'standard', 'level', 'owner', 'color', 'description',
        'structure_type', 'ksb_profile_source_id', 'required_otjh', 'status', 'is_active',
        'is_archived', 'deleted_at', 'deleted_by',
    ),
    'cohort': (
        'cohort_id', 'cohort_name', 'programme_id', 'programme_name', 'start_date', 'end_date',
        'duration_months', 'epa_months', 'apprenticeship_end_date', 'apprenticeship_end_override',
        'color', 'status', 'group_ids', 'module_names', 'holiday_ids', 'excluded_holiday_ids',
        'notes', 'deleted_at', 'deleted_by',
    ),
    'group': (
        'group_id', 'group_name', 'cohort_id', 'cohort_name', 'programme_id', 'programme_name',
        'module_ids', 'module_names', 'coach_name', 'color', 'session_week_day',
        'session_start_time', 'session_end_time', 'notes', 'status', 'deleted_at', 'deleted_by',
    ),
    # Carries the delivery schedule and the tutor, not only the title: "who
    # changed this module's tutor" and "who moved this module's start date" are
    # among the questions most often asked of the trail, and neither could be
    # answered while the snapshot stopped at the description.
    'module': (
        'module_catalogue_id', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
        'group_id', 'group_name', 'title', 'description', 'quality_score',
        'status', 'tutor_name', 'tutor_email', 'coach_name', 'sessions_number',
        'start_date', 'end_date', 'session_week_day', 'session_start_time', 'session_end_time',
        'weekly_schedule', 'session_holidays', 'session_overrides', 'ksb_profile_source_id',
        'color', 'cover_image_url', 'deleted_at', 'deleted_by',
    ),
    'week': (
        'id', 'module_catalogue_id', 'week_number', 'title', 'summary', 'learning_outcomes',
        'display_order', 'status', 'deleted_at', 'deleted_by',
    ),
    'component': (
        'id', 'module_catalogue_id', 'week_id', 'type', 'title', 'description',
        'expected_otjh', 'points', 'ksb_mappings', 'reflection_required',
        'Reflection_Question', 'workplace_evidence_required', 'tutor_validation_required',
        'coach_validation_required', 'display_order', 'settings_json', 'live_sessions_link',
        'status', 'deleted_at', 'deleted_by',
    ),
    'module_details': (
        'module_catalogue_id', 'background', 'epa_requirements',
        'professional_qualification_outcomes', 'intent', 'learner_benefit', 'employer_benefit',
        'sequence_purpose', 'deleted_at', 'deleted_by',
    ),
    'module_completion': (
        'module_catalogue_id', 'quizzes_completed_required', 'checkpoints_completed_required',
        'average_score_required_enabled', 'average_score_required',
        'total_score_required_enabled', 'total_score_required', 'additional_notes',
        'deleted_at', 'deleted_by',
    ),
    'ksb_mapping': (
        'id', 'module_catalogue_id', 'week_id', 'component_id', 'ksb_id', 'ksb_code',
        'ksb_description', 'classification', 'weight', 'weight_class', 'source_type', 'source_id',
        'standard_ksb_id', 'status', 'deleted_at', 'deleted_by',
    ),
    # No join_url / web_link / meeting_options_url: see the note above.
    'live_session': (
        'id', 'module_catalogue_id', 'module_title', 'provider', 'graph_event_id',
        'online_meeting_id', 'organizer_email', 'attendees', 'presenters', 'co_organizers',
        'start_datetime', 'timezone', 'duration_minutes', 'repeat_pattern', 'repeat_occurrences',
        'lobby_bypass', 'recording', 'spoken_language', 'meeting_type', 'request_responses',
        'allow_time_proposals', 'hide_attendees', 'status',
    ),
    'holiday': (
        'id', 'label', 'start_date', 'end_date', 'type', 'color', 'notes', 'is_archived',
    ),
    'week_template': (
        'id', 'title', 'summary', 'learning_outcomes', 'course_type', 'programme_id',
        'programme_name', 'module_catalogue_id', 'group_id', 'group_name', 'status',
        'ksb_mappings', 'total_otjh', 'points', 'component_count', 'author',
        'deleted_at', 'deleted_by',
    ),
    'week_template_component': (
        'id', 'week_template_id', 'type', 'title', 'description', 'expected_otjh', 'points',
        'reflection_required', 'workplace_evidence_required', 'tutor_validation_required',
        'coach_validation_required', 'ksb_mappings', 'settings_json', 'display_order',
    ),
}

ORDER_COLUMNS = {'display_order', 'week_number'}

PARENT_COLUMNS = {
    'component': ('week_id', 'module_catalogue_id'),
    'week': ('module_catalogue_id',),
    'module': ('group_id', 'cohort_id', 'programme_id'),
    'group': ('cohort_id', 'programme_id'),
    'cohort': ('programme_id',),
    'ksb_mapping': ('component_id', 'week_id', 'module_catalogue_id'),
    'week_template_component': ('week_template_id',),
    'live_session': ('module_catalogue_id',),
}

JSON_SNAPSHOT_COLUMNS = {
    'settings_json', 'ksb_mappings', 'learning_outcomes',
    'weekly_schedule', 'session_holidays', 'session_overrides',
    'attendees', 'presenters', 'co_organizers',
    'group_ids', 'module_ids', 'module_names', 'holiday_ids', 'excluded_holiday_ids',
}

IGNORED_SETTING_KEYS = {'updatedAt', 'lastEdited'}

DIFF_VALUE_LIMIT = 200

TEAMS_SYSTEM_SETTING_KEYS = frozenset({
    'teamsEventId', 'teamsOnlineMeetingId', 'teamsLiveSessionId', 'teamsOccurrenceId',
    'teamsMeetingUrl', 'teamsMeetingOptionsUrl', 'teamsWebLink', 'teamsProvider',
    'teamsForBusiness', 'teamsCalendarSeries', 'teamsCalendarsToUpdate',
    'liveSessionId', 'liveSessionIds', 'liveSessionUrl',
})

TEAMS_LINK_KEYS = ('teamsEventId', 'teamsLiveSessionId', 'liveSessionId', 'teamsOnlineMeetingId')

TEAMS_LINK_MARKER = 'teamsMeeting'

TEAMS_LINKED = 'Linked'

SYSTEM_COLUMNS = {'live_session': frozenset({'graph_event_id', 'online_meeting_id'})}

PEOPLE_LIST_FIELDS = frozenset({'settings.teamsAttendees', 'attendees'})

TEXT_COLUMNS = frozenset({
    'description', 'summary', 'notes', 'Reflection_Question', 'background',
    'epa_requirements', 'professional_qualification_outcomes', 'intent',
    'learner_benefit', 'employer_benefit', 'sequence_purpose', 'additional_notes',
})

TEXT_SETTING_PATTERN = re.compile(r'(html|content|text|instructions?|description|body|prompt|summary|notes?|question)$', re.I)

TEXT_CHANGED = 'Text changed'

METADATA_KEYS = {
    'import_type', 'import_batch_id', 'filename', 'row_count', 'reason_code',
    'file_name', 'file_type', 'file_size', 'previous_file_name',
    'recalculated_from', 'command', 'job', 'occurrences', 'note',
    'page_path', 'page_label', 'page_workspace', 'page_source',
    'request_path', 'request_method',
    'merged_saves', 'last_saved_at',
    # The parent an archive went with (curriculum_api.archive_state): the
    # normalised schema keeps no deleted_via_parent, so restore reads it here.
    'archived_via',
}

METADATA_VALUE_LIMIT = 200

METADATA_JSON_LIMIT = 2000

REDACTED_COLUMNS = {}

REDACTED_PREFIX = 'redacted:'

ENTITY_FACT_FIELDS = {
    'programme': {'title': 'name', 'parent': '', 'status': 'status'},
    'cohort': {'title': 'cohort_name', 'parent': 'programme_id', 'status': 'status'},
    'group': {'title': 'group_name', 'parent': 'cohort_id', 'status': ''},
    'module': {'title': 'title', 'parent': 'programme_id', 'status': 'status'},
    'module_details': {'title': '', 'parent': 'module_catalogue_id', 'status': ''},
    'module_completion': {'title': '', 'parent': 'module_catalogue_id', 'status': ''},
    'week': {'title': 'title', 'parent': 'module_catalogue_id', 'status': ''},
    'component': {'title': 'title', 'parent': 'week_id', 'status': ''},
    'ksb_mapping': {'title': 'ksb_code', 'parent': 'component_id', 'status': 'classification'},
    'live_session': {'title': 'module_title', 'parent': 'module_catalogue_id', 'status': 'status'},
    'holiday': {'title': 'label', 'parent': '', 'status': ''},
    'week_template': {'title': 'title', 'parent': 'programme_id', 'status': 'status'},
    'week_template_component': {'title': 'title', 'parent': 'week_template_id', 'status': ''},
}

CONTEXT_KEY = '_context'

ENTITY_CONTEXT_FIELDS = {}

ACTIONS = (
    'created', 'updated', 'archived', 'restored', 'deleted', 'moved', 'reordered', 'recorded',
    'file_uploaded', 'file_replaced', 'file_removed', 'recalculated', 'imported',
)

DECLARABLE_ACTIONS = {'file_uploaded', 'file_replaced', 'file_removed', 'recalculated', 'imported'}

UPLOAD_NAME_FIELD = 'settings.uploadedFileName'

UPLOAD_NAME_KEY = 'uploadedFileName'

UPLOAD_TYPE_KEY = 'uploadedFileContentType'

UPLOAD_SIZE_KEY = 'uploadedFileSize'

STATUS_LIFECYCLE_TYPES = frozenset({'programme', 'cohort', 'group', 'module', 'week', 'component', 'ksb_mapping'})

REVISION_COLUMNS = (
    'entity_type', 'entity_id', 'revision_no', 'action', 'module_catalogue_id', 'parent_id',
    'title', 'version_label', 'content_status', 'snapshot', 'changed_fields',
    'actor_email', 'actor_name', 'reason',
)

METADATA_COLUMNS = ('actor_type', 'triggered_by_email', 'triggered_by_name', 'source', 'metadata')

JSON_REVISION_COLUMNS = {'snapshot', 'changed_fields', 'metadata'}

