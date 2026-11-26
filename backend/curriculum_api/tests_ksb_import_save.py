"""Workbook-generated mapping ids must survive full and partial structure saves."""
import copy

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceTransactionHarness
from curriculum_api.tests_partial_structure_save import delta_between
from coach_api.tests_support.persisted_fixtures import curriculum_session


class KsbWorkbookSaveTests(CurriculumPersistenceTransactionHarness):
    def setUp(self):
        super().setUp()
        curriculum_session(self, self.client)
        response = self.post_json('/curriculum_api/curriculum/modules/', {
            'moduleType': 'authoring', 'title': 'Workbook identities', 'weeks': 1,
            'weekStructure': [{'id': 'WEEK-IMPORT', 'weekNumber': 1, 'title': 'Content',
                'components': [
                    {'id': component_id, 'type': 'video', 'title': component_id,
                     'settings': {'videoUrl': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},
                     'ksbMappings': [{'code': 'K1', 'description': 'Data basics', 'classification': 'main',
                         'weight_class': 'hard', 'weight': 40,
                         'sourceType': 'framework', 'sourceId': 'KSBP-DATA'}]}
                    for component_id in ('COMP-IMPORT', 'COMP-UNTOUCHED')
                ]}],
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.module_id = response.json()['moduleCatalogueId']
        self.url = f'/curriculum_api/curriculum/modules/{self.module_id}/structure/'

    def read(self):
        response = self.client.get(self.url, HTTP_CACHE_CONTROL='no-cache')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def rows(self):
        return views.authoring_fetch_all(views.AUTHORING_KSB_MAPPINGS_TABLE,
                                        'module_catalogue_id = %s', [self.module_id])

    def save(self, base, current, partial=False):
        payload = {**current, 'expectedRevision': base['structureRevision']}
        if partial:
            payload = {key: value for key, value in payload.items() if key not in {'weekStructure', 'weeks'}}
            payload.update(saveMode='partial', structureDelta=delta_between(base, current))
        response = self.patch_json(self.url, payload)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def assert_import_save(self, partial):
        base = self.read()
        old_mapping = base['weekStructure'][0]['components'][0]['ksbMappings'][0]
        before = {row['id']: row for row in self.rows()}
        current = copy.deepcopy(base)
        imported = current['weekStructure'][0]['components'][0]['ksbMappings'][0]
        imported.update(id='KSBMAP-FROM-WORKBOOK', weight=25, type='secondary',
                        classification='secondary', weightClass='soft', weight_class='soft')

        saved = self.save(base, current, partial)

        mapping = saved['weekStructure'][0]['components'][0]['ksbMappings'][0]
        self.assertEqual((mapping['id'], mapping['weight'], mapping['weightClass']),
                         (old_mapping['id'], 25, 'soft'))
        after = {row['id']: row for row in self.rows()}
        self.assertEqual(set(after), set(before))
        self.assertEqual(after[old_mapping['id']]['created_at'], before[old_mapping['id']]['created_at'])
        self.assertIsNone(after[old_mapping['id']]['deleted_at'])
        self.assertEqual(float(after[old_mapping['id']]['weight']), 25)
        other = next(row for row in after.values() if row['component_id'] == 'COMP-UNTOUCHED')
        self.assertEqual(float(other['weight']), 40)
        if partial:
            self.assertEqual(other['updated_at'], before[other['id']]['updated_at'])
        component = views.authoring_fetch_all(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-IMPORT'])[0]
        inline = views.as_json_value(component['ksb_mappings'], [])
        self.assertEqual(inline[0]['id'], old_mapping['id'])
        self.assertEqual(inline[0]['weight'], 25)

    def test_full_save_accepts_new_workbook_ids_for_existing_mappings(self):
        self.assert_import_save(partial=False)

    def test_partial_save_accepts_new_workbook_ids_without_rewriting_other_components(self):
        self.assert_import_save(partial=True)

    def test_import_can_restore_a_previously_removed_mapping(self):
        base = self.read()
        original = base['weekStructure'][0]['components'][0]['ksbMappings'][0]
        current = copy.deepcopy(base)
        current['weekStructure'][0]['components'][0]['ksbMappings'] = []
        removed = self.save(base, current, partial=True)
        withdrawn = next(row for row in self.rows() if row['id'] == original['id'])
        self.assertIsNotNone(withdrawn['deleted_at'])
        current = copy.deepcopy(removed)
        current['weekStructure'][0]['components'][0]['ksbMappings'] = [{**original, 'id': 'KSBMAP-REIMPORTED'}]

        restored = self.save(removed, current, partial=True)

        self.assertEqual(restored['weekStructure'][0]['components'][0]['ksbMappings'][0]['id'], original['id'])
        rows = [row for row in self.rows() if row['component_id'] == 'COMP-IMPORT']
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['deleted_at'])
