"""Teams calendar integrity -- restoration, classification, lifecycle, audit. No database, no network.

Run directly: ``python -B backend/curriculum_api/test_calendar_integrity_no_db.py``.

The incident these pin: Week 3 of a weekly module fell out of its recurring
Teams series when the plan briefly dropped to 11 sessions. When the plan went
back to 12, the save quietly created a standalone meeting with a new join link
for that week, learners split across two rooms, and a Teams run on that new
link marked the not-yet-delivered session Completed.

What must hold now:

* A save never creates a meeting for a session missing from the series. It
  reports it, and only an explicit, confirmed resolution may create one --
  once, however often it is retried.
* A legitimate Additional Week Meeting is never a "link conflict".
* A Teams run that ended before a session was due never completes it.
* Attribution is recorded when known and shown as unknown when not -- never
  invented.
"""
import sys
import types
import unittest
import urllib.parse as urllib_parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
sys.path.insert(0, str(ROOT))

from test_occurrence_deletion_no_db import FakeGraph, at, instance, load, row, target  # noqa: E402

from curriculum_api import teams_calendar_integrity as integrity  # noqa: E402
from curriculum_api import versioning  # noqa: E402

UTC = timezone.utc
MAIN_JOIN = 'https://teams.microsoft.com/l/meetup-join/synthetic-main'
SEPARATE_JOIN = 'https://teams.microsoft.com/l/meetup-join/synthetic-separate'
EXTRA_JOIN = 'https://teams.microsoft.com/l/meetup-join/synthetic-additional'
NOW = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)


def weekly(count, first=(9, 17)):
    start = at(first)
    return [start + timedelta(weeks=index) for index in range(count)]


def destructive(calls):
    return [call for call in calls if call[0] == 'DELETE' or str(call[1]).rstrip('/').endswith('/cancel')]


def creates(calls):
    return [call for call in calls if call[0] == 'POST']


class ShiftHarness(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.v = load()

    def shift(self, graph, targets, stored=None, missing=None):
        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = graph
        with patch.dict('sys.modules', {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport}):
            return self.v.apply_teams_occurrence_shifts(
                'organizer%40example.invalid', 'series-1', 'Synthetic module', targets,
                ['learner@example.invalid'], {'organizer': 'organizer@example.invalid'}, stored, missing=missing,
            )


class RecurringRestorationTests(ShiftHarness):
    def test_normal_twelve_week_series_reports_nothing_and_writes_nothing(self):
        starts = weekly(12)
        graph = FakeGraph([instance(f'occ-{i}', start) for i, start in enumerate(starts, 1)])
        missing = []
        warnings, recreated, _stale = self.shift(graph, [target(i, s) for i, s in enumerate(starts, 1)],
                                                 [row(i, s) for i, s in enumerate(starts, 1)], missing)
        self.assertEqual((warnings, recreated, missing), ([], [], []))
        self.assertEqual([call for call in graph.calls if call[0] != 'GET'], [])

    def test_restored_session_missing_from_series_is_reported_not_recreated(self):
        """The incident: 12 planned, Microsoft holds 11 -- week 3 was deleted while the plan had 11."""
        starts = weekly(12)
        present = [instance(f'occ-{i}', start) for i, start in enumerate(starts, 1) if i != 3]
        graph = FakeGraph(present)
        missing = []
        warnings, recreated, _stale = self.shift(graph, [target(i, s) for i, s in enumerate(starts, 1)],
                                                 [row(i, s) for i, s in enumerate(starts, 1) if i != 3], missing)
        self.assertEqual(warnings, [])
        self.assertEqual(recreated, [])
        self.assertEqual(creates(graph.calls), [], 'a save must never create a separate meeting')
        self.assertEqual(destructive(graph.calls), [])
        self.assertEqual([item['sessionNumber'] for item in missing], [3])
        self.assertEqual(integrity.minute_key(missing[0]['startDateTimeUtc']), integrity.minute_key(starts[2]))

    def test_repeated_restoration_never_creates_a_meeting(self):
        starts = weekly(12)
        graph = FakeGraph([instance(f'occ-{i}', start) for i, start in enumerate(starts, 1) if i != 3])
        targets = [target(i, s) for i, s in enumerate(starts, 1)]
        for _attempt in range(3):
            missing = []
            self.shift(graph, targets, [row(i, s) for i, s in enumerate(starts, 1)], missing)
            self.assertEqual([item['sessionNumber'] for item in missing], [3])
        self.assertEqual(creates(graph.calls), [])

    def test_existing_standalone_replacement_is_kept_not_recreated(self):
        starts = weekly(4)
        graph = FakeGraph([instance(f'occ-{i}', start) for i, start in enumerate(starts, 1) if i != 3])
        standalone = {**instance('standalone-3', starts[2]), 'onlineMeeting': {'joinUrl': SEPARATE_JOIN}}
        original_call = graph.__call__

        def graph_with_standalone(method, path, payload=None, extra_headers=None):
            if method == 'GET' and path.endswith('standalone-3'):
                graph.calls.append((method, path, payload, extra_headers))
                return dict(standalone)
            return original_call(method, path, payload, extra_headers)

        stored = [row(i, s) for i, s in enumerate(starts, 1)]
        stored[2] = {**stored[2], 'graph_event_id': 'standalone-3', 'join_url': SEPARATE_JOIN}
        missing = []
        warnings, recreated, _stale = self.shift(graph_with_standalone, [target(i, s) for i, s in enumerate(starts, 1)],
                                                 stored, missing)
        self.assertEqual(warnings, [])
        self.assertEqual(missing, [])
        # The existing replacement is read and kept (the loader stubs its option refresh).
        self.assertEqual(len(recreated), 1)
        self.assertTrue(any(call[0] == 'GET' and call[1].endswith('standalone-3') for call in graph.calls))
        self.assertEqual(creates(graph.calls), [])

    def test_existing_exception_is_still_paired_by_day(self):
        """A moved occurrence (an exception) keeps its place; nothing is missing."""
        starts = weekly(4)
        moved = starts[1] + timedelta(hours=1)
        graph = FakeGraph([instance('occ-1', starts[0]), instance('occ-2', moved),
                           instance('occ-3', starts[2]), instance('occ-4', starts[3])])
        missing = []
        warnings, _recreated, _stale = self.shift(graph, [target(i, s) for i, s in enumerate(starts, 1)],
                                                  [row(i, s) for i, s in enumerate(starts, 1)], missing)
        self.assertEqual((warnings, missing), ([], []))
        self.assertEqual(creates(graph.calls), [])
        self.assertEqual(destructive(graph.calls), [])

    def test_shift_never_cancels_or_deletes_even_with_extra_occurrences(self):
        starts = weekly(5)
        graph = FakeGraph([instance(f'occ-{i}', start) for i, start in enumerate(starts, 1)])
        self.shift(graph, [target(i, s) for i, s in enumerate(starts[:3], 1)], [row(i, s) for i, s in enumerate(starts[:3], 1)], [])
        self.assertEqual(destructive(graph.calls), [])

    def test_no_caller_list_still_never_creates(self):
        """Callers that do not ask for the missing list (the weekday path) get no meeting either."""
        starts = weekly(3)
        graph = FakeGraph([instance('occ-1', starts[0]), instance('occ-3', starts[2])])
        warnings, recreated, _stale = self.shift(graph, [target(i, s) for i, s in enumerate(starts, 1)], None, None)
        self.assertEqual((warnings, recreated), ([], []))
        self.assertEqual(creates(graph.calls), [])

    def test_verification_skips_only_the_reported_sessions(self):
        targets = [target(i, s) for i, s in enumerate(weekly(4), 1)]
        kept = integrity.without_missing(targets, [{'sessionNumber': 2}])
        self.assertEqual([item['session_number'] for item in kept], [1, 3, 4])
        self.assertEqual(integrity.without_missing(targets, []), targets)


# ------------------------------------------------------------------ fixtures

def series_row(**extra):
    return {'id': 'LIVE-MAIN', 'status': 'active', 'module_catalogue_id': 'MOD-1', 'module_title': 'Synthetic - Thur',
            'graph_event_id': 'series-1', 'join_url': MAIN_JOIN, 'online_meeting_id': 'meeting-main',
            'organizer_email': 'organizer@example.invalid', **extra}


def occurrence(number, start, **extra):
    base = {'id': f'OCC-{number}', 'live_session_id': 'LIVE-MAIN', 'session_number': number,
            'scheduled_start': start.replace(tzinfo=None), 'scheduled_end': (start + timedelta(hours=2)).replace(tzinfo=None),
            'graph_event_id': 'series-1', 'join_url': MAIN_JOIN, 'online_meeting_id': '', 'status': 'scheduled',
            'attendance_report_id': '', 'actual_start': None, 'actual_end': None, 'participant_count': 0}
    base.update(extra)
    return base


def snapshot_for(rows):
    return {'occurrences': {item['id']: {'dates': [integrity.iso(item['scheduled_start']), integrity.iso(item['scheduled_end'])]}
                            for item in rows}}


def incident_calendar():
    """Martech-like: 12 weeks from 17 Sep; week 3 on a separate meeting, completed by a run on 26 Sep."""
    starts = [datetime(2026, 9, 17, 17, 0, tzinfo=UTC) + timedelta(weeks=index) for index in range(12)]
    rows = [occurrence(i, start) for i, start in enumerate(starts, 1)]
    rows[2] = occurrence(3, starts[2], graph_event_id='standalone-3', join_url=SEPARATE_JOIN,
                         online_meeting_id='meeting-separate', status='completed', attendance_report_id='report-x',
                         actual_start=datetime(2026, 9, 26, 11, 5), actual_end=datetime(2026, 9, 26, 11, 9))
    extra_series = {'id': 'LIVE-EXTRA', 'status': 'week-meeting', 'module_catalogue_id': 'MOD-1',
                    'module_title': 'Guest speaker', 'graph_event_id': 'extra-1', 'join_url': EXTRA_JOIN}
    extra_rows = [{**occurrence(1, starts[5] + timedelta(days=1)), 'id': 'OCC-X1', 'live_session_id': 'LIVE-EXTRA',
                   'graph_event_id': 'extra-1', 'join_url': EXTRA_JOIN}]
    return series_row(), rows, [(extra_series, extra_rows)]


def health(series, rows, additional=(), events=(), snapshot=None, checked_at=NOW - timedelta(hours=1), now=NOW):
    return integrity.build_health(series, rows, list(additional), {'title': 'Synthetic - Thur'}, events=list(events),
                                  snapshot=snapshot if snapshot is not None else snapshot_for(rows),
                                  checked_at=checked_at, now=now)


class ClassificationTests(unittest.TestCase):
    def test_incident_counts_and_status(self):
        series, rows, additional = incident_calendar()
        result = health(series, rows, additional)
        counts = result['summary']['counts']
        self.assertEqual(counts['plannedSessions'], 12)
        self.assertEqual(counts['mainSeries'], 11)
        self.assertEqual(counts['standaloneReplacements'], 1)
        self.assertEqual(counts['additionalMeetings'], 1)
        self.assertEqual(counts['linkConflicts'], 1)
        self.assertEqual(counts['lifecycleIssues'], 1)
        self.assertEqual(counts['auditIssues'], 1)
        self.assertEqual(result['summary']['status'], integrity.HEALTH_ATTENTION)
        week3 = next(item for item in result['sessions'] if item['sessionNumber'] == 3 and item['liveSessionId'] == 'LIVE-MAIN')
        self.assertEqual(week3['meetingType'], integrity.MEETING_STANDALONE)
        self.assertEqual(week3['integrity'], integrity.INTEGRITY_CONFLICT)
        self.assertEqual(week3['attribution']['label'], 'System — original trigger unknown')
        self.assertIn('completed_before_start', [issue['code'] for issue in week3['lifecycleIssues']])
        self.assertIn('future_session_completed', [issue['code'] for issue in week3['lifecycleIssues']])

    def test_additional_meeting_is_never_a_link_conflict(self):
        series, rows, additional = incident_calendar()
        result = health(series, rows, additional)
        extra = [item for item in result['sessions'] if item['meetingType'] == integrity.MEETING_ADDITIONAL]
        self.assertEqual(len(extra), 1)
        self.assertNotEqual(extra[0]['integrity'], integrity.INTEGRITY_CONFLICT)
        self.assertEqual(extra[0]['auditIssues'], [])
        self.assertEqual(integrity.resolution_options(extra[0]), [])
        link = next(item for item in result['warnings'] if item['category'] == 'link')
        self.assertEqual(link['sessions'], [3])

    def test_main_counts_ignore_additional_meetings(self):
        series, rows, additional = incident_calendar()
        with_extra = health(series, rows, additional)['summary']['counts']
        without_extra = health(series, rows)['summary']['counts']
        for key in ('plannedSessions', 'mainSeries', 'standaloneReplacements', 'linkConflicts'):
            self.assertEqual(with_extra[key], without_extra[key], key)

    def test_three_categories_are_independent(self):
        series, rows, additional = incident_calendar()
        intentional = {'event_type': integrity.EVENT_INTENTIONAL, 'session_number': 3, 'live_session_id': 'LIVE-MAIN',
                       'meeting_after': {'joinRef': integrity.join_ref(SEPARATE_JOIN)}, 'created_at': NOW,
                       'origin': integrity.ORIGIN_MANUAL, 'initiated_by_email': 'admin@example.invalid'}
        result = health(series, rows, additional, events=[intentional])
        categories = {item['category'] for item in result['warnings']}
        self.assertNotIn('link', categories)
        self.assertIn('lifecycle', categories, 'resolving the link must not clear the lifecycle warning')
        self.assertIn('audit', categories, 'unknown historical attribution stays visible')
        self.assertEqual(result['summary']['status'], integrity.HEALTH_ATTENTION)

    def test_resolution_for_an_old_link_does_not_cover_a_new_one(self):
        series, rows, _additional = incident_calendar()
        old = {'event_type': integrity.EVENT_INTENTIONAL, 'session_number': 3, 'live_session_id': 'LIVE-MAIN',
               'meeting_after': {'joinRef': integrity.join_ref('https://teams.microsoft.com/l/other')}, 'created_at': NOW}
        week3 = next(item for item in health(series, rows, events=[old])['sessions'] if item['sessionNumber'] == 3)
        self.assertEqual(week3['integrity'], integrity.INTEGRITY_CONFLICT)

    def test_missing_session_is_reported_from_the_last_save(self):
        series = series_row()
        starts = [datetime(2026, 10, 1, 17, tzinfo=UTC) + timedelta(weeks=i) for i in range(4)]
        rows = [occurrence(i, s) for i, s in enumerate(starts, 1)]
        reconcile = {'event_type': integrity.EVENT_RECONCILED, 'live_session_id': 'LIVE-MAIN', 'created_at': NOW,
                     'detail': {'missing': [{'sessionNumber': 2, 'startDateTimeUtc': starts[1].isoformat()}]}}
        result = health(series, rows, events=[reconcile], checked_at=NOW - timedelta(hours=2))
        week2 = next(item for item in result['sessions'] if item['sessionNumber'] == 2)
        self.assertEqual(week2['integrity'], integrity.INTEGRITY_MISSING)
        self.assertEqual(result['summary']['counts']['missingOccurrences'], 1)
        self.assertEqual(result['summary']['status'], integrity.HEALTH_ATTENTION)
        actions = [item['action'] for item in integrity.resolution_options(week2)]
        self.assertEqual(actions, [integrity.ACTION_RECHECK, integrity.ACTION_KEEP, integrity.ACTION_REPLACE])

    def test_missing_entry_for_a_moved_session_no_longer_applies(self):
        series = series_row()
        starts = [datetime(2026, 10, 1, 17, tzinfo=UTC) + timedelta(weeks=i) for i in range(2)]
        rows = [occurrence(i, s) for i, s in enumerate(starts, 1)]
        reconcile = {'event_type': integrity.EVENT_RECONCILED, 'live_session_id': 'LIVE-MAIN', 'created_at': NOW,
                     'detail': {'missing': [{'sessionNumber': 2, 'startDateTimeUtc': (starts[1] - timedelta(days=1)).isoformat()}]}}
        week2 = next(item for item in health(series, rows, events=[reconcile])['sessions'] if item['sessionNumber'] == 2)
        self.assertNotEqual(week2['integrity'], integrity.INTEGRITY_MISSING)

    def test_healthy_only_when_verified_and_fresh(self):
        series = series_row()
        rows = [occurrence(i, datetime(2026, 10, 8, 17, tzinfo=UTC) + timedelta(weeks=i)) for i in range(1, 4)]
        self.assertEqual(health(series, rows)['summary']['status'], integrity.HEALTH_HEALTHY)
        stale = health(series, rows, checked_at=NOW - timedelta(days=3))
        self.assertEqual(stale['summary']['status'], integrity.HEALTH_PENDING)
        self.assertTrue(stale['summary']['verificationStale'])
        self.assertTrue(all(item['verificationStale'] for item in stale['sessions']))
        never = health(series, rows, snapshot={}, checked_at=None)
        self.assertEqual(never['summary']['status'], integrity.HEALTH_PENDING)
        self.assertTrue(never['summary']['neverVerified'])
        self.assertFalse(any(item['integrity'] == integrity.INTEGRITY_VERIFIED for item in never['sessions']),
                         'never shown verified when Microsoft was not checked')

    def test_failed_check_after_last_success_is_shown_as_failed(self):
        series = series_row()
        rows = [occurrence(1, datetime(2026, 10, 8, 17, tzinfo=UTC))]
        failure = {'event_type': integrity.EVENT_VERIFY_FAILED, 'live_session_id': 'LIVE-MAIN', 'created_at': NOW,
                   'detail': {'message': 'Microsoft calendar status could not be verified.'}}
        result = health(series, rows, events=[failure], checked_at=NOW - timedelta(hours=2))
        self.assertEqual(result['summary']['status'], integrity.HEALTH_FAILED)
        self.assertEqual(result['summary']['lastVerificationFailure']['message'],
                         'Microsoft calendar status could not be verified.')

    def test_unmatched_session_from_the_status_check_is_verification_failed(self):
        series = series_row()
        rows = [occurrence(1, datetime(2026, 10, 8, 17, tzinfo=UTC))]
        snapshot = {**snapshot_for(rows), 'integrity': {'unmatched': ['OCC-1']}}
        result = health(series, rows, snapshot=snapshot)
        self.assertEqual(result['sessions'][0]['integrity'], integrity.INTEGRITY_FAILED)

    def test_membership_states(self):
        series = series_row()
        start = datetime(2026, 10, 8, 17, tzinfo=UTC)
        rows = [occurrence(1, start), occurrence(-1, start + timedelta(weeks=1), status='superseded'),
                occurrence(2, start + timedelta(weeks=2), status='cancelled')]
        sessions = health(series, rows)['sessions']
        self.assertEqual([item['membership'] for item in sessions],
                         [integrity.MEMBERSHIP_IN_PLAN, integrity.MEMBERSHIP_NOT_IN_PLAN, integrity.MEMBERSHIP_CANCELLED])

    def test_filters_and_pagination(self):
        series, rows, additional = incident_calendar()
        sessions = health(series, rows, additional)['sessions']
        self.assertEqual(integrity.page_of(sessions, 'standalone')['total'], 1)
        self.assertEqual(integrity.page_of(sessions, 'additional')['total'], 1)
        self.assertEqual(integrity.page_of(sessions, 'link_conflict')['total'], 1)
        self.assertEqual(integrity.page_of(sessions, 'lifecycle')['total'], 1)
        self.assertEqual(integrity.page_of(sessions, 'audit')['total'], 1)
        first = integrity.page_of(sessions, 'all', page=1, page_size=5)
        last = integrity.page_of(sessions, 'all', page=99, page_size=5)
        self.assertEqual((first['total'], first['pages'], len(first['items'])), (13, 3, 5))
        self.assertEqual((last['page'], len(last['items'])), (3, 3))

    def test_weekday_calendar_links_are_main_series(self):
        series = series_row(calendar_series=[{'day': 'Tuesday', 'eventId': 'series-tue', 'joinUrl': 'https://teams.microsoft.com/tue'}])
        tuesday = occurrence(2, datetime(2026, 10, 6, 17, tzinfo=UTC), graph_event_id='tue-instance',
                             join_url='https://teams.microsoft.com/tue')
        self.assertEqual(integrity.meeting_type(series, tuesday), integrity.MEETING_MAIN)


class LifecycleTests(unittest.TestCase):
    def test_future_scheduled_session_has_no_issue(self):
        self.assertEqual(integrity.lifecycle_issues(occurrence(1, NOW + timedelta(days=7)), NOW), [])
        self.assertEqual(integrity.lifecycle_state(occurrence(1, NOW + timedelta(days=7)), NOW), 'scheduled')

    def test_run_before_the_session_does_not_complete_it(self):
        session = occurrence(3, datetime(2026, 10, 8, 17, tzinfo=UTC))
        self.assertTrue(integrity.run_precedes_session(session, datetime(2026, 9, 26, 11, 5), datetime(2026, 9, 26, 11, 9)))
        # A tutor opening the room 20 minutes early and teaching through is delivery.
        self.assertFalse(integrity.run_precedes_session(session, datetime(2026, 10, 8, 16, 40), datetime(2026, 10, 8, 19, 0)))
        # The run on the day.
        self.assertFalse(integrity.run_precedes_session(session, datetime(2026, 10, 8, 17, 2), datetime(2026, 10, 8, 18, 55)))
        # An ongoing report is not judged.
        self.assertFalse(integrity.run_precedes_session(session, datetime(2026, 9, 26, 11, 5), None))

    def test_legitimate_completion_is_not_flagged(self):
        done = occurrence(1, NOW - timedelta(days=7), status='completed', attendance_report_id='r1',
                          actual_start=(NOW - timedelta(days=7, minutes=-2)).replace(tzinfo=None),
                          actual_end=(NOW - timedelta(days=7, minutes=-118)).replace(tzinfo=None))
        self.assertEqual(integrity.lifecycle_issues(done, NOW), [])

    def test_invalid_historical_completion_is_detected(self):
        _series, rows, _additional = incident_calendar()
        codes = [issue['code'] for issue in integrity.lifecycle_issues(rows[2], NOW)]
        self.assertIn('completed_before_start', codes)

    def test_same_morning_test_run_on_a_delivered_session_is_a_note_not_an_error(self):
        """Production pattern: a few seconds in the room hours before, then the session itself."""
        start = NOW - timedelta(days=14)
        delivered = occurrence(1, start, status='completed', attendance_report_id='r1',
                               actual_start=(start - timedelta(hours=3)).replace(tzinfo=None),
                               actual_end=(start - timedelta(hours=3) + timedelta(seconds=8)).replace(tzinfo=None))
        issues = integrity.lifecycle_issues(delivered, NOW)
        self.assertEqual([issue['code'] for issue in issues], ['completed_before_start'])
        self.assertFalse(issues[0]['confirmed'])
        result = health(series_row(), [delivered])
        self.assertEqual(result['summary']['counts']['lifecycleIssues'], 0)
        self.assertNotEqual(result['summary']['status'], integrity.HEALTH_ATTENTION)

    def test_run_days_before_a_past_session_is_still_a_confirmed_error(self):
        start = NOW - timedelta(hours=4)
        wrong = occurrence(3, start, status='completed', attendance_report_id='r1',
                           actual_start=(start - timedelta(days=3)).replace(tzinfo=None),
                           actual_end=(start - timedelta(days=3) + timedelta(seconds=4)).replace(tzinfo=None))
        issues = integrity.lifecycle_issues(wrong, NOW)
        self.assertTrue(any(issue['code'] == 'completed_before_start' and issue['confirmed'] for issue in issues))

    def test_completion_without_evidence_is_a_notice_not_a_confirmed_error(self):
        bare = occurrence(1, NOW - timedelta(days=7), status='completed')
        issues = integrity.lifecycle_issues(bare, NOW)
        self.assertEqual([issue['code'] for issue in issues], ['completion_evidence_missing'])
        self.assertFalse(issues[0]['confirmed'])


class AttributionTests(unittest.TestCase):
    def tearDown(self):
        versioning.set_actor(None)
        versioning.discard_context()

    def test_manual_action_records_the_person(self):
        versioning.set_actor({'email': 'admin@example.invalid', 'name': 'Synthetic Admin'})
        event = integrity.build_event('LIVE-1', integrity.EVENT_KEPT, session_number=3)
        self.assertEqual(event['origin'], integrity.ORIGIN_MANUAL)
        self.assertEqual(event['initiated_by_email'], 'admin@example.invalid')

    def test_background_job_records_its_job_id_and_no_person(self):
        event = integrity.build_event('LIVE-1', integrity.EVENT_COMPLETED, job_id='session-results:abc')
        self.assertEqual(event['origin'], integrity.ORIGIN_SCHEDULED)
        self.assertEqual(event['job_id'], 'session-results:abc')
        self.assertEqual(event['initiated_by_email'], '')

    def test_user_initiated_background_work_keeps_the_person(self):
        with versioning.audit_context(actor_type='system', triggered_by={'email': 'tutor@example.invalid', 'name': 'Tutor'}):
            event = integrity.build_event('LIVE-1', integrity.EVENT_RECONCILED)
        self.assertEqual(event['origin'], integrity.ORIGIN_USER_BACKGROUND)
        self.assertEqual(event['initiated_by_email'], 'tutor@example.invalid')

    def test_unknown_history_stays_unknown(self):
        described = integrity.describe_attribution(None)
        self.assertFalse(described['known'])
        self.assertEqual(described['label'], 'System — original trigger unknown')
        self.assertEqual(described['initiatedBy'], '')

    def test_meeting_references_hold_a_digest_never_the_link(self):
        before = integrity.meeting_reference('series-1', MAIN_JOIN, 'm1')
        after = integrity.meeting_reference('standalone-3', SEPARATE_JOIN, 'm2')
        event = integrity.build_event('LIVE-1', integrity.EVENT_REASSOCIATED, before=before, after=after)
        self.assertNotIn(MAIN_JOIN, str(event))
        self.assertNotIn(SEPARATE_JOIN, str(event))
        self.assertNotEqual(event['meeting_before']['joinRef'], event['meeting_after']['joinRef'])

    def test_record_event_never_raises_without_the_table(self):
        with patch.object(integrity, 'events_available', return_value=False):
            self.assertIsNone(integrity.record_event('LIVE-1', integrity.EVENT_KEPT))


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.series, self.rows, _additional = incident_calendar()
        self.session = next(item for item in health(self.series, self.rows)['sessions'] if item['sessionNumber'] == 3)
        self.no_evidence = {'attendanceRecords': 0, 'recordings': 0, 'transcripts': 0}

    def test_keep_touches_nothing_in_microsoft(self):
        preview = integrity.build_preview(integrity.ACTION_KEEP, self.session, self.rows[2], self.series, self.no_evidence)
        self.assertEqual(preview['blocked'], '')
        self.assertFalse(any(preview['microsoft'][key] for key in ('creates', 'updates', 'cancels', 'mayEmail')))
        self.assertTrue(preview['requiresConfirmation'])

    def test_reassociation_is_blocked_while_evidence_is_linked(self):
        preview = integrity.build_preview(integrity.ACTION_REASSOCIATE, self.session, self.rows[2], self.series,
                                          {'attendanceRecords': 4, 'recordings': 0, 'transcripts': 0})
        self.assertIn('Attendance', preview['blocked'])
        self.assertFalse(preview['microsoft']['cancels'])

    def test_replacement_preview_says_microsoft_may_email(self):
        missing_row = occurrence(5, datetime(2026, 10, 15, 17, tzinfo=UTC))
        session = {**integrity.classify_session(self.series, missing_row, events=[], snapshot={}, checked_at=None, now=NOW),
                   'integrity': integrity.INTEGRITY_MISSING}
        preview = integrity.build_preview(integrity.ACTION_REPLACE, session, missing_row, self.series, self.no_evidence)
        self.assertEqual(preview['blocked'], '')
        self.assertTrue(preview['microsoft']['creates'])
        self.assertTrue(preview['microsoft']['mayEmail'])
        self.assertFalse(preview['microsoft']['cancels'])
        self.assertTrue(any('cannot guarantee' in line for line in preview['followUp']))

    def test_action_that_does_not_apply_is_blocked(self):
        preview = integrity.build_preview(integrity.ACTION_REPLACE, self.session, self.rows[2], self.series, self.no_evidence)
        self.assertTrue(preview['blocked'])

    def test_token_changes_when_the_session_changes(self):
        token = integrity.preview_token(self.rows[2], integrity.ACTION_KEEP)
        self.assertEqual(token, integrity.preview_token(dict(self.rows[2]), integrity.ACTION_KEEP))
        self.assertNotEqual(token, integrity.preview_token({**self.rows[2], 'join_url': MAIN_JOIN}, integrity.ACTION_KEEP))
        self.assertNotEqual(token, integrity.preview_token(self.rows[2], integrity.ACTION_INTENTIONAL))


class ReplacementGraph:
    """Microsoft for the explicit replacement: series instances, calendarView, and POST."""

    def __init__(self, instances, existing=(), fail_post=None):
        self.instances = instances
        self.existing = list(existing)
        self.fail_post = fail_post
        self.calls = []

    def __call__(self, method, path, payload=None, extra_headers=None):
        self.calls.append((method, path, payload))
        if method == 'GET' and '/instances?' in path:
            return {'value': self.instances}
        if method == 'GET' and '/calendarView?' in path:
            return {'value': list(self.existing)}
        if method == 'POST':
            created = {'id': 'created-1', 'type': 'singleInstance', 'transactionId': payload.get('transactionId'),
                       'start': payload['start'], 'end': payload['end'], 'onlineMeeting': {'joinUrl': SEPARATE_JOIN}}
            # Microsoft may well have created it even when the answer never came back.
            self.existing.append(created)
            if self.fail_post:
                raise RuntimeError(self.fail_post)
            return created
        if method in ('DELETE', 'PATCH') or path.endswith('/cancel'):
            raise AssertionError(f'Replacement must not {method} {path}')
        return {}


class ReplacementTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.series = series_row()
        self.row = occurrence(3, datetime(2026, 10, 8, 17, tzinfo=UTC))
        stub = types.ModuleType('curriculum_api.views')
        stub.teams_meeting_default_organizer = lambda: 'organizer@example.invalid'
        stub.teams_series_email_list = lambda value: list(value or [])
        stub.teams_single_occurrence_payload = lambda title, target, people, transaction_id='': {
            'subject': title, 'transactionId': transaction_id,
            'start': {'dateTime': target['start'].isoformat(), 'timeZone': 'UTC'},
            'end': {'dateTime': target['end'].isoformat(), 'timeZone': 'UTC'}}
        stub.GRAPH_SILENT_INVITE_HEADERS = {}
        stub.teams_standalone_occurrence_meeting = lambda owner, event, target, people, options: {
            'session_number': target['session_number'], 'graph_event_id': event['id'],
            'join_url': event['onlineMeeting']['joinUrl'], 'online_meeting_id': 'meeting-new', 'warnings': []}
        self.persisted = []
        stub.persist_recreated_occurrence_details = lambda live, details: self.persisted.extend(details)
        modules = patch.dict('sys.modules', {'curriculum_api.views': stub})
        modules.start()
        self.addCleanup(modules.stop)
        import curriculum_api
        attribute = patch.object(curriculum_api, 'views', stub, create=True)
        attribute.start()
        self.addCleanup(attribute.stop)
        self.notes = []

    def note(self, event_type, **kwargs):
        self.notes.append(event_type)

    def run_create(self, graph):
        return integrity.create_replacement(self.series, self.row, integrity.row_meeting_reference(self.row),
                                           {'session_number': 3}, graph, self.note)

    def test_creates_exactly_one_meeting_with_a_deterministic_transaction_id(self):
        graph = ReplacementGraph(instances=[])
        result = self.run_create(graph)
        posts = [call for call in graph.calls if call[0] == 'POST']
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][2]['transactionId'], integrity.replacement_transaction_id('LIVE-MAIN', self.row))
        self.assertEqual(result['meeting']['eventId'], 'created-1')
        self.assertEqual([detail['graph_event_id'] for detail in self.persisted], ['created-1'])
        self.assertEqual(self.notes, [integrity.EVENT_REPLACEMENT])

    def test_retry_after_a_timeout_finds_the_meeting_instead_of_creating_another(self):
        graph = ReplacementGraph(instances=[], fail_post='Microsoft Graph request timed out')
        with self.assertRaises(integrity.ResolutionRefused) as first:
            self.run_create(graph)
        self.assertEqual(first.exception.extra.get('code'), 'resolution_uncertain')
        self.assertEqual(self.notes, [integrity.EVENT_REPLACEMENT_UNCERTAIN])
        self.assertEqual(self.persisted, [], 'an unconfirmed meeting is never written to the session')
        graph.fail_post = None
        with self.assertRaises(integrity.ResolutionRefused) as second:
            self.run_create(graph)
        self.assertEqual(second.exception.extra.get('code'), 'resolution_existing_meeting')
        self.assertTrue(second.exception.extra['existing'][0]['createdByThisLms'])
        self.assertEqual(len([call for call in graph.calls if call[0] == 'POST']), 1)

    def test_refuses_when_the_occurrence_is_back_in_the_series(self):
        back = {'id': 'occ-3', 'start': {'dateTime': '2026-10-08T17:00:00', 'timeZone': 'UTC'},
                'end': {'dateTime': '2026-10-08T19:00:00', 'timeZone': 'UTC'}}
        graph = ReplacementGraph(instances=[back])
        with self.assertRaises(integrity.ResolutionRefused) as refused:
            self.run_create(graph)
        self.assertEqual(refused.exception.extra.get('code'), 'resolution_not_missing')
        self.assertEqual([call for call in graph.calls if call[0] != 'GET'], [])

    def test_refuses_when_a_separate_meeting_already_holds_the_slot(self):
        existing = {'id': 'someone-elses', 'type': 'singleInstance', 'start': {'dateTime': '2026-10-08T17:00:00', 'timeZone': 'UTC'},
                    'end': {'dateTime': '2026-10-08T19:00:00', 'timeZone': 'UTC'},
                    'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/l/other'}}
        graph = ReplacementGraph(instances=[], existing=[existing])
        with self.assertRaises(integrity.ResolutionRefused):
            self.run_create(graph)
        self.assertEqual([call for call in graph.calls if call[0] == 'POST'], [])

    def test_definite_refusal_is_recorded_as_failed(self):
        graph = ReplacementGraph(instances=[], fail_post='Microsoft Graph returned HTTP 403: Forbidden')
        with self.assertRaises(integrity.ResolutionRefused) as refused:
            self.run_create(graph)
        self.assertIn(refused.exception.extra.get('code'), ('resolution_failed', 'resolution_uncertain'))
        self.assertIn(self.notes[0], (integrity.EVENT_REPLACEMENT_FAILED, integrity.EVENT_REPLACEMENT_UNCERTAIN))


class ReadOnlyHealthTests(unittest.TestCase):
    def test_building_health_and_previews_makes_no_microsoft_call(self):
        def forbidden(*_args, **_kwargs):
            raise AssertionError('Health and previews must not call Microsoft')

        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = forbidden
        with patch.dict('sys.modules', {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport}):
            series, rows, additional = incident_calendar()
            result = health(series, rows, additional)
            for session in result['sessions']:
                for option in integrity.resolution_options(session):
                    integrity.build_preview(option['action'], session, rows[0], series,
                                            {'attendanceRecords': 0, 'recordings': 0, 'transcripts': 0})


if __name__ == '__main__':
    unittest.main()
