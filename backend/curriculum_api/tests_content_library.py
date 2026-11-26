"""A permanent programme delete must never destroy authored content.

``curriculum.weeks`` and ``curriculum.components`` carry no foreign keys, so
nothing in the database stops a delete from taking them. Two paths used to:
``permanently_delete_programme_structure`` deleted them outright, and
``repair_curriculum_parent_links`` swept up any child whose parent row had gone.

Both are pinned here. A permanent delete now detaches content into the reuse
library, and the orphan sweeper must leave detached rows alone - that second one
matters most, because it runs after every module delete and would silently undo
the whole feature.
"""
from django.db import connection
from django.test import TestCase

from . import views


class ContentLibraryTests(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        views.ensure_module_authoring_tables()
        self._ensure_programmes_table()
        self._clear()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table = 'curriculum.programmes'
            else:
                table = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    status varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.COHORT_AUTHORING_DETAILS_TABLE,
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')
        with connection.cursor() as cursor:
            cursor.execute('delete from ' + views.authoring_table_name('programmes'))

    # ----------------------------------------------------------------- builders

    def _programme(self, programme_id='PROG-1', *, archived=True):
        views.insert_row('programmes', {
            'id': programme_id,
            'programme_id': programme_id,
            'program_id': programme_id,
            'name': 'Data Technician',
            'status': 'archived' if archived else 'active',
            'is_archived': archived,
            'is_active': not archived,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _module(self, module_id='MOD-1', *, programme_id='PROG-1', title='Databases'):
        views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'programme_id': programme_id,
            'programme_name': 'Data Technician',
            'title': title,
        })
        return module_id

    def _week(self, week_id='WEEK-1', *, module_id='MOD-1', number=3):
        views.insert_row(views.AUTHORING_WEEKS_TABLE, {
            'id': week_id,
            'module_catalogue_id': module_id,
            'week_number': number,
            'title': f'Week {number}',
        })
        return week_id

    def _component(self, component_id, *, week_id='WEEK-1', module_id='MOD-1',
                   title='Intro to joins', ctype='reading', description=''):
        views.insert_row(views.AUTHORING_COMPONENTS_TABLE, {
            'id': component_id,
            'week_id': week_id,
            'module_catalogue_id': module_id,
            'type': ctype,
            'title': title,
            'description': description or f'Notes for {title}.',
            'expected_otjh': 2,
            'points': 10,
            'ksb_mappings': views.json_db_value([
                {'code': 'K1', 'description': 'Data structures', 'classification': 'primary', 'weight': 5},
            ]),
            'settings_json': views.json_db_value({'linkedQuizId': '42'}),
        })
        return component_id

    def _component_row(self, component_id):
        rows = views.authoring_fetch_all(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id]
        )
        return rows[0] if rows else {}

    def _week_row(self, week_id):
        rows = views.authoring_fetch_all(views.AUTHORING_WEEKS_TABLE, 'id = %s', [week_id])
        return rows[0] if rows else {}

    def _full_programme(self):
        self._programme()
        self._module()
        self._week()
        self._component('COMP-1', title='Intro to joins')
        self._component('COMP-2', title='Normalisation reading')

    def _permanently_delete(self, programme_id='PROG-1'):
        plan = views.programme_permanent_delete_plan(programme_id)
        return views.permanently_delete_programme_structure(plan)

    # ------------------------------------------------------- preserve on delete

    def test_permanent_delete_detaches_components_instead_of_deleting(self):
        self._full_programme()

        self._permanently_delete()

        for component_id in ('COMP-1', 'COMP-2'):
            row = self._component_row(component_id)
            self.assertTrue(row, f'{component_id} was destroyed by a permanent delete')
            self.assertEqual(row.get('library_state'), views.LIBRARY_STATE_DETACHED)
            self.assertEqual(views.clean_str(row.get('module_catalogue_id')), '')
            self.assertEqual(views.clean_str(row.get('week_id')), '')
            # A library item is available, not archived.
            self.assertIsNone(row.get('deleted_at'))
            self.assertFalse(views.programme_deleted_row(row))
            self.assertIsNotNone(row.get('detached_at'))

    def test_detach_clears_the_soft_delete_stamps_of_archived_content(self):
        """The real path: a programme is archived first, then deleted for good.

        Archiving stamps every child with deleted_at/deleted_via_parent, and a
        permanent delete is only offered on an archived programme - so the rows
        being detached are always already stamped. The detach has to clear them,
        or content would land in the library still marked deleted.
        """
        self._full_programme()
        views.soft_delete_programme_authoring_structure('PROG-1')
        # Precondition: the cascade really did stamp the components.
        self.assertTrue(views.programme_deleted_row(self._component_row('COMP-1')))

        self._permanently_delete()

        row = self._component_row('COMP-1')
        self.assertEqual(row.get('library_state'), views.LIBRARY_STATE_DETACHED)
        self.assertIsNone(row.get('deleted_at'))
        self.assertIsNone(row.get('deleted_via_parent'))
        self.assertFalse(views.programme_deleted_row(row))
        # And it reads back out of the library as available, not archived.
        by_id = {item['id']: item for item in views.library_component_rows()}
        self.assertEqual(by_id['COMP-1']['origin'], views.LIBRARY_ORIGIN_LIBRARY)

    def test_permanent_delete_records_where_content_came_from(self):
        """The module title is unrecoverable after the delete, so it is stamped."""
        self._full_programme()

        self._permanently_delete()

        row = self._component_row('COMP-1')
        self.assertEqual(row.get('origin_module_catalogue_id'), 'MOD-1')
        self.assertEqual(row.get('origin_module_title'), 'Databases')
        self.assertEqual(row.get('origin_week_id'), 'WEEK-1')
        self.assertEqual(row.get('origin_week_label'), 'Week 3')

    def test_a_component_with_no_week_is_still_detached_with_its_module(self):
        """Weekless components exist (weeks carry no FK) and must not be lost."""
        self._programme()
        self._module()
        self._week()
        self._component('COMP-NO-WEEK', week_id='')

        self._permanently_delete()

        row = self._component_row('COMP-NO-WEEK')
        self.assertTrue(row, 'a weekless component was destroyed')
        self.assertEqual(row.get('library_state'), views.LIBRARY_STATE_DETACHED)
        self.assertEqual(row.get('origin_module_title'), 'Databases')

    def test_permanent_delete_detaches_weeks_and_removes_the_module(self):
        self._full_programme()

        self._permanently_delete()

        week = self._week_row('WEEK-1')
        self.assertTrue(week, 'the week was destroyed by a permanent delete')
        self.assertEqual(week.get('library_state'), views.LIBRARY_STATE_DETACHED)
        self.assertEqual(week.get('origin_module_title'), 'Databases')
        # The delivery scaffolding really does go.
        self.assertEqual(
            views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-1']),
            [],
        )

    def test_detached_component_keeps_its_ksbs_and_quiz_link(self):
        """0042 made components own their KSBs, so wiping the projection is safe."""
        self._full_programme()

        self._permanently_delete()

        row = self._component_row('COMP-1')
        mappings = views.component_ksb_mappings_from_row(row)
        self.assertEqual([mapping.get('ksb_code') for mapping in mappings], ['K1'])
        settings = views.as_json_value(row.get('settings_json'), {})
        self.assertEqual(views.clean_str(settings.get('linkedQuizId')), '42')

    # ------------------------------------------------------- the orphan sweeper

    def test_orphan_sweeper_leaves_detached_content_alone(self):
        """The regression that would silently destroy the whole library."""
        self._full_programme()
        self._permanently_delete()

        views.repair_curriculum_parent_links()

        for component_id in ('COMP-1', 'COMP-2'):
            self.assertTrue(
                self._component_row(component_id),
                f'{component_id} was swept away by the orphan repair',
            )
        self.assertTrue(self._week_row('WEEK-1'))

    def test_orphan_sweeper_still_removes_a_genuine_orphan(self):
        """The guard must not blunt the sweeper for real orphans."""
        self._programme(archived=False)
        self._week('WEEK-ORPHAN', module_id='MOD-GONE')
        self._component('COMP-ORPHAN', week_id='WEEK-ORPHAN', module_id='MOD-GONE')

        views.repair_curriculum_parent_links()

        self.assertEqual(self._component_row('COMP-ORPHAN'), {})
        self.assertEqual(self._week_row('WEEK-ORPHAN'), {})

    def test_second_detach_keeps_the_original_origin(self):
        """Re-detaching must not restamp content with the wrong parent."""
        self._full_programme()
        self._permanently_delete()

        views.detach_rows_to_library(
            views.AUTHORING_COMPONENTS_TABLE,
            'id = %s',
            ['COMP-1'],
            origin_module_id='MOD-OTHER',
            origin_module_title='Somewhere Else',
        )

        self.assertEqual(self._component_row('COMP-1').get('origin_module_title'), 'Databases')

    # -------------------------------------------------------------- library read

    def test_detached_components_are_hidden_from_the_normal_list(self):
        """A detach clears deleted_at, so the active filter must exclude it too."""
        self._full_programme()
        self._permanently_delete()

        ids = {row['id'] for row in views.component_builder_rows()}
        self.assertNotIn('COMP-1', ids)
        self.assertNotIn('COMP-2', ids)

    def test_library_read_classifies_each_origin(self):
        self._full_programme()
        # A second, live programme whose component stays attached.
        self._programme('PROG-LIVE', archived=False)
        self._module('MOD-LIVE', programme_id='PROG-LIVE', title='Live Module')
        self._week('WEEK-LIVE', module_id='MOD-LIVE', number=1)
        self._component('COMP-LIVE', week_id='WEEK-LIVE', module_id='MOD-LIVE', title='Live reading')
        # A third whose module is archived rather than deleted.
        self._module('MOD-ARCHIVED', programme_id='PROG-LIVE', title='Archived Module')
        self._week('WEEK-ARCHIVED', module_id='MOD-ARCHIVED', number=2)
        self._component('COMP-ARCHIVED', week_id='WEEK-ARCHIVED', module_id='MOD-ARCHIVED',
                        title='Archived reading')
        views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-ARCHIVED'], deleted_by='test',
        )

        self._permanently_delete()

        by_id = {row['id']: row for row in views.library_component_rows()}
        self.assertEqual(by_id['COMP-1']['origin'], views.LIBRARY_ORIGIN_LIBRARY)
        self.assertEqual(by_id['COMP-LIVE']['origin'], views.LIBRARY_ORIGIN_ACTIVE)
        self.assertEqual(by_id['COMP-ARCHIVED']['origin'], views.LIBRARY_ORIGIN_ARCHIVED)

    def test_library_read_labels_a_detached_component_with_its_origin(self):
        self._full_programme()
        self._permanently_delete()

        row = {item['id']: item for item in views.library_component_rows()}['COMP-1']
        self.assertEqual(row['originModuleTitle'], 'Databases')
        self.assertEqual(row['originWeekLabel'], 'Week 3')
        # The picker shows these directly, so they must not fall back to blank.
        self.assertEqual(row['module'], 'Databases')
        self.assertEqual(row['week'], 'Week 3')

    def test_the_list_read_leaves_the_heavy_fields_out(self):
        """settings_json is 24 MB across this table; the picker never shows it."""
        self._full_programme()
        self._permanently_delete()

        row = {item['id']: item for item in views.library_component_rows()}['COMP-1']
        self.assertFalse(row['settings'], 'the list must not carry settings_json')
        self.assertEqual(row['ksbMappings'], [])
        # The list still has everything the picker renders.
        self.assertEqual(row['title'], 'Intro to joins')
        self.assertEqual(row['componentType'], 'reading')
        self.assertEqual(row['origin'], views.LIBRARY_ORIGIN_LIBRARY)

    def test_the_detail_read_carries_what_a_copy_needs(self):
        """Fetched by id, for the handful of components actually being copied."""
        self._full_programme()
        self._permanently_delete()

        rows = views.library_component_rows(ids=['COMP-1'], detail=True)
        self.assertEqual([item['id'] for item in rows], ['COMP-1'])
        row = rows[0]
        self.assertEqual([mapping.get('code') for mapping in row['ksbMappings']], ['K1'])
        self.assertEqual(views.clean_str(row['settings'].get('linkedQuizId')), '42')

    def test_an_ids_read_returns_only_those_components(self):
        self._full_programme()

        rows = views.library_component_rows(ids=['COMP-2'], detail=True)

        self.assertEqual([item['id'] for item in rows], ['COMP-2'])

    def test_the_page_window_is_applied_in_sql(self):
        """The LIMIT is what keeps this off a full read of an 18k-row table."""
        self._full_programme()
        self._component('COMP-3', title='Third reading')

        first = views.library_component_rows(page=1, page_size=2)
        second = views.library_component_rows(page=2, page_size=2)

        self.assertEqual(len(first), 2)
        self.assertEqual(len(second), 1)
        self.assertFalse(
            {item['id'] for item in first} & {item['id'] for item in second},
            'pages must not overlap',
        )

    def test_library_read_filters_by_search_type_and_origin(self):
        self._full_programme()
        self._component('COMP-VIDEO', title='Joins on video', ctype='video')

        self.assertEqual(
            {row['id'] for row in views.library_component_rows(search='normalisation')},
            {'COMP-2'},
        )
        self.assertEqual(
            {row['id'] for row in views.library_component_rows(types=['video'])},
            {'COMP-VIDEO'},
        )
        # Nothing is detached yet, so the library bucket is empty.
        self.assertEqual(views.library_component_rows(origins=['library']), [])
        self.assertEqual(
            {row['id'] for row in views.library_component_rows(origins=['active'])},
            {'COMP-1', 'COMP-2', 'COMP-VIDEO'},
        )

    def test_origin_filter_excludes_active_when_unticked(self):
        """Unticking a bucket must actually remove it from the results."""
        self._full_programme()
        self._component('COMP-ARCHIVED', title='Archived reading')
        views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-ARCHIVED'], deleted_by='test',
        )

        archived_only = views.library_component_rows(origins=['archived'])

        self.assertEqual({row['id'] for row in archived_only}, {'COMP-ARCHIVED'})
        self.assertNotIn('COMP-1', {row['id'] for row in archived_only})

    def test_origin_filter_works_without_the_library_state_column(self):
        """The regression: active-vs-archived must not depend on 0053.

        The filter used to be gated on has_column('library_state'), so on a
        database without that column the whole thing silently became a no-op and
        every bucket returned the live components regardless of what was ticked.
        Only the 'library' bucket actually needs the column.
        """
        self._full_programme()
        self._component('COMP-ARCHIVED', title='Archived reading')
        views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-ARCHIVED'], deleted_by='test',
        )
        original = views.has_column

        def without_library_state(table, column):
            if table == views.AUTHORING_COMPONENTS_TABLE and column == 'library_state':
                return False
            return original(table, column)

        views.has_column = without_library_state
        try:
            active_only = views.library_component_rows(origins=['active'])
            archived_only = views.library_component_rows(origins=['archived'])
            library_only = views.library_component_rows(origins=['library'])
        finally:
            views.has_column = original

        active_ids = {row['id'] for row in active_only}
        self.assertIn('COMP-1', active_ids)
        self.assertNotIn('COMP-ARCHIVED', active_ids)
        self.assertEqual({row['id'] for row in archived_only}, {'COMP-ARCHIVED'})
        # Nothing can be detached without the column, so that bucket is empty
        # rather than falling back to everything.
        self.assertEqual(library_only, [])

    def test_library_endpoint_returns_results(self):
        self._full_programme()
        self._permanently_delete()

        response = self.client.get('/curriculum_api/curriculum/components/library/', {'search': 'joins'})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual([row['id'] for row in payload['results']], ['COMP-1'])
        self.assertEqual(payload['results'][0]['origin'], views.LIBRARY_ORIGIN_LIBRARY)
