"""Existing audit display/window constants; public names are re-exported unchanged."""

DEFAULT_WINDOW_DAYS = 7

MAX_WINDOW_DAYS = 7

UNLIMITED_WORKSPACES = frozenset({'curriculum'})

UNLIMITED_WINDOW_DAYS = 3650

MAX_CHANGE_WINDOW_DAYS = 60

DEFAULT_LIMIT = 200

MAX_LIMIT = 1000

DEFAULT_PAGE_SIZE = 50

ENTITY_LABELS = {
    'programme': ('Programme', '/curriculum/programmes'),
    'cohort': ('Cohort', '/curriculum/cohorts'),
    'group': ('Group', '/curriculum/groups'),
    'module': ('Module', '/curriculum/module-builder'),
    'module_details': ('Module detail', '/curriculum/module-builder'),
    'module_completion': ('Module completion rule', '/curriculum/module-builder'),
    'week': ('Week', '/curriculum/week-builder'),
    'component': ('Component', '/curriculum/module-builder'),
    'ksb_mapping': ('KSB mapping', '/curriculum/ksb-coverage'),
    'live_session': ('Live session', '/curriculum/teams-meetings'),
    'holiday': ('Holiday', '/curriculum/holidays'),
    'week_template': ('Week template', '/curriculum/week-builder'),
    'week_template_component': ('Week template component', '/curriculum/week-builder'),
}

FIELD_LABELS = {
    'coach_name': 'Coach',
    'tutor_name': 'Tutor',
    'display_order': 'Position',
    'week_number': 'Week number',
    'week_id': 'Week',
    'module_catalogue_id': 'Module',
    'programme_id': 'Programme',
    'cohort_id': 'Cohort',
    'group_id': 'Group',
    'ksb_mappings': 'KSBs',
    'expected_otjh': 'Expected OTJH',
    'total_otjh': 'Total OTJH',
    'required_otjh': 'Required OTJH',
    'settings_json': 'Content settings',
    'deleted_at': 'Archived on',
    'deleted_by': 'Archived by handler',
    'Reflection_Question': 'Reflection question',
    'ksb_code': 'KSB code',
    # Learner and staff records. The underscore fallback below already reads
    # most of these correctly; named here are the ones where it does not, and
    # the handful where the column name is not what the LMS calls the field.
    'uuid': 'Internal reference',
    'aptem_id': 'Aptem id',
    'username': 'Name',
    'access': 'Access level',
    'access_extra': 'Extra access',
    'organization': 'Organisation',
    'programme_status': 'Programme status',
    'learner_type': 'Learner type',
    'case_owner': 'Case owner',
    'learning_provider': 'Learning provider',
    'rpl_hours': 'RPL hours',
    'minimum_required_hours': 'Minimum required hours',
    'national_insurance_number': 'National insurance number',
    'invite_to_platform': 'Invited to the platform',
    'allow_access_to_checkpoint': 'Checkpoint access',
    'allow_access_to_console': 'Console access',
    'allow_access_to_classic': 'Classic access',
    'onboarding_completed': 'Onboarding completed',
    'practical_period_end_date': 'Practical period end date',
    'apprenticeship_end_date': 'Apprenticeship end date',
    # Employers and organisations.
    'edrs_ern_number': 'EDRS / ERN number',
    'apprenticeship_agreement_id': 'Apprenticeship agreement',
    'levy_payer': 'Levy payer',
    'approx_no_of_employees': 'Approximate employees',
    'health_and_safety': 'Health and safety',
    'send_hours_verification_emails': 'Sends hours verification emails',
    'post_code': 'Postcode',
    'town_city': 'Town / city',
    'city_town': 'Town / city',
    # Coaching meetings and absence reports.
    'event_key': 'Meeting reference',
    'event_type': 'Meeting type',
    'owner_email': 'Coach email',
    'owner_name': 'Coach',
    'learner_name': 'Learner',
    'learner_email': 'Learner email',
    'learner_id': 'Learner',
    'occurrence_number': 'Occurrence',
    'duration_minutes': 'Duration (minutes)',
    'meeting_provider': 'Meeting provider',
    'graph_event_id': 'Teams event id',
    'graph_organizer_email': 'Teams organiser',
    'review_template_id': 'Review template',
    'review_instance_id': 'Review instance',
    'review_completed_at': 'Review completed',
    'review_responses': 'Review answers',
    'manager_signed_at': 'Manager signed on',
    'manager_signed_by': 'Manager signed by',
    'sync_state': 'Teams sync state',
    'attendance_id': 'Attendance record',
    'reason_category': 'Reason category',
    'evidence_provided': 'Evidence provided',
    'evidence_kind': 'Evidence type',
    'evidence_text': 'Evidence',
    'coach_note': 'Coach note',
    'previous_absences': 'Previous absences',
    'attendance_rate': 'Attendance rate',
    'recovery_method': 'Recovery method',
    'catchup_event_key': 'Catch-up meeting',
}

PROVENANCE_LABELS = {
    'revision': 'Revision history',
    'timestamps': 'Recovered from timestamps',
}

ACTION_LABELS = {
    'created': 'Created',
    'updated': 'Edited',
    'archived': 'Archived',
    'restored': 'Restored',
    'deleted': 'Deleted',
    'moved': 'Moved',
    'reordered': 'Reordered',
    # Not "Created": this record already existed when history started, and its
    # real author is unknown rather than assumed.
    'recorded': 'First recorded',
    'file_uploaded': 'Uploaded file',
    'file_replaced': 'Replaced file',
    'file_removed': 'Removed file',
    # Said plainly so a reader is not left thinking a person retyped this.
    'recalculated': 'Recalculated',
    'imported': 'Imported',
}

SOURCE_LABELS = {
    'manual': 'Manual save',
    'auto-save': 'Auto-save',
    'module-builder': 'Module builder',
    'tree-save': 'Programme tree save',
    'import': 'Import',
    'upload': 'File upload',
    'duplicate': 'Duplicate',
    'wizard': 'Wizard',
    'recalculation': 'Recalculation',
    'scheduled-job': 'Scheduled job',
    'system': 'System',
    'api': 'API',
}

REASON_LABELS = {
    'hard-delete': 'a cleanup sweep',
    'bulk-delete': 'a bulk delete',
    'module-save': 'a module save',
    'component-save': 'a component save',
    'programme-tree-save': 'a programme tree save',
    'module-delete': 'its module being deleted',
    'week-delete': 'its week being deleted',
    'component-delete': 'its component being deleted',
    'programme-delete': 'its programme being deleted',
    'cohort-delete': 'its cohort being deleted',
    'group-delete': 'its group being deleted',
    'week-template-delete': 'its week template being deleted',
    'programme-archive': 'its programme being archived',
    'ksb-mapping-delete': 'a KSB mapping being removed',
    'ksb-mapping-patch': 'a KSB mapping update',
    'component-ksb-sync': 'a KSB sync',
    'component-ksb-post': 'a KSB update',
}

