"""Persistent header projection. No enrichment, relations or source lookups."""
from types import SimpleNamespace


def serialize_case_file_profile(profile, source):
    from coach_api.views import caseload_profile_start_date, clean_text, student_activity_available

    def text(profile_field, source_field):
        return clean_text(getattr(profile, profile_field, None) or getattr(source, source_field, None)) or None

    # Preserve the legacy resolver's source precedence and fail-closed conflict.
    def aptem(value):
        return int(str(value).strip()) if student_activity_available(value) else None

    source_aptem = aptem(getattr(source, 'aptem_id', None))
    profile_aptem = aptem(profile.aptem_id)
    resolved_aptem = None if source_aptem and profile_aptem and source_aptem != profile_aptem else source_aptem or profile_aptem
    kind = clean_text(getattr(source, 'learner_type', None) or profile.learner_type).casefold()
    return {'learner': {
        'id': str(profile.id),
        'name': text('full_name', 'username'),
        'email': text('email', 'email'),
        'programme': text('programme', 'programme'),
        'group': text('group_name', 'group'),
        'employer': clean_text(getattr(source, 'employer', None)) or None,
        'status': text('programme_status', 'programme_status'),
        'startDate': caseload_profile_start_date(SimpleNamespace(_caseload_source=source)),
        # The existing persistent header uses the recorded learner end date.
        'plannedEndDate': clean_text(getattr(source, 'learner_end_date', None)) or None,
        'enrolmentId': str(profile.enrolment_id) if profile.enrolment_id else None,
        'aptemId': str(resolved_aptem) if resolved_aptem else None,
        'learnerType': 'commercial' if kind == 'commercial' else 'apprenticeship',
    }}
