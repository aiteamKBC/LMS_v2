"""GET /curriculum/archive/ -- paging, nesting and filtering; synthetic rows, no database."""
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import archive_index


def record(kind, identifier, name, *, archived_at='', via='', by='', programme_id='', **extra):
    body = {
        'id': identifier, 'archivedAt': archived_at, 'archivedBy': by, 'archivedViaParent': via,
        'programmeId': programme_id, **extra,
    }
    body['title' if kind == 'module' else 'name'] = name
    if kind == 'programme':
        body['sourceId'] = identifier
    return {'kind': kind, 'key': f'{kind}:{identifier}', 'record': body}


RECORDS = [
    record('programme', 'PROG-OLD', 'Retired Programme', archived_at='2026-09-10T08:00:00Z', by='programme-delete'),
    record('cohort', 'COH-1', 'Spring Intake', archived_at='2026-09-10T08:00:00Z',
           via='PROG-OLD', by='programme-delete', programme_id='PROG-OLD', programme='Retired Programme'),
    record('group', 'GRP-1', 'Group A', archived_at='2026-09-10T08:00:00Z',
           via='COH-1', by='cohort-delete', programme_id='PROG-OLD', cohort='Spring Intake'),
    record('module', 'MOD-1', 'Data Foundations', archived_at='2026-10-01T09:00:00Z', programme_id='PROG-TL'),
    record('module', 'MOD-2', 'Project Management', archived_at='2026-08-01T09:00:00Z', programme_id='PROG-TL'),
]


class ArchiveIndexTests(SimpleTestCase):
    def get(self, **params):
        request = RequestFactory().get('/api/curriculum/archive/', params)
        with patch.object(archive_index, 'archive_records', return_value=[dict(item) for item in RECORDS]):
            response = archive_index.curriculum_archive_index(request)
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)

    def test_records_archived_with_a_parent_sit_under_its_root(self):
        payload = self.get()
        self.assertEqual([entry['key'] for entry in payload['results']],
                         ['module:MOD-1', 'programme:PROG-OLD', 'module:MOD-2'])
        programme = payload['results'][1]
        self.assertEqual([child['key'] for child in programme['children']], ['cohort:COH-1', 'group:GRP-1'])
        # Each child names the parent that took it down, not only the root.
        self.assertEqual(programme['children'][1]['archivedWith'], 'cohort:COH-1')
        self.assertEqual(payload['total'], 3)
        self.assertEqual(payload['counts'], {'programme': 1, 'cohort': 1, 'group': 1, 'module': 2})
        self.assertEqual(payload['archiveTotal'], 5)

    def test_a_type_filter_lists_that_type_flat_and_says_where_each_came_from(self):
        payload = self.get(type='group')
        self.assertEqual([entry['key'] for entry in payload['results']], ['group:GRP-1'])
        self.assertEqual(payload['results'][0]['archivedWith'], 'cohort:COH-1')
        self.assertEqual(payload['results'][0]['children'], [])

    def test_search_finds_a_child_inside_its_parent(self):
        payload = self.get(q='group a')
        self.assertEqual([entry['key'] for entry in payload['results']], ['programme:PROG-OLD'])
        self.assertEqual(payload['counts'], {'programme': 0, 'cohort': 0, 'group': 1, 'module': 0})
        # The hero's figures describe the archive, not the search.
        self.assertEqual(payload['totals'], {'programme': 1, 'cohort': 1, 'group': 1, 'module': 2})

    def test_programme_filter(self):
        payload = self.get(programme='PROG-TL')
        self.assertEqual([entry['key'] for entry in payload['results']], ['module:MOD-1', 'module:MOD-2'])

    def test_pages_are_cut_on_the_server_and_a_page_past_the_end_is_clamped(self):
        payload = self.get(pageSize='2', page='2')
        self.assertEqual((payload['page'], payload['pages']), (2, 2))
        self.assertEqual([entry['key'] for entry in payload['results']], ['module:MOD-2'])
        self.assertEqual(self.get(pageSize='2', page='9')['page'], 2)
        self.assertEqual(self.get(pageSize='5000')['pageSize'], archive_index.PAGE_SIZE_MAX)

    def test_a_key_answers_one_record_wherever_it_sits(self):
        self.assertEqual(self.get(key='group:GRP-1')['result']['record']['name'], 'Group A')
        self.assertIsNone(self.get(key='cohort:GONE')['result'])
