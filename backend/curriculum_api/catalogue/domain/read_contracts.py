"""Shared catalogue read markers and value contracts; existing values unchanged."""

AUTHORED_HOLIDAY_COLOR = '#dc2626'
AUTHORING_COMPARE_IGNORED_COLUMNS = {'created_at', 'updated_at'}
AUTHORING_JSON_COMPARE_COLUMNS = {
    'settings_json', 'ksb_mappings', 'learning_outcomes',
    'epa_requirements', 'professional_qualification_outcomes',
}
BANK_HOLIDAY_COLOR = '#91d64c'
BANK_HOLIDAY_TYPE = 'Bank holiday'
COMPONENT_CONTENT_SETTING_KEYS = (
    'readingContent', 'transcript', 'lessonContent', 'speakerNotes',
    'assignmentBrief', 'legacySettings',
)
COMPONENT_SETTINGS_OMITTED_FLAG = 'settingsOmitted'
DEFAULT_SESSION_START_TIME = '09:00'
HOLIDAY_SOURCE_AUTHORED = 'authored'
HOLIDAY_SOURCE_GOVUK = 'gov.uk'
LEGACY_REFLECTION_QUESTION_SETTING = 'reflectionPrompt'
PROGRAMME_PAGE_DROPPED_FIELDS = (
    'reflectionQuestion', 'lastEdited', 'isDeleted', 'deletedAt', 'deletedViaParent',
    'coachValidationRequired',
)
PROGRAMME_PAGE_SETTING_KEYS = (
    'attendanceRequired', 'durationMinutes', 'embedCode', 'liveSessionUrl', 'provider',
    'recordingExpected', 'selectedGroupNames', 'sessionDate', 'sessionDateTimeUtc', 'sessionTime',
    'sourceType', 'teamsLiveSessionId', 'teamsOccurrenceId', 'teamsSessionNumber', 'videoUrl',
)
PROGRAMME_VIEW_OMITTED_MARKER = '*'
RETIRED_COMPONENT_TYPES = {'workplace_evidence'}
SUPPORTED_KSB_WEIGHT_CLASSES = {'hard', 'soft', 'possible'}
WEEKDAY_INDEX = {
    'monday': 0,
    'mon': 0,
    'tuesday': 1,
    'tue': 1,
    'wednesday': 2,
    'wed': 2,
    'thursday': 3,
    'thu': 3,
    'friday': 4,
    'fri': 4,
    'saturday': 5,
    'sat': 5,
    'sunday': 6,
    'sun': 6,
}
WEEK_OUTLINE_MODULE_FLAG = 'weekStructureOutline'
WEEK_OUTLINE_WEEK_FLAG = 'componentsOmitted'
WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN = 'reflection_question'

from datetime import timedelta
import re

TRAINING_MODULE_CATALOGUE_COLUMN = 'module_catalogue_id'


CANONICAL_MODULE_ID_PATTERN = re.compile(r'^MOD-[A-Z0-9][A-Z0-9_-]*$', re.I)


CURRICULUM_CHANGE_LOG_KEY = 'curriculum:changes'


CURRICULUM_CHANGE_LOG_SIZE = 50


COMPONENT_UPLOAD_MAX_BYTES = 300 * 1024 * 1024


COMPONENT_UPLOAD_EXTENSIONS = {
    'podcast': {'.mp3', '.m4a', '.mp4', '.wav', '.aac', '.ogg', '.oga', '.webm'},
    'powerpoint': {'.ppt', '.pptx', '.pps', '.ppsx', '.pdf'},
    'reading': {'.txt', '.doc', '.docx', '.pdf', '.rtf', '.odt'},
    # Topic instructions can contain written briefs, documents and videos.
    'assignment': {'.txt', '.doc', '.docx', '.pdf', '.rtf', '.odt', '.ppt', '.pptx', '.mp4', '.webm', '.mov', '.m4v'},
}


MODULE_COVER_UPLOAD_SLOT = 'cover'


LIFECYCLE_KEY_COLUMNS = {
    'programmes': 'programme_id', 'cohorts': 'cohort_id', 'groups': 'group_id', 'modules': 'module_catalogue_id',
    'weeks': 'id', 'components': 'id', 'ksb_mappings': 'id', 'coaches': 'id', 'tutors': 'id',
}


PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS = (
    ('learner_training_plan_modules', 'curriculum_module_id', 'moduleIds'),
    ('learner_training_plan_weeks', 'curriculum_week_id', 'weekIds'),
    ('learner_training_plan_components', 'curriculum_component_id', 'componentIds'),
)


MODULE_INDEX_EXCLUDED_COLUMNS = ('ksb_remap_report',)


MODULE_INDEX_ORDER = 'programme_id, title'


WEEK_INDEX_COLUMNS = [
    'id', 'module_catalogue_id', 'display_order', 'week_number', 'title', 'status',
]


PLACEHOLDER_PROGRAMME_IDS = frozenset({
    'programme-local',
    'program-local',
    'local',
    'undefined',
    'null',
    'none',
    'unassigned',
    'unassigned-programme',
    'unassignedprogramme',
})


AUTHORED_HOLIDAYS_TABLE = 'holidays'


STAFF_ACCESS_ROLES = ('coach', 'tutor')


STAFF_USER_ACCESS_COLUMNS = (
    'id',
    'uuid',
    'Username',
    'Email',
    'Phone_number',
    'Position',
    ' Status',
    'Access',
    'Created_at',
    'Updated_at',
)


DEFAULT_SESSION_END_TIME = '10:00'


ENGLAND_HOLIDAYS_TABLE = 'england_holidays'


COMPACT_MODULE_OMITTED_KEYS = frozenset({'weekStructure', 'sessionNames'})


COMPACT_MODULE_LIST_FIELDS = frozenset({
    # Identity and deep links. `moduleDeepLinkIdentifiers()` and
    # `moduleKsbCascadeId()` between them read every one of these.
    'id', 'moduleId', 'moduleCatalogueId', 'deliveryModuleId', 'structureId',
    'sourceId', 'catalogueId', 'relatedCatalogueIds', 'name',
    # Scope. Filters, the programme/cohort/group chain on the card, and the
    # `moduleBelongsToVisibleProgramme()` gate.
    'programmeId', 'programme', 'cohortId', 'cohort', 'groupId', 'group',
    'learnerRosterMode', 'teamsSharedSourceModuleId', 'ksbRemapReport', 'isProgrammeDeleted', 'isFreeCourse',
    'isForSale', 'price', 'currency',
    # Counts the catalogue card and the OTJH input render.
    'weeks', 'sessionsNumber', 'ksbCount', 'lessons', 'quizzes',
    'totalOtjh', 'declaredTotalOtjh', 'assignments',
    # Status badges and the delivery label.
    'status', 'authoringStatus', 'deliveryStatus',
    # Read into the module edit form and saved back out of it. Not display-only.
    'startDate', 'endDate', 'weeklySchedule', 'scheduleMode', 'sessionHolidays', 'deliveryWeeks', 'weekStartsOn', 'weekBoundaryMode', 'calendarPolicy',
    'weekDays', 'startTime', 'endTime', 'notes', 'color', 'coverImage',
    # Staffing shown on the row.
    'tutor', 'coach',
    # KSB mapping and the programme KSB map modal.
    'ksbCodes', 'ksbProfileSourceId',
    # No reader on this endpoint's own callers, but the entity pages sort by
    # `lastUpdated` off the *other* compact list and these are ~25 bytes each.
    # Kept rather than argued about.
    'lastUpdated', 'createdAt',
})


FREE_PROGRAMME_COMPONENTS_TABLE = 'free_programme_components'


SHARED_TEAMS_DELIVERY_SETTING_KEYS = {
    'teamsLiveSessionId', 'teamsSessionNumber', 'teamsEventId',
    'teamsOnlineMeetingId', 'teamsCalendarSeries', 'teamsMeetingUrl',
    'liveSessionUrl', 'teamsMeetingOptionsUrl', 'teamsProvider',
    'teamsOccurrenceId', 'teamsWebLink', 'teamsStartDateTimeUtc',
    'teamsDurationMinutes', 'sessionDateTimeUtc', 'sessionRescheduled', 'teamsCalendarBinding',
}


COMPONENT_SUMMARY_COLUMNS = (
    'id', 'module_catalogue_id', 'week_id', 'type', 'title', 'display_order',
    'expected_otjh', 'status',
)


COMPONENT_SUMMARY_WEEK_COLUMNS = (
    'id', 'module_catalogue_id', 'week_number', 'title', 'status',
)


COMPONENT_SUMMARY_MODULE_COLUMNS = ('module_catalogue_id', 'title', 'programme_name')


LIBRARY_ORIGIN_ACTIVE = 'active'


LIBRARY_ORIGIN_ARCHIVED = 'archived'


LIBRARY_ORIGIN_LIBRARY = 'library'


LIBRARY_ORIGINS = (LIBRARY_ORIGIN_ACTIVE, LIBRARY_ORIGIN_ARCHIVED, LIBRARY_ORIGIN_LIBRARY)


ADDITIONAL_MEETING_SETTING_KEYS = (
    'extraTeamsMeetingUrl', 'extraTeamsLiveSessionId', 'extraTeamsEventId',
    'extraTeamsOnlineMeetingId', 'extraTeamsWebLink', 'extraTeamsMeetingOptionsUrl',
    'extraTeamsOrganizerEmail', 'extraTeamsAttendees', 'extraTeamsPresenters',
    'extraTeamsCoOrganizers', 'extraTeamsStartDateTimeUtc', 'extraTeamsDurationMinutes',
    'extraTeamsSubject',
)


STRUCTURE_REVISION_VOLATILE_COLUMNS = ('created_at', 'updated_at')


MODULE_ARCHIVE_EVENT_WINDOW = timedelta(minutes=5)


COMPONENT_FULL_READ_PAGE_ROWS = 2000


COMPONENT_DB_OMITTED_KEYS_COLUMN = 'settings_content_omitted__'


PROGRAMME_SECTION_WARM_LIMIT = 3


PROGRAMME_WORKSPACE_MODULE_FIELDS = frozenset({
    'id', 'moduleId', 'moduleCatalogueId', 'deliveryModuleId', 'structureId',
    'sourceId', 'sourceType', 'catalogueId', 'relatedCatalogueIds', 'name',
    'programmeId', 'programme', 'cohortId', 'cohort', 'groupId', 'group',
    'weeks', 'sessionsNumber', 'ksbCount', 'lessons', 'quizzes', 'assignments',
    'status', 'authoringStatus', 'deliveryStatus', 'isProgrammeDeleted',
    'startDate', 'endDate', 'weeklySchedule', 'scheduleMode', 'sessionHolidays', 'deliveryWeeks', 'weekStartsOn', 'weekBoundaryMode', 'calendarPolicy',
    'weekDays', 'startTime', 'endTime', 'notes', 'color', 'coverImage',
    'tutor', 'coach', 'ksbCodes', 'lastUpdated', 'weekStructureOutline',
})


PROGRAMME_WORKSPACE_WEEK_FIELDS = frozenset({
    'id', 'weekNumber', 'number', 'title', 'displayOrder', 'componentsOmitted',
})


OFFICE_PREVIEW_EXTENSIONS = frozenset({
    '.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt',
    '.xls', '.xlsx', '.xlsm', '.ods',
    '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp',
})


OFFICE_PREVIEW_SALT = 'curriculum.office-preview'


OFFICE_PREVIEW_MAX_AGE_SECONDS = 15 * 60


MODULE_COVER_FILE_PATH = re.compile(
    rf'(?:^|/)(?:{MODULE_COVER_UPLOAD_SLOT}/cover-\d{{20}}|(?:free_course_covers|quiz_images)/[0-9a-f]{{32}})\.[a-z]+$'
)


COVERAGE_PART_MAPPING_FIELDS = (
    'mapping_id', 'module_name', 'week_name', 'component_name', 'component_type', 'component_otjh',
    'mapping_level', 'classification', 'group_name', 'groups', 'weight',
)


PROGRESS_LINEAGE_COLUMN_BY_SCOPE = {
    'programme': 'programme_ref',
    'cohort': 'cohort_ref',
    'group': 'group_ref',
    'module': 'module_ref',
    'week': 'week_ref',
    'component': 'component_ref',
}


ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS = 900


_ACHIEVEMENT_LEARNER_IDS = {}


_MODULE_WEEK_IDS = 'select id from "curriculum"."weeks" where module_catalogue_id = %s'


_MODULE_COMPONENT_IDS = 'select id from "curriculum"."components" where module_catalogue_id = %s'


PERMANENT_DELETE_REFERENCES = {
    'programme': (
        ('Learner', 'learners', 'programme_id', 'learners', None),
        ('enrolment', 'Created_users', 'programme_id', 'enrolmentAccounts', None),
        ('Learner', 'learner_progress_entries', 'programme_id', 'progressEntries', None),
    ),
    'cohort': (
        ('Learner', 'learners', 'cohort_id', 'learners', None),
        ('enrolment', 'Created_users', 'cohort_id', 'enrolmentAccounts', None),
        ('Learner', 'learner_progress_entries', 'cohort_id', 'progressEntries', None),
    ),
    'group': (
        ('Learner', 'learners', 'group_id', 'learners', None),
        ('enrolment', 'Created_users', 'group_id', 'enrolmentAccounts', None),
        ('Learner', 'learner_progress_entries', 'group_id', 'progressEntries', None),
    ),
    'module': (
        ('curriculum', 'tutor_module_notifications', 'module_catalogue_id', 'tutorNotifications', None),
        ('curriculum', 'live_session_learner_attendance', 'module_catalogue_id', 'attendance', None),
        ('curriculum', 'live_session_attendance_aliases', 'module_catalogue_id', 'attendanceAliases', None),
        ('curriculum', 'live_session_attendance_identity_rules', 'module_catalogue_id', 'attendanceIdentityRules', None),
        ('curriculum', 'module_teams_shares', 'source_module_catalogue_id', 'teamsShares', None),
        ('Learner', 'learner_training_plan_modules', 'curriculum_module_id', 'trainingPlanModules', None),
        ('Learner', 'learner_training_plan_weeks', 'curriculum_week_id', 'trainingPlanWeeks', _MODULE_WEEK_IDS),
        ('Learner', 'learner_training_plan_components', 'curriculum_component_id', 'trainingPlanComponents',
         _MODULE_COMPONENT_IDS),
    ),
}


MODULE_TEAMS_CALENDAR_BLOCKS_ARCHIVE = (
    'This module has an active Teams calendar with future sessions. Cancel the Teams calendar before archiving '
    'the module.'
)


WEEK_TEMPLATES_TABLE = 'week_templates'



CURRICULUM_CACHE_TTL_SECONDS = 1800


CURRICULUM_ROWS_CACHE_TTL_SECONDS = 300


NON_DELIVERY_WEEKEND_MESSAGE = 'Sessions and meetings can only be booked Monday to Friday.'


STRUCTURE_REVISION_UNAVAILABLE = 'unverified'


COMPONENT_DERIVED_SETTING_KEYS = (
    'displayType', 'componentBuilderStatus', 'contentSections', 'quizQuestions',
    'hasResources', 'durationMinutes',
)


PROGRAMME_VIEW_EXCLUDED_COLUMNS = ('description', 'Reflection_Question', 'reflection_question')


PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS = ('ksb_description', 'description')



SOFT_DELETE_COLUMNS = {'deleted_at', 'deleted_by', 'deleted_via_parent'}


DETACHED_PARENT_SENTINEL = ''


RESTORE_NULLABLE_COLUMNS = ('deleted_at', 'deleted_by', 'deleted_via_parent')


LIBRARY_LIST_COLUMNS = (
    'id', 'week_id', 'module_catalogue_id', 'type', 'title', 'display_order',
    'expected_otjh', 'points', 'reflection_required', 'workplace_evidence_required',
    'tutor_validation_required', 'coach_validation_required',
    'updated_at', 'status', 'copied_from_id',
)


LIBRARY_PAGE_SIZE_DEFAULT = 50


LIBRARY_PAGE_SIZE_MAX = 200


COMPONENT_HEAVY_COLUMNS = ('settings_json',)


COMPONENT_KSB_SCOPE_COLUMNS = (
    'id', 'week_id', 'module_catalogue_id', 'type', 'title', 'expected_otjh',
    'points', 'display_order', 'status',
)



PROGRAMME_MODULE_IDENTITY_FIELDS = ['moduleCatalogueId', 'catalogueId', 'moduleId', 'structureId', 'id']


STAFF_PROFILE_READ_ONLY_MESSAGE = (
    'Tutors and coaches are managed in Users. Curriculum reads them from the staff '
    'directory and cannot create, change or delete them.'
)

import re

CURRICULUM_LEARNER_DATA_TTL_SECONDS = 60


MODULE_COVER_EXTENSIONS = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif',
    'image/svg+xml': '.svg', 'image/bmp': '.bmp',
}


MODULE_COVER_DATA_URI = re.compile(r'^data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$')


PROGRAMME_CONTENT_RETAINED_MESSAGE = (
    'This programme still has weeks and components. Authored content always belongs to its '
    'module on the current curriculum database, so it cannot be deleted permanently and '
    'stays archived.'
)


PROGRAMME_KSB_STAT_FIELDS = (
    'ksbMapped', 'ksbTotal',
    'learnerKsbProgressPercentage', 'learnerKsbConsumedWeight',
    'learnerKsbExpectedWeight', 'learnerKsbLearnerCount',
    'learnerKsbCodesStarted', 'learnerKsbCodesComplete', 'learnerKsbCodesTotal',
    'learnerKsbAchievedCount', 'learnerKsbTargetCount', 'learnerKsbAchievementPercentage',
)


PROGRAMME_DETAIL_SECTIONS = ('shell', 'modules')


PROGRAMME_SECTION_WARM_WINDOW_SECONDS = 15 * 60
