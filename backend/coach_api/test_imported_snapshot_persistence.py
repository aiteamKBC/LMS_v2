"""Execute the real SQL builder against a recording cursor, NOT PostgreSQL.

These tests establish write boundaries/order; they do not prove row locks,
rollback, constraints, or concurrent PostgreSQL commits.
"""
from contextlib import ExitStack, contextmanager, nullcontext
from copy import deepcopy
from datetime import timedelta
import inspect
import re
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from . import views, migrated_intelligence_views
from .migrated_session_scope import snapshot_version
from . import test_aptem_attendance_stabilization as fixtures


class ImportedSnapshotPersistenceTests(SimpleTestCase):
    def setUp(self):
        self.fixture = fixtures.AptemAttendanceRefreshTests()
        self.fixture.setUp()
        self.fixture.prepare('MCM')
        self.record = self.fixture.record
        report, detail = self.fixture.report()
        self.report = views.serialize_coach_meeting_attendance_report(report, detail)
        self.snapshot = {'artifacts': [], 'attendanceReports': [], 'attendanceTracker': {},
                         'attendance': {'expectedAttendees': fixtures.EXPECTED}}
        self.previous = {**deepcopy(self.snapshot), 'attendanceReports': [self.report],
                         'storage': {'stored': True}, 'partial': False}
        self.started = timezone.now()

    def test_sql_retains_report_history_and_only_writes_resource_tables_under_calendar_lock(self):
        events, statements = [], []
        depth = 0
        @contextmanager
        def atomic(*, using):
            nonlocal depth
            self.assertEqual(using, 'snapshot-write')
            depth += 1
            try:
                yield
            finally:
                depth -= 1
        def lock(**kw):
            self.assertGreater(depth, 0)
            events.append('calendar-lock')
            return self.record
        def read(*args, **kw):
            self.assertEqual(events, ['calendar-lock', 'overlay-lock'])
            self.assertEqual(kw['database'], 'snapshot-write')
            events.append('stored-read')
            return deepcopy(self.previous)
        def execute(sql, params):
            self.assertGreater(depth, 0)
            self.assertIn('stored-read', events)
            statements.append((sql, params))
        with ExitStack() as stack:
            def mock(name, **kw):
                return stack.enter_context(patch(name, **kw))
            mock('django.db.router.db_for_write', return_value='snapshot-write')
            mock('django.db.transaction.atomic', side_effect=atomic)
            calendar = mock('coach_api.models.CoachCalendarEvent.objects')
            calendar.using.return_value.select_for_update.return_value.get.side_effect = lock
            overlay = mock('coach_api.models.ImportedReviewInstance.objects')
            overlay.using.return_value.select_for_update.return_value.get.side_effect = lambda **kw: events.append('overlay-lock')
            mock('coach_api.views.stored_coach_meeting_snapshot', side_effect=read)
            mock('coach_api.views.coach_meeting_snapshot_tables_ready', return_value=True)
            mock('coach_api.views.coach_meeting_artifact_transcript_columns_ready', return_value=True)
            connections = mock('coach_api.views.connections')
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.execute.side_effect = execute
            result = views.persist_coach_meeting_snapshots(self.record, artifacts=[], attendance_reports=[],
                attendance_tracker={}, imported_refresh={'snapshot': self.snapshot, 'expected_version': snapshot_version(self.previous),
                                                         'preserve_existing': True, 'context': {'overlayId': 3}})
            self.assertTrue(result['stored'])
            calendar.using.assert_called_once_with('snapshot-write')
            overlay.using.assert_called_once_with('snapshot-write')
        targets = {re.search(r'(?:INSERT INTO|UPDATE)\s+(\S+)', sql).group(1) for sql, params in statements}
        self.assertEqual(targets, {views.COACH_MEETING_ATTENDANCE_REPORTS_RELATION, views.COACH_MEETING_ATTENDANCE_RELATION})
        self.assertFalse(any(re.search(r'\bDELETE\b', sql) for sql, params in statements))
        report_write = next(params for sql, params in statements if 'INSERT INTO ' + views.COACH_MEETING_ATTENDANCE_REPORTS_RELATION in sql)
        self.assertEqual(report_write[5], 'report-1')
        tracker_writes = [params for sql, params in statements if 'INSERT INTO ' + views.COACH_MEETING_ATTENDANCE_RELATION + ' (' in sql]
        self.assertEqual(len(tracker_writes), 2)
        self.assertTrue(all(params[16:18] == ['attended', 600] for params in tracker_writes))

    def test_manual_handlers_refuse_response_overtaken_by_background_before_ai_or_answer_write(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family), ExitStack() as stack:
                self.fixture.prepare(family)
                record, overlay = self.fixture.record, self.fixture.overlay
                before = deepcopy(overlay.answers)
                request = self.fixture.factory.post('/', data='{}', content_type='application/json')
                request.coach_email = record.owner_email
                def mock(name, **kw):
                    return stack.enter_context(patch(name, **kw))
                snapshot = {**deepcopy(self.snapshot), 'errors': [], 'partial': False}
                previous = deepcopy(self.previous)
                previous['storage']['syncedAt'] = (timezone.now() + timedelta(seconds=1)).isoformat()
                mock('coach_api.views.fetch_coach_meeting_graph_snapshot', return_value=(snapshot, None, 200))
                mock('coach_api.views.stored_coach_meeting_snapshot', side_effect=[deepcopy(self.previous), previous])
                mock('django.db.transaction.atomic', return_value=nullcontext())
                manager = mock('coach_api.models.CoachCalendarEvent.objects')
                manager.using.return_value.select_for_update.return_value.get.return_value = record
                ai = mock('coach_api.views.openai_meeting_summary')
                recap = mock('coach_api.views.ensure_coach_meeting_summary')
                connections = mock('coach_api.views.connections')
                if family == 'PSP':
                    mock('coach_api.views.coach_meeting_artifact_record', return_value=record)
                    mock('coach_api.views.coach_meeting_write_error', return_value=None)
                    mock('coach_api.views.apply_teams_attendance_status_transition', return_value=False)
                    result = inspect.unwrap(views.coach_timetable_event_artifacts)(request, record.event_key)
                else:
                    mock('coach_api.migrated_intelligence_views._association', return_value=(overlay, record, {}))
                    mock('coach_api.migrated_intelligence_views._checked_lock', return_value=(overlay, record, None))
                    result = inspect.unwrap(migrated_intelligence_views.migrated_review_check_session)(request, record.event_key)
                self.assertEqual(result.status_code, 409, result.content)
                self.assertIn(b'BOOKING_CONFLICT', result.content)
                connections.__getitem__.assert_not_called()
                ai.assert_not_called()
                recap.assert_not_called()
                overlay.save.assert_not_called()
                self.assertEqual(overlay.answers, before)
