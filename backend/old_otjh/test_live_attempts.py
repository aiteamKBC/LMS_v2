import gzip
import json
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, override_settings

from . import live_attempts


@override_settings(KBC_LMS_API_KEY='test-only-key')
class LiveAttemptTests(SimpleTestCase):
    def setUp(self):
        live_attempts._cache.clear()
        live_attempts._page_locks.clear()
        self.addCleanup(setattr, live_attempts, '_hints', None)
        live_attempts._hints = {'8': 2, '9': 2}

    def payload(self):
        quiz = {'attempted': True, 'passed': True, 'score': 100, 'maximum_score': 100, 'attempt_number': 1,
                'answers': [{'question_id': 1, 'question_body': 'The question', 'learner_answer': 'Own answer'}]}
        return {'pagination': {'page': 2, 'per_page': 20, 'total_pages': 3}, 'groups': [
            {'group_id': 7, 'learners': [
                {'learner_id': 8, 'activity_results': [{'activity_id': 99, 'quiz_result': quiz}]},
                {'learner_id': 999, 'activity_results': [{'activity_id': 99, 'quiz_result': {**quiz, 'answers': [{'learner_answer': 'Another student'}]}}]}]},
            {'group_id': 777, 'learners': [{'learner_id': 8, 'activity_results': [{'activity_id': 99, 'quiz_result': {**quiz, 'answers': [{'learner_answer': 'Other group'}]}}]}]}]}

    def response(self, payload):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.headers = {'Content-Encoding': 'gzip'}
        import io
        response.read.side_effect = io.BytesIO(gzip.compress(json.dumps(payload).encode())).read
        return response

    def test_ignored_upstream_filters_cannot_leak_a_different_student_or_group(self):
        with patch.object(live_attempts.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = self.response(self.payload())
            result = live_attempts.read({'lms_id': 8}, {(7, 99)})
        self.assertEqual(list(result), [(7, 99)])
        self.assertEqual(result[(7, 99)]['quiz_answers'][0]['learner_answer'], 'Own answer')
        self.assertNotIn('Another student', str(live_attempts._cache))
        self.assertNotIn('Other group', str(result))
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/all-students-schema?page=2&per_page=20')
        self.assertIsInstance(build.call_args.args[0], live_attempts.NoRedirect)

    def test_incorrect_page_echo_is_rejected(self):
        payload = self.payload()
        payload['pagination']['page'] = 1
        with patch.object(live_attempts.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = self.response(payload)
            self.assertEqual(live_attempts.read({'lms_id': 8}, {(7, 99)}), {})

    def test_expired_page_is_refetched_and_removed_answers_do_not_linger(self):
        with patch.object(live_attempts.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = self.response(self.payload())
            self.assertTrue(live_attempts.read({'lms_id': 8}, {(7, 99)}))
            for key, (_, value) in list(live_attempts._cache.items()):
                live_attempts._cache[key] = (0, value)
            payload = self.payload()
            payload['groups'][0]['learners'][0]['activity_results'] = []
            build.return_value.open.return_value = self.response(payload)
            self.assertEqual(live_attempts.read({'lms_id': 8}, {(7, 99)}), {})
        self.assertEqual(build.return_value.open.call_count, 2)

    def test_moved_hint_checks_identity_on_neighbouring_page(self):
        with patch.object(live_attempts, 'fetch_page', side_effect=[
            {'ids': {99}, 'learners': {99: {(7, 99): {'wrong': True}}}},
            {'ids': {8}, 'learners': {8: {(7, 99): {'activity_id': 99}}}}]):
            self.assertEqual(live_attempts.read({'lms_id': 8}, {(7, 99)}), {(7, 99): {'activity_id': 99}})

    def test_legacy_schema_proxy_filters_results_when_upstream_ignores_email(self):
        from learner_api.lms_schema import _learner_payload
        payload = {'groups': [
            {'group_id': 1, 'learners': [{'learner_email': 'own@example.org', 'learner_id': 8}, {'learner_email': 'other@example.org', 'learner_id': 9}]},
            {'group_id': 2, 'learners': [{'learner_email': 'other@example.org', 'learner_id': 9}]}],
            'future_roster_field': [{'learner_email': 'other@example.org'}]}
        result = _learner_payload(payload, ' OWN@example.org ')
        self.assertEqual(len(result['groups']), 1)
        self.assertEqual([r['learner_id'] for r in result['groups'][0]['learners']], [8])
        self.assertNotIn('other@example.org', str(result))
        self.assertEqual(_learner_payload(payload, 'absent@example.org')['groups'], [])
