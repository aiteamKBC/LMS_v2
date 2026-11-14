"""A permanent programme delete must never destroy authored content.

Every week belongs to a module and every component to a week on the current
curriculum database, so authored content cannot outlive its programme. A
permanent delete of a programme that still owns weeks or components is refused
whole, before anything is written, and the programme stays archived.

The component reuse search (``library_component_rows``) still offers live and
archived components; its ``library`` (detached) bucket is always empty, because
nothing can be detached any more.
"""
from unittest.mock import patch

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
                    programme_id varchar(128) primary key,
                    name varchar(255) not null default '',
                    color varchar(32) not null default '',
                    status varchar(32) not null default 'active',
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
            'programme_id': programme_id,
            'name': 'Data Technician',
            'color': '#000000',
            'status': 'inactive' if archived else 'active',
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _module(self, module_id='MOD-1', *, programme_id='PROG-1', title='Databases'):
        views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'programme_id': programme_id,
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

    def _module_rows(self, module_id='MOD-1'):
        # A plain read of the stored row: whether it still exists is the question.
        return views.fetch_all(
            f'select module_catalogue_id from {views.authoring_table_name(views.AUTHORING_MODULES_TABLE)} '
            'where module_catalogue_id = %s', [module_id],
        )

    def _full_programme(self):
        self._programme()
        self._module()
        self._week()
        self._component('COMP-1', title='Intro to joins')
        self._component('COMP-2', title='Normalisation reading')

    def _plan(self, programme_id='PROG-1', *, module_ids=('MOD-1',), week_ids=('WEEK-1',),
              component_ids=('COMP-1', 'COMP-2')):
        # Built by hand: the plan builder reads curriculum.programmes by its
        # schema-qualified name, which the SQLite harness does not have.
        return {
            'candidates': [programme_id],
            'childIds': {
                'moduleIds': list(module_ids), 'weekIds': list(week_ids),
                'componentIds': list(component_ids), 'groupIds': [], 'cohortIds': [],
                'weekTemplateIds': [],
            },
        }

    def _archive(self, component_id):
        views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id], deleted_by='test',
        )

    # ------------------------------------------------------- preserve on delete

    def test_permanent_delete_is_refused_while_the_programme_owns_content(self):
        self._full_programme()

        with self.assertRaises(views.ProgrammeContentRetained):
            views.permanently_delete_programme_structure(self._plan())

        for component_id in ('COMP-1', 'COMP-2'):
            self.assertTrue(self._component_row(component_id), f'{component_id} was destroyed')
        self.assertTrue(self._week_row('WEEK-1'), 'the week was destroyed')
        self.assertTrue(self._module_rows(), 'the module was removed despite the refusal')

    def test_the_refusal_comes_before_any_write(self):
        self._full_programme()
        writes = []
        with patch.object(views, 'delete_rows', lambda *args, **kwargs: writes.append(args) or []), \
                patch.object(views, 'update_rows', lambda *args, **kwargs: writes.append(args) or []):
            with self.assertRaises(views.ProgrammeContentRetained):
                views.permanently_delete_programme_structure(self._plan())
        self.assertEqual(writes, [])

    def test_a_programme_without_content_is_deleted(self):
        self._programme()
        self._module()

        views.permanently_delete_programme_structure(self._plan(week_ids=(), component_ids=()))

        self.assertEqual(self._module_rows(), [])

    # ------------------------------------------------------- the orphan sweeper

    def test_orphan_sweeper_still_removes_a_genuine_orphan(self):
        self._programme(archived=False)
        self._week('WEEK-ORPHAN', module_id='MOD-GONE')
        self._component('COMP-ORPHAN', week_id='WEEK-ORPHAN', module_id='MOD-GONE')

        views.repair_curriculum_parent_links()

        self.assertEqual(self._component_row('COMP-ORPHAN'), {})
        self.assertEqual(self._week_row('WEEK-ORPHAN'), {})

    # -------------------------------------------------------------- reuse search

    def test_reuse_read_classifies_active_and_archived(self):
        self._full_programme()
        self._component('COMP-ARCHIVED', title='Archived reading')
        self._archive('COMP-ARCHIVED')

        by_id = {row['id']: row for row in views.library_component_rows()}
        self.assertEqual(by_id['COMP-1']['origin'], views.LIBRARY_ORIGIN_ACTIVE)
        self.assertEqual(by_id['COMP-ARCHIVED']['origin'], views.LIBRARY_ORIGIN_ARCHIVED)

    def test_the_library_bucket_is_always_empty(self):
        """Nothing is ever detached, so asking for it returns nothing - never everything."""
        self._full_programme()
        self._component('COMP-ARCHIVED', title='Archived reading')
        self._archive('COMP-ARCHIVED')

        self.assertEqual(views.library_component_rows(origins=['library']), [])

    def test_a_row_carries_its_module_and_week(self):
        self._full_programme()

        row = {item['id']: item for item in views.library_component_rows()}['COMP-1']
        self.assertEqual(row['originModuleTitle'], 'Databases')
        self.assertEqual(row['originWeekLabel'], 'Week 3')
        self.assertEqual(row['module'], 'Databases')
        self.assertEqual(row['week'], 'Week 3')
        self.assertIsNone(row['detachedAt'])

    def test_the_list_read_leaves_the_heavy_fields_out(self):
        """settings_json is 24 MB across this table; the picker never shows it."""
        self._full_programme()

        row = {item['id']: item for item in views.library_component_rows()}['COMP-1']
        self.assertFalse(row['settings'], 'the list must not carry settings_json')
        self.assertEqual(row['ksbMappings'], [])
        self.assertEqual(row['title'], 'Intro to joins')
        self.assertEqual(row['componentType'], 'reading')

    def test_the_detail_read_carries_what_a_copy_needs(self):
        """Fetched by id, for the handful of components actually being copied."""
        self._full_programme()

        rows = views.library_component_rows(ids=['COMP-1'], detail=True)
        self.assertEqual([item['id'] for item in rows], ['COMP-1'])
        self.assertEqual(views.clean_str(rows[0]['settings'].get('linkedQuizId')), '42')

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

    def test_reuse_read_filters_by_search_type_and_origin(self):
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
        self.assertEqual(
            {row['id'] for row in views.library_component_rows(origins=['active'])},
            {'COMP-1', 'COMP-2', 'COMP-VIDEO'},
        )

    def test_origin_filter_excludes_active_when_unticked(self):
        """Unticking a bucket must actually remove it from the results."""
        self._full_programme()
        self._component('COMP-ARCHIVED', title='Archived reading')
        self._archive('COMP-ARCHIVED')

        archived_only = views.library_component_rows(origins=['archived'])

        self.assertEqual({row['id'] for row in archived_only}, {'COMP-ARCHIVED'})

    def test_reuse_endpoint_returns_results(self):
        self._full_programme()

        response = self.client.get('/curriculum_api/curriculum/components/library/', {'search': 'joins'})

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual([row['id'] for row in payload['results']], ['COMP-1'])
        self.assertEqual(payload['results'][0]['origin'], views.LIBRARY_ORIGIN_ACTIVE)
