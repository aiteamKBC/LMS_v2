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


class BlankProgrammeStatusTests(SimpleTestCase):
    """A new account with no programme status is a 'Fresh user', not "unknown".

    The learner workspace reads this summary; given a blank it fell back to the
    full dashboard, and a brand-new apprentice never saw the first-login screens.
    """

    def test_a_blank_status_reads_as_fresh_user(self):
        for blank in ("", None):
            model = MagicMock()
            source = _source(None)
            source.programme_status = blank
            model.all_learners.only.return_value.get.return_value = source
            with patch.object(detail, 'SOURCE_MODELS', {'apprenticeship': model}), \
                    patch.object(detail, 'access_gate', return_value={'blocked': False}):
                response = detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'apprenticeship', 125)
            self.assertEqual(json.loads(response.content)['programmeStatus'], 'Fresh user', blank)

    def test_a_real_status_is_left_alone(self):
        payload, _ = SummaryOnboardingStatusTests.summary(self, 'Submitted')
        self.assertEqual(payload['programmeStatus'], 'Onboarding')  # _source's own status

    def test_new_learners_start_as_fresh_user(self):
        from .mappers import write_fields

        fields = write_fields({"username": "New Learner", "email": "new@example.test"}, require_create=True)
        self.assertEqual(fields["programme_status"], "Fresh user")

    def test_a_status_given_on_create_is_kept(self):
        from .mappers import write_fields

        fields = write_fields(
            {"username": "New Learner", "email": "new@example.test", "programmeStatus": "Onboarding"},
            require_create=True,
        )
        self.assertEqual(fields["programme_status"], "Onboarding")

    def test_an_update_never_stamps_a_status(self):
        from .mappers import write_fields

        self.assertNotIn("programme_status", write_fields({"phone": "07123456789"}))
