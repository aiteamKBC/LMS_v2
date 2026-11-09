"""The group list reads the groups alone, never the whole curriculum payload.

GET /curriculum/groups/ used to build the full payload (34-49 s cold on the new
database) for 80 groups the light build returns identically in under a second.
"""
import json
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views

GROUPS = [
    {'id': 'GROUP-1', 'name': 'Group one', 'cohortId': 'COHORT-1', 'cohort': 'Cohort one'},
    {'id': 'GROUP-2', 'name': 'Group two', 'cohortId': 'COHORT-2', 'cohort': 'Cohort two'},
]


def passthrough(key, build, force=False, **kwargs):
    passthrough.keys.append(key)
    return build()


class GroupListReadTests(SimpleTestCase):
    def setUp(self):
        passthrough.keys = []
        patches = [
            mock.patch.object(views, 'get_cached_payload', side_effect=AssertionError('full curriculum payload built')),
            mock.patch.object(views, 'build_cohorts_and_groups', return_value=([], GROUPS)),
            mock.patch.object(views, 'cached_curriculum_value', side_effect=passthrough),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_lists_the_groups_without_building_the_full_payload(self):
        response = views.curriculum_groups(RequestFactory().get('/curriculum/groups/'))
        body = json.loads(response.content)
        self.assertEqual(body['schema'], views.CURRICULUM_SCHEMA)
        self.assertEqual([group['id'] for group in body['results']], ['GROUP-1', 'GROUP-2'])
        self.assertEqual(body['count'], 2)

    def test_keeps_the_cohort_filter(self):
        response = views.curriculum_groups(RequestFactory().get('/curriculum/groups/', {'cohortId': 'COHORT-2'}))
        self.assertEqual([group['id'] for group in json.loads(response.content)['results']], ['GROUP-2'])

    def test_shares_the_delivery_scope_cache_entry(self):
        views.curriculum_groups(RequestFactory().get('/curriculum/groups/', {'visibility': 'all'}))
        views.curriculum_delivery_scope(RequestFactory().get('/curriculum/delivery-scope/', {'visibility': 'all'}))
        self.assertEqual(passthrough.keys, ['delivery-scope:all', 'delivery-scope:all'])

    def test_archived_groups_are_asked_for_only_with_visibility_all(self):
        views.curriculum_groups(RequestFactory().get('/curriculum/groups/'))
        views.build_cohorts_and_groups.assert_called_with(include_archived=False)
        views.curriculum_groups(RequestFactory().get('/curriculum/groups/', {'visibility': 'all'}))
        views.build_cohorts_and_groups.assert_called_with(include_archived=True)
