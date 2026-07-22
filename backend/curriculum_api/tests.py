import json

from django.db import connection
from django.test import Client, TestCase

from . import views


class CurriculumPersistenceTests(TestCase):
    def setUp(self):
        views._AUTHORING_TABLES_READY = False
        views._PROGRAMME_CONFIG_DEDUP_READY = False
        views._TABLE_COLUMNS_CACHE.clear()
        views.invalidate_curriculum_cache()
        self.client = Client()
        self.ensure_programmes_table()
        self.ensure_ksb_profiles_table()
        views.ensure_module_authoring_tables()
        self.clear_curriculum_tables()
        self.seed_ksb_profile()

    def ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table_name = 'curriculum.programmes'
            else:
                table_name = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table_name} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    sub varchar(255),
                    standard varchar(255),
                    level varchar(64),
                    owner varchar(255),
                    created_by varchar(255),
                    color varchar(32),
                    description text,
                    structure_type varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def ensure_ksb_profiles_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table_name = 'curriculum.ksb_profiles'
                json_type = 'jsonb'
            else:
                table_name = 'ksb_profiles'
                json_type = 'text'
            cursor.execute(
                f"""
                create table if not exists {table_name} (
                    id varchar(128) primary key,
                    name varchar(255),
                    programme_name varchar(255),
                    programme_id varchar(128),
                    ksb_profile_id varchar(128),
                    legacy_numeric_id bigint,
                    ksb_items {json_type},
                    is_active boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def clear_curriculum_tables(self):
        table_names = [
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_COMPLETION_TABLE,
            views.AUTHORING_ADVANCED_TABLE,
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.COHORT_AUTHORING_DETAILS_TABLE,
            'ksb_profiles',
            'programmes',
        ]
        with connection.cursor() as cursor:
            for table in table_names:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')

    def seed_ksb_profile(self):
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {views.authoring_table_name('ksb_profiles')}
                (id, name, programme_name, programme_id, ksb_profile_id, ksb_items, is_active)
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    'KSBP-DATA',
                    'Data Analyst KSBs',
                    'Data Analyst',
                    'PROG-DATA',
                    'KSBP-DATA',
                    json.dumps([{'id': 'KSB-K1', 'code': 'K1', 'type': 'knowledge', 'description': 'Data basics'}]),
                    True,
                ],
            )

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def tree_payload(self, programme_id='PROG-DATA', cohort_id='COHORT-DATA-1', group_id='GROUP-DATA-1', module_id='MOD-DATA-1'):
        return {
            'programme': {
                'id': programme_id,
                'name': 'Data Analyst',
                'standard': 'Data Analyst',
                'level': '4',
                'structureType': 'scheduled',
            },
            'cohorts': [{
                'id': cohort_id,
                'name': 'September 2026',
                'programmeId': programme_id,
                'startDate': '2026-09-01',
                'endDate': '2027-08-31',
                'durationMonths': 12,
                'groups': [{
                    'id': group_id,
                    'name': 'Group A',
                    'coach': 'Coach One',
                    'tutor': 'Tutor One',
                    'weekDays': 'Wednesday',
                    'startTime': '10:00',
                    'endTime': '12:00',
                    'modules': [{
                        'moduleName': 'Data Foundations',
                        'catalogueId': module_id,
                        'startDate': '2026-09-02',
                        'endDate': '2026-09-09',
                        'sessionsNumber': 2,
                        'weekDays': 'Wednesday',
                        'coach': 'Coach One',
                        'tutor': 'Tutor One',
                        'weekStructure': [{
                            'id': 'WEEK-DATA-1',
                            'weekNumber': 1,
                            'title': 'Week 1',
                            'components': [{
                                'id': 'COMP-DATA-1',
                                'type': 'reading',
                                'title': 'Read data brief',
                                'ksbMappings': [{
                                    'id': 'KSBMAP-DATA-1',
                                    'code': 'K1',
                                    'description': 'Data basics',
                                    'classification': 'main',
                                    'weight': 1,
                                    'sourceType': 'framework',
                                    'sourceId': 'KSBP-DATA',
                                }],
                            }],
                        }],
                    }],
                }],
            }],
            'archiveMissing': False,
            'hydrationComplete': True,
        }

    def row(self, table, key, value):
        rows = views.authoring_fetch_all(table, f'{key} = %s', [value])
        self.assertTrue(rows, f'Expected {table}.{key}={value}')
        return rows[0]

    def test_create_programme_tree_with_component_ksb_mapping(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)

        cohort = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        component = self.row(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-DATA-1')
        mapping = self.row(views.AUTHORING_KSB_MAPPINGS_TABLE, 'id', 'KSBMAP-DATA-1')

        self.assertEqual(cohort['programme_id'], 'PROG-DATA')
        self.assertIn('GROUP-DATA-1', views.as_json_value(cohort['group_ids'], []))
        self.assertEqual(group['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')
        self.assertEqual(module['tutor_name'], 'Tutor One')
        self.assertEqual(component['module_catalogue_id'], 'MOD-DATA-1')
        self.assertEqual(mapping['component_id'], 'COMP-DATA-1')

    def test_add_cohort_without_archiving_existing_when_hydration_incomplete(self):
        first = self.tree_payload()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['archiveMissing'] = True
        second['hydrationComplete'] = False

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotEqual(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')['status'], 'archived')
        self.assertNotEqual(self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')['status'], 'archived')

    def test_post_add_module_does_not_detach_existing_modules(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {
            'moduleName': 'Data Visualisation',
            'catalogueId': 'MOD-DATA-2',
            'startDate': '2026-09-16',
            'sessionsNumber': 1,
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['group_id'], 'GROUP-DATA-1')
        self.assertEqual(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-2')['group_id'], 'GROUP-DATA-1')

    def test_patch_replace_group_modules_detaches_omitted_modules(self):
        self.test_post_add_module_does_not_detach_existing_modules()
        response = self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {'modules': [{
            'moduleName': 'Data Visualisation',
            'catalogueId': 'MOD-DATA-2',
            'startDate': '2026-09-16',
            'sessionsNumber': 1,
        }]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['group_id'])
        self.assertEqual(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-2')['group_id'], 'GROUP-DATA-1')

    def test_move_group_updates_both_cohort_group_ids_and_modules(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['archiveMissing'] = False
        self.post_json('/curriculum_api/curriculum/programmes/tree/', second)

        response = self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {'cohortId': 'COHORT-DATA-2'})
        self.assertEqual(response.status_code, 200, response.content)
        old_ids = views.as_json_value(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')['group_ids'], [])
        new_ids = views.as_json_value(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-2')['group_ids'], [])
        self.assertNotIn('GROUP-DATA-1', old_ids)
        self.assertIn('GROUP-DATA-1', new_ids)
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(module['cohort_id'], 'COHORT-DATA-2')
        self.assertEqual(module['programme_id'], 'PROG-DATA')

    def test_id_edits_preserve_parent_relationships(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.patch_json('/curriculum_api/curriculum/cohorts/COHORT-DATA-1/', {'name': 'Renamed Cohort'})
        self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {'name': 'Renamed Group', 'coach': 'Coach Two', 'tutor': 'Tutor Two'})
        self.patch_json('/curriculum_api/curriculum/modules/MOD-DATA-1/', {'name': 'Renamed Module'})

        cohort = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(cohort['programme_id'], 'PROG-DATA')
        self.assertEqual(group['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(group['programme_id'], 'PROG-DATA')
        self.assertEqual(group['coach_name'], 'Coach Two')
        self.assertEqual(group['tutor_name'], 'Tutor Two')
        self.assertEqual(module['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')
