"""Recorded learners in the bulk register; no database or external services."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import bulk_attendance_recorded as recorded
from .bulk_attendance_kbc_history import _with_warnings

NOW = datetime(2026, 11, 6, 12, tzinfo=timezone.utc)


def record(key='live:1', learner='301', **changes):
    return dict(recordKey=key, learnerId=learner, occurrenceId='OCC-1', source='live',
                sessionDate='2026-11-04', attendance='absent') | changes


class BulkRecordedOutcomeTests(SimpleTestCase):
    def setUp(self):
        self.sources = {'301': SimpleNamespace(id=17, learner_type='commercial')}
        self.occurrences = [{'id': 'OCC-1', 'scheduled_start': NOW-timedelta(days=2, hours=1),
                             'scheduled_end': NOW-timedelta(days=2), 'status': 'scheduled'}]
        self.corrections = set()
        self.watched = set()
        for target, kwargs in (
            ('curriculum_api.bulk_attendance_recorded.recorded_sources', {'side_effect': lambda ids: {k: v for k, v in self.sources.items() if k in ids}}),
            ('curriculum_api.bulk_attendance_recorded.register_context', {'return_value': {'live:1': {'source_id': 'OCC-1'}}}),
            ('curriculum_api.bulk_attendance_recorded.manual_corrections', {'side_effect': lambda _: self.corrections}),
            ('curriculum_api.bulk_attendance_recorded.LiveSessionOccurrence.objects.filter', {}),
            ('curriculum_api.recording_views.fully_watched_occurrences', {'side_effect': lambda *args: self.watched}),
            ('learner_api.recorded_attendance.timezone.now', {'return_value': NOW}),
        ):
            mocked = patch(target, **kwargs).start()
            self.addCleanup(patch.stopall)
            if target.endswith('objects.filter'):
                mocked.return_value.values.side_effect = lambda *args: self.occurrences
            if target.endswith('fully_watched_occurrences'):
                self.watch = mocked

    def test_last_four_and_history_keep_raw_absence_and_scope_completion_by_identity(self):
        rows = [record(), record('kbc-key', occurrenceId=None, source='kbc'),
                record('live:2', '302'), record('live:3', attendance='present')]
        result = recorded.apply_recorded_outcomes(rows)
        self.assertEqual([r.get('attendanceBasis') for r in result], ['awaiting_recording', 'awaiting_recording', None, None])
        self.watch.assert_called_once_with('commercial', 17, {'OCC-1'})
        self.assertEqual(result[0]['attendance'], 'absent')
        self.assertNotIn('attendanceBasis', rows[0])
        self.watched = {'OCC-1'}
        result = recorded.apply_recorded_outcomes(rows)
        self.assertEqual(result[0]['attendanceBasis'], 'recorded')
        self.assertEqual(result[0]['effectiveAttendance'], 'present')
        self.assertEqual(result[1]['effectiveAttendance'], 'awaiting_recording')
        self.assertNotIn('attendanceBasis', result[2])

    def test_both_learner_kinds_use_enrolment_id_for_watch_evidence(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.sources['301'].learner_type = kind
                self.watch.reset_mock()
                recorded.apply_recorded_outcomes([record()])
                self.watch.assert_called_once_with(kind, 17, {'OCC-1'})

    def test_active_future_and_cancelled_occurrences_do_not_acquire_credit(self):
        for changes in ({'scheduled_start': NOW+timedelta(days=1)},
                        {'scheduled_start': NOW-timedelta(minutes=5), 'scheduled_end': NOW+timedelta(minutes=5)},
                        {'status': 'cancelled'}):
            with self.subTest(changes=changes):
                self.occurrences = [self.occurrences[0] | changes]
                rows = [record()]
                self.assertEqual(recorded.apply_recorded_outcomes(rows), rows)
        self.watch.assert_not_called()

    def test_manual_absence_and_parallel_group_credit_stay_authoritative(self):
        self.corrections = {(17, 'microsoft-teams', 'OCC-1')}
        rows = [record(), record('kbc', source='kbc', occurrenceId=None, effectiveAttendance='present')]
        self.assertEqual(recorded.apply_recorded_outcomes(rows), rows)
        self.watch.assert_not_called()

    def test_unavailable_recording_reads_are_visible_instead_of_returning_false_absences(self):
        with patch('curriculum_api.bulk_attendance_kbc_history._recorded_outcomes', side_effect=DatabaseError):
            self.assertEqual(_with_warnings({'records': [record()]}, None).status_code, 503)

    def test_day_payload_uses_occurrence_date_when_compact_record_omits_date(self):
        row = record()
        del row['sessionDate']
        result = recorded.apply_recorded_outcomes([row])[0]
        self.assertEqual(result['attendanceBasis'], 'awaiting_recording')

    def test_shared_module_manual_correction_keeps_its_exact_source_identity(self):
        self.corrections = {(17, 'microsoft-teams', 'OCC-1:shared-module')}
        with patch.object(recorded, 'register_context', return_value={'live:1': {'source_id': 'OCC-1:shared-module'}}):
            rows = [record()]
            self.assertEqual(recorded.apply_recorded_outcomes(rows), rows)
        self.watch.assert_not_called()


class DirectoryEmailBridgeTests(SimpleTestCase):
    def linked_cursor(self, rows):
        cursor = MagicMock()
        cursor.fetchall.return_value = rows
        context = MagicMock()
        context.__enter__.return_value = cursor
        return cursor, context

    def test_new_database_reads_lms_learners_and_never_connects_to_kbc(self):
        cursor, context = self.linked_cursor([('301', 'A@Example.test'), ('302', 'b@example.test'),
                                              ('302', 'c@example.test')])
        with patch('curriculum_api.bulk_attendance_kbc_source.on_new_database', return_value=True), \
             patch('curriculum_api.bulk_attendance_kbc_source.new_database_cursor', return_value=context) as linked, \
             patch('curriculum_api.bulk_attendance_learners.learner_directory_dsn') as direct, \
             patch('psycopg.connect') as connect:
            self.assertEqual(recorded.directory_emails({'301', '302'}), {'301': 'a@example.test'})
        linked.assert_called_once_with(read_only=True)
        self.assertIn('"Learner".learners', cursor.execute.call_args[0][0])
        direct.assert_not_called()
        connect.assert_not_called()

    def test_new_database_failure_is_reported_without_details(self):
        cursor, context = self.linked_cursor([])
        cursor.execute.side_effect = DatabaseError('host=secret')
        with patch('curriculum_api.bulk_attendance_kbc_source.on_new_database', return_value=True), \
             patch('curriculum_api.bulk_attendance_kbc_source.new_database_cursor', return_value=context):
            with self.assertRaisesMessage(DatabaseError, 'The attendance identity bridge is unavailable.'):
                recorded.directory_emails({'301'})


class RecordedSourceIdentityTests(SimpleTestCase):
    def test_legacy_email_bridge_uses_one_server_matched_enrolment_identity(self):
        source = SimpleNamespace(id=17, aptem_id='old-id', learner_type='commercial', email='Legacy@Example.test')
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(17,)]
        with patch.object(recorded.EnrolmentUser, 'all_learners') as users, \
             patch.object(recorded, 'connections', {'enrolment': connection}), \
             patch.object(recorded, 'directory_emails', return_value={'301': 'legacy@example.test'}), \
             patch('learner_api.attendance_mode._ready', return_value=True):
            users.filter.return_value.only.return_value = []
            users.annotate.return_value.filter.return_value.only.return_value = [source]
            self.assertEqual(recorded.recorded_sources({'301'}), {'301': source})
            users.annotate.return_value.filter.return_value.only.return_value = [source, source]
            self.assertEqual(recorded.recorded_sources({'301'}), {})

    def test_uses_only_active_saved_modes_and_refuses_ambiguous_aptem_identities(self):
        sources = [SimpleNamespace(id=17, aptem_id='301', learner_type='commercial'),
                   SimpleNamespace(id=18, aptem_id='302', learner_type='apprenticeship'),
                   SimpleNamespace(id=19, aptem_id='303', learner_type='apprenticeship'),
                   SimpleNamespace(id=20, aptem_id='303', learner_type='commercial')]
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(17,), (19,), (20,)]
        with patch.object(recorded.EnrolmentUser, 'all_learners') as users, \
             patch.object(recorded, 'connections', {'enrolment': connection}), \
             patch('learner_api.attendance_mode._ready', return_value=True):
            users.filter.return_value.only.return_value = sources
            actual = recorded.recorded_sources({'301', '302', '303'})
        self.assertEqual(actual, {'301': sources[0]})
        self.assertIn("mode='lazy'", cursor.execute.call_args.args[0])
        self.assertNotIn('requested_mode', cursor.execute.call_args.args[0])
