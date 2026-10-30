import json
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase, RequestFactory
from django.db import DatabaseError
from . import learner_directory as directory


class AssignedLearnerDirectoryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        for context in (
            patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}),
            patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')),
        ):
            context.start(); self.addCleanup(context.stop)
        self.lineage = self.enterContext(patch('curriculum_api.views.scope_placement_lineage', return_value={'found': True}))
        self.members = self.enterContext(patch('curriculum_api.views.assigned_learners_for_scope'))
        self.cache = self.enterContext(patch('curriculum_api.views.cached_curriculum_value', side_effect=lambda key, load, **kwargs: load()))
        self.members.side_effect = lambda scope, identifier, status, **kwargs: [
            row for row in [
                {'id': 1, 'name': 'Active learner', 'email': 'active@example.invalid', 'lifecycleStatus': 'active'},
                {'id': 2, 'name': 'Former learner', 'email': 'former@example.invalid', 'lifecycleStatus': 'withdrawn'},
            ] if not status or row['lifecycleStatus'] == status
        ]

    def test_requested_list_reports_the_active_total_and_keeps_the_roster_out_of_shared_cache(self):
        result = json.loads(directory.learners(self.factory.get('/', {'scope': 'module', 'id': 'MOD-A'})).content)
        self.members.assert_called_once_with('module', 'MOD-A', 'active', lineage={'found': True}, strict=True)
        self.assertEqual((result['total'], result['learners'][0]['id']), (1, '1'))
        self.assertNotIn('learningPlan', result['learners'][0])
        self.cache.assert_not_called()
        response = directory.learners(self.factory.get('/', {'scope': 'module', 'id': 'MOD-A'}))
        self.assertEqual(self.members.call_count, 2)
        self.assertIn('no-store', response['Cache-Control'])

    def test_other_statuses_are_opt_in(self):
        result = json.loads(directory.learners(self.factory.get('/', {'scope': 'cohort', 'id': 'C-A', 'status': 'all'})).content)
        self.assertEqual(result['total'], 2)
        self.members.assert_called_once_with('cohort', 'C-A', '', lineage={'found': True}, strict=True)

    def test_pagination_search_and_unique_identity(self):
        rows = [{'id': i, 'name': f'Learner {i:02}', 'email': f'{i}@example.invalid'} for i in range(60)]
        self.members.side_effect = None; self.members.return_value = rows + [rows[0]]
        result = json.loads(directory.learners(self.factory.get('/', {'scope': 'programme', 'id': 'P-A', 'page': '2'})).content)
        self.assertEqual((result['total'], len(result['learners']), result['learners'][0]['id']), (60, 25, '25'))
        result = json.loads(directory.learners(self.factory.get('/', {'scope': 'programme', 'id': 'P-A', 'q': '59@'})).content)
        self.assertEqual((result['total'], result['filteredTotal'], result['learners'][0]['id']), (60, 1, '59'))

    def test_missing_record_is_distinct_from_empty_roster(self):
        self.lineage.return_value = {'found': False}
        self.assertEqual(directory.learners(self.factory.get('/', {'scope': 'group', 'id': 'G-A'})).status_code, 404)
        self.members.assert_not_called()

    def test_invalid_and_unbounded_requests_do_not_query_membership(self):
        for params in [{'scope': 'bad'}, {'id': ''}, {'id': 'x' * 201}, {'q': 'x' * 101}, {'page': 'oops'}, {'status': 'unknown'}, {'page': '0'}]:
            self.assertEqual(directory.learners(self.factory.get('/', {'scope': 'module', 'id': 'M', **params})).status_code, 400)
        self.members.assert_not_called()

    def test_only_staff_can_read_and_no_write_method_is_accepted(self):
        for account, expected in [(None, 401), (SimpleNamespace(role='learner'), 403), (SimpleNamespace(role='employer'), 403)]:
            with patch('login.permissions.authenticate_request', return_value=account):
                request = self.factory.get('/', {'scope': 'module', 'id': 'M'})
                self.assertEqual(directory.learners(request).status_code, expected)
        self.assertEqual(directory.learners(self.factory.post('/')).status_code, 405)
        self.members.assert_not_called()

    def test_one_programme_roster_read_is_shared_across_a_batch_but_not_requests(self):
        from . import views
        with patch.object(views, 'programme_identity_candidates', return_value=[]) as identity, \
             patch.object(views, 'learner_schema_table_exists', return_value=False):
            with views.curriculum_read_scope():
                views.assigned_learners_for_programme('P-A', 'active')
                views.assigned_learners_for_programme('P-A', 'active')
                views.assigned_learners_for_programme('P-A', '')
                self.assertEqual(identity.call_count, 2)
            views.assigned_learners_for_programme('P-A', 'active')
            self.assertEqual(identity.call_count, 3)

    def test_database_failure_is_not_reported_as_zero_or_an_empty_list(self):
        self.members.side_effect = DatabaseError('Private database detail')
        response = directory.learners(self.factory.get('/', {'scope': 'module', 'id': 'M'}))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('Private database detail', response.content.decode())
