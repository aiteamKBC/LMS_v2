from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .live_session_progress import (project_live_credits, read_catalogue_live_credits, read_live_credits,
    project_completed_live_credits, read_completed_live_credits,
    supplement_component_progress, supplement_module_hours, LIVE_SESSION_CREDIT_MINUTES)
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
        patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='live').start()
        self.manual = patch('learner_api.live_session_progress.read_manual_live_credits', return_value=({}, [])).start()
        self.saved = patch('learner_api.live_session_progress.read_completed_live_credits', return_value=[]).start()
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
                    self.assertEqual(credits[0]['hours'], LIVE_SESSION_CREDIT_MINUTES / 60)
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
        self.assertEqual(once[0]['reportedTime'], '150 minutes')
        manual = [{'componentId': 'C1', 'kind': 'component', 'reportedTime': '30 minutes'}]
        self.assertEqual(supplement_component_progress(manual, credits)[0]['reportedTime'], '150 minutes')

    def test_verified_teams_credit_refreshes_a_saved_live_session_duration(self):
        saved = [{
            'componentId': 'C1', 'componentType': 'live_session', 'kind': 'component',
            'reportedTime': '120 minutes', 'timeTaken': '02:00:00',
            'timeTrackingSource': 'activity-time-decision:input', 'claimedSeconds': 7200,
            'feedback': 'Keep this reflection',
        }]
        refreshed = supplement_component_progress(saved, self.credits())
        self.assertEqual(refreshed[0]['reportedTime'], '150 minutes')
        self.assertIsNone(refreshed[0]['claimedSeconds'])
        self.assertIsNone(refreshed[0]['timeTaken'])
        self.assertEqual(refreshed[0]['timeTrackingSource'], 'verified_teams_attendance')
        self.assertEqual(refreshed[0]['feedback'], 'Keep this reflection')

    def test_manual_completion_keeps_entered_time_without_fixed_credit(self):
        saved = [{'kind': 'component', 'componentId': 'C1', 'componentType': 'live_session',
                  'moduleId': 'M1', 'submittedAt': NOW.isoformat(), 'timeTaken': '60:00',
                  'reportedTime': '60.0 minutes', 'claimedSeconds': 3600,
                  'timeTrackingSource': 'signed_session_capped_visible_page:input',
                  'feedback': 'Keep the saved reflection', 'retakeTimeChoice': 'add'}]
        before = deepcopy(saved)
        credits = project_completed_live_credits([component()], saved * 2)
        self.assertEqual(credits, [])
        result = supplement_component_progress(saved, credits)
        self.assertEqual(result, saved)
        self.assertEqual(supplement_component_progress(result, credits), result)
        self.assertEqual(saved, before)
        from .active_users import completed_hours_value_from_progress
        self.assertEqual(completed_hours_value_from_progress(result), 1)
        metrics = {'M1': {'hours': {'actual': 1}}, 'OTHER': {'hours': {'actual': 4}}}
        self.assertEqual(supplement_module_hours(metrics,
            [{'component_ref': 'C1', 'actual_seconds': 3600, 'accepted': True}], credits), metrics)

    def test_input_attempt_does_not_inherit_fixed_credit_from_a_legacy_attempt(self):
        legacy = dict(kind='component', componentId='C1', moduleId='M1', submittedAt=NOW.isoformat())
        manual = {**legacy, 'timeTrackingSource': 'signed_session_capped_visible_page:input'}
        for attempts in ([legacy, manual], [manual, legacy]):
            self.assertEqual(project_completed_live_credits([component()], attempts), [])
        for changes in ({'passed': False}, {'moduleId': 'OTHER'}, {'componentId': 'OTHER'},
                        {'deletedAt': NOW.isoformat()}, {'submittedAt': None}):
            self.assertEqual(len(project_completed_live_credits([component()], [legacy, manual | changes])), 1)

    def test_input_time_survives_reloading_absent_learner_in_both_delivery_modes(self):
        for kind in ('commercial', 'apprenticeship'):
            for mode in ('live', 'lazy'):
                with self.subTest(kind=kind, mode=mode), \
                     patch('learner_api.recorded_attendance.saved_delivery_mode', return_value=mode), \
                     patch('learner_api.recorded_session_progress.read_recorded_credits', return_value=[]), \
                     patch('learner_api.models.LearnerProgressEntry') as entries:
                    source = SimpleNamespace(id=7, learner_type=kind,
                        _case_file_profile=SimpleNamespace(pk=70, enrolment_id=7))
                    entries.objects.using.return_value.filter.return_value.order_by.return_value.values.return_value = [
                        dict(component_ref='C1', module_ref='M1', kind='component', passed=None, submitted_at=NOW,
                             time_tracking_source='signed_session_capped_visible_page:input')]
                    self.saved.side_effect = read_completed_live_credits
                    credits = read_live_credits(source, components=[component()],
                        register=[lecture(attendance_status='absent', attended_seconds=0)])
                    self.assertEqual(credits, [])
                    entries.objects.using.return_value.filter.assert_called_once_with(
                        learner_id=70, component_ref__in=['C1'], kind='component', deleted_at__isnull=True)
                    self.assertIn('time_tracking_source',
                        entries.objects.using.return_value.filter.return_value.order_by.return_value.values.call_args.args)

    def test_saved_credit_requires_successful_owned_live_completion(self):
        saved = {'kind': 'component', 'componentId': 'C1', 'moduleId': 'M1', 'submittedAt': NOW.isoformat()}
        for changes in ({'passed': False}, {'kind': 'quiz'}, {'deletedAt': NOW.isoformat()},
                        {'submittedAt': None}, {'moduleId': 'OTHER'}, {'componentId': 'OTHER'}):
            with self.subTest(changes=changes):
                self.assertEqual(project_completed_live_credits([component()], [saved | changes]), [])
        self.assertEqual(project_completed_live_credits([component(type='reading')], [saved]), [])

    def test_saved_credit_reader_scopes_progress_to_the_resolved_profile(self):
        source = SimpleNamespace(id=7, _case_file_profile=SimpleNamespace(pk=70, enrolment_id=7))
        with patch('learner_api.models.LearnerProgressEntry') as entries:
            entries.objects.using.return_value.filter.return_value.order_by.return_value.values.return_value = [
                dict(component_ref='C1', module_ref='M1', kind='component', passed=None, submitted_at=NOW,
                     time_tracking_source='')]
            credits = read_completed_live_credits(source, [component()])
        entries.objects.using.assert_called_once_with('enrolment')
        entries.objects.using.return_value.filter.assert_called_once_with(
            learner_id=70, component_ref__in=['C1'], kind='component', deleted_at__isnull=True)
        self.assertEqual(credits[0]['hours'], 2.5)

    def test_manual_completion_is_used_in_recorded_and_live_modes_for_both_kinds(self):
        self.saved.return_value = project_completed_live_credits([component()], [
            dict(kind='component', componentId='C1', submittedAt=NOW.isoformat())])
        for kind in ('commercial', 'apprenticeship'):
            for mode in ('live', 'lazy'):
                with self.subTest(kind=kind, mode=mode), \
                     patch('learner_api.recorded_attendance.saved_delivery_mode', return_value=mode), \
                     patch('learner_api.recorded_session_progress.read_recorded_credits', return_value=[]):
                    credits = read_live_credits(SimpleNamespace(id=7, learner_type=kind),
                        components=[component()], register=[lecture(attendance_status='absent', attended_seconds=0)])
                    self.assertEqual(credits, self.saved.return_value)

    def test_hours_top_up_existing_manual_time_without_changing_stored_rows(self):
        for seconds, expected in [(0, 2.5), (1800, 2.5), (7200, 2.5), (10800, 3)]:
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
        self.assertEqual(supplement_module_hours(metrics, records, self.credits())['M1']['hours']['actual'], 5.5)
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
                self.assertEqual(read_live_credits(source, components=[component()])[0]['hours'], LIVE_SESSION_CREDIT_MINUTES / 60)
                register.assert_called_once_with(source, module_ids=['M1'], credit_projection=True)

    def test_non_live_catalogue_does_not_read_attendance(self):
        with patch('learner_api.attendance_lectures.lecture_register') as register:
            self.assertEqual(read_live_credits(SimpleNamespace(id=7), components=[component(type='video')]), [])
        register.assert_not_called()

    def test_catalogue_reader_batches_saved_shared_register_without_full_lecture_register(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('C1', 'M1', 'Synthetic live session', 'O1', NOW, 7200)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        source = SimpleNamespace(
            id=7,
            _case_file_profile=SimpleNamespace(pk=70, enrolment_id=7),
            _canonical_profile={'id': 70},
        )
        with patch('learner_api.live_session_progress.connections', {'enrolment': connection}), \
             patch('learner_api.live_session_progress.read_manual_live_credits', return_value=({}, [])), \
             patch('learner_api.attendance_lectures.lecture_register') as register:
            credits = read_catalogue_live_credits(source, [component()])

        self.assertEqual(credits, [{
            'componentId': 'C1', 'moduleId': 'M1', 'title': 'Synthetic live session',
            'occurrenceId': 'O1', 'hours': 2, 'verifiedSeconds': 7200,
            'submittedAt': NOW.isoformat(),
        }])
        register.assert_not_called()
        self.assertEqual(cursor.execute.call_count, 1)
        sql = cursor.execute.call_args.args[0]
        self.assertIn('WITH RECURSIVE requested_components', sql)
        self.assertIn('teams_shared_source_module_id', sql)
        self.assertIn('r.module_catalogue_id=c.module_catalogue_id', sql)
        self.assertIn('HAVING count(*)=1', sql)

    def test_catalogue_reader_keeps_manual_override_and_rejects_ambiguous_profile(self):
        manual = {'componentId': 'C1', 'moduleId': 'M1', 'hours': 2.5, 'title': 'Live',
                  'submittedAt': NOW.isoformat(), 'timeTrackingSource': 'manual_attendance'}
        cursor = MagicMock()
        cursor.fetchall.return_value = [('C1', 'M1', 'Synthetic live session', 'O1', NOW, 7200)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        source = SimpleNamespace(id=7, _case_file_profile=SimpleNamespace(pk=70, enrolment_id=7),
                                 _canonical_profile={'id': 70})
        with patch('learner_api.live_session_progress.connections', {'enrolment': connection}), \
             patch('learner_api.live_session_progress.read_manual_live_credits',
                   return_value=({('C1', 'M1'): (True, NOW)}, [manual])):
            self.assertEqual(read_catalogue_live_credits(source, [component()]), [manual])

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
            self.assertEqual(read_live_credits(SimpleNamespace(id=7), components=[component()], register=[lecture()])[0]['hours'], LIVE_SESSION_CREDIT_MINUTES / 60)

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
        self.assertEqual(first['moduleProgress']['M1']['hours']['actual'], LIVE_SESSION_CREDIT_MINUTES / 60)
        self.assertEqual(second['moduleProgress'], first['moduleProgress'])
        self.assertEqual(first['actual'], [])
        self.assertEqual(read.call_count, 2)
        read.assert_called_with(source, module_ids=['M1'])
        for call in connection.cursor.return_value.__enter__.return_value.execute.call_args_list:
            self.assertTrue(call.args[0].lstrip().upper().startswith(('SELECT', 'WITH')))
