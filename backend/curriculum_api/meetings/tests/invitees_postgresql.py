"""Synthetic ORM/HTTP comparisons, loaded only by the verified isolated PG runner."""
import ast
import json
from pathlib import Path
import unittest
from unittest.mock import patch


def suite(fixtures):
    from django.test import RequestFactory
    from curriculum_api import views
    from curriculum_api.meetings.api import invitees
    from curriculum_api.meetings.application import invitee_queries
    from curriculum_api.meetings.infrastructure import invitee_reads

    source = json.loads((Path(__file__).parent / 'fixtures/lifecycle_snapshot.json').read_text(encoding='utf-8'))
    namespace = dict(vars(views))
    node = ast.parse(source['functions']['curriculum_module_meeting_invitees']['source']).body[0]
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<original-invitees>', 'exec'), namespace)
    original = namespace['curriculum_module_meeting_invitees']
    lm = fixtures['lm']

    class InviteePostgresqlParity(unittest.TestCase):
        # Reuse only setup, not the base class's unrelated test methods.
        setUp = fixtures['MembershipIntegration'].setUp

        def test_actual_http_reads_normalized_assignments_without_placement_or_lifecycle_filters(self):
            lm.LearnerTrainingPlanModule.objects.create(learner_id=6, position=1, curriculum_module_id='MOD-TEST')
            expected = original(RequestFactory().get('/synthetic/'), 'MOD-TEST')
            with patch.object(invitees, 'curriculum_module_meeting_invitees',
                              wraps=invitees.curriculum_module_meeting_invitees) as api, \
                    patch.object(invitee_queries, 'module_invitee_payload',
                                 wraps=invitee_queries.module_invitee_payload) as application, \
                    patch.object(invitee_reads, 'module_invitee_sources',
                                 wraps=invitee_reads.module_invitee_sources) as infrastructure:
                actual = self.client.get('/curriculum_api/curriculum/modules/MOD-TEST/meeting-invitees/')
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
            self.assertEqual(actual.json()['attendees'], [
                'profile2@example.invalid', 'profile4@example.invalid', 'profile6@example.invalid'])
            api.assert_called_once()
            application.assert_called_once()
            infrastructure.assert_called_once()

        def test_http_post_is_still_rejected_before_querying_invitees(self):
            expected = original(RequestFactory().post('/synthetic/'), 'MOD-TEST')
            with patch.object(invitee_reads, 'module_invitee_sources') as infrastructure:
                actual = self.client.post('/curriculum_api/curriculum/modules/MOD-TEST/meeting-invitees/')
            self.assertEqual(actual.status_code, expected.status_code)
            self.assertEqual(actual.status_code, 405)
            self.assertEqual(actual['Allow'], expected['Allow'])
            infrastructure.assert_not_called()

    return unittest.defaultTestLoader.loadTestsFromTestCase(InviteePostgresqlParity)
