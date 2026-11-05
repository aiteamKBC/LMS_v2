from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .manual_attendance_completion import project_manual_completion, read_manual_completion, project_manual_credits


NOW = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)


def component(**values):
    return {'id': 'C1', 'module_catalogue_id': 'M1', 'title': 'Lecture 1',
            'settings_json': {'teamsOccurrenceId': 'O1'}, **values}


def occurrence(**values):
    return {'session_id': 'O1', 'module_catalogue_id': 'M1', 'live_session_id': 'S1',
            'session_number': 1, 'session_date': date(2026, 10, 24),
            'scheduled_end': NOW - timedelta(days=1), **values}


def adjustment(**values):
    return SimpleNamespace(**{'source': 'microsoft-teams', 'source_id': 'O1', 'status': 'present',
                             'is_deleted': False, 'updated_at': NOW, **values})


def manual(**values):
    return SimpleNamespace(**{'module_name': 'Module one', 'session_title': 'Lecture 1',
                             'session_date': date(2026, 10, 24), 'status': 'present',
                             'updated_at': NOW, **values})


class ManualAttendanceCompletionTests(SimpleTestCase):
    def project(self, components=None, occurrences=None, adjustments=None, manual_rows=None):
        return project_manual_completion(
            components if components is not None else [component()],
            occurrences if occurrences is not None else [occurrence()],
            adjustments if adjustments is not None else [adjustment()],
            manual_rows or [], {'M1': 'Module one', 'M2': 'Module two'}, now=NOW)

    def test_saved_bulk_or_coach_correction_needs_no_teams_report_or_duration(self):
        self.assertEqual(self.project(), {('C1', 'M1'): (True, NOW)})

    def test_other_module_and_other_occurrence_are_untouched(self):
        components = [component(), component(id='C2', module_catalogue_id='M2'),
                      component(id='C3', settings_json={'teamsOccurrenceId': 'O2'})]
        self.assertEqual(self.project(components), {('C1', 'M1'): (True, NOW)})

    def test_absent_deleted_reset_and_removed_corrections(self):
        for change in ({'status': 'absent'}, {'is_deleted': True}):
            self.assertEqual(self.project(adjustments=[adjustment(**change)]), {('C1', 'M1'): (False, NOW)})
        self.assertEqual(self.project(adjustments=[adjustment(status='')]), {})
        self.assertEqual(self.project(adjustments=[]), {})

    def test_future_and_cancelled_sessions_never_complete(self):
        for change in ({'scheduled_end': NOW + timedelta(minutes=1)}, {'session_status': 'cancelled'},
                       {'occurrence_status': 'deleted'}, {'scheduled_end': None}):
            self.assertEqual(self.project(occurrences=[occurrence(**change)]), {})

    def test_recurrence_matches_series_and_number_not_just_series(self):
        components = [component(settings_json={'teamsLiveSessionId': 'S1', 'teamsSessionNumber': 1}),
                      component(id='C2', settings_json={'teamsLiveSessionId': 'S1', 'teamsSessionNumber': 2})]
        rows = [occurrence(), occurrence(session_id='O2', session_number=2)]
        self.assertEqual(self.project(components, rows), {('C1', 'M1'): (True, NOW)})

    def test_shared_delivery_uses_module_specific_correction(self):
        row = occurrence(session_id='O1:M1', attendance_source_occurrence_id='O1')
        self.assertEqual(self.project(occurrences=[row]), {})
        self.assertEqual(self.project(occurrences=[row], adjustments=[adjustment(source_id='O1:M1')]),
                         {('C1', 'M1'): (True, NOW)})

    def test_legacy_occurrence_identity_is_supported(self):
        self.assertEqual(self.project([component(settings_json={'legacySettings': {'teamsOccurrenceId': 'O1'}})]),
                         {('C1', 'M1'): (True, NOW)})

    def test_ambiguous_component_or_occurrence_does_not_complete(self):
        self.assertEqual(self.project([component(), component(id='C2')]), {})
        self.assertEqual(self.project(occurrences=[occurrence(), occurrence()]), {})

    def test_coach_free_form_record_requires_module_title_session_title_and_day(self):
        self.assertEqual(self.project(adjustments=[], manual_rows=[manual()]), {('C1', 'M1'): (True, NOW)})
        for change in ({'module_name': 'Module two'}, {'session_title': 'Lecture 2'}, {'session_date': date(2026, 10, 23)}):
            self.assertEqual(self.project(adjustments=[], manual_rows=[manual(**change)]), {})

    def test_free_form_match_normalizes_case_and_whitespace_only(self):
        self.assertEqual(self.project(adjustments=[], manual_rows=[manual(module_name=' MODULE  ONE ', session_title='lecture 1')]),
                         {('C1', 'M1'): (True, NOW)})
        self.assertEqual(self.project(adjustments=[], manual_rows=[manual(session_title='Lecture')]), {})

    def test_duplicate_free_form_records_do_not_guess_and_absent_is_respected(self):
        self.assertEqual(self.project(adjustments=[], manual_rows=[manual(), manual(status='absent')]), {})
        self.assertEqual(self.project(adjustments=[], manual_rows=[manual(status='absent')]), {('C1', 'M1'): (False, NOW)})

    def test_occurrence_correction_takes_priority_over_free_form_record(self):
        self.assertEqual(self.project(adjustments=[adjustment(status='absent')], manual_rows=[manual()]),
                         {('C1', 'M1'): (False, NOW)})

    def test_corrected_card_still_counts_when_checking_free_text_ambiguity(self):
        cards = [component(), component(id='C2', settings_json={'teamsOccurrenceId': 'O2'})]
        rows = [occurrence(), occurrence(session_id='O2')]
        self.assertEqual(self.project(cards, rows, [adjustment()], [manual()]), {('C1', 'M1'): (True, NOW)})

    def test_same_titles_in_two_modules_never_guess_from_free_text(self):
        cards = [component(), component(id='C2', module_catalogue_id='M2')]
        rows = [occurrence(), occurrence(module_catalogue_id='M2')]
        self.assertEqual(project_manual_completion(cards, rows, [], [manual()],
                         {'M1': 'Module one', 'M2': 'Module one'}, now=NOW), {})

    def test_unlinked_authored_session_can_use_exact_manual_match(self):
        card = component(settings_json={'sessionDate': '2026-10-24'})
        self.assertEqual(self.project([card], [], [], [manual()]), {('C1', 'M1'): (True, NOW)})
        self.assertEqual(self.project([card, {**card, 'id': 'C2'}], [], [], [manual()]), {})

    def test_invalid_or_future_unlinked_dates_and_broken_links_do_not_match(self):
        for settings in ({'sessionDate': 'bad'}, {'sessionDate': '2026-10-26'},
                         {'sessionDate': '2026-10-24', 'teamsOccurrenceId': 'missing'}):
            self.assertEqual(self.project([component(settings_json=settings)], [], [], [manual()]), {})

    def test_kbc_coach_correction_uses_exact_match(self):
        record = adjustment(source='kbc-attendance', source_id='legacy-key', **vars(manual()))
        self.assertEqual(self.project(adjustments=[record]), {('C1', 'M1'): (True, NOW)})

    def test_reader_scopes_both_ledgers_by_profile_not_enrolment(self):
        with patch('coach_api.models.CoachAttendanceSourceAdjustment.objects') as corrections, \
             patch('coach_api.models.CoachManualAttendance.objects') as records:
            corrections.filter.return_value = []
            records.filter.return_value = []
            self.assertEqual(read_manual_completion([{'moduleId': 'M1'}], SimpleNamespace(pk=7, enrolment_id=70)), {})
        corrections.filter.assert_called_once_with(learner_id=7)
        records.filter.assert_called_once_with(learner_id=7)

    def test_reader_loads_all_module_cards_to_keep_single_card_reads_unambiguous(self):
        with patch('coach_api.models.CoachAttendanceSourceAdjustment.objects') as corrections, \
             patch('coach_api.models.CoachManualAttendance.objects') as records, \
             patch('curriculum_api.models.ModuleAuthoringComponent.objects') as cards, \
             patch('curriculum_api.models.ModuleAuthoringModule.objects') as modules, \
             patch('learner_api.attendance_lectures.read_native_occurrences', return_value=[occurrence()]), \
             patch('learner_api.manual_attendance_completion.timezone.now', return_value=NOW):
            corrections.filter.return_value = [adjustment()]
            records.filter.return_value = []
            modules.using.return_value.filter.return_value.values_list.return_value = [('M1', 'Module one')]
            cards.using.return_value.filter.return_value.values.return_value = [component(), component(id='C2')]
            result = read_manual_completion([{'componentId': 'C1', 'moduleId': 'M1'}],
                                            SimpleNamespace(pk=7, enrolment_id=70, email='synthetic@example.invalid'))
        self.assertEqual(result, {})
        self.assertNotIn('id__in', cards.using.return_value.filter.call_args.kwargs)


class ManualAttendanceHoursTests(SimpleTestCase):
    def credits(self, hours=2.5, *, present=True, candidates=None, occurrences=None):
        return project_manual_credits(
            candidates if candidates is not None else [{'componentId': 'C1', 'moduleId': 'M1'}],
            {('C1', 'M1'): (present, NOW)},
            [component(expected_otjh=hours)], [occurrence()] if occurrences is None else occurrences)

    def test_uses_each_components_authored_otj_hours(self):
        for hours in (2.5, 1, 3.25, 0, '2.50'):
            credit = self.credits(hours)[0]
            self.assertEqual(credit['hours'], float(hours))
            self.assertEqual(credit['occurrenceId'], 'O1')
            self.assertEqual(credit['sessionDate'], '2026-10-24')
            self.assertEqual(credit['timeTrackingSource'], 'manual_attendance')
            self.assertNotIn('verifiedSeconds', credit)

    def test_absence_or_different_component_and_module_never_receive_hours(self):
        self.assertEqual(self.credits(present=False), [])
        self.assertEqual(self.credits(candidates=[{'componentId': 'C2', 'moduleId': 'M1'}]), [])
        self.assertEqual(self.credits(candidates=[{'componentId': 'C1', 'moduleId': 'M2'}]), [])

    def test_missing_hours_do_not_invent_a_default_and_invalid_hours_are_rejected(self):
        self.assertEqual(self.credits(None)[0]['hours'], 0)
        for hours in (-1, 'bad', 'NaN', float('inf')):
            self.assertEqual(self.credits(hours), [])

    def test_repeated_components_only_receive_one_credit(self):
        card = component(expected_otjh=2.5)
        credits = project_manual_credits([{'componentId': 'C1', 'moduleId': 'M1'}],
            {('C1', 'M1'): (True, NOW)}, [card, card], [occurrence()])
        self.assertEqual(len(credits), 1)

    def test_profile_is_resolved_by_enrolment_and_never_reuses_another_learners_profile(self):
        from .live_session_progress import read_manual_live_credits
        profile = SimpleNamespace(pk=7, enrolment_id=70, email='synthetic@example.invalid')
        for kind in ('commercial', 'apprenticeship'):
            source = SimpleNamespace(pk=70, learner_type=kind,
                                     _case_file_profile=SimpleNamespace(pk=8, enrolment_id=80))
            with patch('learner_api.models.LearnerProfile.objects') as profiles, \
                 patch('learner_api.manual_attendance_completion.read_manual_credit_evidence', return_value=({}, [])) as evidence:
                profiles.filter.return_value.only.return_value.__getitem__.return_value = [profile]
                self.assertEqual(read_manual_live_credits(source, [{'componentId': 'C1', 'moduleId': 'M1'}]), ({}, []))
                profiles.filter.assert_called_once_with(enrolment_id=70)
                self.assertIs(evidence.call_args.args[1], profile)

    def test_missing_or_ambiguous_profile_never_grants_hours(self):
        from .live_session_progress import read_manual_live_credits
        for found in ([], [SimpleNamespace(pk=7), SimpleNamespace(pk=8)]):
            with patch('learner_api.models.LearnerProfile.objects') as profiles, \
                 patch('learner_api.manual_attendance_completion.read_manual_credit_evidence') as evidence:
                profiles.filter.return_value.only.return_value.__getitem__.return_value = found
                self.assertEqual(read_manual_live_credits(SimpleNamespace(pk=70), []), ({}, []))
                evidence.assert_not_called()
