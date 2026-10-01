from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .read_model_signals import (
    enrolment_changed,
    learner_absence_changed,
    learner_detail_changed,
    profile_changed,
)


class LearnerHomeReadModelSignalTests(SimpleTestCase):
    @patch('learner_api.read_model_signals.enqueue_learner_home_refresh')
    def test_enrolment_change_targets_the_correct_learner_kind(self, enqueue):
        enrolment_changed(
            sender=object,
            instance=SimpleNamespace(pk=41, learner_type='commercial'),
            using='enrolment',
        )

        enqueue.assert_called_once_with(
            'commercial', 41, reason='enrolment', using='enrolment',
        )

    @patch('learner_api.read_model_signals.enqueue_learner_home_refresh')
    def test_profile_change_targets_its_enrolment(self, enqueue):
        profile_changed(
            sender=object,
            instance=SimpleNamespace(enrolment_id=42, learner_type='apprenticeship'),
            using='enrolment',
        )

        enqueue.assert_called_once_with(
            'apprenticeship', 42, reason='learner-profile', using='enrolment',
        )

    @patch('learner_api.read_model_signals.enqueue_learner_home_refresh')
    def test_progress_change_reuses_the_cached_profile_without_an_extra_query(self, enqueue):
        profile = SimpleNamespace(enrolment_id=43, learner_type='commercial')
        instance = SimpleNamespace(
            learner_id=7,
            _state=SimpleNamespace(fields_cache={'learner': profile}),
        )

        learner_detail_changed(sender=object, instance=instance, using='enrolment')

        enqueue.assert_called_once_with(
            'commercial', 43, reason='progress-or-plan', using='enrolment',
        )

    @patch('learner_api.read_model_signals._enqueue_enrolment')
    def test_absence_change_targets_the_learner(self, enqueue):
        learner_absence_changed(
            sender=object,
            instance=SimpleNamespace(learner_id=44),
            using='default',
        )

        enqueue.assert_called_once_with(44, using='default', reason='attendance-recovery')
