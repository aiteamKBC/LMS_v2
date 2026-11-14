"""Read-only calendar visibility for confirmed, unlinked legacy Review bookings.

These are appointments, not replacement Aptem Reviews. No associations, forms,
signatures or stored booking fields are created or changed by this projection.
"""


def _canonical_profile_id(record, profile):
    """Resolve a Calendar row through the reviewed learner-link table."""
    from django.db import DatabaseError

    from .calendar_identity import CalendarLearnerIdentityError, resolve_profile_identity

    try:
        identity = resolve_profile_identity(
            record.pk,
            expected_profile_id=profile.id,
            expected_enrolment_id=getattr(profile, "enrolment_id", None),
            expected_raw_learner_id=getattr(record, "learner_id", None),
        )
    except (CalendarLearnerIdentityError, DatabaseError, ValueError):
        return None
    value = identity.get("learner_profile_id") or identity.get("verified_profile_id")
    return value if value not in (None, "") else None


def booking_only_candidates(records, profiles, aptem_profile_ids, *, events=(), linked_keys=(), native_instances=()):
    instances = {row['id']: row for row in native_instances}
    keys = set(linked_keys)
    ids, operations = set(), set()
    for event in events:
        keys.update(value for value in (event.get('eventKey'), event.get('calendarEventKey')) if value)
        if event.get('calendarEventId'):
            ids.add(str(event['calendarEventId']))
        if event.get('operationId'):
            operations.add(str(event['operationId']))
    result = []
    for record in records:
        if (record.event_type not in {'mcr', 'progress-review', 'review'}
                or not (record.review_template_id or record.review_instance_id)
                or record.status not in {'scheduled', 'in-progress', 'awaiting-signature', 'completed'}
                or record.sync_state != 'synced' or not record.graph_event_id
                or not (record.meeting_link or record.graph_web_link)
                or not record.scheduled_date or record.scheduled_time is None):
            continue
        if record.event_key in keys or str(record.pk) in ids or str(record.operation_id) in operations:
            continue
        parts = (record.idempotency_key or '').split(':')
        enrolment_booking = parts[0] == 'learner-book'
        matches = []
        for profile in profiles:
            if profile.id not in aptem_profile_ids:
                continue
            if str(_canonical_profile_id(record, profile)) != str(profile.id):
                continue
            # Some older learner-book operations saved the profile ID after
            # creating a Native instance. Its exact persisted association is
            # stronger evidence than the key prefix's legacy ID convention.
            instance = instances.get(record.review_instance_id) or {}
            native_matches = (
                instance.get('learner_id') == profile.id
                and instance.get('calendar_event_id') == record.pk
                and instance.get('review_template_id') == record.review_template_id
                and instance.get('occurrence_number') == getattr(record, 'occurrence_number', None)
                and instance.get('learner_kind') in ('', profile.learner_type)
            )
            use_enrolment_id = enrolment_booking and not native_matches
            expected = getattr(profile, 'enrolment_id', None) if use_enrolment_id else profile.id
            if expected is None:
                continue
            if use_enrolment_id and str(record.learner_profile_id) != str(expected):
                # The key's legacy namespace is only an additional consistency
                # check. Ownership itself was already proven by the canonical
                # Calendar learner link above.
                continue
            if enrolment_booking and len(parts) >= 4 and parts[2] in {'commercial', 'apprenticeship'}:
                if parts[2] != profile.learner_type or (use_enrolment_id and parts[3] != str(expected)):
                    continue
            # Do not use a colliding numeric ID to expose another learner's booking.
            email = (record.learner_email or '').strip().casefold()
            if email and email != (profile.email or '').strip().casefold():
                # An old email is safe only when the saved Native instance
                # independently confirms this exact profile AND booking.
                if not native_matches:
                    continue
            matches.append(profile)
        if len(matches) == 1:
            result.append((record, matches[0]))
            keys.add(record.event_key)
    return result


def unlinked_review_bookings(records, profiles, aptem_profile_ids, *, events=(), linked_keys=()):
    records, profiles = list(records), list(profiles)
    owners = {profile.id: profile for profile in profiles if profile.id in aptem_profile_ids}
    proof_instance_ids = sorted({record.review_instance_id for record in records
        if record.review_instance_id and record.review_template_id
        and any(
            _canonical_profile_id(record, profile) == profile.id
            and ((record.idempotency_key or '').startswith('learner-book:')
                 or (record.learner_email or '').strip().casefold()
                 != (profile.email or '').strip().casefold())
            for profile in owners.values()
        )})
    instances = []
    if proof_instance_ids:
        from curriculum_api import views as curriculum_views
        placeholders = ', '.join(['%s'] * len(proof_instance_ids))
        instances = curriculum_views.fetch_all(
            'SELECT id, learner_id, learner_kind, calendar_event_id, review_template_id, occurrence_number '
            f'FROM {curriculum_views.authoring_table_name("review_instances")} WHERE id IN ({placeholders})',
            proof_instance_ids,
        )
    candidates = booking_only_candidates(records, profiles, aptem_profile_ids,
        events=events, linked_keys=linked_keys, native_instances=instances)
    if not candidates:
        return []
    from .reconciliation_links import active_links
    linked = set(active_links(calendar_event_id__in=[record.pk for record, _ in candidates])
                 .values_list('calendar_event_id', flat=True))
    return [(record, profile) for record, profile in candidates if record.pk not in linked]


def booking_only_projection(event, record):
    """Keep appointment details; never route this calendar card to a Review."""
    return {**event, 'bookingOnly': True, 'reviewSource': 'unlinked-booking',
            'reviewTemplateId': None, 'reviewInstanceId': None, 'reviewId': None,
            'formEventKey': None, 'hasReviewForm': False, 'reviewResponses': {},
            'calendarEventId': str(record.pk), 'calendarEventKey': record.event_key,
            'meetingLink': record.meeting_link or record.graph_web_link, 'invited': True}
