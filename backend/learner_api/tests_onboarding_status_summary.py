"""The learner summary says whether the enrolment wizard is handed in.

The learner sidebar keeps an onboarding apprentice's Reviews locked until it is,
so the summary (which already drives that sidebar) carries it.

SimpleTestCase with the model mocked: no database is touched.
"""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import learner_detail as detail


def _source(onboarding_status):
    return SimpleNamespace(
        id=125, username='Learner', email='learner@example.test', phone_number='', programme='Programme',
        programme_status='Onboarding', cohort='', group='', employer='', employer_id=None, organization='',
        learner_type='apprenticeship', aptem_id=None, start_date=None, end_date=None,
        practical_period_end_date=None, apprenticeship_end_date=None, onboarding_status=onboarding_status,
    )


class SummaryOnboardingStatusTests(SimpleTestCase):
    def summary(self, onboarding_status):
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = _source(onboarding_status)
        with patch.object(detail, 'SOURCE_MODELS', {'apprenticeship': model}), \
                patch.object(detail, 'access_gate', return_value={'blocked': False}):
            response = detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'apprenticeship', 125)
        return json.loads(response.content), model

    def test_reports_a_submitted_enrolment(self):
        payload, model = self.summary('Submitted')
        self.assertEqual(payload['onboardingStatus'], 'Submitted')
        self.assertIn('onboarding_status', model.all_learners.only.call_args.args)

    def test_reports_an_unset_status_as_empty(self):
        payload, _ = self.summary(None)
        self.assertEqual(payload['onboardingStatus'], '')
