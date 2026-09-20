"""Which records are audited, and which of their fields may be shown.

Every entry here is two decisions made deliberately and written down:

1. **What is collected.** The tuple is an allowlist. A column not named cannot
   reach the audit log, whatever a write path does later, so adding a column to
   a table does not quietly add it to the history of that table.

2. **What may be read back.** ``redact`` names the fields that record *that*
   they changed without recording *what to*. Those fields are stored as a digest
   of their own value, so an edit to a learner's date of birth still shows up as
   an edit to a learner's date of birth, by a named person, at a known time --
   and the date of birth itself is nowhere in the log.

The rule applied throughout: personal detail about a human being is redacted;
the operational facts of their enrolment are not. Somebody's programme, cohort,
status, dates and access level are what an audit is for. Their address, phone
number, national insurance number and a coach's free-text notes about them are
not, and an audit log that copied them would be a second, less-guarded copy of
the very data it exists to protect.

Left out of the allowlists entirely, rather than redacted, because they are a
capability rather than a fact: meeting join links and evidence image URLs. A
digest of a link is useless, and the link itself is a way in.
"""

from __future__ import annotations

import logging

from .writes import register_model

logger = logging.getLogger(__name__)


def register_enrolment_records():
    """Learner, staff, employer and organisation records on the enrolment DB."""
    try:
        from learner_api.models import Employer, EnrolmentUser, Organisation, StaffUser
    except Exception:
        logger.warning('Enrolment records could not be registered for audit.', exc_info=True)
        return

    register_model(
        EnrolmentUser,
        workspace='admin',
        entity_type='learner_record',
        label='Learner record',
        href='/users',
        key='id',
        title='username',
        using='enrolment',
        columns=(
            # identity
            'id', 'uuid', 'aptem_id', 'username', 'email', 'title', 'preferred_name',
            # where they sit in delivery
            'learner_type', 'status', 'type', 'programme_status',
            'programme', 'cohort', 'group', 'target_programme', 'sub_programme',
            # who looks after them
            'coach_name', 'coach_email', 'mentor', 'case_owner', 'learning_provider',
            # who they work for
            'employer', 'employer_id', 'organization', 'line_manager',
            # the dates and hours the funding rests on
            'start_date', 'end_date', 'learner_start_date', 'learner_end_date',
            'practical_period_end_date', 'apprenticeship_end_date',
            'minimum_required_hours', 'planned_hours', 'rpl_hours',
            'extended_break', 'reference_number',
            # onboarding and access
            'onboarding_status', 'onboarding_completed', 'invite_to_platform',
            'allow_access_to_checkpoint', 'allow_access_to_console', 'allow_access_to_classic',
            # personal detail -- collected so a change to it is visible, redacted
            # below so the value is not
            'date_of_birth', 'phone_number', 'address', 'current_postcode',
            'national_insurance_number', 'legal_sex', 'gender', 'age',
            'referrer', 'referrer_address', 'referrer_contact',
            'employer_address', 'contacts',
        ),
        redact=(
            'date_of_birth', 'phone_number', 'address', 'current_postcode',
            'national_insurance_number', 'legal_sex', 'gender', 'age',
            'referrer', 'referrer_address', 'referrer_contact',
            'employer_address', 'contacts',
        ),
    )

    register_model(
        StaffUser,
        workspace='admin',
        entity_type='staff_record',
        label='Staff record',
        href='/users',
        key='id',
        title='username',
        using='enrolment',
        columns=(
            'id', 'uuid', 'username', 'email', 'title', 'preferred_name',
            'type', 'status', 'position',
            # The permission level. The single most audit-worthy field in the
            # LMS: it is the answer to "who gave them that access, and when?".
            'access', 'access_extra',
            'organization', 'case_owner', 'learning_provider', 'reference_number',
            'invite_to_platform', 'allow_access_to_checkpoint',
            'allow_access_to_console', 'allow_access_to_classic',
            'created_at', 'updated_at',
            'phone_number', 'date_of_birth', 'gender',
        ),
        redact=('phone_number', 'date_of_birth', 'gender'),
    )

    register_model(
        Employer,
        workspace='employer',
        entity_type='employer_contact',
        label='Employer contact',
        href='/employers',
        key='id',
        title='surname',
        using='enrolment',
        columns=(
            'id', 'uuid', 'first_name', 'surname', 'email',
            'town_city', 'county', 'country',
            'signature_name', 'signature_date',
            'created_at', 'updated_at',
            'mobile', 'post_code', 'gender', 'signature',
        ),
        redact=('mobile', 'post_code', 'gender', 'signature'),
    )

    register_model(
        Organisation,
        workspace='employer',
        entity_type='organisation',
        label='Organisation',
        href='/employers',
        key='id',
        title='name',
        using='enrolment',
        columns=(
            'id', 'status', 'name', 'owner', 'category', 'group_type', 'parent_name',
            'edrs_ern_number', 'apprenticeship_agreement_id',
            'city_town', 'county', 'country', 'website', 'reference_number',
            'levy_payer', 'approx_no_of_employees', 'health_and_safety',
            'send_hours_verification_emails', 'logo_url',
            'contact_name', 'contact_role',
            'created_at', 'updated_at',
            'post_code', 'contact_email', 'contact_telephone',
        ),
        redact=('post_code', 'contact_email', 'contact_telephone'),
    )


def register_coach_records():
    """Coaching meetings and absence reports."""
    try:
        from coach_api.models import CoachAbsenceReport, CoachCalendarEvent
    except Exception:
        logger.warning('Coach records could not be registered for audit.', exc_info=True)
        return

    register_model(
        CoachCalendarEvent,
        workspace='coach',
        entity_type='coach_meeting',
        label='Coaching meeting',
        href='/coach/meetings',
        key='event_key',
        title='event_type',
        columns=(
            'event_key', 'owner_email', 'owner_name',
            'learner_id', 'learner_name', 'learner_email',
            'event_type', 'sequence', 'occurrence_number',
            'target_date', 'scheduled_date', 'scheduled_time', 'duration_minutes',
            'status', 'meeting_provider',
            # The meeting's identity in Graph, which is traceable on purpose.
            # `meeting_link` and `graph_web_link` are deliberately absent: those
            # are the way into the meeting, not a fact about it.
            'graph_event_id', 'graph_organizer_email',
            'review_template_id', 'review_instance_id', 'review_completed_at',
            'manager_signed_at', 'manager_signed_by',
            'sync_state', 'created_at', 'updated_at',
            'notes', 'review_responses',
        ),
        # What a coach wrote about a learner. That the notes changed is auditable;
        # what they say is between the coach and the learner.
        redact=('notes', 'review_responses'),
    )

    register_model(
        CoachAbsenceReport,
        workspace='coach',
        entity_type='absence_report',
        label='Absence report',
        href='/coach/absence-reports',
        key='id',
        title='session_title',
        columns=(
            'id', 'attendance_id', 'owner_email', 'owner_name',
            'learner_id', 'learner_name', 'learner_email',
            'session_title', 'session_date', 'session_time',
            'reason_category', 'reported_by', 'status',
            'evidence_provided', 'evidence_kind',
            'previous_absences', 'attendance_rate',
            'recovery_method', 'catchup_event_key',
            'created_at', 'updated_at',
            'reason', 'evidence_text', 'coach_note',
        ),
        # Why somebody was absent is often a health or home circumstance. The
        # category is recorded plainly; the words are not.
        redact=('reason', 'evidence_text', 'coach_note'),
    )
