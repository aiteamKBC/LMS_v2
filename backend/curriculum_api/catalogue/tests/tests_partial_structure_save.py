import copy

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'


def delta_between(base, current):
    """The structureDelta the Module Builder sends (moduleStructureDelta)."""
    base_weeks = {week['id']: week for week in base['weekStructure']}
    base_components = {c['id']: c for week in base['weekStructure'] for c in week['components']}
    delta = {'weekOrder': [], 'componentOrder': {}, 'weeks': {}, 'components': {}}
    for week in current['weekStructure']:
        fields = {key: value for key, value in week.items() if key != 'components'}
        delta['weekOrder'].append(week['id'])
        delta['componentOrder'][week['id']] = [c['id'] for c in week['components']]
        base_week = base_weeks.get(week['id'])
        if base_week is None or {k: v for k, v in base_week.items() if k != 'components'} != fields:
            delta['weeks'][week['id']] = fields
        for component in week['components']:
            if base_components.get(component['id']) != component:
                delta['components'][component['id']] = component
    return delta


class PartialStructureSaveTests(CurriculumPersistenceHarness):
    """A partial save writes only what changed, and stores what a full save would."""

    def setUp(self):
        super().setUp()
        response = self.post_json('/curriculum_api/curriculum/modules/', {
            'moduleType': 'authoring', 'title': 'Partial saves', 'weeks': 2, 'sessionsNumber': 2,
            'weekStructure': [{'weekNumber': index + 1, 'title': f'Week {index + 1}', 'components': []} for index in range(2)],
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.module_id = response.json()['moduleCatalogueId']
        structure = views.get_authoring_structure_payload(self.module_id)
        for week in structure['weekStructure']:
            number = week['weekNumber']
            week['components'] = [
                {'id': f'COMP-V{number}{index}', 'type': 'video', 'title': f'Video {number}.{index}',
                 'settings': {'videoUrl': VIDEO},
                 # No id, deliberately: such a mapping is minted a fresh id on
                 # every save, which is the case the content comparison is for.
                 'ksbMappings': [{'code': 'K1', 'description': 'Data basics', 'classification': 'main',
                                  'weight_class': 'hard', 'weight': 1,
                                  'sourceType': 'framework', 'sourceId': 'KSBP-DATA'}]}
                for index in range(3)
            ]
        views.save_module_authoring_structure(self.module_id, structure)
        self.url = f'/curriculum_api/curriculum/modules/{self.module_id}/structure/'

    def read(self):
        response = self.client.get(self.url, HTTP_CACHE_CONTROL='no-cache')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def stamps(self, table):
        return {
            row['id']: (row['updated_at'], row.get('deleted_at'))
            for row in views.authoring_fetch_all(table, 'module_catalogue_id = %s', [self.module_id])
        }

    def partial(self, base, current, **extra):
        module_fields = {key: value for key, value in current.items() if key not in {'weekStructure', 'weeks'}}
        return self.patch_json(self.url, {
            **module_fields,
            'expectedRevision': base['structureRevision'],
            'saveMode': 'partial',
            'structureDelta': delta_between(base, current),
            **extra,
        })

    def without_volatile(self, payload):
        return [
            [(c['id'], c['title'], c['settings'], [m.get('code') for m in c['ksbMappings']]) for c in week['components']]
            for week in payload['weekStructure']
        ]

    def test_an_unchanged_module_writes_no_week_component_or_mapping_rows(self):
        base = self.read()
        before = {table: self.stamps(table) for table in (views.AUTHORING_WEEKS_TABLE, views.AUTHORING_COMPONENTS_TABLE, views.AUTHORING_KSB_MAPPINGS_TABLE)}

        response = self.partial(base, copy.deepcopy(base))

        self.assertEqual(response.status_code, 200, response.content)
        for table, stamps in before.items():
            with self.subTest(table=table):
                self.assertEqual(self.stamps(table), stamps)

    def test_only_the_edited_component_is_written(self):
        base = self.read()
        current = copy.deepcopy(base)
        edited = current['weekStructure'][0]['components'][1]
        edited['title'] = 'Renamed video'
        before = self.stamps(views.AUTHORING_COMPONENTS_TABLE)

        response = self.partial(base, current)

        self.assertEqual(response.status_code, 200, response.content)
        after = self.stamps(views.AUTHORING_COMPONENTS_TABLE)
        changed = {row_id for row_id in after if after[row_id] != before.get(row_id)}
        self.assertEqual(changed, {edited['id']})
        self.assertEqual(response.json()['weekStructure'][0]['components'][1]['title'], 'Renamed video')

    def test_removing_moving_and_adding_components_need_no_unchanged_rows(self):
        base = self.read()
        current = copy.deepcopy(base)
        first, second = current['weekStructure']
        removed = first['components'].pop(0)
        moved = first['components'].pop(0)
        second['components'].insert(0, moved)
        second['components'].append({'id': 'COMP-NEW', 'type': 'video', 'title': 'Added', 'settings': {'videoUrl': VIDEO}, 'ksbMappings': []})

        response = self.partial(base, current)

        self.assertEqual(response.status_code, 200, response.content)
        saved = response.json()['weekStructure']
        self.assertEqual([c['id'] for c in saved[0]['components']], [c['id'] for c in first['components']])
        self.assertEqual([c['id'] for c in saved[1]['components']], [c['id'] for c in second['components']])
        rows = {row['id']: row for row in views.authoring_fetch_all(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [self.module_id])}
        self.assertIsNotNone(rows[removed['id']]['deleted_at'])
        self.assertEqual(rows[moved['id']]['week_id'], second['id'])
        self.assertIsNone(rows['COMP-NEW']['deleted_at'])

    def test_a_component_ksb_change_rewrites_only_that_components_mappings(self):
        base = self.read()
        current = copy.deepcopy(base)
        target = current['weekStructure'][1]['components'][2]
        target['ksbMappings'] = []
        mappings_before = self.stamps(views.AUTHORING_KSB_MAPPINGS_TABLE)

        response = self.partial(base, current)

        self.assertEqual(response.status_code, 200, response.content)
        rows = views.authoring_fetch_all(views.AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [self.module_id])
        touched = {row['component_id'] for row in rows if (row['updated_at'], row.get('deleted_at')) != mappings_before.get(row['id'])}
        self.assertEqual(touched, {target['id']})
        active_for_target = [row for row in rows if row['component_id'] == target['id'] and not row.get('deleted_at')]
        self.assertEqual(active_for_target, [])

    def test_stores_exactly_what_a_full_save_of_the_same_edit_stores(self):
        base = self.read()
        current = copy.deepcopy(base)
        current['weekStructure'][0]['title'] = 'Week one, renamed'
        current['weekStructure'][1]['components'][0]['settings']['videoUrl'] = 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
        partial = self.partial(base, current).json()

        full = views.save_module_authoring_structure(self.module_id, current)

        self.assertEqual(self.without_volatile(partial), self.without_volatile(full))
        self.assertEqual(partial['weekStructure'][0]['title'], 'Week one, renamed')

    def test_refuses_a_partial_save_it_cannot_place(self):
        base = self.read()
        current = copy.deepcopy(base)
        current['weekStructure'][0]['title'] = 'Changed'

        stale = self.partial(base, current, expectedRevision='stale')
        self.assertEqual(stale.status_code, 409)
        self.assertTrue(stale.json()['conflict'])

        unknown = self.partial(base, current, structureDelta={
            **delta_between(base, current),
            'componentOrder': {base['weekStructure'][0]['id']: ['COMP-NOT-STORED']},
        })
        self.assertEqual(unknown.status_code, 409)
        self.assertTrue(unknown.json()['conflict'])

        no_revision = self.partial(base, current, expectedRevision='')
        self.assertEqual(no_revision.status_code, 400)
        self.assertEqual(self.read()['weekStructure'][0]['title'], base['weekStructure'][0]['title'])
