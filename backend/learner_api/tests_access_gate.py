"""Why a learner has not started yet, reported rather than applied.

The learner's own workspace used to assume there was one answer — "your start
date has not arrived" — and said it even when the date had passed months ago and
the real hold-up was an unassigned learning plan. access_gate answers with the
same conditions advance_learner checks, so the page can say what is true.
"""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from .learner_progression import access_gate

PAST = date(2025, 5, 1)


def _learner(**kwargs):
    fields = {
        'pk': 124,
        'learner_type': 'commercial',
        'programme_status': 'Delivery',
        'learning_plan': None,
        'training_plan': None,
        'start_date': PAST.isoformat(),
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


class AccessGateTests(SimpleTestCase):
    def _gate(self, learner, start=PAST, documents=None):
        with patch('learner_api.learner_progression._programme_start_date', return_value=start), \
                patch('learner_api.learner_progression.compliance_document_state',
                      return_value=documents or {}):
            return access_gate(learner)

    def test_a_commercial_learner_with_no_plan_is_waiting_on_the_plan(self):
        # The reported case: start date long past, no plan assigned.
        gate = self._gate(_learner())

        self.assertTrue(gate['blocked'])
        self.assertEqual(gate['reasons'], ['plan'])
        self.assertEqual(gate['startDate'], '2025-05-01')

    def test_a_start_date_still_ahead_is_reported_as_such(self):
        ahead = timezone.localdate() + timedelta(days=30)

        gate = self._gate(_learner(learning_plan=[{'moduleId': 'MOD-1'}]), start=ahead)

        self.assertEqual(gate['reasons'], ['start-date-future'])
        self.assertEqual(gate['startDate'], ahead.isoformat())

    def test_a_missing_start_date_is_its_own_reason(self):
        gate = self._gate(_learner(learning_plan=[{'moduleId': 'MOD-1'}]), start=None)

        self.assertEqual(gate['reasons'], ['start-date-missing'])
        self.assertEqual(gate['startDate'], '')

    def test_both_reasons_are_reported_when_both_apply(self):
        ahead = timezone.localdate() + timedelta(days=7)

        gate = self._gate(_learner(), start=ahead)

        self.assertEqual(gate['reasons'], ['plan', 'start-date-future'])

    def test_a_learner_with_everything_in_place_is_not_blocked(self):
        gate = self._gate(_learner(learning_plan=[{'moduleId': 'MOD-1'}]))

        self.assertFalse(gate['blocked'])
        self.assertEqual(gate['reasons'], [])

    def test_an_apprenticeship_learner_is_waiting_on_their_documents(self):
        learner = _learner(learner_type='apprenticeship')
        documents = {
            'apprenticeshipAgreement': True,
            'ilr': False,
            'trainingPlan': False,
            'writtenAgreement': True,
        }

        gate = self._gate(learner, documents=documents)

        self.assertIn('documents', gate['reasons'])
        self.assertEqual(
            gate['outstandingDocuments'], ['Individual Learner Record', 'Training Plan'],
        )
        # An apprenticeship learner's plan is not a gate; their documents are.
        self.assertNotIn('plan', gate['reasons'])

    def test_an_apprenticeship_learner_with_signed_documents_waits_only_on_the_date(self):
        learner = _learner(learner_type='apprenticeship')
        signed = dict.fromkeys(
            ('apprenticeshipAgreement', 'ilr', 'trainingPlan', 'writtenAgreement'), True,
        )
        ahead = timezone.localdate() + timedelta(days=3)

        gate = self._gate(learner, start=ahead, documents=signed)

        self.assertEqual(gate['reasons'], ['start-date-future'])

    def test_a_learner_already_active_is_asked_nothing(self):
        gate = self._gate(_learner(programme_status='Active'))

        self.assertFalse(gate['blocked'])
        self.assertEqual(gate['reasons'], [])

    def test_a_withdrawn_learner_is_not_described_as_waiting(self):
        gate = self._gate(_learner(programme_status='Withdrawn'))

        self.assertFalse(gate['blocked'])

    def test_a_lookup_failure_reports_nothing_rather_than_raising(self):
        from django.db import DatabaseError

        with patch('learner_api.learner_progression._programme_start_date',
                   side_effect=DatabaseError('gone')):
            gate = access_gate(_learner())

        self.assertFalse(gate['blocked'])
        self.assertEqual(gate['reasons'], [])
