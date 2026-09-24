from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import versioning
from system_audit import activity, pages, writes


class RequestContextTests(SimpleTestCase):
    def tearDown(self):
        versioning.discard_context()
        versioning.set_actor(None)

    def test_page_is_resolved_without_query_strings_or_client_actor(self):
        request = RequestFactory().post('/coach_api/marking/?token=secret',
                                        HTTP_X_AUDIT_PAGE='/tutor/marking?token=secret#private')
        metadata = versioning.request_metadata(request)
        self.assertEqual(metadata['page_workspace'], 'tutor')
        self.assertEqual(metadata['page_path'], '/tutor/marking')
        self.assertEqual(metadata['request_path'], '/coach_api/marking/')
        self.assertNotIn('secret', str(metadata))

    def test_content_runner_writes_have_page_context_even_when_visits_are_excluded(self):
        request = RequestFactory().post('/learner_api/submit/', HTTP_X_AUDIT_PAGE='/learner/quiz/apprenticeship/7/q1')
        self.assertEqual(versioning.request_metadata(request)['page_workspace'], 'learner')

    def test_external_or_credential_paths_are_not_kept_as_pages(self):
        for path in ('https://evil.example/x', '//evil.example/x', '/reset-password/private-token'):
            request = RequestFactory().post('/api/save/', HTTP_X_AUDIT_PAGE=path)
            self.assertNotIn('page_path', versioning.request_metadata(request))

    def test_request_context_and_identity_are_cleared_after_failure(self):
        request = RequestFactory().post('/api/save/', HTTP_X_AUDIT_PAGE='/curriculum/modules/7')
        request.login_account = SimpleNamespace(email='tester@example.invalid', display_name='Test Actor')
        def fail(req):
            self.assertEqual(versioning.current_context()['metadata']['page_path'], '/curriculum/modules/7')
            raise ValueError('test failure')
        with self.assertRaises(ValueError):
            versioning.ActorMiddleware(fail)(request)
        self.assertEqual(versioning.current_context(), {})
        self.assertFalse(versioning.current_actor()['email'])

    def test_empty_workspace_never_broadens_to_all_changes(self):
        with patch.object(versioning, 'metadata_columns_available', return_value=False):
            clause, params = writes.revision_workspace_clause('unknown-workspace')
            # Still nothing, whatever else the clause filters.
            self.assertTrue(clause.startswith('(1 = 0) and '))
            self.assertEqual(params, [])

    def test_all_workspaces_are_filterable(self):
        options = {row['value'] for row in pages.workspace_options()}
        self.assertTrue({'enrolment', 'learner', 'coach', 'curriculum', 'tutor'} <= options)

    def test_history_without_a_page_is_not_assigned_by_overlapping_timestamps(self):
        change = {'at': '2026-09-23T09:00:00', 'metadata': {}, 'placed': False}
        events = [{'kind': 'page_view', 'id': 1, 'visit_id': 'one', 'path': '/coach',
                   'occurred_at': '2026-09-23T09:00:00'}]
        activity.build_visits(events, [change])
        self.assertFalse(change['placed'])
