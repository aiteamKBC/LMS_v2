"""Fill booked coaching meetings omitted by the bounded dashboard preview.

This read never books/syncs meetings or refreshes dashboard snapshots. The
normal timetable resolver retains imported-review identity and access scope.
"""
import json

from django.db.models.functions import Lower, Trim

from .models import CoachCalendarEvent


def missing_booking_owners(coach_emails, rows, start_date, end_date):
    """Compare durable booking identities, never titles, dates or learner IDs."""
    represented = {email: set() for email in coach_emails}
    for email, _refreshed, event in rows:
        if email not in represented:
            continue
        if isinstance(event, str):
            try:
                event = json.loads(event)
            except (TypeError, ValueError):
                continue
        if not isinstance(event, dict):
            continue
        represented[email].update(
            (field, str(event[field])) for field in
            ('eventKey', 'calendarEventKey', 'calendarEventId', 'operationId') if event.get(field)
        )
    bookings = (CoachCalendarEvent.objects.annotate(owner_key=Lower(Trim('owner_email')))
                .filter(owner_key__in=sorted(coach_emails),
                        scheduled_date__range=(start_date, end_date), scheduled_time__isnull=False)
                .exclude(graph_event_id='').exclude(status='cancelled').exclude(sync_state='cancelled')
                .values_list('owner_key', 'event_key', 'id', 'operation_id'))
    missing = set()
    for owner, key, record_id, operation_id in bookings:
        identities = {('eventKey', key), ('calendarEventKey', key),
                      ('calendarEventId', str(record_id)), ('operationId', str(operation_id))}
        if owner in represented and not represented[owner].intersection(identities):
            missing.add(owner)
    return missing


def read_missing_bookings(coach_emails, rows, start_date, end_date):
    """Keep the fast preview when complete; read only affected coaches live."""
    from . import views
    from .meeting_outcomes import annotate_meeting_outcomes

    result = {}
    for owner in sorted(missing_booking_owners(coach_emails, rows, start_date, end_date)):
        payload = views.collect_generated_timetable(
            owner, start_date=start_date, end_date=end_date,
            include_live_sessions=False, include_scheduler_queues=False, include_unlinked_bookings=True,
        )
        events = payload['events']
        annotate_meeting_outcomes(events)
        result[owner] = events
    return result
