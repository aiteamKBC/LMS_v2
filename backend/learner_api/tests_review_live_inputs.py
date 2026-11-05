"""Live Dashboard inputs for reviews, with no database or external calls."""
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError

from . import journal_sources, review_live_inputs as inputs


class ReviewLiveInputsTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=201, learner_type='commercial')
        self.profile = SimpleNamespace(pk=101, enrolment_id=201, completed_hours=21.9,
                                       planned_hours=130.9, target_hours=40)
        self.owner = {'id': 101, 'enrolment_id': 201}
        self.metrics = {'otjh': {'actual': 177.36, 'completed_actual': 177.36, 'planned': 560},
                        'programme': {'completed': 9, 'total': 10},
                        'ksb': {'completed': 159, 'total': 166, 'percent': 95.78}}
        self.modules = [{'id': 'current:M1', 'completed': 27, 'total': 261},
                        {'id': 'legacy:50', 'completed': 46, 'total': 140}]
        for name, target, value in [
            ('identity', inputs.canonical_learning, self.owner),
            ('metrics', inputs.canonical_learning, {201: self.metrics}),
            ('modules', inputs, {'modules': self.modules, 'nativeComponents': [],
                                'historicalComponents': 140, 'retainedComponents': 0}),
        ]:
            attribute = {'identity': 'require_profile', 'metrics': 'metrics_bulk',
                         'modules': 'canonical_module_facts'}[name]
            patcher = patch.object(target, attribute, return_value=value)
            setattr(self, name + '_read', patcher.start())
            self.addCleanup(patcher.stop)
        patcher = patch.object(inputs, 'plan_planned_hours', return_value=500)
        self.plan_read = patcher.start()
        self.addCleanup(patcher.stop)

    def read(self):
        return inputs.read_live_inputs(self.source, self.profile, as_of=self.now)

    now = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)

    def test_dashboard_inputs_replace_stale_columns_without_writes_or_extra_hours(self):
        before = deepcopy(vars(self.profile))
        result = self.read()
        self.assertEqual(result['otjh'], self.metrics['otjh'])
        self.assertEqual(result['ksb'], self.metrics['ksb'])
        self.assertEqual(result['modules'], self.modules)
        self.assertEqual(vars(self.profile), before)
        self.identity_read.assert_called_once_with(201)
        self.metrics_read.assert_called_once_with([201], learner_workspace=True, as_of=self.now)
        self.modules_read.assert_called_once_with(self.source, self.profile, as_of=self.now)
        self.plan_read.assert_not_called()

    def test_caller_perspective_is_restored_on_success_and_failure(self):
        observed = []
        def metrics(*args, **kwargs):
            observed.append(journal_sources.enabled())
            return {201: self.metrics}
        self.assertFalse(journal_sources.enabled())
        self.metrics_read.side_effect = metrics
        self.read()
        self.modules_read.side_effect = ServiceError('Synthetic unavailable catalogue')
        with self.assertRaisesMessage(inputs.UnavailableReviewProgress, 'Synthetic unavailable catalogue'):
            self.read()
        self.assertEqual(observed, [True, True])
        self.assertFalse(journal_sources.enabled())

    def test_missing_live_programme_plan_uses_only_dashboard_fallback(self):
        self.metrics['otjh']['planned'] = None
        self.assertEqual(self.read()['otjh']['planned'], 500)
        self.plan_read.assert_called_once_with(self.source, self.owner)
        self.assertIsNone(self.metrics['otjh']['planned'])

    def test_zero_programme_plan_does_not_trigger_fallback(self):
        self.metrics['otjh']['planned'] = 0
        self.assertEqual(self.read()['otjh']['planned'], 0)
        self.plan_read.assert_not_called()

    def test_conflicting_profile_enrolment_and_source_namespaces_fail_before_reads(self):
        for enrolment_id, source_id in [(None, 201), (201, 101), (201, 10624)]:
            with self.subTest(enrolment_id=enrolment_id, source_id=source_id):
                self.profile.enrolment_id = enrolment_id
                self.source.pk = source_id
                with self.assertRaises(inputs.UnavailableReviewProgress):
                    self.read()
        self.identity_read.assert_not_called()
        self.metrics_read.assert_not_called()

    def test_foreign_owner_is_rejected_without_loading_metrics_or_modules(self):
        for owner in [{'id': 999, 'enrolment_id': 201}, {'id': 101, 'enrolment_id': 999}]:
            self.identity_read.return_value = owner
            with self.assertRaises(inputs.UnavailableReviewProgress):
                self.read()
        self.metrics_read.assert_not_called()
        self.modules_read.assert_not_called()

    def test_canonical_identity_conflict_has_no_stale_column_fallback(self):
        self.metrics_read.return_value = {201: None}
        with self.assertRaises(inputs.UnavailableReviewProgress):
            self.read()
        self.modules_read.assert_not_called()
        self.plan_read.assert_not_called()

    def test_identity_error_is_a_safe_review_conflict(self):
        self.identity_read.side_effect = ServiceError('The consolidated learner identity needs review.')
        with self.assertRaisesMessage(ValueError, 'The consolidated learner identity needs review.'):
            self.read()
        self.metrics_read.assert_not_called()

    def test_both_learner_types_use_the_same_dashboard_read(self):
        first = self.read()
        self.source.learner_type = 'apprenticeship'
        self.assertEqual(self.read(), first)

    def test_only_finite_nonnegative_numbers_are_accepted_and_zero_is_valid(self):
        for value in (None, '', True, 'bad', 'NaN', 'Infinity', '-1', '1e999'):
            with self.subTest(value=value), self.assertRaises(inputs.UnavailableReviewProgress):
                inputs.nonnegative_number(value, 'OTJ hours')
        self.assertEqual(inputs.nonnegative_number(0, 'OTJ hours'), 0)
        self.assertEqual(inputs.nonnegative_number('177.36', 'OTJ hours'), 177.36)
