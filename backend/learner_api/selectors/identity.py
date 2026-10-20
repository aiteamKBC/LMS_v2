"""Read canonical identity for an already-authorized enrolment.

The caller supplies its current query callable and error class, retaining its
existing database alias, request cache and error boundary. No repairs occur here.
"""


def profile_for_enrolment(enrolment_id, *, query, error_type):
    records = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id,
        u."Planned_hours" AS programme_planned_hours,
        EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t WHERE t.enrolment_id=l.enrolment_id) AS progress_transfer_active
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=%s''', [enrolment_id])
    if not records:
        return None
    if len(records) != 1:
        raise error_type('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return validate_profile(records[0], error_type=error_type)


def validate_profile(owner, *, error_type):
    email = str(owner.get('email') or '').strip().casefold()
    account_email = str(owner.get('account_email') or '').strip().casefold()
    aptem = str(owner.get('account_aptem_id') or '').strip().lstrip('0')
    if (owner.get('account_record_id') is None or not email or email != account_email
            or (aptem and aptem != str(owner.get('aptem_id') or '').lstrip('0'))):
        raise error_type('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return owner
