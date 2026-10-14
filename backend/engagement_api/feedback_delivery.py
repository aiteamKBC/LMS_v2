"""Idempotent attendance-to-feedback delivery and reconciliation."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone as datetime_timezone

from django.db import connection, transaction
from django.utils import timezone

from learner_api.models import EnrolmentUser

from .models import FeedbackDelivery, FeedbackDeliveryRecipient, FeedbackForm


@dataclass(frozen=True)
class LectureOccurrence:
    key: str
    module_catalogue_id: str
    programme_id: str = ''
    programme_name: str = ''
    cohort_id: str = ''
    cohort_name: str = ''
    group_id: str = ''
    group_name: str = ''
    module_name: str = ''
    title: str = ''
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    attendance_source: str = 'attendance'
    attendance_reference: str = ''


@dataclass(frozen=True)
class Attendee:
    learner_id: str
    attendance_reference: str = ''
    learner_name: str = ''
    programme: str = ''


def _required(value, label):
    cleaned = str(value or '').strip()
    if not cleaned:
        raise ValueError(f'{label} is required.')
    return cleaned


def _form_for_occurrence(occurrence_key, module_id):
    """Pin an existing lecture to its original version, otherwise choose one current template."""
    existing = FeedbackDelivery.objects.select_related('form').filter(
        occurrence_key=occurrence_key,
    ).first()
    if existing:
        return existing.form
    available = FeedbackForm.objects.filter(
        form_type='post_lecture', status='published', is_current=True,
    )
    return (
        available.filter(delivery_scope='module', module_catalogue_id=module_id).order_by('-version', '-id').first()
        or available.filter(delivery_scope='all_modules').order_by('-version', '-id').first()
    )


def sync_post_lecture_feedback(occurrence, attendees, *, attendance_finalized=False):
    """Create delivery recipients for published templates matching a lecture.

    ``attendance_finalized`` must be explicit so a partial/importing register
    cannot expose feedback early. Missing learner IDs are reported to the
    caller and never create orphan recipients. A corrected finalized register
    revokes removed recipients but keeps their historical responses intact.
    """
    if not attendance_finalized:
        raise ValueError('Attendance must be finalized before feedback is delivered.')
    occurrence_key = _required(occurrence.key, 'Occurrence key')
    module_id = _required(occurrence.module_catalogue_id, 'Module catalogue ID')
    for moment in (occurrence.starts_at, occurrence.ends_at):
        if moment is not None and timezone.is_naive(moment):
            raise ValueError('Lecture dates must include a timezone.')
    attendees = list(attendees)
    attendee_ids = list(dict.fromkeys(_required(item.learner_id, 'Learner ID') for item in attendees))
    attendees_by_id = {str(item.learner_id).strip(): item for item in attendees}
    learners = {
        str(item.id): item
        for item in EnrolmentUser.all_learners.filter(id__in=attendee_ids)
    }
    missing = [learner_id for learner_id in attendee_ids if learner_id not in learners]
    form = _form_for_occurrence(occurrence_key, module_id)
    forms = [form] if form else []
    available_at = occurrence.ends_at or occurrence.starts_at or timezone.now()
    deliveries = []
    recipient_count = 0
    revoked_count = 0
    with transaction.atomic():
        for form in forms:
            delivery, _ = FeedbackDelivery.objects.update_or_create(
                occurrence_key=occurrence_key,
                defaults={
                    'form': form,
                    'attendance_source': _required(occurrence.attendance_source, 'Attendance source'),
                    'attendance_reference': str(occurrence.attendance_reference or '').strip(),
                    'programme_id': str(occurrence.programme_id or '').strip(),
                    'programme_name': str(occurrence.programme_name or '').strip(),
                    'cohort_id': str(occurrence.cohort_id or '').strip(),
                    'cohort_name': str(occurrence.cohort_name or '').strip(),
                    'group_id': str(occurrence.group_id or '').strip(),
                    'group_name': str(occurrence.group_name or '').strip(),
                    'module_catalogue_id': module_id,
                    'module_name': str(occurrence.module_name or '').strip(),
                    'session_title': str(occurrence.title or '').strip(),
                    'starts_at': occurrence.starts_at,
                    'ends_at': occurrence.ends_at,
                    'available_at': available_at,
                    'status': 'open',
                },
            )
            deliveries.append(delivery.id)
            revoked_count += FeedbackDeliveryRecipient.objects.filter(
                delivery=delivery, revoked_at__isnull=True,
            ).exclude(learner_id__in=learners).update(revoked_at=timezone.now())
            for learner_id, learner in learners.items():
                attendee = attendees_by_id[learner_id]
                FeedbackDeliveryRecipient.objects.update_or_create(
                    delivery=delivery, learner_id=learner_id,
                    defaults={
                        'learner_name': attendee.learner_name or learner.username or learner.email or f'Learner {learner_id}',
                        'programme': attendee.programme or learner.programme or '',
                        'attendance_reference': str(attendee.attendance_reference or '').strip(),
                        'due_date': form.due_date,
                        'revoked_at': None,
                    },
                )
                recipient_count += 1
    return {
        'deliveryIds': deliveries,
        'formsMatched': len(forms),
        'recipientsMatched': recipient_count,
        'recipientsRevoked': revoked_count,
        'missingLearnerIds': missing,
    }


def _aware_utc(value):
    """Curriculum stores Teams instants as naive UTC timestamps."""
    if value is None or timezone.is_aware(value):
        return value
    return timezone.make_aware(value, datetime_timezone.utc)


def sync_post_lecture_feedback_from_attendance(*, live_session_ids=None, occurrence_ids=None):
    """Reconcile finalized curriculum attendance into feedback deliveries.

    Only ``present`` rows qualify. An occurrence is final when the same
    conditions used by Curriculum's saved-results UI are true: the meeting has
    an actual end and a non-empty attendance report. Re-running this function
    is safe and also revokes recipients whose finalized status changed.
    """
    live_session_ids = list(dict.fromkeys(str(value).strip() for value in (live_session_ids or []) if str(value).strip()))
    occurrence_ids = list(dict.fromkeys(str(value).strip() for value in (occurrence_ids or []) if str(value).strip()))
    filters = []
    params = []
    if live_session_ids:
        filters.append('o.live_session_id = ANY(%s)')
        params.append(live_session_ids)
    if occurrence_ids:
        filters.append('o.id = ANY(%s)')
        params.append(occurrence_ids)
    scope = ''.join(f' AND {item}' for item in filters)
    with connection.cursor() as cursor:
        cursor.execute('''
            WITH unique_learners AS (
                SELECT lower(btrim("Email")) AS email_key, min(id) AS learner_id
                  FROM enrolment."Created_users"
                 WHERE coalesce(btrim("Email"), '') <> ''
                 GROUP BY lower(btrim("Email"))
                HAVING count(*) = 1
            )
            SELECT a.occurrence_id,
                   a.module_catalogue_id,
                   coalesce(nullif(m.title, ''), nullif(s.module_title, ''), a.module_catalogue_id) AS module_title,
                   coalesce(p.programme_id::text, '') AS programme_id,
                   coalesce(nullif(p.name, ''), m.programme_name, '') AS programme_name,
                   coalesce(c.cohort_id::text, '') AS cohort_id,
                   coalesce(c.cohort_name, '') AS cohort_name,
                   coalesce(g.group_id::text, '') AS group_id,
                   coalesce(g.group_name, '') AS group_name,
                   o.session_number,
                   o.scheduled_start,
                   coalesce(o.actual_end, o.scheduled_end) AS session_end,
                   o.attendance_report_id,
                   a.id AS attendance_id,
                   a.learner_name,
                   lower(btrim(a.attendance_status)) AS attendance_status,
                   u.learner_id
              FROM curriculum.live_session_learner_attendance a
              JOIN curriculum.live_session_occurrences o ON o.id = a.occurrence_id
              JOIN curriculum.live_sessions s ON s.id = o.live_session_id
         LEFT JOIN curriculum.modules m ON m.module_catalogue_id = a.module_catalogue_id
         LEFT JOIN curriculum.groups g ON g.group_id = m.group_id
         LEFT JOIN curriculum.cohorts c ON c.cohort_id = g.cohort_id
         LEFT JOIN curriculum.programmes p ON p.programme_id = c.programme_id
         LEFT JOIN unique_learners u ON u.email_key = lower(btrim(a.learner_email))
             WHERE lower(btrim(o.status)) = 'completed'
               AND o.actual_end IS NOT NULL
               AND coalesce(btrim(o.attendance_report_id), '') <> ''
        ''' + scope + '''
          ORDER BY a.occurrence_id, a.id
        ''', params)
        columns = [item[0] for item in cursor.description]
        rows = [dict(zip(columns, values)) for values in cursor.fetchall()]

    grouped = {}
    unmatched = 0
    for row in rows:
        bucket = grouped.setdefault(row['occurrence_id'], {'row': row, 'attendees': []})
        if row['attendance_status'] != 'present':
            continue
        if row['learner_id'] is None:
            unmatched += 1
            continue
        bucket['attendees'].append(Attendee(
            learner_id=str(row['learner_id']),
            attendance_reference=str(row['attendance_id']),
            learner_name=str(row['learner_name'] or '').strip(),
            programme=str(row['programme_name'] or '').strip(),
        ))

    results = []
    for occurrence_id, bucket in grouped.items():
        row = bucket['row']
        title = str(row['module_title'] or '').strip()
        if row['session_number']:
            title = f'{title} - Session {row["session_number"]}'
        results.append(sync_post_lecture_feedback(
            LectureOccurrence(
                key=occurrence_id,
                module_catalogue_id=row['module_catalogue_id'],
                programme_id=row['programme_id'],
                programme_name=row['programme_name'],
                cohort_id=row['cohort_id'],
                cohort_name=row['cohort_name'],
                group_id=row['group_id'],
                group_name=row['group_name'],
                module_name=row['module_title'],
                title=title,
                starts_at=_aware_utc(row['scheduled_start']),
                ends_at=_aware_utc(row['session_end']),
                attendance_source='curriculum.live_session_learner_attendance',
                attendance_reference=str(row['attendance_report_id'] or '').strip(),
            ),
            bucket['attendees'],
            attendance_finalized=True,
        ))

    return {
        'rowsScanned': len(rows),
        'occurrencesProcessed': len(results),
        'formsMatched': sum(item['formsMatched'] for item in results),
        'recipientsMatched': sum(item['recipientsMatched'] for item in results),
        'recipientsRevoked': sum(item['recipientsRevoked'] for item in results),
        'unmatchedPresentAttendees': unmatched,
        'deliveryIds': [delivery_id for item in results for delivery_id in item['deliveryIds']],
    }
