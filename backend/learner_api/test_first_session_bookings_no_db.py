"""Run with ``python -I backend/learner_api/test_first_session_bookings_no_db.py``.

No database, network or project settings: Django is configured in memory, the
querysets are mocked and socket access is rejected.
"""
import json
import sys
import unittest
from datetime import date, datetime, time, timezone as dt_timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure(
        INSTALLED_APPS=['django.contrib.contenttypes', 'django.contrib.auth', 'login', 'learner_api', 'coach_api'],
        DATABASES={
            'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'},
            'enrolment': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'},
        },
        SECRET_KEY='isolated-test', USE_TZ=True, TIME_ZONE='UTC', DEFAULT_CHARSET='utf-8',
    )
import django
django.setup()
from django.test import RequestFactory
from learner_api import first_session_bookings as views

Event = views.CoachCalendarEvent


def event(pk=1, **overrides):
    values = dict(
        pk=pk, learner_id=10, learner_name='Example Learner', learner_email='learner@example.org',
        owner_name='Example Owner', owner_email='owner@example.org',
        scheduled_date=date(2026, 10, 6), scheduled_time=time(10, 0), duration_minutes=60,
        meeting_link='https://teams.example.org/join/1', status=Event.STATUS_SCHEDULED,
        sync_state=Event.SYNC_SYNCED, created_at=datetime(2026, 9, 20, 9, 30, tzinfo=dt_timezone.utc),
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def learner(pk, email, **overrides):
    values = dict(id=pk, username=f'Learner {pk}', email=email, programme='Example Programme', case_owner='Recorded Owner',
                  learner_type='apprenticeship')
    values.update(overrides)
    return SimpleNamespace(**values)


class Queryset(list):
    """Enough of a queryset for the chained calls the module makes."""

    def only(self, *args):
        return self

    def order_by(self, *args):
        return self

    def filter(self, *args, **kwargs):
        return self

    def annotate(self, *args, **kwargs):
        return self


class Base(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.create_connection'):
            blocker = patch(target, side_effect=AssertionError('Network access is forbidden'))
            blocker.start()
            self.addCleanup(blocker.stop)

    def mock_tables(self, *, events=(), profiles=(), by_id=(), by_email=()):
        coach = MagicMock()
        coach.objects.filter.return_value = Queryset(events)
        profile = MagicMock()
        profile.objects.filter.return_value = Queryset(profiles)
        enrolment = MagicMock()
        enrolment.all_learners.filter.return_value = Queryset(by_id)
        enrolment.all_learners.annotate.return_value = Queryset(by_email)
        for name, value in (('CoachCalendarEvent', coach), ('LearnerProfile', profile), ('EnrolmentUser', enrolment)):
            patcher = patch.object(views, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        return coach, profile, enrolment


class AccessTests(Base):
    def call(self, role, accesses, method='get'):
        request = getattr(RequestFactory(), method)('/learner_api/first-session-bookings/')
        account = SimpleNamespace(role=role) if role else None
        with patch('login.permissions.authenticate_request', return_value=account), \
                patch('login.permissions._accesses_of', return_value=frozenset(accesses)):
            return views.first_session_bookings(request)

    def test_refused_callers_never_reach_the_calendar(self):
        coach, _, _ = self.mock_tables()
        cases = [(None, [], 401), ('learner', ['enrolment'], 403), ('employer', ['enrolment'], 403),
                 ('staff', ['coach'], 403), ('staff', ['curriculum'], 403), ('staff', [], 403), ('admin', [], 403)]
        for role, grants, expected in cases:
            with self.subTest(role=role, grants=grants):
                self.assertEqual(self.call(role, grants).status_code, expected)
        coach.objects.filter.assert_not_called()

    def test_enrolment_and_super_admin_can_read(self):
        coach, _, _ = self.mock_tables(events=[event()], by_id=[learner(10, 'learner@example.org')])
        for role, grants in (('staff', ['enrolment']), ('admin', ['super-admin']), ('staff', ['coach', 'enrolment'])):
            with self.subTest(role=role, grants=grants):
                response = self.call(role, grants)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content)['count'], 1)
        coach.objects.filter.assert_called_with(event_type='first-session')

    def test_read_only(self):
        self.mock_tables()
        for method in ('post', 'put', 'patch', 'delete'):
            with self.subTest(method=method):
                self.assertEqual(self.call('staff', ['enrolment'], method).status_code, 405)

    def test_database_failure_is_reported_not_emptied(self):
        coach, _, _ = self.mock_tables()
        coach.objects.filter.side_effect = views.DatabaseError('boom')
        with self.assertLogs(views.logger, 'ERROR'):
            response = self.call('staff', ['enrolment'])
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('boom', response.content.decode())


class StateTests(unittest.TestCase):
    def test_states(self):
        cases = [
            ((Event.STATUS_CANCELLED, Event.SYNC_SYNCED), 'cancelled'),
            ((Event.STATUS_NOT_SCHEDULED, Event.SYNC_CANCELLED), 'cancelled'),
            ((Event.STATUS_COMPLETED, Event.SYNC_FAILED), 'completed'),
            ((Event.STATUS_SCHEDULED, Event.SYNC_FAILED), 'sync-failed'),
            ((Event.STATUS_SCHEDULED, Event.SYNC_RECONCILIATION), 'needs-reconciliation'),
            ((Event.STATUS_SCHEDULED, Event.SYNC_PENDING), 'sync-pending'),
            ((Event.STATUS_SCHEDULED, Event.SYNC_SYNCING), 'sync-pending'),
            ((Event.STATUS_NOT_SCHEDULED, Event.SYNC_SYNCED), 'requested'),
            ((Event.STATUS_SCHEDULED, Event.SYNC_SYNCED), 'scheduled'),
            ((Event.STATUS_AWAITING_SIGNATURE, Event.SYNC_SYNCED), 'awaiting-signature'),
        ]
        for (status, sync), expected in cases:
            with self.subTest(status=status, sync=sync):
                self.assertEqual(views.booking_state(event(status=status, sync_state=sync)), expected)


class LearnerResolutionTests(Base):
    def test_enrolment_id_with_matching_email(self):
        own = learner(10, 'Learner@Example.org ')
        self.mock_tables(by_id=[own])
        self.assertIs(views.resolve_learners([event()])[1], own)

    def test_profile_id_collision_resolves_by_email(self):
        # Calendar id 42 is a learner-profile id; enrolment row 42 is somebody else.
        stranger = learner(42, 'someone-else@example.org')
        target = learner(7, 'learner@example.org')
        profile = SimpleNamespace(id=42, email='learner@example.org', enrolment_id=7)
        self.mock_tables(profiles=[profile], by_id=[stranger, target])
        self.assertIs(views.resolve_learners([event(learner_id=42)])[1], target)

    def test_email_fallback_and_unmatched(self):
        target = learner(8, 'learner@example.org')
        self.mock_tables(by_id=[learner(99, 'other@example.org')], by_email=[target])
        resolved = views.resolve_learners([event(learner_id=99), event(pk=2, learner_id=5, learner_email='nobody@example.org')])
        self.assertIs(resolved[1], target)
        self.assertIsNone(resolved[2])


class SerializeTests(unittest.TestCase):
    def test_row(self):
        row = views.serialize_booking(event(), learner(10, 'learner@example.org'))
        self.assertEqual(row, {
            'id': 1, 'learnerId': 10, 'source': 'apprenticeship', 'learnerName': 'Learner 10', 'learnerEmail': 'learner@example.org',
            'programme': 'Example Programme',
            'caseOwner': {'name': 'Example Owner', 'email': 'owner@example.org'},
            'bookedAt': '2026-09-20T09:30:00+00:00', 'bookedDate': '2026-09-20',
            'sessionDate': '2026-10-06', 'sessionTime': '10:00', 'durationMinutes': 60,
            'meetingLink': 'https://teams.example.org/join/1',
            'state': 'scheduled', 'status': 'scheduled', 'syncState': 'synced',
        })

    def test_booked_date_is_the_uk_day(self):
        # 23:30 UTC on 30 June is 00:30 BST on 1 July.
        row = views.serialize_booking(event(created_at=datetime(2026, 6, 30, 23, 30, tzinfo=dt_timezone.utc)), None)
        self.assertEqual(row['bookedDate'], '2026-07-01')

    def test_unmatched_learner_keeps_calendar_identity(self):
        row = views.serialize_booking(event(owner_name='', meeting_link='', scheduled_time=None), None)
        self.assertIsNone(row['learnerId'])
        self.assertIsNone(row['source'])
        self.assertEqual((row['learnerName'], row['learnerEmail'], row['programme']), ('Example Learner', 'learner@example.org', ''))
        self.assertEqual(row['caseOwner'], {'name': '', 'email': 'owner@example.org'})
        self.assertEqual((row['meetingLink'], row['sessionTime']), ('', None))

    def test_commercial_learner_opens_the_commercial_board(self):
        row = views.serialize_booking(event(), learner(10, 'learner@example.org', learner_type='commercial'))
        self.assertEqual(row['source'], 'commercial')

    def test_owner_name_falls_back_to_recorded_case_owner(self):
        row = views.serialize_booking(event(owner_name=''), learner(10, 'learner@example.org'))
        self.assertEqual(row['caseOwner']['name'], 'Recorded Owner')


if __name__ == '__main__':
    unittest.main()
