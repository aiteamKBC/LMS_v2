"""Current screens share accepted actuals; historical snapshots stay separate."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical, employer_portal, learner_detail, views
from .canonical_hours import profile_actual_hours
from progress_reviews_api.review_pack import _build_otj_section, NOT_AVAILABLE


class CurrentActualHoursTests(SimpleTestCase):
    def setUp(self):
        self.profile = SimpleNamespace(
            id=101, enrolment_id=201, completed_hours='9.00', target_hours='100',
            planned_hours='200', minimum_hours='180', training_plan_progress=[],
            ksbs=[], plan_modules=SimpleNamespace(all=lambda: []), updated_at=None,
            otjh_status='', full_name='Synthetic learner', email='synthetic@example.test',
            programme='Programme', cohort='', group_name='', start_date=date(2026, 1, 1),
        )
        self.facts = {201: {'profile_id': 101, 'actual': 87.125}}
        self.reader = self.enterContext(patch.object(canonical, 'otjh_summary_bulk', return_value=self.facts))

    def test_tutor_and_employer_show_current_hours_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.profile.learner_type = kind
                tutor = views._tutor_live_learner_row(self.profile, hour_summaries=self.facts)
                self.assertEqual(tutor['otjhHours'], 87.125)
                self.reader.assert_not_called()  # tutor consumes its bounded batch
                with patch.object(learner_detail, '_active_profile_for_source', return_value=self.profile):
                    employer = employer_portal._performance(kind, SimpleNamespace(pk=201))
                self.assertEqual(employer['completedHours'], '87.12')
                self.reader.reset_mock()
        self.assertEqual(self.profile.completed_hours, '9.00')

    def test_live_profile_uses_accepted_total_without_adding_review_hours_again(self):
        with patch.object(learner_detail, '_review_otjh_hours', return_value=(2, 10)), \
             patch.object(learner_detail, '_cumulative_week_target', return_value=50), \
             patch.object(learner_detail, '_week_target_rows', return_value=[]), \
             patch.object(learner_detail, '_week_component_count_rows', return_value=[]):
            result = learner_detail._live_otjh_snapshot({'totalExpectedOtjh': 200}, self.profile)
        self.assertEqual(float(result['completedHours']), 87.1)  # existing one-decimal contract
        self.assertEqual(float(result['plannedHours']), 202)
        self.assertEqual(self.profile.completed_hours, '9.00')

    def test_unavailable_or_different_profile_never_uses_cached_hours(self):
        for facts in ({}, {201: None}, {201: {'profile_id': 102, 'actual': 500}}):
            with self.subTest(facts=facts):
                self.assertIsNone(profile_actual_hours(self.profile, summaries=facts))

    def test_review_pack_actual_is_unavailable_when_current_metrics_fail(self):
        warnings = []
        result = _build_otj_section(SimpleNamespace(), self.profile, {}, None, warnings)
        self.assertEqual(result['completed_otj_hours'], NOT_AVAILABLE)
        self.assertEqual(result['variance'], NOT_AVAILABLE)
        self.assertIn('Current accepted OTJ hours are unavailable.', warnings)

    def test_reading_signed_review_keeps_its_frozen_legacy_actual_and_formula(self):
        from curriculum_api.review_instances import review_instance_progress_snapshot
        stored = {'schemaVersion': 4, 'formulaVersion': 'stored_completed_hours_and_component_ksb_v4',
                  'actualHoursSource': 'learner.completed_hours', 'offTheJobHours': {'actual': 9}}
        result = review_instance_progress_snapshot({'status': 'completed', 'progress_snapshot': stored})
        self.assertEqual(result, stored)
        self.assertEqual(result['offTheJobHours']['actual'], 9)
        self.reader.assert_not_called()
