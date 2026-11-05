from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .live_session_progress import (project_live_credits, read_live_credits,
    supplement_component_progress, supplement_module_hours)
from .module_progress import aggregate_module_progress


NOW = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)


def component(**values):
    return dict(componentId='C1', moduleId='M1', title='Synthetic live session', type='live_session',
                sessionDate='2026-10-17', teamsLiveSessionId='S1', teamsSessionNumber=1) | values


def lecture(**values):
    return dict(source='microsoft-teams', session_id='O1', occurrence_id='O1',
                module_catalogue_id='M1', live_session_id='S1', session_number=1,
                scheduled_start=NOW-timedelta(days=1, hours=2), scheduled_end=NOW-timedelta(days=1),
                session_date=(NOW-timedelta(days=1)).date(), attendance_status='present',
                attendance_report_id='R1', attended_seconds=181) | values


class LiveSessionProgressTests(SimpleTestCase):
    def setUp(self):
        self.manual = patch('learner_api.live_session_progress.read_manual_live_credits', return_value=({}, [])).start()
        self.addCleanup(patch.stopall)

    def credits(self, components=None, register=None):
        return project_live_credits([component()] if components is None else components,
                                    [lecture()] if register is None else register, now=NOW)

    def test_threshold_grants_full_lecture_hours_not_participant_duration(self):
        for seconds in (0, 180, 181, 7200, 8000):
            with self.subTest(seconds=seconds):
                credits = self.credits(register=[lecture(attended_seconds=seconds)])
                self.assertEqual(len(credits), int(seconds > 180))
                if credits:
                    self.assertEqual(credits[0]['hours'], 2)
                    self.assertEqual(credits[0]['verifiedSeconds'], seconds)

    def test_recorded_recovery_and_staff_absence_do_not_grant_live_credit(self):
        cases = [lecture(attendance_status='absent'),
                 lecture(attendance_status='absent', effective_attendance=1, attendance_basis='recorded'),
                 lecture(effective_attendance_status='absent', effective_attendance=0),
                 lecture(attendance_report_id=None), lecture(source='kbc-attendance'),
                 lecture(session_status='cancelled'),
                 lecture(scheduled_start=NOW+timedelta(hours=1), scheduled_end=NOW+timedelta(hours=3)),
                 lecture(scheduled_start=NOW-timedelta(hours=1), scheduled_end=NOW+timedelta(hours=1))]
        for row in cases:
            with self.subTest(row=row):
                self.assertEqual(self.credits(register=[row]), [])

    def test_shared_module_credit_uses_original_evidence_and_owned_component(self):
        credits = self.credits(register=[lecture(session_id='O1:M1', occurrence_id='O1:M1',
                                               attendance_source_occurrence_id='O1')])
        self.assertEqual((credits[0]['occurrenceId'], credits[0]['componentId']), ('O1', 'C1'))
        self.assertEqual(self.credits(components=[component(moduleId='OTHER')]), [])

    def test_week_two_cannot_inherit_week_one_presence(self):
        components = [component(), component(componentId='C2', teamsSessionNumber=2, sessionDate='2026-10-24')]
        self.assertEqual([c['componentId'] for c in self.credits(components)], ['C1'])

    def test_date_only_mapping_requires_unique_component_and_session(self):
        card = component(teamsLiveSessionId=None, teamsSessionNumber=None)
        self.assertEqual(len(self.credits([card])), 1)
        self.assertEqual(self.credits([card, card | {'componentId': 'DUP'}]), [])
        self.assertEqual(self.credits([card], [lecture(), lecture(occurrence_id='O2', session_id='O2')]), [])

    def test_repeated_component_and_shared_evidence_never_double_count(self):
        self.assertEqual(len(self.credits([component(), component()])), 1)
        self.assertEqual(self.credits([component(), component(componentId='C2', moduleId='M2')],
            [lecture(), lecture(module_catalogue_id='M2', attendance_source_occurrence_id='O1')]), [])

    def test_completion_is_idempotent_and_does_not_fabricate_reflection_or_ksbs(self):
        credits = self.credits()
        original = []
        once = supplement_component_progress(original, credits)
        self.assertEqual(supplement_component_progress(once, credits), once)
        self.assertEqual(original, [])
        self.assertEqual(once[0]['ksbs'], [])
        self.assertNotIn('feedback', once[0])
        self.assertEqual(once[0]['timeTrackingSource'], 'verified_teams_attendance')
        manual = [{'componentId': 'C1', 'kind': 'component', 'reportedTime': '30 minutes'}]
        self.assertEqual(supplement_component_progress(manual, credits), manual)

    def test_hours_top_up_existing_manual_time_without_changing_stored_rows(self):
        for seconds, expected in [(0, 2), (1800, 2), (7200, 2), (10800, 3)]:
            with self.subTest(seconds=seconds):
                records = [{'component_ref': 'C1', 'actual_seconds': seconds, 'accepted': True}]
                before = deepcopy(records)
                metrics = {'M1': {'hours': {'actual': seconds / 3600}}}
                result = supplement_module_hours(metrics, records, self.credits() * 2)
                self.assertEqual(result['M1']['hours']['actual'], expected)
                self.assertEqual(records, before)
                self.assertEqual(metrics['M1']['hours']['actual'], seconds / 3600)
                self.assertEqual(supplement_module_hours(metrics, records, self.credits()), result)

    def test_explicit_staff_hours_correction_wins(self):
        records = [{'component_ref': 'C1', 'actual_seconds': 0, 'accepted': True,
                    'actual_basis': 'staff:module-progress'}]
        metrics = {'M1': {'hours': {'actual': 0}}, 'OTHER': {'hours': {'actual': 4}}}
        self.assertEqual(supplement_module_hours(metrics, records, self.credits()), metrics)

    def test_other_activity_hours_and_completion_are_preserved(self):
        metrics = {'M1': {'hours': {'actual': 3}}}
        records = [{'component_ref': 'READING', 'actual_seconds': 10800, 'accepted': True}]
        self.assertEqual(supplement_module_hours(metrics, records, self.credits())['M1']['hours']['actual'], 5)
        progress = supplement_component_progress([{'componentId': 'READING', 'kind': 'component'}], self.credits())
        detail = {'components': [component(), {'componentId': 'READING', 'moduleId': 'M1', 'type': 'reading'}], 'quizAttempts': []}
        rows = aggregate_module_progress(None, detail, [], [
            {'kind': p['kind'], 'passed': None, 'component_ref': p['componentId']} for p in progress])
        self.assertEqual((rows[0]['completed'], rows[0]['total'], rows[0]['percent']), (2, 2, 100))

    def test_reader_uses_canonical_register_for_both_learner_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            source = SimpleNamespace(id=7, learner_type=kind)
            with patch('learner_api.attendance_lectures.lecture_register', return_value=[lecture()]) as register, \
                 patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
                self.assertEqual(read_live_credits(source, components=[component()])[0]['hours'], 2)
                register.assert_called_once_with(source, module_ids=['M1'], credit_projection=True)

    def test_non_live_catalogue_does_not_read_attendance(self):
        with patch('learner_api.attendance_lectures.lecture_register') as register:
            self.assertEqual(read_live_credits(SimpleNamespace(id=7), components=[component(type='video')]), [])
        register.assert_not_called()

    def test_supplied_register_is_reused_even_when_empty(self):
        with patch('learner_api.attendance_lectures.lecture_register') as register, \
             patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
            self.assertEqual(len(read_live_credits(SimpleNamespace(pk=7), components=[component()],
                                                  register=[lecture()])), 1)
            self.assertEqual(read_live_credits(SimpleNamespace(pk=7), components=[component()], register=[]), [])
        register.assert_not_called()

    def test_manual_component_hours_replace_provider_credit_instead_of_adding_to_it(self):
        credit = {'componentId': 'C1', 'moduleId': 'M1', 'hours': 2.5, 'title': 'Live',
                  'submittedAt': NOW.isoformat(), 'timeTrackingSource': 'manual_attendance'}
        self.manual.return_value = ({('C1', 'M1'): (True, NOW)}, [credit])
        with patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
            for register in ([lecture()], [], [lecture(attendance_status='absent', attendance_report_id=None, attended_seconds=0)]):
                credits = read_live_credits(SimpleNamespace(id=7), components=[component()], register=register)
                self.assertEqual(credits, [credit])
                progress = supplement_component_progress([], credits)
                self.assertEqual(progress[0]['reportedTime'], '150 minutes')
                self.assertEqual(progress[0]['timeTrackingSource'], 'manual_attendance')
                self.assertNotIn('verifiedSeconds', progress[0])

    def test_manual_hours_top_up_existing_time_once_and_preserve_other_activities(self):
        credits = [{'componentId': 'C1', 'moduleId': 'M1', 'hours': 2.5}]
        for recorded, expected in [(0, 2.5), (.5, 2.5), (2, 2.5), (2.5, 2.5), (3, 3)]:
            records = [{'component_ref': 'C1', 'accepted': True, 'actual_seconds': recorded * 3600}]
            metrics = {'M1': {'hours': {'actual': recorded + 4}}, 'M2': {'hours': {'actual': 9}}}
            first = supplement_module_hours(metrics, records, credits * 2)
            second = supplement_module_hours(metrics, records, credits)
            self.assertEqual(first, second)
            self.assertEqual(first['M1']['hours']['actual'], expected + 4)
            self.assertEqual(first['M2'], metrics['M2'])
            self.assertEqual(metrics['M1']['hours']['actual'], recorded + 4)

    def test_manual_absence_removes_automatic_credit_but_reset_restores_provider_rule(self):
        with patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
            self.manual.return_value = ({('C1', 'M1'): (False, NOW)}, [])
            self.assertEqual(read_live_credits(SimpleNamespace(id=7), components=[component()], register=[lecture()]), [])
            self.manual.return_value = ({}, [])
            self.assertEqual(read_live_credits(SimpleNamespace(id=7), components=[component()], register=[lecture()])[0]['hours'], 2)

    def test_canonical_module_percentage_includes_verified_live_completion(self):
        from .module_progress import canonical_module_progress
        source = SimpleNamespace(pk=7)
        profile = SimpleNamespace(pk=70, enrolment_id=7)
        detail = {'components': [component(), component(componentId='C2', type='reading')], 'quizAttempts': []}
        with patch('learner_api.canonical_learning.require_profile', return_value={'id': 70}), \
             patch('learner_api.attendance_lectures.lecture_register', return_value=[lecture()]), \
             patch('learner_api.live_session_progress.timezone.now', return_value=NOW):
            result = canonical_module_progress(source, profile,
                read_projection=lambda: (None, detail, [], [], {}))
        self.assertEqual((result[0]['completed'], result[0]['total'], result[0]['percent']), (1, 2, 50))

    def test_dashboard_hours_include_live_credit_on_each_read_without_ledger_writes(self):
        from .training_plan_dashboard import read_dashboard
        source = SimpleNamespace(pk=7, email='synthetic@example.invalid', aptem_id=None,
                                 _canonical_profile={'id': 70}, programme='', cohort='', group='')
        connection = MagicMock()
        module = {'id': 'M1', 'title': 'Synthetic module', 'total_otjh': 10}
        with patch('learner_api.training_plan_dashboard.connections', {'enrolment': connection}), \
             patch('learner_api.training_plan_dashboard.LearnerProfile') as profiles, \
             patch('learner_api.training_plan_dashboard.plan_module_ids', return_value=(['M1'], {})), \
             patch('learner_api.training_plan_dashboard._canonical_actual_rows', return_value=[]), \
             patch('learner_api.training_plan_dashboard.rows', side_effect=[[module], [], []] * 2), \
             patch('learner_api.calendar.coaching_events_for_learner', return_value=[]), \
             patch('learner_api.live_session_progress.read_live_credits', return_value=self.credits()) as read:
            profiles.objects.filter.return_value.only.return_value.first.return_value = None
            first = read_dashboard(source, section='overview', records=[], targets={})
            second = read_dashboard(source, section='overview', records=[], targets={})
        self.assertEqual(first['moduleProgress']['M1']['hours']['actual'], 2)
        self.assertEqual(second['moduleProgress'], first['moduleProgress'])
        self.assertEqual(first['actual'], [])
        self.assertEqual(read.call_count, 2)
        read.assert_called_with(source, module_ids=['M1'])
        for call in connection.cursor.return_value.__enter__.return_value.execute.call_args_list:
            self.assertTrue(call.args[0].lstrip().upper().startswith(('SELECT', 'WITH')))
