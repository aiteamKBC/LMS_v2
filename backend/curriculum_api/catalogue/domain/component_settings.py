"""Component settings schema and normalization; no IO or framework dependencies."""



import json


CONTENT_AUTHORING_STATUSES = {'Draft', 'Ready for QA', 'Needs changes', 'Approved'}


BASE_COMPONENT_SETTINGS = {
    'completionRule': 'Mark complete',
    'evidenceRequired': '-',
    'reflectionPrompt': 'What did you learn? How will you apply this at work? Which KSBs did this develop?',
    'contentStatus': 'Draft',
    'version': '0.1',
}


COMPONENT_SETTINGS_SCHEMA = {
    'live-session': {
        **BASE_COMPONENT_SETTINGS,
        'sessionPurpose': '',
        'sessionDate': '',
        # The weekday `sessionDate` falls on, which
        # `apply_module_session_plan_to_weeks` stamps beside it. Declared
        # because it is written: an undeclared key is moved into
        # `legacySettings` here and rejected outright by the browser's copy of
        # this schema, so the module the backend just served could not be saved
        # back. This list and the one in
        # `module-builder/componentAuthoringModel.ts` must agree, except for
        # `selectedGroupKeys`/`selectedGroupNames`, which group assignment
        # deletes outright and the browser deliberately does not declare.
        'sessionDay': '',
        'sessionTime': '',
        'sessionDateTimeUtc': '',
        'durationMinutes': 60,
        'selectedGroupKeys': [],
        'selectedGroupNames': [],
        'liveSessionUrl': '',
        # A module-builder bulk replacement is an explicit authoring override.
        # Keep it as a first-class setting so the normaliser does not hide it
        # inside legacySettings before the calendar re-attach reads the row.
        'liveSessionLinkOverride': '',
        'teamsEventId': '',
        'teamsLiveSessionId': '',
        # Written when a calendar is created or a plan is stamped, by the
        # planner above, `applyModuleTeamsSeries` and the schedule editor.
        'teamsStartDateTimeUtc': '',
        'teamsMeetingUrl': '',
        'teamsOnlineMeetingId': '',
        'teamsCalendarSeries': '',
        # Empty, not 0, like every other Teams key here: this holds a number once
        # a calendar exists, and 0 would read as a real occurrence.
        'teamsDurationMinutes': '',
        # `teamsSessionNumber` is deliberately NOT defaulted here. It is an
        # occurrence identity, carried by LIVE_SESSION_TRACKING_SETTING_KEYS, so
        # it still saves whenever Teams has actually assigned one -- but a
        # component with no occurrence behind it must not be handed the key at
        # all, empty or otherwise.
        'teamsMeetingOptionsUrl': '',
        'teamsOrganizerEmail': '',
        'teamsAttendees': [],
        # Declared here too, or the roles a created calendar writes back land in
        # `legacySettings` and come home nested inside a JSON blob.
        'teamsPresenters': [],
        'teamsCoOrganizers': [],
        'teamsProvider': '',
        'teamsRepeat': 'none',
        'teamsRepeatOccurrences': 1,
        'teamsLobbyBypass': 'invited',
        'teamsRecording': 'record-transcribe',
        'teamsSpokenLanguage': 'en-GB',
        'teamsMeetingType': 'live-session',
        'teamsRequestResponses': True,
        'teamsAllowTimeProposals': True,
        'teamsHideAttendees': False,
        'preparationInstructions': '',
        'reflectionQuestions': '',
        'attendanceRequired': True,
        'recordingExpected': True,
    },
    'recording-placeholder': {
        **BASE_COMPONENT_SETTINGS,
        'recordingPurpose': '',
        'source': 'MIS allocation',
        'recordingUrl': '',
        'expectedAvailability': 'After live session',
        # The live-session component this recording plays (any week), and the
        # module holding it when that is another group's module ('' = this
        # module). Empty id = not linked. Mirrors the browser's definition in
        # module-builder/componentAuthoringModel.ts.
        'linkedLiveSessionComponentId': '',
        'linkedLiveSessionModuleId': '',
    },
    'video': {
        **BASE_COMPONENT_SETTINGS,
        'sourceType': 'YouTube',
        'provider': 'YouTube',
        'videoUrl': '',
        'embedCode': '',
        'durationMinutes': 10,
        'requiredProgressPercentage': 0,
        'shortDescription': '',
        'learningBrief': '',
        'lessonContent': '',
        'lessonMaterialLinks': '',
        'lessonMaterialsNotes': '',
        'postWatchTask': '',
        'markersAndQuestions': '',
        'qAndA': '',
    },
    'podcast': {
        **BASE_COMPONENT_SETTINGS,
        'podcastSource': 'External URL',
        'podcastUrl': '',
        'embedCode': '',
        'shortcode': '',
        'componentFiles': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'durationMinutes': 20,
        'requiredProgressPercentage': 0,
        'listeningFocus': '',
        'podcastReflectionQuestion': '',
        'transcript': '',
    },
    'reading': {
        **BASE_COMPONENT_SETTINGS,
        'difficulty': 'Standard',
        'requirement': 'Required',
        'readingSource': 'Written in LMS',
        'resourceUrl': '',
        'componentFiles': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'shortDescription': '',
        'readingContent': '',
        'mainLearningOutcomes': '',
        'ksbEvidenceNotes': '',
        'focusSections': '',
        'learnerInstruction': '',
        'keyPointCount': '0',
        'keyPoints': '',
        'glossaryTerms': '',
        'estimatedReadingTime': 20,
        'otjhRationale': '',
        'audioEnabled': False,
        'audioUrl': '',
        'reflectionQuestionCount': '0 qs',
        'readingReflectionPrompts': '',
        'readingEvidenceRequired': '',
        'completionRuleCount': '3 rules',
        'completionConfirmationRequired': True,
        'linkedActivity': '',
        'coachingPrompt': '',
        'requiredReading': True,
    },
    'powerpoint': {
        **BASE_COMPONENT_SETTINGS,
        'fileName': '',
        'presentationUrl': '',
        'componentFiles': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'slideRange': '',
        'speakerNotes': '',
        'downloadAllowed': True,
    },
    'quiz': {
        **BASE_COMPONENT_SETTINGS,
        'buildMode': 'linked',
        'linkedQuizId': '',
        'linkedActivity': '',
        'numberOfQuestions': 10,
        'passMarkPercentage': 70,
        'attemptsAllowed': 2,
        'affectsKsbProgression': True,
        'completionFeedback': '',
    },
    'monthly-ksb-quiz': {
        **BASE_COMPONENT_SETTINGS,
        'buildMode': 'linked',
        'linkedQuizId': '',
        'linkedActivity': '',
        'numberOfQuestions': 12,
        'passMarkPercentage': 70,
        'attemptsAllowed': 2,
        'affectsKsbProgression': True,
        'monthFocus': '',
    },
    'reflection': {
        **BASE_COMPONENT_SETTINGS,
        'minimumWordCount': 250,
        'learnerGuidance': '',
        'tutorReviewGuidance': '',
    },
    'assignment': {
        **BASE_COMPONENT_SETTINGS,
        'assignmentBrief': '',
        'assignmentTopics': '',
        'submissionInstructions': '',
        'dueTiming': 'End of week',
        'markingRubric': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'assignmentFileName': '',
        'assignmentFileUrl': '',
        # Read by learner_api.assignment_settings: the title learners are given,
        # and whether this is the eight-step monthly assignment.
        'learnerTitle': '',
        'isMonthlyAssignment': False,
    },
    'checkpoint': {
        **BASE_COMPONENT_SETTINGS,
        'checkpointTitle': '',
        'checkpointQuestions': '',
        'progressReviewLinked': True,
        'monthlyCoachingReviewLinked': True,
    },
    'coaching-preparation': {
        **BASE_COMPONENT_SETTINGS,
        'preparationPrompt': '',
        'evidenceToBring': '',
        'coachDiscussionPoints': '',
        'coachingReviewLinked': True,
    },
}


LEGACY_SETTING_KEYS = {'legacySettings', 'legacySourceType', 'legacyUnsupportedSource', 'shortcode'}


RECORDING_SOURCE_SETTING_KEYS = {'recordingSeriesId', 'recordingSessionNumber', 'recordingDate'}


LIVE_SESSION_TRACKING_SETTING_KEYS = {
    'teamsOccurrenceId', 'teamsSessionNumber', 'teamsOnlineMeetingId',
    'teamsMeetingUrl', 'teamsWebLink', 'teamsStartDateTimeUtc',
    'teamsDurationMinutes', 'sessionDay', 'sessionRescheduled',
    'liveSessionLinkOverride', 'teamsCalendarBinding', 'teamsMainLinkInherited',
    'teamsMeetingScope',
    'extraTeamsMeetingUrl', 'extraTeamsLiveSessionId', 'extraTeamsEventId',
    'extraTeamsOnlineMeetingId', 'extraTeamsWebLink', 'extraTeamsMeetingOptionsUrl',
    'extraTeamsOrganizerEmail', 'extraTeamsAttendees', 'extraTeamsPresenters',
    'extraTeamsCoOrganizers', 'extraTeamsStartDateTimeUtc', 'extraTeamsDurationMinutes',
    'extraTeamsSubject',
}

from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value


def component_settings_defaults(component_type, *, frontend_component_type=_default_frontend_component_type):
    return COMPONENT_SETTINGS_SCHEMA.get(frontend_component_type(component_type), COMPONENT_SETTINGS_SCHEMA['reading'])


def allowed_component_setting_keys(
    component_type,
    *,
    component_settings_defaults=component_settings_defaults,
    frontend_component_type=_default_frontend_component_type,
):
    allowed = set(component_settings_defaults(component_type)) | LEGACY_SETTING_KEYS
    if frontend_component_type(component_type) in {'live-session', 'video', 'recording-placeholder'}:
        allowed |= RECORDING_SOURCE_SETTING_KEYS
    if frontend_component_type(component_type) == 'live-session':
        allowed |= LIVE_SESSION_TRACKING_SETTING_KEYS
    return allowed


def normalise_component_settings_payload(
    component_type,
    settings,
    *,
    allowed_component_setting_keys=allowed_component_setting_keys,
    as_json_value=_default_as_json_value,
    component_settings_defaults=component_settings_defaults,
    frontend_component_type=_default_frontend_component_type,
):
    source = dict(settings) if isinstance(settings, dict) else {}
    stored_legacy = as_json_value(source.get('legacySettings'), {})
    if isinstance(stored_legacy, dict):
        source = {**stored_legacy, **source}
    component_type = frontend_component_type(component_type)
    if component_type == 'podcast':
        source['embedCode'] = source.get('embedCode') or source.get('podcastEmbedCode') or ''
        source['shortcode'] = source.get('shortcode') or source.get('podcastShortcode') or ''
        if source.get('podcastSource') == 'Audio File':
            source['podcastSource'] = 'Device upload'
        elif source.get('podcastSource') == 'External Link':
            source['podcastSource'] = 'External URL'
        if source.get('podcastSource') == 'Device upload' and not source.get('podcastUrl'):
            source['podcastUrl'] = source.get('uploadedFileUrl') or ''
    elif component_type == 'reading':
        if source.get('readingSource') == 'Text':
            source['readingSource'] = 'Written in LMS'
        elif source.get('readingSource') == 'File':
            source['readingSource'] = 'LMS resource'
        if source.get('readingSource') == 'LMS resource' and not source.get('resourceUrl'):
            source['resourceUrl'] = source.get('uploadedFileUrl') or ''
    elif component_type == 'assignment':
        source['assignmentBrief'] = source.get('assignmentBrief') or source.get('assignmentContent') or ''
        source['assignmentFileName'] = source.get('assignmentFileName') or source.get('uploadedFileName') or ''
        source['assignmentFileUrl'] = source.get('assignmentFileUrl') or source.get('uploadedFileUrl') or ''
    defaults = component_settings_defaults(component_type)
    allowed = allowed_component_setting_keys(component_type)
    normalised = dict(defaults)
    legacy = {}
    for key, value in source.items():
        if value is None:
            continue
        if key == 'legacySettings':
            continue
        if key in allowed:
            normalised[key] = value
        elif isinstance(value, (str, int, float, bool, list)):
            legacy[key] = value
    if legacy:
        normalised['legacySettings'] = json.dumps(legacy)
    if frontend_component_type(component_type) == 'video' and (source.get('sourceType') == 'Shortcode' or source.get('provider') == 'Shortcode'):
        normalised['legacySourceType'] = 'Shortcode'
        normalised['legacyUnsupportedSource'] = True
        normalised['sourceType'] = source.get('sourceType') or 'Shortcode'
        normalised['provider'] = source.get('provider') or 'Shortcode'
    return normalised
