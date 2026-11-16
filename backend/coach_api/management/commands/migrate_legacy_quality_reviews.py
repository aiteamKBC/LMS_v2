"""Copy unlinked legacy quality responses into the canonical lms_quality store.

This command is deliberately dry-run by default.  The old response JSON is
kept verbatim under ``legacyResponses``; it is not silently guessed into the
new form criteria.  That makes the migration lossless and auditable while the
new review workspace becomes the only writer.
"""
from datetime import datetime, time, timedelta
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from coach_api.models import CoachCalendarEvent
from coach_api.quality_form_definition import default_definition
from coach_api.quality_review_store import connect, digest, ReviewUnavailable


LONDON = ZoneInfo('Europe/London')
LEGACY_TYPES = {'mcr': 'MCM', 'progress-review': 'PR'}


def _starts(event):
    day = event.scheduled_date or event.target_date
    at = event.scheduled_time or time.min
    return timezone.make_aware(datetime.combine(day, at), LONDON)


def _snapshot(event):
    kind = LEGACY_TYPES[event.event_type]
    starts = _starts(event)
    ends = starts + timedelta(minutes=max(int(event.duration_minutes or 60), 1))
    identity = digest(['legacy-quality', event.event_key])
    review_id = uuid5(NAMESPACE_URL, identity)
    status = 'completed' if event.review_completed_at or event.status in {
        CoachCalendarEvent.STATUS_COMPLETED,
        CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
    } else 'draft'
    definition = default_definition(kind)
    payload = {
        'id': str(review_id),
        'identity': identity,
        'version': 1,
        'status': status,
        'scope': 'coaching',
        'reviewType': kind,
        'legacyImported': True,
        'legacySource': {'eventKey': event.event_key, 'eventType': event.event_type},
        'coach': {'email': event.owner_email or '', 'name': event.owner_name or ''},
        'learner': {'id': str(event.learner_profile_id), 'name': event.learner_name or '',
                    'email': event.learner_email or ''},
        'meeting': {'id': event.event_key, 'eventId': event.event_key,
                    'title': event.notes or kind, 'startsAt': starts.isoformat(),
                    'endsAt': ends.isoformat()},
        'definition': definition,
        'form': {'header': {'activityDate': starts.date().isoformat()},
                 'criteria': {}, 'actions': [], 'images': {}, 'sources': {}},
        'legacyResponses': event.review_responses or {},
        'createdAt': (event.created_at or starts).isoformat(),
        'updatedAt': (event.updated_at or starts).isoformat(),
    }
    return review_id, identity, starts, ends, payload


class Command(BaseCommand):
    help = 'Migrate unlinked Coach calendar quality responses into lms_quality (dry-run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument('--expected-project', required=True)
        parser.add_argument('--expected-branch', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        events = [event for event in CoachCalendarEvent.objects.filter(
            event_type__in=LEGACY_TYPES).filter(review_instance_id='').iterator()
                   if isinstance(event.review_responses, dict) and event.review_responses]
        if not events:
            self.stdout.write('No unlinked legacy quality responses found.')
            return
        if not options['apply']:
            self.stdout.write(f'Dry run: {len(events)} legacy quality response(s) would be copied.')
            return
        try:
            with connect(write=True) as connection:
                from psycopg.types.json import Jsonb
                target = connection.execute(
                    "SELECT current_setting('neon.project_id',true) AS project, "
                    "current_setting('neon.branch_id',true) AS branch"
                ).fetchone()
                if target != {'project': options['expected_project'], 'branch': options['expected_branch']}:
                    raise CommandError('The configured Coaching Session database is not the explicitly selected target.')
                connection.execute('SELECT pg_advisory_xact_lock(1346525001, 5)')
                inserted = 0
                for event in events:
                    review_id, identity, starts, ends, payload = _snapshot(event)
                    actor = 'migration:legacy-quality'
                    request_id = uuid5(NAMESPACE_URL, f'{identity}:revision:1')
                    result = connection.execute('''
                        INSERT INTO lms_quality.review
                          (id,identity,coach_email,learner_id,learner_name,starts_at,ends_at,status,version,payload,updated_by)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s)
                        ON CONFLICT(identity) DO NOTHING
                    ''', [str(review_id), identity, event.owner_email, str(event.learner_profile_id),
                          event.learner_name or '', starts, ends, payload['status'], Jsonb(payload), actor])
                    if result.rowcount:
                        connection.execute('''
                            INSERT INTO lms_quality.revision
                              (review_id,version,request_id,request_hash,actor,payload)
                            VALUES (%s,1,%s,%s,%s,%s)
                            ON CONFLICT(review_id,version) DO NOTHING
                        ''', [str(review_id), str(request_id), digest([payload, 0, actor]), actor, Jsonb(payload)])
                        inserted += 1
                self.stdout.write(f'Migrated {inserted} of {len(events)} legacy quality response(s).')
        except ReviewUnavailable as error:
            raise CommandError(str(error)) from None
