"""Projection regressions on a verified isolated SQLite database, with no network."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import StringIO
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections
from django.test.utils import CaptureQueriesContext

from coach_api.models import CoachingCalendarIndex, CoachingCalendarMeeting, CoachingRecordingJob
from coach_api import recordings_index as index
from coach_api import recordings_jobs as jobs
from coach_api.recordings_calendar import compare_coach_calendar
from coach_api.management.commands import backfill_coaching_calendar_index as backfill

OWNER = 'coach@example.invalid'
OTHER = 'other@example.invalid'
START = datetime(2026, 10, 1, tzinfo=timezone.utc)
END = datetime(2026, 11, 1, tzinfo=timezone.utc)
STAMP = datetime(2026, 10, 22, tzinfo=timezone.utc)
CONTEXT = {'owner': OWNER, 'start': START.isoformat(), 'end': END.isoformat()}
EVENT = {'id': 'meeting', 'subject': 'Original support meeting',
    'start': {'dateTime': '2026-10-20T09:00:00Z'}, 'end': {'dateTime': '2026-10-20T10:00:00Z'},
    'organizer': {'emailAddress': {'address': OWNER, 'name': 'Coach'}},
    'attendees': [{'emailAddress': {'address': 'learner@example.invalid', 'name': 'Learner'}}],
    'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/l/meetup-join/meeting'},
    'body': {'content': 'Large invitation text'}, 'unknownProviderField': {'notForCalendar': True}}


class CoachingCalendarIndexTests(TestCase):
    @classmethod
    def setUpClass(cls):
        assert settings.COACH_TEST_MODE
        assert all(config['ENGINE'] == 'django.db.backends.sqlite3' for config in settings.DATABASES.values())
        cls.alias = 'coaching_index_memory'
        config = deepcopy(connections['default'].settings_dict)
        config['NAME'] = ':memory:'
        connections.databases[cls.alias] = config
        assert connections[cls.alias].vendor == 'sqlite' and connections[cls.alias].settings_dict['NAME'] == ':memory:'
        with connections[cls.alias].schema_editor() as editor:
            for model in (CoachingRecordingJob, CoachingCalendarIndex, CoachingCalendarMeeting):
                editor.create_model(model)

    @classmethod
    def tearDownClass(cls):
        connections[cls.alias].close()
        del connections[cls.alias]
        del connections.databases[cls.alias]

    def setUp(self):
        self.addCleanup(patch.stopall)
        patch('socket.socket', side_effect=AssertionError('Live network forbidden')).start()
        patch.object(index.router, 'db_for_read', return_value=self.alias).start()
        patch.object(index.router, 'db_for_write', return_value=self.alias).start()
        patch.object(backfill, '_coaches', return_value=[{'email': OWNER}, {'email': OTHER}]).start()
        CoachingCalendarIndex.objects.all().delete()
        CoachingRecordingJob.objects.all().delete()
        self.key = jobs.job_key('calendar', CONTEXT)
        self.source = SimpleNamespace(key=self.key, owner_email=OWNER, last_success_at=STAMP)

    def publish(self, events=None):
        return index.publish_calendar_index(self.key, CONTEXT, [EVENT] if events is None else events, STAMP)

    def test_reads_only_requested_day_in_one_sql_statement_without_source_json(self):
        other_day = {**EVENT, 'id': 'other-day', 'start': {'dateTime': '2026-10-21T09:00:00Z'},
                     'end': {'dateTime': '2026-10-21T10:00:00Z'}}
        self.publish([EVENT, other_day])
        with CaptureQueriesContext(connections[self.alias]) as queries:
            result = index.indexed_calendars([self.source], datetime(2026,10,20,tzinfo=timezone.utc),
                                             datetime(2026,10,21,tzinfo=timezone.utc))
        self.assertEqual(len(queries), 1)
        self.assertNotIn('coach_test_recording_job', queries[0]['sql'])
        self.assertEqual([row['id'] for row in result[self.key]], ['meeting'])
        self.assertNotIn('body', result[self.key][0])
        self.assertNotIn('unknownProviderField', result[self.key][0])

    def test_empty_success_and_no_events_on_selected_day_are_not_missing_indexes(self):
        self.publish()
        day = datetime(2026,10,21,tzinfo=timezone.utc)
        self.assertEqual(index.indexed_calendars([self.source], day, day+timedelta(days=1)), {self.key: []})
        self.publish([])
        self.assertEqual(index.indexed_calendars([self.source], START, END), {self.key: []})
        self.assertEqual(CoachingCalendarMeeting.objects.count(), 0)

    def test_missing_old_generation_or_wrong_owner_never_claims_an_empty_calendar(self):
        self.publish()
        for changes in ({'last_success_at': STAMP+timedelta(seconds=1)}, {'owner_email': OTHER}):
            source = SimpleNamespace(**{**vars(self.source), **changes})
            self.assertEqual(index.indexed_calendars([source], START, END), {})
        self.assertEqual(index.indexed_calendars([], START, END), {})

    def test_window_coverage_is_required_and_overlapping_events_are_included(self):
        crossing = {**EVENT, 'start': {'dateTime': '2026-10-19T23:30:00Z'},
                    'end': {'dateTime': '2026-10-20T00:30:00Z'}}
        self.publish([crossing])
        self.assertEqual(len(index.indexed_calendars([self.source], datetime(2026,10,20,tzinfo=timezone.utc),
                                                    datetime(2026,10,21,tzinfo=timezone.utc))[self.key]), 1)
        self.assertEqual(index.indexed_calendars([self.source], START-timedelta(days=1), END), {})

    def test_malformed_complete_snapshot_preserves_last_successful_projection(self):
        self.publish()
        with self.assertRaises(ValueError):
            self.publish([EVENT, {**EVENT, 'id': 'bad', 'end': {}}])
        self.assertEqual(CoachingCalendarIndex.objects.get().event_count, 1)
        self.assertEqual(CoachingCalendarMeeting.objects.get().event['id'], 'meeting')

    def test_replacement_removes_deleted_occurrences_only_inside_that_snapshot(self):
        self.publish()
        other_context = {**CONTEXT, 'owner': OTHER}
        other_key = jobs.job_key('calendar', other_context)
        index.publish_calendar_index(other_key, other_context, [EVENT], STAMP)
        self.publish([])
        self.assertEqual(list(CoachingCalendarMeeting.objects.values_list('snapshot_id', flat=True)), [other_key])

    def test_duplicate_occurrences_use_existing_first_event_semantics(self):
        self.assertEqual(self.publish([EVENT, {**EVENT, 'subject': 'Duplicate'}]), 1)
        self.assertEqual(CoachingCalendarMeeting.objects.get().event['subject'], EVENT['subject'])

    def test_original_title_cancellation_matching_and_timezone_semantics_survive_projection(self):
        event = {**EVENT, 'isCancelled': True,
                 'start': {'dateTime': '2026-10-20T10:00:00', 'timeZone': 'GMT Standard Time'},
                 'end': {'dateTime': '2026-10-20T11:00:00', 'timeZone': 'GMT Standard Time'}}
        learners = [{'id': 1, 'email': 'learner@example.invalid'}]
        before = compare_coach_calendar([event], [], learners, coach_email=OWNER, start=START, end=END, now=STAMP)
        self.publish([event])
        events = index.indexed_calendars([self.source], START, END)[self.key]
        after = compare_coach_calendar(events, [], learners, coach_email=OWNER, start=START, end=END, now=STAMP)
        self.assertEqual(after, before)

    def make_source(self, **changes):
        return CoachingRecordingJob.objects.create(key=self.key, kind='calendar', owner_email=OWNER,
            context=CONTEXT, result={'events': [EVENT]}, last_success_at=STAMP, **changes)

    def test_backfill_dry_run_does_not_write_or_change_source_jobs(self):
        self.make_source()
        output = StringIO()
        call_command('backfill_coaching_calendar_index', coach_email=OWNER, start='2026-10-01', end='2026-10-31',
                     dry_run=True, stdout=output)
        self.assertIn('1 saved calendar windows', output.getvalue())
        self.assertFalse(CoachingCalendarIndex.objects.exists())
        self.assertEqual(CoachingRecordingJob.objects.get().result, {'events': [EVENT]})

    def test_backfill_uses_saved_current_generation_and_repeated_runs_are_idempotent(self):
        self.make_source()
        for _ in range(2):
            call_command('backfill_coaching_calendar_index', coach_email=OWNER, start='2026-10-01',
                         end='2026-10-31', stdout=StringIO())
        self.assertEqual(CoachingCalendarIndex.objects.count(), 1)
        self.assertEqual(CoachingCalendarMeeting.objects.count(), 1)
        self.assertEqual(CoachingRecordingJob.objects.get().last_success_at, STAMP)

    def test_backfill_requires_scope_and_rejects_unregistered_coaches_before_writes(self):
        for options in ({}, {'coach_email': 'missing@example.invalid'}):
            with self.assertRaises(CommandError):
                backfill.Command().handle(start='2026-10-01', end='2026-10-31', time_zone='UTC',
                                          limit=100, dry_run=False, **options)
        self.assertFalse(CoachingCalendarIndex.objects.exists())

    def test_backfill_limit_rejects_the_whole_pass_before_writes(self):
        self.make_source()
        other_context = {**CONTEXT, 'owner': OTHER}
        CoachingRecordingJob.objects.create(key=jobs.job_key('calendar', other_context), kind='calendar',
            owner_email=OTHER, context=other_context, result={'events': [EVENT]}, last_success_at=STAMP)
        with self.assertRaisesRegex(CommandError, 'exceed the limit'):
            call_command('backfill_coaching_calendar_index', all_coaches=True, start='2026-10-01',
                         end='2026-10-31', limit=1, stdout=StringIO())
        self.assertFalse(CoachingCalendarIndex.objects.exists())

    def test_backfill_owner_mismatch_does_not_replace_existing_projection(self):
        self.publish()
        self.make_source()
        CoachingRecordingJob.objects.update(context={**CONTEXT, 'owner': OTHER})
        with self.assertRaisesRegex(CommandError, 'owner mismatch'):
            call_command('backfill_coaching_calendar_index', coach_email=OWNER, start='2026-10-01',
                         end='2026-10-31', stdout=StringIO())
        self.assertEqual(CoachingCalendarMeeting.objects.get().event['id'], EVENT['id'])
