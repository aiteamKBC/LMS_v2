"""Recorded delivery regressions; database and external transports are mocked."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .live_session_progress import read_live_credits, supplement_component_progress, supplement_module_hours
from .recorded_session_progress import project_recorded_credits, read_components

NOW = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)
END = NOW - timedelta(days=1)


def live(**changes):
    return dict(componentId='LIVE', moduleId='M1', title='Synthetic live session', type='live_session',
                teamsLiveSessionId='SERIES', teamsSessionNumber=1, expectedOtjh=0) | changes


def recording(**changes):
    return dict(componentId='REC', moduleId='M1', title='Synthetic recording', type='recording_placeholder',
                linkedLiveSessionComponentId='LIVE', expectedOtjh=2.5) | changes


def row(**changes):
    return dict(source='microsoft-teams', session_id='OCC', occurrence_id='OCC',
                module_catalogue_id='M1', live_session_id='SERIES', session_number=1,
                scheduled_start=END-timedelta(hours=2), scheduled_end=END, session_date=END.date(),
                attendance_status='present', attendance_report_id='REPORT', attended_seconds=7200) | changes


def evidence(**changes):
    return {'OCC': dict(ready=True, completed=False, availableAt=NOW-timedelta(hours=1), completedAt=NOW) | changes}


def credit(**changes):
    return dict(componentId='LIVE', moduleId='M1', hours=2, title='Synthetic live session',
                submittedAt=END.isoformat(), verifiedSeconds=7200) | changes


class RecordedComponentQueryTests(SimpleTestCase):
    def test_uses_the_canonical_module_lifecycle_without_removed_columns(self):
        from curriculum_api.schema_compat import active_condition

        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        with patch('learner_api.recorded_session_progress.connections', {'enrolment': connection}):
            self.assertEqual(read_components(['M1']), [])

        sql, params = cursor.execute.call_args.args
        self.assertIn(active_condition('m'), sql)
        self.assertNotIn('m.deleted_at', sql)
        self.assertNotIn('m.is_programme_deleted', sql)
        self.assertEqual(params, [['M1']])


class RecordedSessionProgressTests(SimpleTestCase):
    def project(self, *, components=None, register=None, saved=None, attended=True, **kwargs):
        return project_recorded_credits([live(), recording()] if components is None else components,
            [row()] if register is None else register, evidence() if saved is None else saved,
            [credit()] if attended else [], now=NOW, **kwargs)

    def test_public_reader_completes_the_recording_with_its_authored_hours_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), \
                 patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='lazy'), \
                 patch('learner_api.recorded_session_progress.read_components', return_value=[live(), recording()]), \
                 patch('curriculum_api.recording_views.recording_completion_evidence', return_value=evidence()) as saved, \
                 patch('learner_api.live_session_progress.read_manual_live_credits', return_value=({}, [])), \
                 patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
                result = read_live_credits(SimpleNamespace(id=7, learner_type=kind), components=[live(), recording()], register=[row()])
                self.assertEqual([(r['componentId'], r['hours']) for r in result], [('REC', 2.5), ('LIVE', 0)])
                saved.assert_called_once_with(kind, 7, {'OCC'})

    def test_live_attendance_waits_for_recording_availability(self):
        for saved in ({}, evidence(ready=False)):
            self.assertEqual(self.project(saved=saved), [])
        result = self.project()[0]
        self.assertEqual((result['componentId'], result['hours']), ('REC', 2.5))
        self.assertEqual(result['submittedAt'], (NOW-timedelta(hours=1)).isoformat())

    def test_no_live_attendance_means_no_completion_or_hours_until_recording_is_finished(self):
        absent = [row(attendance_status='absent', attended_seconds=0)]
        self.assertEqual(self.project(register=absent, attended=False), [])
        completed = self.project(register=absent, attended=False, saved=evidence(completed=True))[0]
        self.assertEqual((completed['componentId'], completed['hours']), ('REC', 2.5))
        self.assertEqual(completed['timeTrackingSource'], 'verified_recording_watch')

    def test_live_and_recording_together_earn_one_completion_and_one_allocation(self):
        result = self.project(saved=evidence(completed=True))
        self.assertEqual(sum(row['hours'] for row in result), 2.5)
        progress = supplement_component_progress([], result)
        self.assertEqual(supplement_component_progress(progress, result), progress)
        self.assertEqual(progress[0]['componentId'], 'REC')
        self.assertEqual(progress[0]['componentType'], 'recording_placeholder')
        stored = [{'kind': 'component', 'componentId': 'REC', 'reportedTime': '150 minutes'}]
        self.assertEqual(supplement_component_progress(stored, result)[0], stored[0])

    def test_recorded_watch_completes_both_delivery_cards_in_the_module_with_hours_only_on_recording(self):
        from .module_progress import aggregate_module_progress
        credits = self.project(register=[row(attendance_status='absent')], attended=False,
                               saved=evidence(completed=True))
        progress = supplement_component_progress([], credits)
        detail = {'components': [live(), recording()], 'quizAttempts': []}
        rows = aggregate_module_progress(None, detail, [], [
            {'kind': 'component', 'component_ref': item['componentId'], 'passed': None} for item in progress])
        self.assertEqual((rows[0]['completed'], rows[0]['total'], rows[0]['percent']), (2, 2, 100))
        self.assertEqual({item['componentId']: item['hours'] for item in credits}, {'REC': 2.5, 'LIVE': 0})

    def test_existing_hours_on_either_card_are_not_added_again(self):
        result = self.project()
        for identity in ('LIVE', 'REC'):
            for hours in (0, 1, 2.5, 4):
                with self.subTest(identity=identity, hours=hours):
                    records = [{'component_ref': identity, 'actual_seconds': hours*3600, 'accepted': True}]
                    metrics = {'M1': {'hours': {'actual': hours+3}}}
                    updated = supplement_module_hours(metrics, records, result)
                    self.assertEqual(updated['M1']['hours']['actual'], max(hours, 2.5)+3)
                    self.assertEqual(metrics['M1']['hours']['actual'], hours+3)

    def test_explicit_staff_hours_and_absence_remain_authoritative(self):
        self.assertEqual(self.project(states={('LIVE', 'M1'): (False, NOW)}), [])
        records = [{'component_ref': 'LIVE', 'actual_seconds': 0, 'accepted': True, 'actual_basis': 'staff:module-progress'}]
        metrics = {'M1': {'hours': {'actual': 0}}}
        self.assertEqual(supplement_module_hours(metrics, records, self.project()), metrics)

    def test_recording_hours_never_replace_unrelated_or_invalid_allocations(self):
        for hours in (-1, float('nan'), float('inf'), 'invalid'):
            with self.subTest(hours=hours):
                self.assertEqual(self.project(components=[live(), recording(expectedOtjh=hours)]), [])
        credits = self.project()
        records = [{'component_ref': 'OTHER', 'actual_seconds': 3600, 'accepted': True}]
        metrics = {'M1': {'hours': {'actual': 1}}, 'OTHER-MODULE': {'hours': {'actual': 5}}}
        self.assertEqual(supplement_module_hours(metrics, records, credits),
                         {'M1': {'hours': {'actual': 3.5}}, 'OTHER-MODULE': {'hours': {'actual': 5}}})

    def test_another_module_and_ambiguous_links_never_inherit_completion(self):
        self.assertEqual(self.project(register=[row(module_catalogue_id='OTHER')]), [])
        self.assertEqual(self.project(components=[live(), live(componentId='DUP'), recording()]), [])
        self.assertEqual(self.project(components=[live(), recording(), recording(componentId='DUP')]), [])
        other = self.project(components=[live(), recording(moduleId='OTHER')])
        self.assertEqual([r['componentId'] for r in other], ['LIVE'])

    def test_future_active_and_cancelled_sessions_never_complete_from_recording(self):
        for changes in ({'scheduled_start': NOW+timedelta(days=1)},
                        {'scheduled_start': NOW-timedelta(minutes=2), 'scheduled_end': NOW+timedelta(minutes=2)},
                        {'occurrence_status': 'cancelled'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.project(register=[row(**changes)], saved=evidence(completed=True)), [])

    def test_merged_layout_keeps_one_existing_card_and_recording_hours(self):
        result = self.project(merge=True)
        self.assertEqual([(r['componentId'], r['hours']) for r in result], [('LIVE', 2.5)])

    def test_live_mode_keeps_live_credit_without_reading_recording_state(self):
        with patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='live'), \
             patch('learner_api.recorded_session_progress.read_components') as components, \
             patch('learner_api.live_session_progress.read_manual_live_credits', return_value=({}, [])), \
             patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
            source = SimpleNamespace(id=7, learner_type='commercial')
            result = read_live_credits(source, components=[live(), recording()], register=[row()])
        self.assertEqual([(r['componentId'], r['hours']) for r in result], [('LIVE', 2.5)])
        components.assert_not_called()
