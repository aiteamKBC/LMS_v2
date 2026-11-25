"""Recorded learners in the bulk register; no database or external services."""
from datetime import datetime, timedelta, timezone
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase
from learner_api.models import EnrolmentUser, LearnerProfile

from curriculum_api import bulk_attendance_recorded as recorded
from curriculum_api.bulk_attendance_kbc_history import _with_warnings

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


class RecordedSourceIdentityTests(SimpleTestCase):
    def setUp(self):
        # Created_users deliberately does not exist. Run the real mode join
        # against a disposable fixture; ORM identity reads return profile rows.
        self.database = sqlite3.connect(':memory:')
        self.addCleanup(self.database.close)
        self.database.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.database.executescript('''
            CREATE TABLE "Learner".learners (id INTEGER, enrolment_id INTEGER, attendance_preference_id INTEGER);
            CREATE TABLE "Learner".attendance_preferences (learner_id INTEGER PRIMARY KEY, mode TEXT, requested_mode TEXT);
            INSERT INTO "Learner".learners VALUES (1,17,41), (2,18,42), (3,19,NULL);
            INSERT INTO "Learner".attendance_preferences VALUES
                (17,'lazy',NULL), (18,'live',NULL), (19,'lazy',NULL),
                (41,'live','lazy'), (42,'lazy',NULL);
        ''')
        self.profiles = [SimpleNamespace(id=1, enrolment_id=17, aptem_id=301, learner_type='commercial'),
                         SimpleNamespace(id=2, enrolment_id=18, aptem_id=302, learner_type='apprenticeship'),
                         SimpleNamespace(id=3, enrolment_id=19, aptem_id=303, learner_type='commercial')]
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        def execute(sql, params):
            ids = params[0]
            sql = sql.replace('=ANY(%s)', ' IN (' + ','.join('?' for _ in ids) + ')')
            cursor.fetchall.return_value = self.database.execute(sql, ids).fetchall()
        cursor.execute.side_effect = execute
        self.enterContext(patch.object(recorded, 'connections', {'enrolment': connection}))
        self.enterContext(patch('learner_api.attendance_mode._ready', return_value=True))
        self.enterContext(patch.object(EnrolmentUser.all_learners, 'get_queryset',
                                      side_effect=AssertionError('Created_users must not be read')))
        manager = self.enterContext(patch.object(LearnerProfile, 'objects'))
        def filter_profiles(**kwargs):
            query = MagicMock()
            query.only.return_value = [p for p in self.profiles if p.aptem_id in kwargs['aptem_id__in']]
            return query
        manager.filter.side_effect = filter_profiles

    def test_saved_mode_uses_profile_fk_not_legacy_id_or_pending_request(self):
        self.assertEqual(recorded.recorded_sources({'301', '302', '303'}),
                         {'302': recorded.RecordingIdentity(18, 'apprenticeship', 2)})

    def test_both_kinds_retain_their_historical_watch_keys_from_learners(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.profiles[1].learner_type = kind
                self.assertEqual(recorded.recorded_sources({'302'})['302'],
                                 recorded.RecordingIdentity(18, kind, 2))

    def test_missing_aptem_does_not_fall_back_to_created_users_or_email(self):
        self.profiles[1].aptem_id = None
        self.assertEqual(recorded.recorded_sources({'302'}), {})

    def test_duplicate_aptem_cannot_acquire_another_profiles_recording_credit(self):
        self.profiles[0].aptem_id = 302
        self.assertEqual(recorded.recorded_sources({'302'}), {})

    def test_incomplete_recording_identity_is_reported_without_guessing_a_kind(self):
        for field, value in (('enrolment_id', None), ('learner_type', None), ('learner_type', 'unknown')):
            with self.subTest(field=field, value=value), patch.object(self.profiles[1], field, value):
                with self.assertRaisesMessage(DatabaseError, 'historical recording identity'):
                    recorded.recorded_sources({'302'})

    def test_live_learner_does_not_need_a_recording_identity(self):
        self.profiles[0].enrolment_id = None
        self.profiles[0].learner_type = None
        self.assertEqual(recorded.recorded_sources({'301'}), {})

    def test_manual_corrections_use_exact_profile_and_keep_legacy_evidence_keys(self):
        with patch('coach_api.models.CoachAttendanceSourceAdjustment.objects') as adjustments:
            adjustments.filter.return_value.values.return_value = [
                {'learner_profile_id': 2, 'source': 'microsoft-teams', 'source_id': 'OCC:shared',
                 'status': 'absent', 'is_deleted': False},
                {'learner_profile_id': 2, 'source': 'kbc-attendance', 'source_id': 'deleted',
                 'status': None, 'is_deleted': True},
                {'learner_profile_id': 2, 'source': 'kbc-attendance', 'source_id': 'unchanged',
                 'status': None, 'is_deleted': False},
            ]
            actual = recorded.manual_corrections(recorded.recorded_sources({'302'}))
            self.assertEqual(actual, {(18, 'microsoft-teams', 'OCC:shared'), (18, 'kbc-attendance', 'deleted')})
            self.assertEqual(set(adjustments.filter.call_args.kwargs['learner_profile_id__in']), {2})
