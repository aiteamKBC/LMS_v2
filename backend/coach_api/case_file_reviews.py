"""Coach Case File review projections. All readers are stored-only."""
from datetime import date, datetime

from django.db.models import Q

from .models import CoachCalendarEvent
from . import views
from .review_sources import standalone_review_records, load_imported_links

# Construct detached records with defaults for unused fields rather than defer():
# shared pure adapters can access defaults without causing per-row DB queries.
CALENDAR_FIELDS = (
    'id', 'event_key', 'idempotency_key', 'owner_email', 'owner_name', 'learner_id',
    'event_type', 'sequence', 'target_date', 'scheduled_date', 'scheduled_time',
    'status', 'review_completed_at', 'review_template_id', 'review_instance_id',
    'occurrence_number', 'sync_state', 'graph_event_id', 'meeting_link', 'graph_web_link',
)


def review_events(context):
    profile, owner = context.profile, context.coach
    owner_name = views._case_file_owner_name(owner, profile)
    resolved = views.resolve_coach_review_events(owner, owner_name, [profile])
    events = resolved['events']
    curriculum = [event for event in events if event.get('reviewSource') == 'curriculum']
    imported = [event for event in events if event.get('reviewSource') == 'aptem']
    # One learner-scoped calendar query covers canonical, legacy and standalone
    # records; durable identity reconciliation remains the shared authority.
    ids = {profile.id}
    if profile.enrolment_id:
        ids.add(profile.enrolment_id)
    records = [CoachCalendarEvent(**row) for row in CoachCalendarEvent.objects.filter(
        Q(owner_email__iexact=owner, learner_id=profile.id)
        | Q(event_key__in=[event['eventKey'] for event in imported])
        | Q(learner_id__in=ids, event_type__in={event['source'] for event in imported})).values(*CALENDAR_FIELDS)]
    candidates = [record for record in records if record.learner_id == profile.id and record.owner_email.casefold() == owner.casefold() and (
        record.event_type not in {'mcr', 'progress-review'}
        or record.idempotency_key.startswith('learner-book:') or record.review_template_id
        or record.status in {'scheduled', 'in-progress', 'awaiting-signature', 'completed', 'cancelled'}
        or (record.scheduled_date and record.scheduled_time))]
    candidates.sort(key=lambda row: (str(row.scheduled_date or ''), str(row.target_date or ''), str(row.scheduled_time or '')))
    standalone = standalone_review_records(candidates, [profile], resolved['aptemProfileIds'],
                                          linked_keys={event['eventKey'] for event in events})
    native_records = views.curriculum_review_instances.reconcile_review_event_keys(
        curriculum, [record for record in records if record.learner_id == profile.id and record.owner_email.casefold() == owner.casefold()])
    shaped = [views.overlay_calendar_record(event, native_records.get(event['eventKey']), compact=True)
              for event in curriculum]
    bookings, overlays = load_imported_links(imported, records=records, compact=True)
    for event in imported:
        overlay = overlays.get(event['eventKey'])
        row = views.overlay_calendar_record(event, bookings.get(event['eventKey']), overlay, compact=True)
        shaped.append(row)
    types = views.review_type_fields_by_template(record.review_template_id for record in standalone)
    for record in standalone:
        native = record.event_type in views.CURRICULUM_REVIEW_EVENT_TYPES and bool(record.review_template_id)
        metadata = types.get(record.review_template_id) or views.review_type_event_fields(None) if native else views.review_type_event_fields(None)
        source = views.review_event_type_for_type_code(metadata.get('reviewTypeCode')) if native else record.event_type
        if source not in {'mcr', 'progress-review', 'review'}:
            continue
        target = record.target_date or record.scheduled_date or views.timezone.localdate()
        scheduled = record.scheduled_date
        shaped.append({
            'id': record.event_key, 'eventKey': record.event_key, 'source': source, **metadata,
            'sequence': record.sequence or 1, 'occurrenceNumber': record.occurrence_number or record.sequence,
            'targetDate': target.isoformat(), 'date': (scheduled or target).isoformat(),
            'scheduledDate': scheduled.isoformat() if scheduled else None,
            'scheduledTime': record.scheduled_time.strftime('%H:%M') if record.scheduled_time else None,
            'startHour': record.scheduled_time.hour + record.scheduled_time.minute / 60 if record.scheduled_time else 9,
            'status': record.status, 'ownerName': owner_name or record.owner_name or 'Coach',
            'reviewInstanceId': record.review_instance_id if native else None,
        })
    return sorted(shaped, key=lambda event: (event.get('date') or '', event.get('startHour') or 0)), resolved['reviewGenerationIssues']


def category(event):
    # Preserve the old Case File filter's precedence using authoritative type
    # metadata (never the event title). Older bookings can carry stale codes.
    label = str(event.get('reviewTypeName') or '').strip().lower()
    source = event.get('source') or 'review'
    if not label:
        label = {'mcr': 'monthly coaching meeting', 'progress-review': 'progress review'}.get(source, 'review')
    if label == 'monthly coaching meeting':
        return 'mcr'
    if label == 'progress review':
        return 'progress-review'
    code = str(event.get('reviewTypeCode') or '').strip().lower()
    if code:
        return {'mcm': 'mcr', 'progress_review': 'progress-review'}.get(code, 'review')
    return source if source in {'mcr', 'progress-review'} else 'review'


def date_only(value):
    if not value:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    return str(value)[:10]


def compact_row(event):
    source = event.get('source') or 'review'
    title = event.get('reviewTypeName') or {'mcr': 'Monthly Coaching Meeting', 'progress-review': 'Progress Review'}.get(source, 'Review')
    display_date = event.get('scheduledDate') or event.get('date') or event.get('targetDate')
    return {
        'id': event.get('eventKey') or event['id'], 'type': category(event), 'title': title,
        'plannedDate': date_only(event.get('targetDate') or event.get('scheduledDate')),
        'scheduledDate': date_only(event.get('scheduledDate')),
        'scheduledTime': str(event['scheduledTime'])[:5] if event.get('scheduledTime') else None,
        'completedDate': date_only(event.get('reviewCompletedAt') or display_date) if event.get('status') == 'completed' else None,
        'status': event.get('status'),
        'reviewer': str(event.get('reviewerName') or event.get('ownerName') or '').strip() or '--',
    }


def project_reviews(events, issues=()):
    # Same grouping/occurrence order as the former Case File frontend.
    groups = {}
    today = views.timezone.localdate().isoformat()
    display_date = lambda event: event.get('scheduledDate') or event.get('date') or event.get('targetDate') or ''
    ordered = sorted(events, key=lambda event: (display_date(event), bool(event.get('isTimeEstimated')), event.get('startHour') or 0))
    ordered = [event for event in ordered if display_date(event) >= today] + list(reversed([
        event for event in ordered if display_date(event) < today]))
    for event in ordered:
        if event.get('status') == 'cancelled':
            continue
        row = compact_row(event)
        groups.setdefault(row['title'].strip().lower(), []).append((event, row))
    rank = {'progress review': 0, 'monthly coaching meeting': 1, 'review': 99}
    rows = []
    for key in sorted(groups, key=lambda key: (rank.get(key, 10), key)):
        rows.extend(row for event, row in sorted(groups[key], key=lambda pair: (
            pair[0].get('occurrenceNumber') if pair[0].get('occurrenceNumber') is not None
            else pair[0].get('sequence') if pair[0].get('sequence') is not None else float('inf'))))
    payload = {'summary': {
        'total': len(rows), 'progressReviews': sum(row['type'] == 'progress-review' for row in rows),
        'monthlyCoachingMeetings': sum(row['type'] == 'mcr' for row in rows),
        'completed': sum(row['status'] == 'completed' for row in rows),
        'upcoming': sum(row['status'] not in {'completed', 'cancelled'} for row in rows),
    }, 'reviews': rows}
    # These warnings are rendered, not diagnostics-only. No learner identity or
    # internal issue data is needed in the transport.
    if issues:
        payload['reviewGenerationIssues'] = [{'code': issue['code']} for issue in issues]
    return payload


def read_reviews(context):
    return project_reviews(*review_events(context))

